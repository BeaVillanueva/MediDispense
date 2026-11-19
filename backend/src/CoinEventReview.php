<?php
declare(strict_types=1);
/** Exact-event no-additional-payment decisions. Never writes payment, inventory or machine readiness. */
final class CoinEventReview {
    public function __construct(private PDO $db,private string $machineCode,private array $config,private Closure $commandIdle){}
    public static function localConfig():array {$p=__DIR__.'/../config/coin-review.local.php';return is_file($p)?require $p:['enabled'=>false,'device_keys'=>[]];}
    private function key(string $device):string {
        $hex=$this->config['device_keys'][$device]??'';
        if(!($this->config['enabled']??false)||!preg_match('/^[A-F0-9]{12}$/D',$device)||!is_string($hex)||!preg_match('/^[a-fA-F0-9]{64}$/D',$hex))throw new KioskError('COIN_REVIEW_NOT_CONFIGURED','Exact-event review is not enabled or the installed controller review key is missing.',503);
        return hex2bin($hex);
    }
    private function q(string $s,array $v=[]):PDOStatement{$q=$this->db->prepare($s);$q->execute($v);return $q;}
    private function machine(bool $lock=false):int{$id=(int)$this->q('SELECT id FROM machines WHERE machine_code=?'.($lock?' FOR UPDATE':''),[$this->machineCode])->fetchColumn();if(!$id)throw new KioskError('MACHINE_MISMATCH','Machine not found.');return $id;}
    private function atomic(Closure $f):mixed{$this->db->beginTransaction();try{$v=$f();$this->db->commit();return $v;}catch(Throwable $e){$this->db->rollBack();throw $e;}}
    private function hex(string $v):bool{return preg_match('/^[a-f0-9]{32}$/D',$v)===1;}
    private function proof(string $device,string $text,mixed $signature):void {if(!is_string($signature)||!hash_equals(hash_hmac('sha256',$text,$this->key($device)),$signature))throw new KioskError('COIN_REVIEW_PROOF','Controller review proof could not be verified.',403);}
    private function audit(string $action,string $id,?int $actor,array $metadata):void{$this->q('INSERT INTO activity_logs(actor_type,actor_user_id,action,description,metadata) VALUES(?,?,?,?,?)',[$actor?'user':'system',$actor,$action,'Exact coin-event review; no payment credit or kiosk reopening.',json_encode(['review_id'=>$id]+$metadata,JSON_THROW_ON_ERROR)]);}
    public static function attestationText(array $p):string{return implode('|',['attest-v1',$p['device_id'],$p['challenge'],$p['expires'],$p['event_id'],$p['transaction_id'],$p['bound_transaction_id'],$p['pulses'],$p['amount'],$p['count'],$p['quiet'],$p['healthy'],$p['binding_stable'],$p['overflow'],$p['requires_review']]);}
    public static function decisionText(array $p):string{return implode('|',['review-v1',$p['id'],$p['device_id'],$p['event_id'],$p['transaction_id'],$p['pulses'],$p['amount'],$p['nonce'],'no_additional_payment','keep_blocked']);}
    public static function ackText(array $p):string{return implode('|',['ack-v1',$p['id'],$p['device_id'],$p['archive_hash'],$p['count'],'archived','journal_persisted','keep_blocked']);}
    public function challenge(string $device):array {$key=$this->key($device);$nonce=bin2hex(random_bytes(16));$expires=time()+30;return ['challenge'=>$nonce,'expires'=>$expires,'signature'=>hash_hmac('sha256',"challenge-v1|$device|$nonce|$expires",$key)];}
    public function attest(array $p):array {
        $device=$p['device_id']??'';$nonce=$p['challenge']??'';$expires=$p['expires']??0;
        if(!is_string($device)||!is_string($nonce)||!$this->hex($nonce)||!is_int($expires)||$expires<time()||$expires>time()+30)throw new KioskError('COIN_REVIEW_CHALLENGE','Obtain a new controller review challenge.',409);
        foreach(['transaction_id','bound_transaction_id','pulses','amount','count','quiet','healthy','binding_stable','overflow','requires_review'] as $k)if(!is_int($p[$k]??null)||$p[$k]<0)throw new KioskError('INVALID_COIN_REVIEW','Invalid attestation.',422);
        if(!is_string($p['event_id']??null)||!preg_match('/^coin-'.$device.'-[A-Fa-f0-9]{8}-[A-Fa-f0-9]{16}-[A-Fa-f0-9]{8}$/D',$p['event_id'])||$p['count']<1||$p['count']>16||$p['amount']>20||$p['transaction_id']<1||$p['pulses']<1)throw new KioskError('INVALID_COIN_REVIEW','Invalid exact event.',422);
        $this->proof($device,"challenge-v1|$device|$nonce|$expires",$p['challenge_signature']??null);$this->proof($device,self::attestationText($p),$p['signature']??null);
        $payload=[];foreach(['device_id','challenge','expires','event_id','transaction_id','bound_transaction_id','pulses','amount','count','quiet','healthy','binding_stable','overflow','requires_review'] as $field)$payload[$field]=$p[$field];
        return $this->atomic(function()use($nonce,$device,$payload){$machine=$this->machine(true);$old=$this->q('SELECT payload FROM coin_review_attestations WHERE nonce=?',[$nonce])->fetchColumn();if($old){if(json_decode($old,true)!==$payload)throw new KioskError('EVENT_CONFLICT','Challenge already belongs to other evidence.');return ['saved'=>true,'nonce'=>$nonce];}$this->q('INSERT INTO coin_review_attestations(nonce,machine_id,device_id,payload) VALUES(?,?,?,?)',[$nonce,$machine,$device,json_encode($payload)]);return ['saved'=>true,'nonce'=>$nonce];});
    }
    public function inspect(array $actor):array {
        $this->admin($actor);$machine=$this->machine();
        if(!($this->config['enabled']??false))return ['enabled'=>false,'attestation'=>null,'reviews'=>[]];
        $a=$this->q('SELECT nonce,device_id,payload,created_at,TIMESTAMPDIFF(SECOND,created_at,NOW(3)) age_seconds FROM coin_review_attestations WHERE machine_id=? ORDER BY created_at DESC LIMIT 1',[$machine])->fetch()?:null;
        if($a)$a['payload']=json_decode($a['payload'],true);
        $reviews=$this->q('SELECT r.id,r.device_id,r.event_id,r.transaction_id,r.decision,r.created_at,r.expires_at,a.created_at AS acknowledged_at FROM coin_event_reviews r LEFT JOIN coin_event_review_acks a ON a.review_id=r.id WHERE r.machine_id=? ORDER BY r.created_at DESC LIMIT 10',[$machine])->fetchAll();
        return ['enabled'=>true,'attestation'=>$a,'reviews'=>$reviews];
    }
    private function admin(array $actor):void{if(($actor['role_code']??'')!=='super_admin'||(int)($actor['id']??0)<1)throw new KioskError('FORBIDDEN','Super Admin authorization required.',403);}
    public function authorize(array $b,array $actor):array {
        $this->admin($actor);$device=$b['device_id']??'';if(!is_string($device))throw new KioskError('INVALID_COIN_REVIEW','Controller required.',422);$this->key($device);
        foreach(['request_key','attestation_nonce'] as $k)if(!is_string($b[$k]??null)||!$this->hex($b[$k]))throw new KioskError('INVALID_COIN_REVIEW','Exact review keys required.',422);
        foreach(['machine_isolated','motors_stopped','coin_path_checked','no_additional_payment_confirmed'] as $k)if(($b[$k]??false)!==true)throw new KioskError('PHYSICAL_VERIFICATION_REQUIRED','Explicit physical verification is required.',422);
        if(!is_int($b['verified_total']??null)||$b['verified_total']<1||!is_string($b['notes']??null)||strlen(trim($b['notes']))<20||strlen($b['notes'])>1000||!is_string($b['event_id']??null)||!is_string($b['original_payment_event_id']??null))throw new KioskError('INVALID_COIN_REVIEW','Provide the verified total, exact events and review evidence.',422);
        $intent=[];foreach(['device_id','attestation_nonce','event_id','original_payment_event_id','verified_total'] as $field)$intent[$field]=$b[$field];$intent['notes']=trim($b['notes']);
        $fingerprint=hash('sha256',json_encode($intent,JSON_THROW_ON_ERROR));
        return $this->atomic(function()use($b,$actor,$device,$fingerprint){
            $machine=$this->machine(true);$old=$this->q('SELECT id,fingerprint FROM coin_event_reviews WHERE id=?',[$b['request_key']])->fetch();if($old){if(!hash_equals($old['fingerprint'],$fingerprint))throw new KioskError('EVENT_CONFLICT','This review key already contains a different decision.');return ['id'=>$old['id'],'authorized'=>true];}
            $a=$this->q('SELECT payload,TIMESTAMPDIFF(SECOND,created_at,NOW(3)) age_seconds FROM coin_review_attestations WHERE nonce=? AND machine_id=? AND device_id=?',[$b['attestation_nonce'],$machine,$device])->fetch();
            if(!$a||(int)$a['age_seconds']>30||(int)$a['age_seconds']<0)throw new KioskError('COIN_REVIEW_STALE','Obtain a fresh signed controller event report.',409);
            $p=json_decode($a['payload'],true);if((int)$p['expires']<time())throw new KioskError('COIN_REVIEW_STALE','Obtain a fresh signed controller event report.',409);
            if($p['event_id']!==$b['event_id']||$p['transaction_id']!==$p['bound_transaction_id']||$p['count']!==1||$p['quiet']!==1||$p['healthy']!==1||$p['binding_stable']!==1||$p['overflow']!==0||$p['requires_review']!==1)throw new KioskError('COIN_REVIEW_UNSAFE','The exact event or controller safety evidence does not match.',409);
            $reports=(new CoinPaymentDiagnostics($this->db,$this->machineCode))->activeReports();if(count($reports)!==1||$reports[0]['device_id']!==$device)throw new KioskError('CONTROLLER_UNVERIFIED','One installed controller must be verified.',409);
            $pause=json_decode($this->q('SELECT setting_value FROM system_settings WHERE setting_key=?',['delivery_inspection:'.$this->machineCode])->fetchColumn()?:'null',true);
            if(($pause['status']??'')!=='active'||($pause['controller_id']??'')!==$device||(int)($pause['transaction_id']??0)!==$p['transaction_id']||!($pause['power_isolated']??false)||!($pause['motor_stopped']??false)||!($pause['controller_disconnected']??false))throw new KioskError('INSPECTION_REQUIRED','A matching isolated inspection pause is required.',409);
            $t=$this->q('SELECT * FROM transactions WHERE id=? AND machine_id=? FOR UPDATE',[$p['transaction_id'],$machine])->fetch();
            if(!$t||$t['payment_status']!=='successful'||$t['dispensing_status']!=='failed')throw new KioskError('COIN_REVIEW_UNSAFE','Only a paid, stopped failed purchase can use this workflow.',409);
            if($this->q("SELECT id FROM dispensing_requests WHERE machine_id=? AND request_status IN ('queued','sent','dispensing') LIMIT 1",[$machine])->fetchColumn()||!($this->commandIdle)())throw new KioskError('ACTIVE_DISPENSING','Verify all dispensing commands are idle.',409);
            $events=$this->q('SELECT event_id,amount FROM payment_events WHERE transaction_id=?',[$p['transaction_id']])->fetchAll();$payment=$this->q('SELECT amount_inserted,status FROM payments WHERE transaction_id=?',[$p['transaction_id']])->fetch();
            if(count($events)!==1||$events[0]['event_id']!==$b['original_payment_event_id']||$b['event_id']===$events[0]['event_id']||!$payment||$payment['status']!=='successful'||(float)$events[0]['amount']!== (float)$b['verified_total']||(float)$payment['amount_inserted']!==(float)$b['verified_total']||(float)$t['amount_paid']!==(float)$b['verified_total']||(float)$t['total_amount']!==(float)$b['verified_total'])throw new KioskError('PAYMENT_EVIDENCE_MISMATCH','The original recorded payment must match the verified physical total; no extra credit is permitted.',409);
            if($this->q('SELECT id FROM coin_event_reviews WHERE machine_id=? AND device_id=? AND event_id=?',[$machine,$device,$b['event_id']])->fetchColumn())throw new KioskError('EVENT_CONFLICT','This event already has a review. Reuse its original decision.',409);
            $nonce=bin2hex(random_bytes(16));$this->q("INSERT INTO coin_event_reviews(id,machine_id,device_id,event_id,transaction_id,attestation_nonce,decision_nonce,event_payload,decision,original_payment_event_id,verified_total,notes,actor_user_id,fingerprint,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(3),INTERVAL 15 MINUTE))",[$b['request_key'],$machine,$device,$b['event_id'],$p['transaction_id'],$b['attestation_nonce'],$nonce,json_encode($p),'no_additional_payment',$b['original_payment_event_id'],$b['verified_total'],trim($b['notes']),$actor['id'],$fingerprint]);
            $this->audit('coin_event_review_authorized',$b['request_key'],(int)$actor['id'],['transaction_id'=>$p['transaction_id'],'event_id'=>$b['event_id'],'original_payment_event_id'=>$b['original_payment_event_id'],'decision'=>'no_additional_payment','cause'=>'unconfirmed','keep_machine_blocked'=>true]);return ['id'=>$b['request_key'],'authorized'=>true];
        });
    }
    private function decision(string $id,string $device):array {$r=$this->q('SELECT r.*,r.expires_at>NOW(3) AS valid FROM coin_event_reviews r WHERE r.id=? AND r.device_id=? AND r.machine_id=?',[$id,$device,$this->machine()])->fetch();if(!$r)throw new KioskError('REVIEW_NOT_FOUND','Exact event review not found.',404);$p=json_decode($r['event_payload'],true);return ['id'=>$r['id'],'device_id'=>$device,'event_id'=>$r['event_id'],'transaction_id'=>(int)$r['transaction_id'],'pulses'=>$p['pulses'],'amount'=>$p['amount'],'nonce'=>$r['decision_nonce'],'valid'=>(bool)$r['valid']];}
    public function fetchDecision(string $id,string $device,string $challenge,string $proof):array {
        if(!$this->hex($id)||!$this->hex($challenge))throw new KioskError('INVALID_COIN_REVIEW','Invalid review challenge.',422);
        $this->proof($device,"fetch-v1|$id|$device|$challenge",$proof);$p=$this->decision($id,$device);if(!$p['valid'])throw new KioskError('COIN_REVIEW_EXPIRED','The decision expired; preserve the event and ask the Super Admin.',409);
        unset($p['valid']);$p['archive_hash']=hash('sha256',self::decisionText($p));$p['signature']=hash_hmac('sha256',self::decisionText($p).'|'.$challenge,$this->key($device));return $p;
    }
    public function acknowledge(array $p):array {
        $id=$p['id']??'';$device=$p['device_id']??'';
        if(!is_string($id)||!$this->hex($id)||!is_string($device)||!is_int($p['count']??null)||$p['count']<0||$p['count']>16||!is_string($p['archive_hash']??null)||!preg_match('/^[a-f0-9]{64}$/D',$p['archive_hash']))throw new KioskError('INVALID_COIN_REVIEW','Invalid durable receipt.',422);
        $this->proof($device,self::ackText($p),$p['signature']??null);$decision=$this->decision($id,$device);$expected=hash('sha256',self::decisionText($decision));if(!hash_equals($expected,$p['archive_hash']))throw new KioskError('EVENT_CONFLICT','Archive evidence does not match the authorized event.',409);
        return $this->atomic(function()use($id,$device,$p){$this->machine(true);$existing=$this->q('SELECT archive_hash FROM coin_event_review_acks WHERE review_id=?',[$id])->fetchColumn();if($existing){if(!hash_equals($existing,$p['archive_hash']))throw new KioskError('EVENT_CONFLICT','A different archive receipt exists.');return ['acknowledged'=>true,'id'=>$id];}$this->q('INSERT INTO coin_event_review_acks(review_id,archive_hash,payload) VALUES(?,?,?)',[$id,$p['archive_hash'],json_encode(['device_id'=>$device,'count'=>$p['count'],'keep_machine_blocked'=>true,'archive_verified'=>true,'journal_persisted'=>true])]);$this->audit('coin_event_review_acknowledged',$id,null,['device_id'=>$device,'archive_hash'=>$p['archive_hash'],'keep_machine_blocked'=>true]);return ['acknowledged'=>true,'id'=>$id];});
    }
}
