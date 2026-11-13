<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../src/CoinPaymentDiagnostics.php';require __DIR__.'/../src/Database.php';require __DIR__.'/../src/KioskService.php';require __DIR__.'/../src/FirebaseRealtimeDatabase.php';
$db=Database::connect(require __DIR__.'/../config/config.php');
foreach(['medicine_categories','medicines','inventory','machines','machine_slots','transactions','transaction_items','payments','payment_events','dispensing_requests','dispensing_logs','stock_movements','notifications','activity_logs','system_settings','roles','users','machine_status','alert_incidents','alert_email_jobs','alert_recipients','notification_reads','notification_dismissals','alert_email_attempts'] as $table) {
    $ddl=$db->query("SHOW CREATE TABLE $table")->fetch(PDO::FETCH_NUM)[1];$ddl=preg_replace('/^\s*CONSTRAINT[^\n]+\n/m','',$ddl);$ddl=preg_replace('/,\n\)/',"\n)",$ddl);$db->exec(str_replace('CREATE TABLE','CREATE TEMPORARY TABLE',$ddl));
}
$db->exec("INSERT INTO medicine_categories(id,name) VALUES(1,'LAN Test')");
$db->exec("INSERT INTO medicines(id,category_id,name,generic_name,description,dosage_information,usage_instructions,unit_price,expiry_date) VALUES(1,1,'LAN test medicine','Test','Test','Label','Label',10,'2035-01-01')");
$db->exec('INSERT INTO inventory(medicine_id,quantity,reserved_quantity) VALUES(1,5,0)');
$db->exec("INSERT INTO machines(id,machine_code,name) VALUES(1,'LAN-TEST','Test')");
$db->exec("INSERT INTO machine_slots(id,machine_id,slot_number,medicine_id,motor_id,sensor_id,slot_status) VALUES(1,1,1,1,'TEST','TEST','ready')");
require __DIR__.'/../src/AlertService.php';
$gateway=new class implements DispenseCommandGateway, DispenseRecoveryReadGateway {
    public int $sent=0;public int $retired=0;public bool $fail=false;public bool $active=false;
    public function sendDispenseCommand(int $r,int $s,int $q):array{$this->sent++;throw new RuntimeException('No dispensing allowed in recovery tests');}
    public function retireDispenseCommand(int $r):void{if($this->active)throw new RuntimeException('Another Firebase command is active. Keep the controller disconnected and reconcile that request first.');if($this->fail)throw new RuntimeException('Simulated Firebase retirement failure');$this->retired++;}
    public function recoveryRetirementState(int $r):string{return $this->active?'active':($this->fail?'unverified':'retired');}
};
$service=new KioskService($db,'LAN-TEST',$gateway);$token=bin2hex(random_bytes(32));$actor=['id'=>1,'role_code'=>'admin'];
function ok(bool $b,string $s):void{if(!$b)throw new RuntimeException($s);echo "PASS $s\n";}
function denied(callable $f,string $code):void{try{$f();throw new RuntimeException('Unexpected recovery accepted');}catch(KioskError $e){ok($e->errorCode===$code,$code);}}
function controller(array $changes=[]):void{global $db;(new CoinPaymentDiagnostics($db,'LAN-TEST'))->record(array_replace(['device_id'=>'AABBCCDDEEFF','bound_transaction_id'=>0,'pending_events'=>0,'durable_events'=>0,'overflow_events'=>0,'overflow_pulses'=>0,'incomplete_pulses'=>false,'reconciliation_required'=>false,'boot_review_required'=>false,'storage_healthy'=>true,'backend_session_verified'=>true,'inhibit_supported'=>false,'automatic_handoff_safe'=>false,'binding_phase'=>0,'binding_review_required'=>false],$changes));}
function clean():void{global $db,$gateway;foreach(['activity_logs','stock_movements','dispensing_logs','dispensing_requests','payment_events','payments','transaction_items','transactions','notifications','alert_email_jobs','alert_incidents','system_settings','machine_status'] as $t)$db->exec('DELETE FROM '.$t);$db->exec('UPDATE inventory SET quantity=5,reserved_quantity=0');$db->exec("UPDATE machine_slots SET slot_status='ready'");$gateway->sent=0;$gateway->retired=0;$gateway->fail=false;$gateway->active=false;controller();}
function purchase(int $qty=1):array{global $service,$token;$t=$service->checkout(['request_id'=>bin2hex(random_bytes(16)),'items'=>[['medicine_id'=>1,'quantity'=>$qty]]],$token);for($i=0;$i<$qty;$i++)$t=$service->verifyCoin($t['databaseId'],'payment-'.$i,10);return $t;}
function body(array $t,int $qty,int $stock,string $outcome='dispensed_sensor_missed',int $revision=0):array{return ['transaction_code'=>$t['id'],'request_key'=>bin2hex(random_bytes(16)),'expected_revision'=>$revision,'outcome'=>$outcome,'verified_quantity'=>$qty,'physical_stock'=>$stock,'physically_inspected'=>true,'motor_stopped'=>true,'controller_disconnected'=>true,'inspection_complete'=>true,'obligation_status'=>$outcome==='dispensed_sensor_missed'?'delivery_verified':'pending','obligation_reference'=>'','notes'=>'Physically inspected medicine and machine; motor stopped.','return_to_kiosk'=>true];}

clean();$t=purchase();$id=$t['databaseId'];$rid=$t['dispensingRequestId'];$service->sensor($rid,1,false);
$b=body($t,1,4);
ok(!$service->snapshot($id)['receipt']['eligible'],'Paid failed dispensing stays details-only');
ok($service->dispensingIssueDetails($id,$actor)['returnEligibility']['blockers'][0]['code']==='REVIEW_NOT_SAVED','Unsaved return eligibility explicitly says to save the review first');
$payments=$db->query('SELECT * FROM payments')->fetchAll();$events=$db->query('SELECT * FROM payment_events')->fetchAll();$notifications=$db->query('SELECT * FROM notifications')->fetchAll();
denied(fn()=>$service->resolveDispensingIssue($id,$b,['id'=>2,'role_code'=>'staff']),'FORBIDDEN');
foreach(['physically_inspected','motor_stopped','controller_disconnected'] as $field)denied(fn()=>$service->resolveDispensingIssue($id,array_replace($b,[$field=>false]),$actor),'CONFIRMATION_REQUIRED');
denied(fn()=>$service->resolveDispensingIssue($id,array_replace($b,['transaction_code'=>'OTHER']),$actor),'TRANSACTION_MISMATCH');
denied(fn()=>$service->resolveDispensingIssue($id,array_replace($b,['physical_stock'=>5]),$actor),'PHYSICAL_STOCK_MISMATCH');
$gateway->fail=true;denied(fn()=>$service->resolveDispensingIssue($id,$b,$actor),'FIREBASE_VERIFICATION_REQUIRED');$gateway->fail=false;
$gateway->active=true;denied(fn()=>$service->resolveDispensingIssue($id,$b,$actor),'ACTIVE_FIREBASE_COMMAND');$gateway->active=false;
ok((int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===5&&!$service->snapshot($id)['issueRecovery'],'Failed recovery does not change inventory or write outcome audit');
$result=$service->resolveDispensingIssue($id,$b,$actor);
ok($result['dispensingStatus']==='dispensed'&&$result['dispensedQuantity']===1&&$result['sensorConfirmedQuantity']===0,'Missed IR reconciles physical delivery without inventing sensor evidence');
ok($result['receipt']['eligible']&&$result['receipt']['deliveryVerification']==='admin_physical','Actual recovery snapshot exposes E-Receipt only after finalized physical delivery');
ok($service->transactionRecordDetails($id,$actor)['history']!==[],'Transaction details preserve the recovery audit history');
$staffDetails=$service->transactionRecordDetails($id,['id'=>2,'role_code'=>'staff']);
ok(!str_contains(json_encode($staffDetails['history']),$b['notes']),'Staff transaction access does not expose private admin recovery notes');
denied(fn()=>$service->transactionRecordDetails($id,['id'=>0,'role_code'=>'anonymous']),'FORBIDDEN');
ok($result['issueRecovery']['machineReuseReady']&&$result['issueRecovery']['returnRequested'],'Return requires persisted complete recovery and verified machine reuse conditions');
ok((int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===4&&(int)$db->query('SELECT reserved_quantity FROM inventory')->fetchColumn()===0,'Verified missed unit deducted once; failed-request reservation not released twice');
$service->resolveDispensingIssue($id,$b,$actor);
ok((int)$db->query('SELECT COUNT(*) FROM stock_movements')->fetchColumn()===1&&(int)$db->query("SELECT COUNT(*) FROM activity_logs WHERE action='admin_dispense_issue_reviewed'")->fetchColumn()===1,'Duplicate submission has one movement and one review');
denied(fn()=>$service->resolveDispensingIssue($id,array_replace($b,['notes'=>'Changed notes for reused key']),$actor),'EVENT_CONFLICT');
denied(fn()=>$service->resolveDispensingIssue($id,array_replace($b,['request_key'=>bin2hex(random_bytes(16))]),$actor),'RECOVERY_STALE');
denied(fn()=>$service->sensor($rid,1,true),'DISPENSE_FINALIZED');
ok($payments===$db->query('SELECT * FROM payments')->fetchAll()&&$events===$db->query('SELECT * FROM payment_events')->fetchAll(),'Verified payment and immutable event records preserved');
ok($notifications===$db->query('SELECT * FROM notifications')->fetchAll(),'Recovery neither acknowledges nor resolves notifications');
$details=$service->dispensingIssueDetails($id,$actor);$h=$details['history'][0];
ok($details['returnEligibility']['ready']&&$details['returnEligibility']['blockers']===[],'Successful saved review exposes confirmed return eligibility');
$gateway->active=true;
ok(in_array('ACTIVE_FIREBASE_COMMAND',array_column($service->dispensingIssueDetails($id,$actor)['returnEligibility']['blockers'],'code'),true),'Read-only eligibility detects a currently active Firebase command');
$gateway->active=false;$gateway->fail=true;
ok(in_array('FIREBASE_VERIFICATION_REQUIRED',array_column($service->dispensingIssueDetails($id,$actor)['returnEligibility']['blockers'],'code'),true),'Unavailable Firebase verification keeps Return blocked without altering the review');
$gateway->fail=false;
ok($h['adminId']===1&&!!$h['createdAt']&&$h['originalDispensingStatus']==='failed'&&$h['outcome']==='dispensed_sensor_missed'&&$h['notes']===$b['notes'],'Audit exposes actor, timestamp, original status, physical outcome, quantity and notes');
denied(fn()=>$service->dispensingIssueDetails($id,['id'=>2,'role_code'=>'staff']),'FORBIDDEN');
ok(!array_key_exists('notes',$result['issueRecovery'])&&!array_key_exists('obligationReference',$result['issueRecovery']),'Customer snapshot does not expose private admin notes or financial references');
ok($gateway->sent===0&&$gateway->retired===1,'Only selected command retirement; no repeat dispense on recovery or retries');

clean();$t=purchase(2);$id=$t['databaseId'];$b=body($t,0,5,'not_dispensed');$b['return_to_kiosk']=false;
$r=$service->resolveDispensingIssue($id,$b,$actor);
ok($r['dispensingStatus']==='failed'&&$r['issueRecovery']['reviewRequired'],'No physical delivery retains failure and outstanding obligation');
ok(!$r['receipt']['eligible'],'Recovered missing delivery with an outstanding customer obligation has no E-Receipt');
ok(in_array('CUSTOMER_OBLIGATION_PENDING',array_column($service->dispensingIssueDetails($id,$actor)['returnEligibility']['warnings'],'code'),true),'Unresolved customer obligation remains visible as a warning, not a motor/session lock');
ok((int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===5&&(int)$db->query('SELECT reserved_quantity FROM inventory')->fetchColumn()===0,'No delivery deducts no stock and releases its reservation once');
ok($service->medicines()[0]['availableForPurchase'],'A physically reconciled case with customer follow-up does not lock unrelated safe purchases');
$next=array_replace($b,['request_key'=>bin2hex(random_bytes(16)),'expected_revision'=>1,'return_to_kiosk'=>true]);
$owed=$service->resolveDispensingIssue($id,$next,$actor);
ok($owed['issueRecovery']['machineReuseReady']&&$owed['issueRecovery']['customerObligationPending']&&!$owed['issueRecovery']['machineReviewRequired'],'Return can succeed while the outstanding customer obligation remains recorded');
$next['request_key']=bin2hex(random_bytes(16));$next['expected_revision']=2;
$next['obligation_status']='refund_documented';$next['obligation_reference']='external-receipt-123';
$r=$service->resolveDispensingIssue($id,$next,$actor);
ok($r['dispensingStatus']==='failed'&&!$r['issueRecovery']['reviewRequired']&&$r['issueRecovery']['machineReuseReady'],'Documented external obligation can close a no-delivery review without claiming dispensing success');
ok($r['amountPaid']===20.0&&$r['paymentStatus']==='successful'&&(int)$db->query('SELECT COUNT(*) FROM stock_movements')->fetchColumn()===0,'External refund note does not rewrite payment or invent stock movements');

clean();$t=purchase(3);$id=$t['databaseId'];$service->sensor($t['dispensingRequestId'],1,true);
$b=body($t,2,3,'partial');$b['inspection_complete']=false;$b['return_to_kiosk']=false;
$r=$service->resolveDispensingIssue($id,$b,$actor);
ok($r['sensorConfirmedQuantity']===1&&$r['dispensedQuantity']===2&&$r['issueRecovery']['reviewRequired'],'Partial review separates IR evidence from cumulative physical units and keeps review flagged');
ok(in_array('INSPECTION_INCOMPLETE',array_column($service->dispensingIssueDetails($id,$actor)['returnEligibility']['blockers'],'code'),true),'Partial inspection explains why kiosk return is blocked');
ok((int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===3,'Partial review deducts only the one newly verified physical unit');
denied(fn()=>$service->resolveDispensingIssue($id,array_replace($b,['request_key'=>bin2hex(random_bytes(16)),'expected_revision'=>1,'verified_quantity'=>1]),$actor),'INVALID_QUANTITY');
$complete=body($t,3,2,'dispensed_sensor_missed',1);$r=$service->resolveDispensingIssue($id,$complete,$actor);
ok($r['dispensedQuantity']===3&&$r['sensorConfirmedQuantity']===1&&!$r['issueRecovery']['reviewRequired'],'Further inspection resolves only newly verified remaining units');
ok((int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===2&&(int)$db->query('SELECT COUNT(*) FROM stock_movements')->fetchColumn()===3,'Original sensor deduction plus two incremental physical deductions remain accurate');

clean();$t=purchase(3);$id=$t['databaseId'];$service->sensor($t['dispensingRequestId'],1,true);
$b=body($t,2,3,'partial');$b['obligation_status']='replacement_documented';$b['obligation_reference']='external-fulfillment-record-123';
$r=$service->resolveDispensingIssue($id,$b,$actor);
ok($r['dispensingStatus']==='failed'&&$r['dispensedQuantity']===2&&$r['issueRecovery']['machineReuseReady'],'Final partial delivery keeps missing units explicit and requires documented external fulfillment before reuse');
ok((int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===3&&$r['amountPaid']===30.0,'Externally supplied replacement does not silently deduct another kiosk unit or rewrite payment');
$service->coin($id,'late-extra-event',1);
ok(!$service->snapshot($id)['issueRecovery']['machineReuseReady'],'Late excess payment preserves the event and blocks a previously ready return for reconciliation');
ok(in_array('PAYMENT_RECONCILIATION_REQUIRED',array_column($service->dispensingIssueDetails($id,$actor)['returnEligibility']['blockers'],'code'),true),'Payment discrepancy is reported explicitly in eligibility');

clean();$t=purchase();$id=$t['databaseId'];$b=body($t,1,4);unset($b['physical_stock']);$b['return_to_kiosk']=false;
$service->resolveDispensingIssue($id,$b,$actor);
ok(in_array('INVENTORY_INCOMPLETE',array_column($service->dispensingIssueDetails($id,$actor)['returnEligibility']['blockers'],'code'),true),'Saved review without a physical count explains incomplete inventory reconciliation');

clean();$t=purchase();$id=$t['databaseId'];$db->exec('UPDATE inventory SET reserved_quantity=2');
denied(fn()=>$service->resolveDispensingIssue($id,body($t,1,4),$actor),'STOCK_RECONCILIATION_REQUIRED');
ok(!$service->snapshot($id)['issueRecovery'],'Inconsistent aggregate reservations cannot be silently repaired by recovery');

clean();$t=purchase();$id=$t['databaseId'];$legacy=['transaction_code'=>$t['id'],'motor_stopped'=>true,'controller_disconnected'=>true,'reason'=>'Verified stopped and physically counted','physical_stock'=>4];
$service->recoverStoppedDispense($id,$legacy,$actor);$r=$service->resolveDispensingIssue($id,body($t,1,4),$actor);
ok($r['dispensedQuantity']===1&&(int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===4&&(int)$db->query('SELECT COUNT(*) FROM stock_movements')->fetchColumn()===1,'Legacy physical recount is preserved without double deduction');

clean();$t=purchase();$id=$t['databaseId'];$service->sensor($t['dispensingRequestId'],1,true);
denied(fn()=>$service->resolveDispensingIssue($id,body($t,1,4),$actor),'RECOVERY_NOT_ALLOWED');
ok(!$service->snapshot($id)['issueRecovery'],'Existing completed transaction cannot be rewritten as a new recovery');

// A separate legacy failure fixture with an existing confirmed unit. Recovery must not
// implicitly resolve even an incident whose old sensor count happens to match the total.
$db->exec("UPDATE transactions SET dispensing_status='failed' WHERE id=$id");
$db->prepare("INSERT INTO notifications(notification_type,title,message,severity,transaction_id) VALUES('dispensing_failure','Issue','Inspect','danger',?)")->execute([$id]);$nid=(int)$db->lastInsertId();
$db->prepare("INSERT INTO alert_incidents(incident_key,active_key,notification_id,kind,medicine_id,slot_id,request_id,details) VALUES('issue-fixture','issue-fixture',?,'dispensing_failure',1,1,?,'{}')")->execute([$nid,$t['dispensingRequestId']]);
$service->resolveDispensingIssue($id,body($t,1,4),$actor);
(new AlertService($db,120,'medidispense_isolated_physical_review_test'))->scan();
ok($db->query("SELECT resolved_at FROM alert_incidents WHERE incident_key='issue-fixture'")->fetchColumn()===null,'Background alert scan keeps notification resolution separate from physical recovery');

clean();$first=$service->checkout(['request_id'=>bin2hex(random_bytes(16)),'items'=>[['medicine_id'=>1,'quantity'=>1]]],$token);$other=$service->checkout(['request_id'=>bin2hex(random_bytes(16)),'items'=>[['medicine_id'=>1,'quantity'=>1]]],$token);$t=$service->verifyCoin($first['databaseId'],'paid-case',10);
denied(fn()=>$service->resolveDispensingIssue($t['databaseId'],body($t,1,4),$actor),'OTHER_UNRESOLVED');
ok(!$service->snapshot($t['databaseId'])['issueRecovery']&&(int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===5,'Another active purchase prevents recovery return and rolls back inventory');
$save=body($t,1,4);$save['return_to_kiosk']=false;$service->resolveDispensingIssue($t['databaseId'],$save,$actor);
ok(in_array('OTHER_PURCHASE_PENDING',array_column($service->dispensingIssueDetails($t['databaseId'],$actor)['returnEligibility']['blockers'],'code'),true),'Save succeeds but return remains blocked by another unpaid purchase');
$service->cancel($other['databaseId'],$token);
ok(!$service->snapshot($other['databaseId'])['receipt']['eligible']&&$service->transactionRecordDetails($other['databaseId'],$actor)['reason']!==null,'Cancelled purchase remains a detailed history record with its cancellation reason');
ok($service->dispensingIssueDetails($t['databaseId'],$actor)['returnEligibility']['ready'],'Refreshing eligibility becomes ready when the blocking purchase closes');
$return=body($t,1,4,'dispensed_sensor_missed',1);$service->resolveDispensingIssue($t['databaseId'],$return,$actor);$service->resolveDispensingIssue($t['databaseId'],$return,$actor);
ok((int)$db->query('SELECT COUNT(*) FROM stock_movements')->fetchColumn()===1,'Save then Return and duplicate Return do not deduct another tablet');
$active=purchase();
ok(in_array('ACTIVE_DISPENSING_REQUEST',array_column($service->dispensingIssueDetails($t['databaseId'],$actor)['returnEligibility']['blockers'],'code'),true),'Active dispensing command/request is exposed as a specific return blocker');

clean();$old=purchase();$service->sensor($old['dispensingRequestId'],1,false);
$oldPayments=$db->query('SELECT * FROM payments WHERE transaction_id='.(int)$old['databaseId'])->fetchAll();
$oldState=$service->snapshot($old['databaseId']);$t=purchase();$id=$t['databaseId'];
$service->resolveDispensingIssue($id,body($t,1,4),$actor);
$eligibility=$service->dispensingIssueDetails($id,$actor)['returnEligibility'];
ok($eligibility['ready']&&in_array('HISTORICAL_FAILED_PURCHASES',array_column($eligibility['warnings'],'code'),true),'Unreviewed historical failure without an active command is a warning, not a return blocker');
ok($service->snapshot($old['databaseId'])['dispensingStatus']===$oldState['dispensingStatus']&&$oldPayments===$db->query('SELECT * FROM payments WHERE transaction_id='.(int)$old['databaseId'])->fetchAll(),'Ignoring a historical failure does not complete it or change its payment');
$db->exec("UPDATE dispensing_requests SET request_status='sent' WHERE id=".(int)$old['dispensingRequestId']);
ok(in_array('ACTIVE_DISPENSING_REQUEST',array_column($service->dispensingIssueDetails($id,$actor)['returnEligibility']['blockers'],'code'),true),'A historical failed status with a dispatched request still blocks return');
$db->exec("UPDATE dispensing_requests SET request_status='failed' WHERE id=".(int)$old['dispensingRequestId']);
controller(['bound_transaction_id'=>$old['databaseId']]);
ok($service->dispensingIssueDetails($id,$actor)['returnEligibility']['ready'],'A clean controller owner on a terminal historical failure is not treated as an active payment');
foreach([
 [['pending_events'=>1],'UNRESOLVED_COIN_EVENTS'],
 [['pending_events'=>1,'durable_events'=>1],'UNRESOLVED_COIN_EVENTS'],
 [['incomplete_pulses'=>true],'INCOMPLETE_COIN_PULSES'],
 [['storage_healthy'=>false],'COIN_STORAGE_UNHEALTHY'],
 [['reconciliation_required'=>true],'CONTROLLER_RECONCILIATION_REQUIRED'],
 [['binding_phase'=>1],'CONTROLLER_RECONCILIATION_REQUIRED'],
 [['overflow_events'=>1,'overflow_pulses'=>5],'CONTROLLER_RECONCILIATION_REQUIRED'],
 [['backend_session_verified'=>false],'PAYMENT_SESSION_UNVERIFIED'],
] as [$change,$code]){
 controller($change);$e=$service->dispensingIssueDetails($id,$actor)['returnEligibility'];
 ok(!$e['ready']&&in_array($code,array_column($e['blockers'],'code'),true),'Actual controller safety dependency blocks return: '.$code);
}
controller();$db->exec("UPDATE system_settings SET setting_value=JSON_SET(setting_value,'$.reportedAtMs',0) WHERE setting_key LIKE 'coin_diag:%'");
ok(in_array('CONTROLLER_DIAGNOSTICS_STALE',array_column($service->dispensingIssueDetails($id,$actor)['returnEligibility']['blockers'],'code'),true),'An old clean report is not presented as current zero-event proof');
controller();$db->exec("INSERT INTO machine_status(machine_id,motor_status,last_communication_at) VALUES(1,'Running',NOW())");
ok(in_array('ACTIVE_MOTOR',array_column($service->dispensingIssueDetails($id,$actor)['returnEligibility']['blockers'],'code'),true),'Recent verified motor-running evidence blocks a saved return');
$db->exec('DELETE FROM machine_status');
ok($service->dispensingIssueDetails($id,$actor)['returnEligibility']['ready'],'Restored clean diagnostics and terminal commands allow safe return despite historical failures');
echo "All physical recovery fixtures use temporary tables and a recording gateway; no real inventory, Firebase, motors or payments changed.\n";
