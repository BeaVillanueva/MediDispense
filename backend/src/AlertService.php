<?php
declare(strict_types=1);

/** Database-only incident detection. Never sends mail or issues hardware commands. */
final class AlertService {
    public function __construct(private PDO $db, private int $timeoutSeconds=120, private string $lockName='medidispense_alert_scan') {}
    private function query(string $sql,array $args=[]): PDOStatement { $q=$this->db->prepare($sql); $q->execute($args); return $q; }
    public function installed(): bool {
        try { $this->db->query('SELECT id FROM alert_incidents LIMIT 0'); return true; }
        catch(PDOException $e) { if (in_array((int)($e->errorInfo[1]??0),[1146],true)) return false; throw $e; }
    }
    public function scan(): void {
        if ($this->db->inTransaction()) throw new RuntimeException('Alert detection must run outside purchase transactions.');
        if (!$this->installed()) return;
        // Multiple workers / dashboard polls cannot create competing incidents.
        if (!(int)$this->query('SELECT GET_LOCK(?,0)',[$this->lockName])->fetchColumn()) return;
        try {
            $this->db->beginTransaction();
            $rows=$this->db->query('SELECT m.id medicine_id,m.name,m.minimum_stock_level,i.quantity,i.reserved_quantity,s.id slot_id,s.slot_number FROM medicines m JOIN inventory i ON i.medicine_id=m.id JOIN machine_slots s ON s.medicine_id=m.id WHERE m.is_enabled=1')->fetchAll();
            $low=[];
            foreach($rows as $r) {
                $key='low:'.$r['medicine_id'].':'.$r['slot_id'];
                $available=max(0,(int)$r['quantity']-(int)$r['reserved_quantity']);
                if ($available>(int)$r['minimum_stock_level']) continue;
                $low[]=$key;
                $details=['medicine_name'=>$r['name'],'slot_number'=>(int)$r['slot_number'],'available_stock'=>$available,'threshold'=>(int)$r['minimum_stock_level'],'issue_type'=>$available===0?'out_of_stock':'low_stock','action'=>$available===0?'Out of stock. Restock this medicine to restore availability.':'Restock this medicine to avoid unavailability.'];
                $this->incident($key,'stock:'.bin2hex(random_bytes(16)),'low_stock',$r,$details);
            }
            foreach($this->db->query("SELECT * FROM alert_incidents WHERE kind='low_stock' AND resolved_at IS NULL AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(details,'$.is_test')),'false') <> 'true'")->fetchAll() as $i) {
                if (!in_array($i['active_key'],$low,true)) $this->resolveRow((int)$i['id'],null,'Inventory recovered above its threshold or medicine was removed from service.');
            }
            $requests=$this->query("SELECT dr.*,t.transaction_code,t.dispensing_status,t.payment_status,s.slot_number,ti.medicine_id,ti.medicine_name_snapshot name,
              ms.motor_status,ms.sensor_status,ms.esp32_status,
              (ms.last_communication_at >= COALESCE(dr.sent_at,dr.requested_at)) fresh_hardware_status,
              TIMESTAMPDIFF(SECOND,COALESCE(dr.sent_at,dr.requested_at),NOW()) elapsed
              FROM dispensing_requests dr JOIN transactions t ON t.id=dr.transaction_id JOIN machine_slots s ON s.id=dr.slot_id
              LEFT JOIN machine_status ms ON ms.machine_id=dr.machine_id
              JOIN transaction_items ti ON ti.transaction_id=t.id AND ti.slot_id=dr.slot_id
              WHERE (t.dispensing_status='dispensing' AND t.payment_status='successful') OR
              (dr.completed_at >= (SELECT setting_value FROM system_settings WHERE setting_key='alert_monitor_started_at') AND dr.request_status IN ('failed','timeout'))")->fetchAll();
            foreach($requests as $r) {
                $log=$this->query("SELECT event_type,motor_status FROM dispensing_logs WHERE dispensing_request_id=? AND (event_type IN ('dispensing_failed','timeout') OR LOWER(COALESCE(motor_status,'')) REGEXP '(^|[^a-z])(error|failed|jammed|stalled)([^a-z]|$)') ORDER BY id DESC LIMIT 1",[$r['id']])->fetch();
                $heartbeatError=(bool)$r['fresh_hardware_status'] && preg_match('/\b(error|failed|jammed|stalled)\b/i',($r['motor_status']??'').' '.($r['sensor_status']??'').' '.($r['esp32_status']??''))===1;
                $issue=$r['request_status']==='failed'?'sensor_or_dispensing_failure':($r['request_status']==='timeout'?'confirmation_timeout':($log||$heartbeatError?'hardware_error':((int)$r['elapsed'] >= max(10,$this->timeoutSeconds)?'confirmation_timeout':null)));
                if (!$issue) continue;
                $hardware=$log?:($heartbeatError?['motor_status'=>$r['motor_status'],'sensor_status'=>$r['sensor_status'],'esp32_status'=>$r['esp32_status']]:null);
                $details=['medicine_name'=>$r['name'],'slot_number'=>(int)$r['slot_number'],'transaction_reference'=>$r['transaction_code'],'issue_type'=>$issue,'confirmed_units'=>(int)$r['dispensed_quantity'],'requested_units'=>(int)$r['quantity'],'hardware_details'=>$hardware,'timeout_seconds'=>max(10,$this->timeoutSeconds),'action'=>'Technical assistance required. Inspect the mechanism and verify whether medicine was released. Do not automatically retry dispensing.'];
                $this->incident('dispense:'.$r['id'],'dispense:'.$r['id'],'dispensing_failure',$r,$details,(int)$r['id']);
            }
            // A genuine full confirmation resolves a timeout, never a successful command alone.
            foreach($this->db->query("SELECT a.id,dr.quantity,dr.dispensed_quantity,dr.request_status,t.dispensing_status FROM alert_incidents a JOIN dispensing_requests dr ON dr.id=a.request_id JOIN transactions t ON t.id=dr.transaction_id WHERE a.kind='dispensing_failure' AND a.resolved_at IS NULL")->fetchAll() as $i) {
                if ($i['request_status']==='success' && $i['dispensing_status']==='dispensed' && (int)$i['quantity']===(int)$i['dispensed_quantity']) $this->resolveRow((int)$i['id'],null,'All requested units were confirmed by dispensing feedback.');
            }
            $this->queueEmails();
            $this->db->commit();
        } catch(Throwable $e) { if($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
        finally { $this->query('SELECT RELEASE_LOCK(?)',[$this->lockName]); }
    }
    private function incident(string $activeKey,string $key,string $kind,array $r,array $details,?int $request=null): void {
        $existing=$this->query('SELECT id,resolved_at,details,notification_id FROM alert_incidents WHERE active_key=? OR incident_key=? LIMIT 1',[$activeKey,$key])->fetch();
        $out=$kind==='low_stock' && (int)$details['available_stock']===0;
        $type=$out?'out_of_stock':$kind;
        $title=$kind==='low_stock'?($out?'Out of Stock Alert':'Low Stock Alert'):'URGENT: Dispensing Issue Detected';
        $message=$details['medicine_name'].' · Slot '.$details['slot_number'].' · '.($kind==='low_stock'?'Available: '.$details['available_stock'].'; threshold: '.$details['threshold']:$details['transaction_reference'].' · '.str_replace('_',' ',$details['issue_type'])).'. '.$details['action'];
        if ($existing) {
            if ($kind==='low_stock' && !$existing['resolved_at'] && json_decode($existing['details'],true)!==$details) {
                $this->query('UPDATE alert_incidents SET details=? WHERE id=?',[json_encode($details,JSON_THROW_ON_ERROR),$existing['id']]);
                $this->query('UPDATE notifications SET notification_type=?,title=?,message=? WHERE id=?',[$type,$title,$message,$existing['notification_id']]);
            }
            return;
        }
        $notification=false;
        if ($request) $notification=$this->query("SELECT id FROM notifications WHERE notification_type='dispensing_failure' AND transaction_id=? ORDER BY id DESC LIMIT 1",[$r['transaction_id']])->fetchColumn();
        if (!$notification) {
            $this->query('INSERT INTO notifications(notification_type,title,message,severity,medicine_id,transaction_id) VALUES(?,?,?,?,?,?)',[$type,$title,$message,$kind==='low_stock'?'warning':'danger',$r['medicine_id'],$r['transaction_id']??null]);
            $notification=(int)$this->db->lastInsertId();
        } else $this->query('UPDATE notifications SET title=?,message=?,severity=? WHERE id=?',[$title,$message,'danger',$notification]);
        $this->query('INSERT INTO alert_incidents(incident_key,active_key,notification_id,kind,medicine_id,slot_id,request_id,details) VALUES(?,?,?,?,?,?,?,?)',[$key,$activeKey,$notification,$kind,$r['medicine_id'],$r['slot_id'],$request,json_encode($details,JSON_THROW_ON_ERROR)]);
    }
    private function resolveRow(int $id,?int $actor,string $note): void {
        $this->query('UPDATE alert_incidents SET resolved_at=NOW(),resolved_by=?,resolution_note=?,active_key=NULL WHERE id=? AND resolved_at IS NULL',[$actor,$note,$id]);
        $this->query("UPDATE alert_email_jobs SET status='cancelled',last_error='Incident resolved before delivery' WHERE incident_id=? AND status IN ('pending','retry')",[$id]);
    }
    public function queueEmails(): void {
        $this->db->exec("INSERT IGNORE INTO alert_email_jobs(incident_id,user_id,recipient,message_id)
          SELECT a.id,u.id,u.email,CONCAT('<medidispense-alert-',a.id,'-',u.id,'@alerts.medidispense.local>')
          FROM alert_incidents a JOIN alert_recipients p ON (a.kind='low_stock' AND p.low_stock=1) OR (a.kind='dispensing_failure' AND p.dispensing_failure=1)
          JOIN users u ON u.id=p.user_id JOIN roles r ON r.id=u.role_id
          WHERE a.resolved_at IS NULL AND u.is_active=1 AND u.email_verified_at IS NOT NULL AND r.code IN ('super_admin','admin','staff')");
    }
    private function productionNotificationCondition(): string {
        return "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.details,'$.is_test')),'false')<>'true'
          AND UPPER(LTRIM(n.title)) NOT LIKE '[TEST]%' AND UPPER(LTRIM(n.message)) NOT LIKE '[TEST]%'
          AND UPPER(LTRIM(n.title)) NOT LIKE '[TEST %' AND UPPER(LTRIM(n.message)) NOT LIKE '[TEST %'
          AND (a.resolved_at IS NULL OR a.kind<>'low_stock' OR m.minimum_stock_level IS NULL
            OR CAST(JSON_UNQUOTE(JSON_EXTRACT(a.details,'$.threshold')) AS UNSIGNED)=m.minimum_stock_level)";
    }
    public function notifications(int $user, bool $includeAudit=false): array {
        $where=$includeAudit?'1=1':'nd.user_id IS NULL AND '.$this->productionNotificationCondition();
        return $this->query('SELECT n.*,IF(nr.user_id IS NULL,0,1) is_read,a.id incident_id,a.kind incident_kind,a.details,a.detected_at,a.acknowledged_at,a.resolved_at,a.resolution_note,
          (SELECT j.status FROM alert_email_jobs j WHERE j.incident_id=a.id ORDER BY FIELD(j.status,\'uncertain\',\'dead\',\'retry\',\'pending\',\'processing\',\'sent\',\'cancelled\') LIMIT 1) email_status
          FROM notifications n LEFT JOIN notification_reads nr ON nr.notification_id=n.id AND nr.user_id=? LEFT JOIN alert_incidents a ON a.notification_id=n.id
          LEFT JOIN medicines m ON m.id=a.medicine_id LEFT JOIN notification_dismissals nd ON nd.notification_id=n.id AND nd.user_id=?
          WHERE '.$where.' ORDER BY n.created_at DESC,n.id DESC LIMIT 250',[$user,$user])->fetchAll();
    }
    public function dismissAll(int $throughId,array $actor): int {
        if(!in_array($actor['role_code']??'', ['super_admin','admin','staff'],true)) throw new KioskError('FORBIDDEN','Staff access required.',403);
        if($throughId<1)throw new KioskError('INVALID_NOTIFICATION','A notification boundary is required.',422);
        $this->db->beginTransaction();
        try {
            // Bound the action to what existed when confirmation opened. New arrivals stay visible.
            $q=$this->query('INSERT IGNORE INTO notification_dismissals(notification_id,user_id)
              SELECT n.id,? FROM notifications n LEFT JOIN alert_incidents a ON a.notification_id=n.id LEFT JOIN medicines m ON m.id=a.medicine_id
              WHERE n.id<=? AND '.$this->productionNotificationCondition(),[$actor['id'],$throughId]);
            $count=$q->rowCount();
            $this->query("INSERT INTO activity_logs(actor_type,actor_user_id,action,description,metadata) VALUES('user',?,'notifications_dismissed','Notifications archived for this user only; incident and email state unchanged.',?)",[$actor['id'],json_encode(['through_id'=>$throughId,'dismissed'=>$count])]);
            $this->db->commit();return $count;
        }catch(Throwable $e){if($this->db->inTransaction())$this->db->rollBack();throw $e;}
    }
    public function manage(int $notification,string $action,array $actor,string $reason=''): void {
        if (!in_array($actor['role_code']??'', ['super_admin','admin','staff'],true)) throw new KioskError('FORBIDDEN','Staff access required.',403);
        if (!$this->query('SELECT id FROM notifications WHERE id=?',[$notification])->fetchColumn()) throw new KioskError('NOT_FOUND','Notification not found.',404);
        if ($action==='read') { $this->query('INSERT IGNORE INTO notification_reads(notification_id,user_id) VALUES(?,?)',[$notification,$actor['id']]); return; }
        $this->db->beginTransaction();
        try {
            $i=$this->query('SELECT * FROM alert_incidents WHERE notification_id=? FOR UPDATE',[$notification])->fetch();
            if (!$i) throw new KioskError('NOT_MANAGED','This legacy notification has no managed incident.');
            if ($action==='acknowledge') $this->query('UPDATE alert_incidents SET acknowledged_at=COALESCE(acknowledged_at,NOW()),acknowledged_by=COALESCE(acknowledged_by,?) WHERE id=?',[$actor['id'],$i['id']]);
            elseif ($action==='resolve') {
                if (strlen(trim($reason))<5 || strlen($reason)>500) throw new KioskError('REASON_REQUIRED','Enter a resolution note (5–500 characters).',422);
                $test=json_decode($i['details'],true)['is_test']??false;
                if ($test===true) {
                    // Only the CLI fixture runner creates test incidents. Never inspect or alter hardware for them.
                } elseif ($i['kind']==='low_stock') {
                    $r=$this->query('SELECT i.quantity,i.reserved_quantity,m.minimum_stock_level FROM inventory i JOIN medicines m ON m.id=i.medicine_id WHERE i.medicine_id=?',[$i['medicine_id']])->fetch();
                    if ($r && max(0,(int)$r['quantity']-(int)$r['reserved_quantity']) <= (int)$r['minimum_stock_level']) throw new KioskError('CONDITION_ACTIVE','Restock above the threshold before resolving this alert.');
                } else {
                    $r=$this->query('SELECT t.dispensing_status,s.slot_status FROM dispensing_requests dr JOIN transactions t ON t.id=dr.transaction_id JOIN machine_slots s ON s.id=dr.slot_id WHERE dr.id=?',[$i['request_id']])->fetch();
                    if (!$r || $r['dispensing_status']==='dispensing' || !in_array($r['slot_status'],['ready','low'],true)) throw new KioskError('CONDITION_ACTIVE','Complete staff recovery and slot reconciliation before resolving this alert.');
                }
                $this->resolveRow((int)$i['id'],(int)$actor['id'],trim($reason));
            } else throw new KioskError('INVALID_ACTION','Invalid notification action.',422);
            $this->query("INSERT INTO activity_logs(actor_type,actor_user_id,action,description,metadata) VALUES('user',?,'alert_managed',?,?)",[$actor['id'],'Alert '.$action,json_encode(['incident_id'=>(int)$i['id'],'action'=>$action,'reason'=>$reason])]);
            $this->db->commit();
        } catch(Throwable $e) { if($this->db->inTransaction())$this->db->rollBack(); throw $e; }
    }
    public function recipients(): array {
        return $this->db->query("SELECT u.id,u.display_name,u.email,r.code role_code,COALESCE(p.low_stock,0) low_stock,COALESCE(p.dispensing_failure,0) dispensing_failure FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN alert_recipients p ON p.user_id=u.id WHERE u.is_active=1 AND u.email_verified_at IS NOT NULL AND r.code IN ('super_admin','admin','staff') ORDER BY u.id")->fetchAll();
    }
    public function saveRecipients(array $recipients,array $actor): void {
        if (($actor['role_code']??'')!=='super_admin') throw new KioskError('FORBIDDEN','Super Admin access required.',403);
        $eligible=array_column($this->recipients(),'id');
        foreach($recipients as $r) if (!is_int($r['user_id']??null) || !in_array($r['user_id'],$eligible) || !is_bool($r['low_stock']??null) || !is_bool($r['dispensing_failure']??null)) throw new KioskError('INVALID_RECIPIENT','Choose active, email-verified staff accounts.',422);
        $this->db->beginTransaction();
        try {
            $this->db->exec('DELETE FROM alert_recipients');
            foreach($recipients as $r) $this->query('INSERT INTO alert_recipients(user_id,low_stock,dispensing_failure,updated_by) VALUES(?,?,?,?)',[$r['user_id'],(int)$r['low_stock'],(int)$r['dispensing_failure'],$actor['id']]);
            $this->query("INSERT INTO activity_logs(actor_type,actor_user_id,action,description,metadata) VALUES('user',?,'alert_recipients_updated','Notification recipient preferences updated.',?)",[$actor['id'],json_encode($recipients)]);
            $this->queueEmails();
            $this->db->commit();
        } catch(Throwable $e) { if($this->db->inTransaction())$this->db->rollBack(); throw $e; }
    }
}
