<?php
declare(strict_types=1);
/** Descriptive telemetry only. Never sufficient to authorize expiration/handoff. */
final class CoinPaymentDiagnostics {
    public function __construct(private PDO $db,private string $machineCode,private ?Closure $commandState=null){}
    /** Retired evidence stays readable; renewed reports reactivate the safety blocker. */
    public function activeReports():array {
        return array_values(array_filter($this->read(),fn($d)=>!($d['retired']??false)));
    }
    public function retire(array $body,array $actor):array {
        if(($actor['role_code']??'')!=='super_admin')throw new KioskError('FORBIDDEN','Super Admin maintenance access required.',403);
        $old=strtoupper($body['old_device_id']??'');$new=strtoupper($body['new_device_id']??'');
        if(!preg_match('/^[A-F0-9]{12}$/D',$old)||!preg_match('/^[A-F0-9]{12}$/D',$new)||$old===$new)throw new KioskError('INVALID_CONTROLLER','Two distinct controller IDs required.',422);
        if(($body['old_disconnected']??false)!==true||($body['no_unrecorded_coins']??false)!==true||($body['new_physically_verified']??false)!==true)throw new KioskError('PHYSICAL_VERIFICATION_REQUIRED','Confirm both controller identities, old board disconnection and no unrecorded coins.',422);
        $this->db->beginTransaction();
        try {
            $q=$this->db->prepare('SELECT id FROM machines WHERE machine_code=? FOR UPDATE');$q->execute([$this->machineCode]);$machine=(int)$q->fetchColumn();
            $q=$this->db->prepare('SELECT setting_key FROM system_settings WHERE setting_key LIKE ? FOR UPDATE');$q->execute(['coin_diag:'.$machine.':%']);$q->fetchAll();
            $reports=array_column($this->read(),null,'device_id');$a=$reports[$old]??null;$b=$reports[$new]??null;
            if(!$a||!$b||!$b['fresh'])throw new KioskError('CONTROLLER_UNVERIFIED','A fresh replacement report and the original record are required.',409);
            if(($b['backend_session_verified']??false)!==true)throw new KioskError('CONTROLLER_UNVERIFIED','The replacement must verify its backend session.',409);
            foreach([$a,$b] as $d)if(($d['pending_events']??-1)!==0||($d['durable_events']??-1)!==0||($d['incomplete_pulses']??true)||!($d['storage_healthy']??false)||($d['reconciliation_required']??true)||($d['boot_review_required']??true)||($d['binding_review_required']??true)||($d['binding_phase']??-1)!==0||($d['overflow_events']??-1)!==0||($d['overflow_pulses']??-1)!==0)throw new KioskError('COIN_REVIEW_REQUIRED','Controller journal or binding review is unresolved.',409);
            if($a['fresh'])throw new KioskError('OLD_CONTROLLER_ONLINE','Disconnect the old controller and wait for its report to become stale.',409);
            foreach($this->activeReports() as $d)if(!in_array($d['device_id'],[$old,$new],true))throw new KioskError('CONTROLLER_AMBIGUITY','Another unretired controller requires review.',409);
            $q=$this->db->prepare('SELECT * FROM transactions WHERE id=? FOR UPDATE');$q->execute([(int)$a['bound_transaction_id']]);$t=$q->fetch();
            if($t){
                $q=$this->db->prepare('SELECT * FROM payments WHERE transaction_id=? FOR UPDATE');$q->execute([$t['id']]);$payment=$q->fetch();
                $q=$this->db->prepare('SELECT COALESCE(SUM(amount),0) FROM payment_events WHERE transaction_id=?');$q->execute([$t['id']]);$ledger=(float)$q->fetchColumn();
                $closed= in_array($t['payment_status'],['cancelled','failed'],true)&&(float)$t['amount_paid']===0.0&&$ledger===0.0&&(!$payment||(float)$payment['amount_inserted']===0.0);
                if($t['payment_status']==='successful'&&$t['dispensing_status']==='dispensed'){
                    require_once __DIR__.'/TransactionReceipt.php';
                    $q=$this->db->prepare('SELECT * FROM dispensing_requests WHERE transaction_id=? ORDER BY id DESC LIMIT 1');$q->execute([$t['id']]);$request=$q->fetch()?:null;
                    $q=$this->db->prepare('SELECT quantity,unit_price_snapshot AS unitPrice,subtotal FROM transaction_items WHERE transaction_id=?');$q->execute([$t['id']]);
                    $closed=TransactionReceipt::evaluate($t,$payment?:null,$request,$q->fetchAll(),null)['eligible']&&abs($ledger-(float)$t['amount_paid'])<0.001;
                }
                if(!$closed)throw new KioskError('OLD_SESSION_UNRESOLVED','The old purchase payment and delivery are not finalized.',409);
            }elseif((int)$a['bound_transaction_id']!==0)throw new KioskError('OLD_SESSION_UNKNOWN','Old purchase is missing.',409);
            $q=$this->db->prepare("SELECT DISTINCT t.id FROM payment_events e JOIN transactions t ON t.id=e.transaction_id WHERE e.event_id LIKE ? AND NOT (t.payment_status='successful' AND t.dispensing_status='dispensed') LIMIT 1");$q->execute(['coin-'.$old.'-%']);if($q->fetchColumn())throw new KioskError('OLD_PAYMENT_HISTORY_REVIEW','Old controller payment events have an unresolved purchase.',409);
            $q=$this->db->prepare("SELECT id FROM dispensing_requests WHERE machine_id=? AND request_status IN ('queued','sent','dispensing') LIMIT 1 FOR UPDATE");$q->execute([$machine]);if($q->fetchColumn())throw new KioskError('ACTIVE_DISPENSING','An active dispensing command blocks replacement.',409);
            try{$command=$this->commandState?($this->commandState)():'unverified';}catch(Throwable){$command='unverified';}
            if($command!=='idle')throw new KioskError('FIREBASE_COMMAND_UNVERIFIED','Firebase command must be confirmed idle before controller replacement.',409);
            $key='coin_retired:'.$machine.':'.$old;
            $q=$this->db->prepare('SELECT setting_value FROM system_settings WHERE setting_key=? FOR UPDATE');$q->execute([$key]);$existing=$q->fetchColumn();
            if($existing&&($a['retired']??false)){$this->db->commit();return ['retired'=>true,'already_retired'=>true];}
            $data=['device_id'=>$old,'replacement'=>$new,'retiredReportAtMs'=>$a['reportedAtMs'],'actorId'=>(int)$actor['id'],'physicalVerification'=>true];
            $q=$this->db->prepare('INSERT INTO system_settings(setting_key,setting_value) VALUES(?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)');$q->execute([$key,json_encode($data)]);
            $q=$this->db->prepare("INSERT INTO activity_logs(actor_type,actor_user_id,action,description,metadata) VALUES('user',?,'controller_retired','Controller replacement physically verified; historical journals preserved.',?)");$q->execute([(int)$actor['id'],json_encode($data)]);
            $this->db->commit();return ['retired'=>true,'replacement'=>$new];
        }catch(Throwable $e){if($this->db->inTransaction())$this->db->rollBack();throw $e;}
    }
    /** Current ALLAN model/control is unverified. Empty queues cannot override this blocker. */
    public static function handoffBlockers(?array $report):array {
        $reasons=['COIN_ACCEPTANCE_CONTROL_UNVERIFIED'];
        if(!$report || !($report['fresh']??false))$reasons[]='PAYMENT_DIAGNOSTICS_UNAVAILABLE_OR_STALE';
        if($report) {
            if(($report['pending_events']??0)>0)$reasons[]='UNCONFIRMED_PAYMENT_EVENTS';
            if($report['incomplete_pulses']??false)$reasons[]='INCOMPLETE_COIN_PULSE_SEQUENCE';
            if(!($report['storage_healthy']??false))$reasons[]='PAYMENT_JOURNAL_UNVERIFIED';
            if(($report['overflow_events']??0)>0||($report['overflow_pulses']??0)>0)$reasons[]='COIN_QUEUE_OVERFLOW_REQUIRES_RECONCILIATION';
            if(($report['binding_phase']??0)!==0)$reasons[]='INTERRUPTED_PAYMENT_BINDING';
            if($report['reconciliation_required']??false)$reasons[]='PAYMENT_RECONCILIATION_REQUIRED';
        }
        return $reasons;
    }
    public function selfServiceAssessment():array {
        $devices=$this->read();$reasons=self::handoffBlockers(null);
        foreach($devices as $device)$reasons=array_merge($reasons,self::handoffBlockers($device));
        if($devices && count(array_filter($devices,fn($d)=>$d['fresh']))===count($devices))$reasons=array_values(array_diff($reasons,['PAYMENT_DIAGNOSTICS_UNAVAILABLE_OR_STALE']));
        return ['automatic_self_service_available'=>false,'automatic_handoff_safe'=>false,
            'acceptance_control'=>'unverified','blockers'=>array_values(array_unique($reasons)),'devices'=>$devices];
    }
    public function record(array $body):array {
        if(!is_string($body['device_id']??null)||!preg_match('/^[A-Fa-f0-9]{12}$/D',$body['device_id']))throw new KioskError('INVALID_DIAGNOSTICS','Invalid device identifier.',422);
        $machine=$this->db->prepare('SELECT id FROM machines WHERE machine_code=?');$machine->execute([$this->machineCode]);$machineId=$machine->fetchColumn();
        if(!$machineId)throw new KioskError('INVALID_DIAGNOSTICS','Machine not found.',422);
        $data=['device_id'=>strtoupper($body['device_id'])];
        foreach(['bound_transaction_id'=>2147483647,'pending_events'=>65535,'durable_events'=>16,'overflow_events'=>4294967295,'overflow_pulses'=>4294967295] as $key=>$max) {
            if(!is_int($body[$key]??null)||$body[$key]<0||$body[$key]>$max)throw new KioskError('INVALID_DIAGNOSTICS','Invalid diagnostic count.',422);
            $data[$key]=$body[$key];
        }
        foreach(['incomplete_pulses','reconciliation_required','boot_review_required','storage_healthy','backend_session_verified','inhibit_supported','automatic_handoff_safe'] as $key) {
            if(!is_bool($body[$key]??null))throw new KioskError('INVALID_DIAGNOSTICS','Invalid diagnostic flag.',422);
            $data[$key]=$body[$key];
        }
        if($data['inhibit_supported']||$data['automatic_handoff_safe'])throw new KioskError('UNSUPPORTED_CAPABILITY','Coin inhibit and automatic handoff are not verified.',422);
        if($data['durable_events']>$data['pending_events'])throw new KioskError('INVALID_DIAGNOSTICS','Inconsistent queue counts.',422);
        foreach(['binding_phase'=>1,'previous_binding_transaction_id'=>2147483647,'proposed_transaction_id'=>2147483647] as $key=>$max) {
            if(!array_key_exists($key,$body))continue;
            if(!is_int($body[$key])||$body[$key]<0||$body[$key]>$max)throw new KioskError('INVALID_DIAGNOSTICS','Invalid binding diagnostic.',422);
            $data[$key]=$body[$key];
        }
        if(array_key_exists('binding_review_required',$body)) {
            if(!is_bool($body['binding_review_required']))throw new KioskError('INVALID_DIAGNOSTICS','Invalid binding review flag.',422);
            $data['binding_review_required']=$body['binding_review_required'];
        }
        if(isset($body['oldest_event_id'])) {
            if(!is_string($body['oldest_event_id'])||!preg_match('/^[A-Za-z0-9:_-]{1,100}$/D',$body['oldest_event_id']))throw new KioskError('INVALID_DIAGNOSTICS','Invalid queued event identifier.',422);
            $data['oldest_event_id']=$body['oldest_event_id'];
            foreach(['oldest_event_transaction_id'=>2147483647,'oldest_event_pulses'=>4294967295,'oldest_event_amount'=>20] as $key=>$max) {
                if(!is_int($body[$key]??null)||$body[$key]<0||$body[$key]>$max)throw new KioskError('INVALID_DIAGNOSTICS','Invalid queued event detail.',422);
                $data[$key]=$body[$key];
            }
            if(!is_bool($body['oldest_event_requires_review']??null))throw new KioskError('INVALID_DIAGNOSTICS','Invalid queued event review flag.',422);
            $data['oldest_event_requires_review']=$body['oldest_event_requires_review'];
        }
        if(array_key_exists('controlled_demo_autobind',$body)) {
            if(!is_bool($body['controlled_demo_autobind']))throw new KioskError('INVALID_DIAGNOSTICS','Invalid demo policy diagnostic.',422);
            $data['controlled_demo_autobind']=$body['controlled_demo_autobind'];
        }
        if(array_key_exists('expiration_check_ready',$body)) {
            if(!is_bool($body['expiration_check_ready']))throw new KioskError('INVALID_DIAGNOSTICS','Invalid expiration drain diagnostic.',422);
            $data['expiration_check_ready']=$body['expiration_check_ready'];
        }
        if(array_key_exists('automatic_binding_blocker',$body)) {
            if(!is_string($body['automatic_binding_blocker']) || !preg_match('/^[A-Z_]{1,80}$/D',$body['automatic_binding_blocker']))throw new KioskError('INVALID_DIAGNOSTICS','Invalid binding blocker.',422);
            $data['automatic_binding_blocker']=$body['automatic_binding_blocker'];
        }
        if($data['bound_transaction_id']) {
            $q=$this->db->prepare('SELECT id FROM transactions WHERE id=? AND machine_id=?');$q->execute([$data['bound_transaction_id'],$machineId]);
            if(!$q->fetchColumn())throw new KioskError('TRANSACTION_MISMATCH','Diagnostics belong to another or unknown purchase.',422);
        }
        $data['reportedAtMs']=(float)$this->db->query('SELECT UNIX_TIMESTAMP(NOW(3))*1000')->fetchColumn();
        $q=$this->db->prepare('INSERT INTO system_settings(setting_key,setting_value) VALUES(?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)');
        $q->execute(['coin_diag:'.$machineId.':'.$data['device_id'],json_encode($data,JSON_THROW_ON_ERROR)]);
        return ['saved'=>true,'automatic_handoff_safe'=>false];
    }
    public function read():array {
        $q=$this->db->prepare("SELECT s.setting_value FROM system_settings s JOIN machines m ON s.setting_key LIKE CONCAT('coin_diag:',m.id,':%') WHERE m.machine_code=? ORDER BY s.setting_key");$q->execute([$this->machineCode]);
        $now=(float)$this->db->query('SELECT UNIX_TIMESTAMP(NOW(3))*1000')->fetchColumn();$result=[];
        foreach($q->fetchAll() as $row) {
            $data=json_decode($row['setting_value'],true);if(!is_array($data))continue;
            $data['ageSeconds']=max(0,($now-($data['reportedAtMs']??0))/1000);
            $data['fresh']=$data['ageSeconds']<=30;
            $retire=$this->db->prepare("SELECT setting_value FROM system_settings WHERE setting_key=(SELECT CONCAT('coin_retired:',id,':',?) FROM machines WHERE machine_code=?)");$retire->execute([$data['device_id'],$this->machineCode]);$retired=json_decode($retire->fetchColumn()?:'null',true);
            $data['retired']=$retired && ($data['reportedAtMs']??0)<=($retired['retiredReportAtMs']??0);
            $data['registrationStatus']=$data['retired']?'retired':($retired?'retired_controller_reported_again':'unretired');
            $data['automatic_handoff_safe']=false;$data['inhibit_supported']=false;
            $data['automatic_handoff_blockers']=self::handoffBlockers($data);
            $result[]=$data;
        }
        return $result;
    }
}
