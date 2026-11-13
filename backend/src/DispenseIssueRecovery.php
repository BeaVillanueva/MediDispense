<?php
declare(strict_types=1);

/** Admin physical observations; never sensor events, refunds or dispense commands. */
trait DispenseIssueRecovery {
    private function issueCustomerPending(array $review): bool {
        return ($review['verifiedQuantity']??0)<($review['requestedQuantity']??0) && ($review['obligationStatus']??'pending')==='pending';
    }
    private function issueMachinePending(array $review): bool {
        return !($review['inspectionComplete']??false)||!($review['stockVerified']??false)||!($review['firebaseRetired']??false)||!($review['motorStopped']??false)||!($review['controllerDisconnected']??false)
            || (($review['reviewRequired']??true)&&!$this->issueCustomerPending($review));
    }
    private function issueReview(int $id): ?array {
        $row=$this->one("SELECT metadata,created_at,actor_user_id FROM activity_logs WHERE action='admin_dispense_issue_reviewed' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.transaction_id'))=? ORDER BY id DESC LIMIT 1",[(string)$id]);
        if(!$row)return null;
        return json_decode($row['metadata'],true,512,JSON_THROW_ON_ERROR)+['createdAt'=>$row['created_at'],'adminId'=>(int)$row['actor_user_id']];
    }
    private function machineIssueReviewPending(?int $excluding=null): bool {
        $q=$this->db->prepare("SELECT a.metadata FROM activity_logs a JOIN transactions t ON t.id=CAST(JSON_UNQUOTE(JSON_EXTRACT(a.metadata,'$.transaction_id')) AS UNSIGNED) JOIN machines m ON m.id=t.machine_id WHERE a.action='admin_dispense_issue_reviewed' AND m.machine_code=? ORDER BY a.id DESC");
        $q->execute([$this->machineCode]);$seen=[];
        foreach($q->fetchAll() as $r){$v=json_decode($r['metadata'],true);$id=$v['transaction_id'];if($id===$excluding||isset($seen[$id]))continue;$seen[$id]=true;if($this->issueMachinePending($v))return true;}
        return false;
    }
    private function issueReturnReady(int $id,array $review): bool {
        return !$this->issueReturnBlockers($id,$review);
    }
    private function issueReturnBlockers(int $id,?array $review,bool $verifyCommand=false): array {
        if(!$review)return [['code'=>'REVIEW_NOT_SAVED','message'=>'Save your review first.']];
        $reasons=[];
        $add=static function(string $code,string $message)use(&$reasons):void{$reasons[$code]=['code'=>$code,'message'=>$message];};
        if(!($review['inspectionComplete']??false))$add('INSPECTION_INCOMPLETE','Physical inspection is incomplete.');
        if(!($review['motorStopped']??false)||!($review['controllerDisconnected']??false))$add('CONTROLLER_VERIFICATION_REQUIRED','Motor stop and controller disconnection need verification.');
        if(!($review['stockVerified']??false))$add('INVENTORY_INCOMPLETE','Inventory reconciliation is incomplete. Enter the remaining stock and save.');
        if($this->issueMachinePending($review)&&!$reasons)$add('REVIEW_INCOMPLETE','The saved physical recovery still needs review.');
        if(!($review['firebaseRetired']??false))$add('COMMAND_RETIREMENT_UNCONFIRMED','Dispensing command retirement needs verification.');
        if($verifyCommand&&($review['firebaseRetired']??false)&&$this->firebase instanceof DispenseRecoveryReadGateway){
            try{$command=$this->firebase->recoveryRetirementState((int)$review['request_id']);}catch(RuntimeException|JsonException $failure){$command='unverified';}
            if($command==='active')$add('ACTIVE_FIREBASE_COMMAND','Another dispensing command is active. Keep the controller disconnected.');
            elseif($command!=='retired')$add('FIREBASE_VERIFICATION_REQUIRED','Dispensing command retirement could not be verified. Check the Firebase connection.');
        }
        if($this->machineIssueReviewPending($id))$add('OTHER_REVIEW_PENDING','Another dispensing recovery still needs review.');
        $t=$this->transaction($id);$payment=$this->one('SELECT status,amount_inserted FROM payments WHERE transaction_id=?',[$id]);
        if($t['payment_status']!=='successful'||!$payment||$payment['status']!=='successful'||self::cents($t['amount_paid'])!==self::cents($t['total_amount'])||self::cents($payment['amount_inserted'])!==self::cents($t['amount_paid']))$add('PAYMENT_RECONCILIATION_REQUIRED','Recorded payment needs reconciliation.');
        if($this->one("SELECT dr.id FROM dispensing_requests dr JOIN machines m ON m.id=dr.machine_id WHERE m.machine_code=? AND dr.request_status IN ('queued','sent','dispensing') LIMIT 1",[$this->machineCode]))$add('ACTIVE_DISPENSING_REQUEST','Another dispensing request is still active or pending.');
        if($this->one("SELECT t.id FROM transactions t JOIN machines m ON m.id=t.machine_id WHERE m.machine_code=? AND t.id<>? AND t.payment_status='pending' AND t.checkout_key IS NOT NULL LIMIT 1",[$this->machineCode,$id]))$add('OTHER_PURCHASE_PENDING','Another recoverable purchase is waiting for payment.');
        foreach($this->issueControllerBlockers($id) as $reason)$add($reason['code'],$reason['message']);
        return array_values($reasons);
    }
    private function issueControllerBlockers(int $id): array {
        $reasons=[];$add=static function(string $c,string $m)use(&$reasons){$reasons[]=['code'=>$c,'message'=>$m];};
        if(!class_exists('CoinPaymentDiagnostics'))return [['code'=>'CONTROLLER_UNVERIFIED','message'=>'Controller payment diagnostics are unavailable.']];
        $reports=(new CoinPaymentDiagnostics($this->db,$this->machineCode))->activeReports();
        if(count($reports)!==1)return [['code'=>'CONTROLLER_UNVERIFIED','message'=>'One genuine controller report is required to verify payment safety.']];
        $r=$reports[0];
        if(!($r['fresh']??false))$add('CONTROLLER_DIAGNOSTICS_STALE','Controller diagnostics are out of date. Obtain a fresh status report before returning the kiosk.');
        if(($r['pending_events']??-1)!==0||($r['durable_events']??-1)!==0)$add('UNRESOLVED_COIN_EVENTS','Unconfirmed coin events must be reconciled before kiosk return.');
        if(($r['incomplete_pulses']??true)!==false)$add('INCOMPLETE_COIN_PULSES','A coin pulse sequence is incomplete. Keep the purchase for inspection.');
        if(($r['storage_healthy']??false)!==true)$add('COIN_STORAGE_UNHEALTHY','The controller coin journal needs verification.');
        if(($r['reconciliation_required']??true)!==false||($r['boot_review_required']??true)!==false||($r['binding_review_required']??true)!==false||($r['binding_phase']??-1)!==0||($r['overflow_events']??-1)!==0||($r['overflow_pulses']??-1)!==0)$add('CONTROLLER_RECONCILIATION_REQUIRED','The controller has an unresolved recovery, binding or queue fault.');
        if(($r['backend_session_verified']??false)!==true)$add('PAYMENT_SESSION_UNVERIFIED','The controller has not verified its payment session with the backend.');
        $owner=(int)($r['bound_transaction_id']??0);
        if($owner>0){$owned=$this->one('SELECT t.id,t.payment_status FROM transactions t JOIN machines m ON m.id=t.machine_id WHERE t.id=? AND m.machine_code=?',[$owner,$this->machineCode]);
            if(!$owned)$add('UNKNOWN_PAYMENT_OWNER','The controller is bound to an unknown purchase. Staff reconciliation is required.');
            elseif($owner!==$id && $owned['payment_status']==='pending')$add('ACTIVE_PAYMENT_SESSION','The controller is still bound to another active payment session.');
        }
        $motor=$this->one('SELECT ms.motor_status,(ms.last_communication_at>=DATE_SUB(NOW(),INTERVAL 30 SECOND)) fresh FROM machine_status ms JOIN machines m ON m.id=ms.machine_id WHERE m.machine_code=?',[$this->machineCode]);
        if($motor&&$motor['fresh']&&in_array(strtolower(trim($motor['motor_status'])),['running','dispensing','active','moving'],true))$add('ACTIVE_MOTOR','Recent monitoring reports an active motor. Confirm it is stopped before returning the kiosk.');
        return $reasons;
    }
    private function issueReturnWarnings(int $id,?array $review): array {
        $warnings=[];
        if($review&&$this->issueCustomerPending($review))$warnings[]=['code'=>'CUSTOMER_OBLIGATION_PENDING','message'=>'A customer refund or replacement is still owed for this purchase. Track it separately; kiosk return does not settle it.'];
        $q=$this->db->prepare("SELECT t.id,t.transaction_code FROM transactions t JOIN machines m ON m.id=t.machine_id WHERE m.machine_code=? AND t.id<>? AND t.payment_status='successful' AND t.dispensing_status='failed' AND NOT EXISTS(SELECT 1 FROM dispensing_requests dr WHERE dr.transaction_id=t.id AND dr.request_status IN ('queued','sent','dispensing')) ORDER BY t.id DESC");$q->execute([$this->machineCode,$id]);
        $history=$q->fetchAll();
        if($history)$warnings[]=['code'=>'HISTORICAL_FAILED_PURCHASES','message'=>count($history).' historical failed purchase(s) remain in admin history. Review customer obligations separately; failed status alone is not a machine lock.'];
        return $warnings;
    }
    public function dispensingIssueDetails(int $id,array $actor): array {
        $this->requireRecoveryAdmin($actor);
        $q=$this->db->prepare("SELECT actor_user_id,created_at,metadata FROM activity_logs WHERE action='admin_dispense_issue_reviewed' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.transaction_id'))=? ORDER BY id DESC");$q->execute([(string)$id]);
        $history=array_map(fn($r)=>json_decode($r['metadata'],true)+['adminId'=>(int)$r['actor_user_id'],'createdAt'=>$r['created_at']],$q->fetchAll());
        $item=$this->item($id);$stock=$this->one('SELECT quantity FROM inventory WHERE medicine_id=?',[$item['medicine_id']]);
        $blockers=$this->issueReturnBlockers($id,$this->issueReview($id),true);
        return ['transaction'=>$this->snapshot($id),'recordedStock'=>(int)$stock['quantity'],'history'=>$history,'returnEligibility'=>['ready'=>!$blockers,'blockers'=>$blockers,'warnings'=>$this->issueReturnWarnings($id,$this->issueReview($id))]];
    }
    private function requireRecoveryAdmin(array $actor): void {
        if(!in_array($actor['role_code']??'', ['admin','super_admin'],true) || (int)($actor['id']??0)<1)throw new KioskError('FORBIDDEN','Administrator access required.',403);
    }
    public function resolveDispensingIssue(int $id,array $b,array $actor): array {
        $this->requireRecoveryAdmin($actor);
        $notes=is_string($b['notes']??null)?trim($b['notes']):'';
        $outcome=$b['outcome']??null;$verified=$b['verified_quantity']??null;$key=$b['request_key']??null;$revision=$b['expected_revision']??null;
        $obligation=$b['obligation_status']??'pending';$reference=is_string($b['obligation_reference']??null)?trim($b['obligation_reference']):'';
        if(($b['physically_inspected']??false)!==true || ($b['motor_stopped']??false)!==true || ($b['controller_disconnected']??false)!==true)throw new KioskError('CONFIRMATION_REQUIRED','Confirm physical inspection, stopped motors and a disconnected controller.',422);
        if(!is_string($key)||!preg_match('/^[a-f0-9]{32}$/D',$key)||!is_int($revision)||$revision<0||!is_int($verified)||$verified<0||$verified>3||!in_array($outcome,['dispensed_sensor_missed','not_dispensed','partial'],true)||strlen($notes)<5||strlen($notes)>1000)throw new KioskError('INVALID_RECOVERY','Select a physical outcome, whole verified quantity and notes (5–1000 characters).',422);
        if(!is_bool($b['inspection_complete']??null)||!is_bool($b['return_to_kiosk']??null)||!in_array($obligation,['pending','delivery_verified','refund_documented','replacement_documented'],true)||strlen($reference)>200)throw new KioskError('INVALID_RECOVERY','Invalid inspection, return or customer obligation selection.',422);
        if(in_array($obligation,['refund_documented','replacement_documented'],true)&&strlen($reference)<5)throw new KioskError('OBLIGATION_REFERENCE_REQUIRED','Document the externally handled refund or replacement. This action does not issue one.',422);
        $count=$b['physical_stock']??null;
        if($count!==null&&(!is_int($count)||$count<0||$count>10))throw new KioskError('INVALID_STOCK','Counted remaining stock must be a whole number from 0 to 10.',422);
        $intent=['outcome'=>$outcome,'verified'=>$verified,'notes'=>$notes,'obligation'=>$obligation,'reference'=>$reference,'inspection'=>$b['inspection_complete'],'stock'=>$count,'return'=>$b['return_to_kiosk'],'revision'=>$revision];
        $fingerprint=hash('sha256',json_encode($intent,JSON_THROW_ON_ERROR));
        return $this->atomic(function()use($id,$b,$actor,$key,$revision,$verified,$outcome,$notes,$obligation,$reference,$count,$fingerprint){
            $t=$this->transaction($id,true);
            if(($b['transaction_code']??'')!==$t['transaction_code'])throw new KioskError('TRANSACTION_MISMATCH','Transaction reference changed.',422);
            if(!$this->one('SELECT id FROM machines WHERE id=? AND machine_code=? FOR UPDATE',[$t['machine_id'],$this->machineCode]))throw new KioskError('MACHINE_MISMATCH','This purchase belongs to another configured machine.');
            $previous=$this->issueReview($id);
            $retry=$this->one("SELECT metadata FROM activity_logs WHERE action='admin_dispense_issue_reviewed' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.transaction_id'))=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.request_key'))=? LIMIT 1",[(string)$id,$key]);
            if($retry){if(json_decode($retry['metadata'],true)['fingerprint']!==$fingerprint)throw new KioskError('EVENT_CONFLICT','This recovery key was already used for another decision.');return $this->snapshot($id);}
            if($revision!==($previous['revision']??0))throw new KioskError('RECOVERY_STALE','Another review was saved. Reload this case before continuing.');
            if($t['payment_status']!=='successful'||!in_array($t['dispensing_status'],['dispensing','failed'],true) && !$previous)throw new KioskError('RECOVERY_NOT_ALLOWED','Only a paid dispensing issue can be reviewed. Completed historical transactions are unchanged.');
            $payment=$this->one('SELECT * FROM payments WHERE transaction_id=? FOR UPDATE',[$id]);
            if(!$payment||$payment['status']!=='successful'||self::cents($payment['amount_inserted'])!==self::cents($t['amount_paid'])||self::cents($t['amount_paid'])!==self::cents($t['total_amount']))throw new KioskError('PAYMENT_RECONCILIATION_REQUIRED','Payment mismatch or excess requires separate reconciliation; payment records were not changed.');
            $r=$this->one('SELECT * FROM dispensing_requests WHERE transaction_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE',[$id]);
            if(!$r)throw new KioskError('RECOVERY_NOT_ALLOWED','No dispensing request exists.');
            $item=$this->item($id);$sensor=(int)$r['dispensed_quantity'];$requested=(int)$r['quantity'];$before=$previous['verifiedQuantity']??$sensor;
            if($requested!==(int)$item['quantity'] || (int)$r['slot_id']!==(int)$item['slot_id'] || (int)$r['machine_id']!==(int)$t['machine_id'])throw new KioskError('TRANSACTION_MISMATCH','Dispensing request and purchase mapping disagree; staff investigation is required.');
            if($verified<$sensor||$verified<$before||$verified>$requested || ($outcome==='dispensed_sensor_missed'&&$verified!==$requested) || ($outcome==='not_dispensed'&&$verified!==0) || ($outcome==='partial'&&$verified===$requested))throw new KioskError('INVALID_QUANTITY','Verified quantity must respect sensor evidence and earlier reviews and match the selected outcome.',422);
            if($previous&&!$previous['reviewRequired']&&($verified!==$before||$outcome!==$previous['outcome']||$obligation!==$previous['obligationStatus']))throw new KioskError('RECOVERY_FINALIZED','A finalized outcome cannot be changed by another recovery.');
            if($verified===$requested && $obligation!=='delivery_verified' || $verified<$requested && $obligation==='delivery_verified')throw new KioskError('OBLIGATION_REQUIRED','Record verified delivery for a full outcome or a separate customer obligation for missing units.',422);
            if($outcome!=='partial'&&!$b['inspection_complete'])throw new KioskError('INSPECTION_REQUIRED','Confirm that the physical inspection is complete.',422);
            $stock=$this->one('SELECT * FROM inventory WHERE medicine_id=? FOR UPDATE',[$item['medicine_id']]);
            $slot=$this->one('SELECT * FROM machine_slots WHERE id=? FOR UPDATE',[$item['slot_id']]);
            if(!$stock||!$slot||(int)$slot['medicine_id']!==(int)$item['medicine_id'])throw new KioskError('SLOT_CHANGED','Slot mapping or inventory changed. Staff inventory review is required.');
            $legacy=$this->one("SELECT id FROM activity_logs WHERE action='admin_dispense_recovered' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.transaction_id'))=? LIMIT 1",[(string)$id]);
            $recount=$this->one("SELECT id FROM activity_logs WHERE action='dispense_stock_reconciled' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.transaction_id'))=? LIMIT 1",[(string)$id]);
            $release=$previous||$legacy||$t['dispensing_status']==='failed'?0:$requested-$sensor;
            $open=$this->db->prepare("SELECT ti.transaction_id,ti.quantity FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id WHERE ti.medicine_id=? AND ((t.payment_status='pending' AND t.dispensing_status='pending') OR (t.payment_status='successful' AND t.dispensing_status='dispensing'))");$open->execute([$item['medicine_id']]);$expectedReserved=0;
            foreach($open->fetchAll() as $reservation){$confirmed=$this->one('SELECT dispensed_quantity FROM dispensing_requests WHERE transaction_id=? ORDER BY id DESC LIMIT 1',[$reservation['transaction_id']]);$expectedReserved+=(int)$reservation['quantity']-(int)($confirmed['dispensed_quantity']??0);}
            if($expectedReserved!==(int)$stock['reserved_quantity'])throw new KioskError('STOCK_RECONCILIATION_REQUIRED','Recorded reservations do not match active purchases. Investigate inventory before recovery.');
            $delta=$recount?0:$verified-$before;
            if($recount&&$count===null)throw new KioskError('PHYSICAL_COUNT_REQUIRED','This legacy case was already recounted. Confirm its current physical stock to avoid a second deduction.',422);
            $after=(int)$stock['quantity']-$delta;$remainingReserved=(int)$stock['reserved_quantity']-$release;
            if($remainingReserved<0||$after<$remainingReserved||$after<0)throw new KioskError('STOCK_RECONCILIATION_REQUIRED','Inventory/reservation mismatch; no recovery was saved.');
            if($count!==null&&$count!==$after)throw new KioskError('PHYSICAL_STOCK_MISMATCH','The physical count differs from the expected reconciled stock. Investigate other inventory differences before saving.');
            $machineReviewRequired=!$b['inspection_complete']||$count===null;
            $customerObligationPending=$verified<$requested&&$obligation==='pending';
            $reviewRequired=$machineReviewRequired||$customerObligationPending;
            if($b['return_to_kiosk']&&$machineReviewRequired)throw new KioskError('RECOVERY_INCOMPLETE','Finish the physical inspection and inventory reconciliation before returning the kiosk.');
            // Never send a motor command. ETag retirement rejects a different active Firebase command.
            try{$this->firebase->retireDispenseCommand((int)$r['id']);}
            catch(RuntimeException|JsonException $failure){
                $active=str_starts_with($failure->getMessage(),'Another Firebase command is active.');
                $code=$active?'ACTIVE_FIREBASE_COMMAND':'FIREBASE_VERIFICATION_REQUIRED';
                $message=$active?'Another dispensing command is active. Keep the controller disconnected and resolve that request first.':'Command retirement could not be verified. Keep the controller disconnected and check the Firebase connection before saving again.';
                throw new KioskError($code,$message,409,['returnBlockers'=>[['code'=>$code,'message'=>$message]]]);
            }
            $this->exec('UPDATE inventory SET quantity=?,reserved_quantity=?,last_counted_at=IF(?=1,NOW(),last_counted_at) WHERE medicine_id=?',[$after,$remainingReserved,$count!==null?1:0,$item['medicine_id']]);
            if($delta>0)$this->exec("INSERT INTO stock_movements(medicine_id,transaction_id,dispensing_request_id,previous_quantity,new_quantity,change_quantity,change_type,reason,actor_user_id) VALUES(?,?,?,?,?,?,'adjustment','Admin verified physical dispense; IR evidence unchanged',?)",[$item['medicine_id'],$id,$r['id'],$stock['quantity'],$after,-$delta,$actor['id']]);
            $full=$verified===$requested && $b['inspection_complete'];
            $this->exec('UPDATE transactions SET dispensing_status=? WHERE id=?',[$full?'dispensed':'failed',$id]);
            $this->exec('UPDATE dispensing_requests SET request_status=?,completed_at=COALESCE(completed_at,NOW()) WHERE id=?',[$full?'success':'failed',$r['id']]);
            $this->exec('UPDATE machine_slots SET slot_status=? WHERE id=?',[$machineReviewRequired?'blocked':'ready',$slot['id']]);
            $audit=['transaction_id'=>$id,'request_id'=>(int)$r['id'],'request_key'=>$key,'fingerprint'=>$fingerprint,'revision'=>$revision+1,'outcome'=>$outcome,'verifiedQuantity'=>$verified,'sensorConfirmedQuantity'=>$sensor,'requestedQuantity'=>$requested,'originalDispensingStatus'=>$previous['originalDispensingStatus']??$t['dispensing_status'],'previousDispensingStatus'=>$t['dispensing_status'],'reviewRequired'=>$reviewRequired,'inspectionComplete'=>$b['inspection_complete'],'stockVerified'=>$count!==null,'firebaseRetired'=>true,'returnRequested'=>$b['return_to_kiosk'],'obligationStatus'=>$obligation,'obligationReference'=>$reference,'notes'=>$notes,'releasedReservation'=>$release,'newlyDeducted'=>$delta,'priorStockRecountId'=>$recount?(int)$recount['id']:null,'motorStopped'=>true,'controllerDisconnected'=>true,'confirmationSource'=>'authenticated_admin_physical_inspection'];
            $audit+=['medicine_id'=>(int)$item['medicine_id'],'medicine_name'=>$item['medicine_name_snapshot'],'slot_id'=>(int)$slot['id'],'slot_number'=>(int)$slot['slot_number'],'originalRequestStatus'=>$previous['originalRequestStatus']??$r['request_status'],'physicalStock'=>$count,'recordedStockBefore'=>(int)$stock['quantity'],'recordedStockAfter'=>$after,'reservedBefore'=>(int)$stock['reserved_quantity'],'reservedAfter'=>$remainingReserved];
            $audit+=['machineReviewRequired'=>$machineReviewRequired,'customerObligationPending'=>$customerObligationPending];
            $this->exec("INSERT INTO activity_logs(actor_type,actor_user_id,action,description,metadata) VALUES('user',?,'admin_dispense_issue_reviewed','Physical dispensing outcome reviewed; payment records unchanged.',?)",[$actor['id'],json_encode($audit,JSON_THROW_ON_ERROR)]);
            if($b['return_to_kiosk']&&($blockers=$this->issueReturnBlockers($id,$audit)))throw new KioskError('OTHER_UNRESOLVED',implode(' ',array_column($blockers,'message')).' Review was not committed; keep the controller disconnected.',409,['returnBlockers'=>$blockers]);
            return $this->snapshot($id);
        },false);
    }
}
