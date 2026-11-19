<?php
declare(strict_types=1);

/** Findings, isolated reconciliation, and kiosk reopening have separate authority. */
trait DeliveryCheckWorkflow {
    private function deliveryInspection():?array {
        $r=$this->one('SELECT setting_value FROM system_settings WHERE setting_key=?',['delivery_inspection:'.$this->machineCode]);
        return $r?json_decode($r['setting_value'],true,512,JSON_THROW_ON_ERROR):null;
    }
    private function storeDeliveryInspection(array $value):void {
        $this->exec('INSERT INTO system_settings(setting_key,setting_value) VALUES(?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)',['delivery_inspection:'.$this->machineCode,json_encode($value,JSON_THROW_ON_ERROR)]);
    }
    private function latestDeliveryNote(int $id):?array {
        $r=$this->one("SELECT metadata,created_at,actor_user_id FROM activity_logs WHERE action='admin_dispense_delivery_noted' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.transaction_id'))=? ORDER BY id DESC LIMIT 1",[(string)$id]);
        return $r?json_decode($r['metadata'],true,512,JSON_THROW_ON_ERROR)+['createdAt'=>$r['created_at'],'adminId'=>(int)$r['actor_user_id']]:null;
    }
    private function validateDeliveryFinding(int $id,array $b):array {
        $t=$this->transaction($id);$item=$this->item($id);$r=$this->one('SELECT * FROM dispensing_requests WHERE transaction_id=? ORDER BY id DESC LIMIT 1',[$id]);
        if(!$r||$t['payment_status']!=='successful'||!in_array($t['dispensing_status'],['failed','dispensing'],true)&&!$this->issueReview($id))throw new KioskError('RECOVERY_NOT_ALLOWED','Only an open paid delivery issue can be checked.');
        if(($b['transaction_code']??'')!==$t['transaction_code'])throw new KioskError('TRANSACTION_MISMATCH','The purchase reference changed.');
        $n=$b['verified_quantity']??null;$stock=$b['physical_stock']??null;$outcome=$b['outcome']??'';
        $minimum=max((int)$r['dispensed_quantity'],(int)($this->issueReview($id)['verifiedQuantity']??0));$requested=(int)$r['quantity'];
        if(!is_int($n)||$n<$minimum||$n>$requested||!in_array($outcome,['not_dispensed','partial','dispensed_sensor_missed'],true)||($outcome==='not_dispensed'&&$n!==0)||($outcome==='partial'&&($n<=0||$n>=$requested))||($outcome==='dispensed_sensor_missed'&&$n!==$requested))throw new KioskError('INVALID_QUANTITY','Enter a delivery count matching the selected result and recorded evidence.',422);
        if(!($stock===null&&($b['inspection_mode']??'')==='external')&&(!is_int($stock)||$stock<0||$stock>10))throw new KioskError('INVALID_STOCK','Enter the counted stock from 0 to 10.',422);
        if(!is_string($b['notes']??null)||strlen(trim($b['notes']))<5||strlen($b['notes'])>1000)throw new KioskError('INVALID_RECOVERY','Add a short inspection note.',422);
        $obligation=$b['obligation_status']??'pending';$reference=$b['obligation_reference']??'';
        if(!in_array($obligation,['pending','delivery_verified','refund_documented','replacement_documented'],true)||!is_string($reference)||strlen($reference)>200||($n===$requested&&$obligation!=='delivery_verified')||($n<$requested&&$obligation==='delivery_verified'))throw new KioskError('OBLIGATION_REQUIRED','Choose the actual customer follow-up state.',422);
        if(in_array($obligation,['refund_documented','replacement_documented'],true)&&strlen(trim($reference))<5)throw new KioskError('OBLIGATION_REFERENCE_REQUIRED','Enter the real refund or replacement reference.',422);
        if(!is_string($b['request_key']??null)||!preg_match('/^[a-f0-9]{32}$/D',$b['request_key'])||!is_int($b['expected_revision']??null)||$b['expected_revision']<0)throw new KioskError('INVALID_RECOVERY','A valid request key and revision are required.',422);
        return [$t,$r,$requested];
    }
    /** Read-only independent checks before an operator approaches the mechanism. */
    private function deliveryInspectionBlockers(int $id,bool $requiresFreshController=false):array {
        $reasons=[];$add=static function($c,$m)use(&$reasons){$reasons[]=['code'=>$c,'message'=>$m];};
        $t=$this->transaction($id);$op=$this->deliveryInspection();
        if(($op['status']??'')==='active'&&(int)$op['transaction_id']!==$id)$add('OTHER_REVIEW_PENDING','Another inspection is in progress.');
        if($this->one("SELECT id FROM dispensing_requests WHERE machine_id=? AND request_status IN ('queued','sent','dispensing') LIMIT 1",[$t['machine_id']]))$add('ACTIVE_DISPENSING_REQUEST','An active delivery must be stopped and recovered before hands-on inspection.');
        if($this->one("SELECT id FROM transactions WHERE machine_id=? AND id<>? AND payment_status='pending' AND checkout_key IS NOT NULL LIMIT 1",[$t['machine_id'],$id]))$add('OTHER_PURCHASE_PENDING','Another customer purchase is still open.');
        $m=$this->one('SELECT motor_status FROM machine_status WHERE machine_id=? AND last_communication_at>=DATE_SUB(NOW(),INTERVAL 30 SECOND)',[$t['machine_id']]);
        if($m&&in_array(strtolower(trim($m['motor_status'])),['running','active','moving','dispensing'],true))$add('ACTIVE_MOTOR','The machine still reports movement.');
        $maintenance=$this->one('SELECT setting_value FROM system_settings WHERE setting_key=?',['inventory_maintenance:'.$this->machineCode]);
        if($maintenance&&(json_decode($maintenance['setting_value'],true)['status']??'')==='active')$add('INVENTORY_MAINTENANCE','Finish the open stock change first.');
        $reports=(new CoinPaymentDiagnostics($this->db,$this->machineCode))->activeReports();
        if(count($reports)!==1)$add('CONTROLLER_UNVERIFIED','The installed controller identity needs verification.');
        elseif($requiresFreshController&&!($reports[0]['fresh']??false))$add('CONTROLLER_DIAGNOSTICS_STALE','A recent controller report is required before starting a new inspection pause. Do not reconnect power during an inspection.');
        try{$idle=$this->firebase instanceof DispenseInspectionGateway&&$this->firebase->inspectionCommandIdle();}catch(Throwable){$idle=false;}
        if(!$idle)$add('FIREBASE_VERIFICATION_REQUIRED','The system cannot verify that delivery commands have stopped.');
        return $reasons;
    }
    public function prepareDeliveryInspection(int $id,array $b,array $actor):array {
        $this->requireRecoveryAdmin($actor);
        foreach(['machine_power_isolated','motor_stopped','controller_disconnected'] as $key)if(($b[$key]??false)!==true)throw new KioskError('CONFIRMATION_REQUIRED','Isolate machine power, stop the motors and disconnect the controller before hands-on inspection.',422);
        if(!is_string($b['request_key']??null)||!preg_match('/^[a-f0-9]{32}$/D',$b['request_key']))throw new KioskError('INVALID_RECOVERY','A request key is required.',422);
        return $this->atomic(function()use($id,$b,$actor){
            $t=$this->transaction($id,true);$this->one('SELECT id FROM machines WHERE id=? AND machine_code=? FOR UPDATE',[$t['machine_id'],$this->machineCode])??throw new KioskError('MACHINE_MISMATCH','Machine does not match.');
            if(($b['transaction_code']??'')!==$t['transaction_code']||$t['payment_status']!=='successful'||!in_array($t['dispensing_status'],['failed','dispensed'],true)||($t['dispensing_status']==='dispensed'&&!$this->issueReview($id)))throw new KioskError('RECOVERY_NOT_ALLOWED','Use external observation or recover the active delivery first.');
            $item=$this->item($id);$slot=$this->one('SELECT medicine_id FROM machine_slots WHERE id=?',[$item['slot_id']]);
            if(!$slot||(int)$slot['medicine_id']!==(int)$item['medicine_id'])throw new KioskError('SLOT_CHANGED','This historical medicine no longer occupies the slot. Record external findings only.');
            $existing=$this->deliveryInspection();$resuming=($existing['status']??'')==='active'&&(int)$existing['transaction_id']===$id;
            if($reasons=$this->deliveryInspectionBlockers($id,!$resuming))throw new KioskError('INSPECTION_BLOCKED','Hands-on inspection is not yet safe.',409,['returnBlockers'=>$reasons]);
            if($resuming)return $existing;
            $reports=(new CoinPaymentDiagnostics($this->db,$this->machineCode))->activeReports();
            $v=['status'=>'active','transaction_id'=>$id,'request_key'=>$b['request_key'],'controller_id'=>$reports[0]['device_id'],'actor_id'=>(int)$actor['id'],'power_isolated'=>true,'motor_stopped'=>true,'controller_disconnected'=>true];
            $this->storeDeliveryInspection($v);
            $this->exec("INSERT INTO activity_logs(actor_type,actor_user_id,action,description,metadata) VALUES('user',?,'admin_delivery_inspection_started','Purchases paused for isolated physical inspection; no motor command sent.',?)",[$actor['id'],json_encode($v)]);
            return $v;
        },false);
    }
    /** The persisted isolation pause, not an online heartbeat, authorizes saving findings. */
    private function assertDeliveryInspection(int $id,array $b):void {
        foreach(['machine_power_isolated','motor_stopped','controller_disconnected'] as $flag)if(($b[$flag]??false)!==true)throw new KioskError('CONFIRMATION_REQUIRED','Confirm that power remains isolated and the motors and controller remain stopped.',422);
        $op=$this->deliveryInspection();
        if(($op['status']??'')!=='active'||(int)$op['transaction_id']!==$id||!is_string($b['inspection_key']??null)||!hash_equals($op['request_key'],$b['inspection_key']))throw new KioskError('INSPECTION_REQUIRED','The inspection pause is missing or no longer matches. Keep power isolated and ask a supervisor to check it.');
        // A revoked/expired save authorization never releases the persistent machine pause.
        if(isset($op['authorization_expires_at_ms'])&&(float)$op['authorization_expires_at_ms']<=(float)$this->db->query('SELECT UNIX_TIMESTAMP(NOW(3))*1000')->fetchColumn())throw new KioskError('INSPECTION_EXPIRED','The inspection authorization has expired. Keep power isolated; a supervisor must review the paused operation.');
        foreach(['power_isolated','motor_stopped','controller_disconnected'] as $flag)if(($op[$flag]??false)!==true)throw new KioskError('INSPECTION_REQUIRED','The saved power-isolation confirmation is incomplete. Keep power isolated and ask a supervisor.');
        if($reasons=$this->deliveryInspectionBlockers($id))throw new KioskError('INSPECTION_BLOCKED','The machine state changed during inspection. Keep power isolated and check the paused operation.',409,['returnBlockers'=>$reasons]);
        $reports=(new CoinPaymentDiagnostics($this->db,$this->machineCode))->activeReports();
        if($reports[0]['device_id']!==$op['controller_id'])throw new KioskError('CONTROLLER_UNVERIFIED','The controller identity changed during inspection.');
    }
    public function saveDeliveryCheck(int $id,array $b,array $actor):array {
        $this->requireRecoveryAdmin($actor);$this->validateDeliveryFinding($id,$b);
        if(($b['inspection_mode']??'')==='isolated'){
            if(($b['physically_inspected']??false)!==true)throw new KioskError('CONFIRMATION_REQUIRED','Confirm the physical inspection findings.',422);
            foreach(['machine_power_isolated','motor_stopped','controller_disconnected'] as $flag)if(($b[$flag]??false)!==true)throw new KioskError('CONFIRMATION_REQUIRED','Confirm that power remains isolated and the motors and controller remain stopped.',422);
            $b['return_to_kiosk']=false;$b['inspection_complete']=true;
            return $this->resolveDispensingIssue($id,$b,$actor);
        }
        if(($b['inspection_mode']??'')!=='external'||($b['external_observation_confirmed']??false)!==true)throw new KioskError('CONFIRMATION_REQUIRED','Confirm observation from outside without opening or reaching into the machine.',422);
        return $this->atomic(function()use($id,$b,$actor){
            $this->transaction($id,true);[$t,$r,$requested]=$this->validateDeliveryFinding($id,$b);
            $intent=array_intersect_key($b,array_flip(['outcome','verified_quantity','physical_stock','notes','obligation_status','obligation_reference','expected_revision','inspection_mode']));$hash=hash('sha256',json_encode($intent));
            $retry=$this->one("SELECT metadata FROM activity_logs WHERE action='admin_dispense_delivery_noted' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.transaction_id'))=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.request_key'))=? LIMIT 1",[(string)$id,$b['request_key']]);
            if($retry){$v=json_decode($retry['metadata'],true);if($v['fingerprint']!==$hash)throw new KioskError('EVENT_CONFLICT','This request already saved different findings.');return $v;}
            $prior=$this->latestDeliveryNote($id);if($b['expected_revision']!==($prior['revision']??0))throw new KioskError('RECOVERY_STALE','New findings were saved. Refresh before continuing.');
            $v=['transaction_id'=>$id,'request_id'=>(int)$r['id'],'request_key'=>$b['request_key'],'revision'=>$b['expected_revision']+1,'fingerprint'=>$hash,'outcome'=>$b['outcome'],'verifiedQuantity'=>$b['verified_quantity'],'physicalStock'=>$b['physical_stock']??null,'notes'=>trim($b['notes']),'obligationStatus'=>$b['obligation_status'],'obligationReference'=>$b['obligation_reference']??'','inspectionMode'=>'external','inventoryApplied'=>false,'originalDispensingStatus'=>$t['dispensing_status']];
            $this->exec("INSERT INTO activity_logs(actor_type,actor_user_id,action,description,metadata) VALUES('user',?,'admin_dispense_delivery_noted','External delivery findings saved; stock, payment and machine state unchanged.',?)",[$actor['id'],json_encode($v)]);
            return $v;
        });
    }
    public function reopenAfterDeliveryCheck(int $id,array $b,array $actor):array {
        $this->requireRecoveryAdmin($actor);$r=$this->issueReview($id);
        if(!$r||$this->issueReturnBlockers($id,$r,true))throw new KioskError('REOPEN_BLOCKED','The saved recovery still has a machine safety blocker.');
        foreach(['machine_power_isolated','motor_stopped','controller_disconnected'] as $key)if(($b[$key]??false)!==true)throw new KioskError('CONFIRMATION_REQUIRED','Confirm isolation and stopped motors before reopening.',422);
        return $this->resolveDispensingIssue($id,['transaction_code'=>$b['transaction_code']??'','request_key'=>$b['request_key']??'','expected_revision'=>$b['expected_revision']??null,'outcome'=>$r['outcome'],'verified_quantity'=>$r['verifiedQuantity'],'physical_stock'=>$r['physicalStock'],'notes'=>$r['notes'],'obligation_status'=>$r['obligationStatus'],'obligation_reference'=>$r['obligationReference'],'physically_inspected'=>true,'motor_stopped'=>true,'controller_disconnected'=>true,'inspection_complete'=>true,'return_to_kiosk'=>true],$actor);
    }
    private function closeDeliveryInspection(int $id):void {
        $op=$this->deliveryInspection();if(($op['status']??'')==='active'&&(int)$op['transaction_id']===$id){$op['status']='completed';$this->storeDeliveryInspection($op);}
    }
}
