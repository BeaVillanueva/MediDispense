<?php
declare(strict_types=1);

interface AlertMailTransport { public function send(string $recipient,string $subject,string $html,string $text,string $messageId): void; }
final class AlertMailFailure extends RuntimeException {
    public function __construct(public readonly bool $uncertain) { parent::__construct($uncertain?'SMTP result uncertain; verify provider logs before retrying.':'SMTP delivery failed before acceptance.'); }
}

/** Track DATA so uncertain acceptance is never retried automatically. */
final class AlertSmtp extends \PHPMailer\PHPMailer\SMTP {
    public bool $dataStarted=false;
    public function data($msg_data) { $this->dataStarted=true; return parent::data($msg_data); }
}
final class SmtpAlertTransport implements AlertMailTransport {
    public function __construct(private array $config) {}
    public function configured(): bool {
        return !empty($this->config['enabled']) && !empty($this->config['host']) && !empty($this->config['username']) && !empty($this->config['password']) && filter_var($this->config['from_email']??'',FILTER_VALIDATE_EMAIL)!==false && in_array($this->config['encryption']??'', ['tls','ssl'],true);
    }
    public function send(string $recipient,string $subject,string $html,string $text,string $messageId): void {
        if (!$this->configured()) throw new RuntimeException('SMTP is not configured and enabled.');
        $smtp=new AlertSmtp();
        $mail=new \PHPMailer\PHPMailer\PHPMailer(true);
        $mail->setSMTPInstance($smtp);
        $mail->isSMTP();
        $mail->Host=$this->config['host']; $mail->Port=(int)$this->config['port'];
        $mail->SMTPAuth=true; $mail->Username=$this->config['username']; $mail->Password=$this->config['password'];
        $mail->SMTPSecure=$this->config['encryption']; $mail->Timeout=15; $mail->Timelimit=25;
        $mail->CharSet='UTF-8'; $mail->SMTPDebug=0;
        $mail->setFrom($this->config['from_email'],'MediDispense');
        $mail->addAddress($recipient); $mail->MessageID=$messageId;
        $mail->Subject=$subject; $mail->isHTML(true); $mail->Body=$html; $mail->AltBody=$text;
        try { $mail->send(); }
        catch(Throwable $e) {
            $reply=$smtp->getLastReply();
            // A definite rejection (4xx / 5xx) is retryable; disconnect after DATA is ambiguous.
            $rejected=preg_match('/^[45]\d\d[ -]/',$reply)===1;
            throw new AlertMailFailure($smtp->dataStarted && !$rejected);
        } finally { $mail->smtpClose(); }
    }
}
final class AlertEmailTemplate {
    public static function render(array $incident): array {
        $d=json_decode($incident['details'],true,512,JSON_THROW_ON_ERROR);
        $low=$incident['kind']==='low_stock';
        $heading=$low?((int)$d['available_stock']===0?'Out of Stock Alert':'Low Stock Alert'):'URGENT: Dispensing Issue';
        $subject='[MediDispense] '.$heading.' — '.($low?$d['medicine_name']:$d['transaction_reference']);
        $test=($d['is_test']??false)===true;
        if($test) $subject='[TEST] '.$subject;
        $fields=['Medicine'=>$d['medicine_name'],'Slot Number'=>(string)$d['slot_number']];
        if($low) $fields+=['Available Stock'=>(string)$d['available_stock'],'Low Stock Threshold'=>(string)$d['threshold']];
        else {
            $fields+=['Transaction Reference'=>$d['transaction_reference'],'Issue'=>str_replace('_',' ',$d['issue_type']),'Confirmed Units'=>$d['confirmed_units'].' of '.$d['requested_units']];
            if(!empty($d['hardware_details'])) $fields['Hardware Details']=json_encode($d['hardware_details'],JSON_UNESCAPED_UNICODE);
        }
        $fields['Detected At']=$incident['detected_at'].' (server database time)';
        if($test) $fields['Test Run']=$d['test_run_id']??'Isolated notification test';
        $escape=fn(string $v)=>htmlspecialchars($v,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8');
        $rows=''; $plain="MediDispense\n$heading\n\n";
        foreach($fields as $k=>$v) { $rows.='<tr><th style="padding:10px;text-align:left;border-bottom:1px solid #d5e3f3">'.$escape($k).'</th><td style="padding:10px;border-bottom:1px solid #d5e3f3">'.$escape((string)$v).'</td></tr>'; $plain.=$k.': '.$v."\n"; }
        $action=$d['action'];
        $html='<div style="background:#edf5ff;padding:24px;font-family:Arial,sans-serif;color:#182d47"><div style="max-width:640px;margin:auto;background:white;border:1px solid #c7d9ef;border-radius:18px;padding:24px"><h2 style="color:#006bdc">MediDispense</h2><h1 style="font-size:24px">'.$escape($heading).'</h1><p>Dear Administrator / Kiosk Operator,</p><table style="width:100%;border-collapse:collapse;font-size:14px">'.$rows.'</table><p><strong>Action Required:</strong> '.$escape($action).'</p><p style="font-size:12px;color:#53657a">Automated notification · Incident #'.(int)$incident['id'].'. SMTP acceptance does not confirm inbox delivery.</p></div></div>';
        if($test) {
            $banner='TEST ONLY — Synthetic incident. No live inventory, payment, or hardware operation was performed.';
            $html='<p style="padding:16px;background:#fff3d6;color:#704b00;font-family:Arial,sans-serif"><strong>'.$banner.'</strong></p>'.$html;
            $plain=$banner."\n\n".$plain;
        }
        return [$subject,$html,$plain."\nAction Required: $action\nAutomated MediDispense notification. Incident #".$incident['id']];
    }
}
final class AlertEmailWorker {
    public function __construct(private PDO $db,private AlertMailTransport $transport) {}
    private function query(string $sql,array $args=[]): PDOStatement { $q=$this->db->prepare($sql); $q->execute($args); return $q; }
    public function run(int $limit=20): int {
        if ($this->db->inTransaction()) throw new RuntimeException('Email worker cannot share a purchase transaction.');
        // A crashed sender may already have delivered DATA. Hold it for explicit review.
        $stale=$this->query("SELECT id FROM alert_email_jobs WHERE status='processing' AND claimed_at<DATE_SUB(NOW(),INTERVAL 5 MINUTE)")->fetchAll();
        foreach($stale as $r) {
            $this->query("UPDATE alert_email_jobs SET status='uncertain',last_error='Worker interrupted; inspect SMTP logs before retrying' WHERE id=? AND status='processing'",[$r['id']]);
            $this->query("INSERT INTO alert_email_attempts(job_id,outcome,detail) VALUES(?,'uncertain','Worker interrupted; acceptance unknown')",[$r['id']]);
        }
        $processed=0;
        while($processed<$limit) {
            $this->db->beginTransaction();
            try {
                $job=$this->query("SELECT * FROM alert_email_jobs WHERE status IN ('pending','retry') AND next_attempt_at<=NOW() ORDER BY (SELECT kind FROM alert_incidents WHERE id=incident_id)='dispensing_failure' DESC,id LIMIT 1 FOR UPDATE")->fetch();
                if(!$job) { $this->db->commit(); break; }
                $incident=$this->query('SELECT * FROM alert_incidents WHERE id=?',[$job['incident_id']])->fetch();
                $recipient=$this->query("SELECT u.email FROM users u JOIN roles r ON r.id=u.role_id JOIN alert_recipients p ON p.user_id=u.id WHERE u.id=? AND u.is_active=1 AND u.email_verified_at IS NOT NULL AND r.code IN ('super_admin','admin','staff') AND ((?='low_stock' AND p.low_stock=1) OR (?='dispensing_failure' AND p.dispensing_failure=1))",[$job['user_id'],$incident['kind']??'',$incident['kind']??''])->fetchColumn();
                if(!$incident || $incident['resolved_at'] || !$recipient || !filter_var($recipient,FILTER_VALIDATE_EMAIL)) {
                    $this->query("UPDATE alert_email_jobs SET status='cancelled',last_error='Resolved incident or recipient is no longer eligible' WHERE id=?",[$job['id']]);
                    $this->query("INSERT INTO alert_email_attempts(job_id,outcome,detail) VALUES(?,'cancelled','Resolved incident or ineligible recipient')",[$job['id']]);
                    $this->db->commit(); $processed++; continue;
                }
                $this->query("UPDATE alert_email_jobs SET status='processing',attempts=attempts+1,claimed_at=NOW(),recipient=? WHERE id=?",[$recipient,$job['id']]);
                $this->query("INSERT INTO alert_email_attempts(job_id,outcome) VALUES(?,'started')",[$job['id']]);
                $this->db->commit();
            } catch(Throwable $e) { if($this->db->inTransaction())$this->db->rollBack(); throw $e; }
            $state='sent'; $error=null;
            try { [$subject,$html,$text]=AlertEmailTemplate::render($incident); $this->transport->send($recipient,$subject,$html,$text,$job['message_id']); }
            catch(Throwable $e) { $state=$e instanceof AlertMailFailure && $e->uncertain?'uncertain':(((int)$job['attempts']+1)>=5?'dead':'retry'); $error=$e instanceof AlertMailFailure?$e->getMessage():'Mail transport unavailable; inspect secure server logs.'; }
            $delay=min(3600,60*(2**min((int)$job['attempts'],6)));
            $this->db->beginTransaction();
            try {
                $this->query("UPDATE alert_email_jobs SET status=?,sent_at=IF(?='sent',NOW(),NULL),last_error=?,next_attempt_at=DATE_ADD(NOW(),INTERVAL ? SECOND) WHERE id=?",[$state,$state,$error,$delay,$job['id']]);
                $this->query('INSERT INTO alert_email_attempts(job_id,outcome,detail) VALUES(?,?,?)',[$job['id'],$state,$error]);
                $this->db->commit();
            } catch(Throwable $e) { if($this->db->inTransaction())$this->db->rollBack(); throw $e; }
            $processed++;
        }
        return $processed;
    }
}
