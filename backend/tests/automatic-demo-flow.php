<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../src/CoinPaymentDiagnostics.php';require __DIR__.'/../src/Database.php';require __DIR__.'/../src/KioskService.php';require __DIR__.'/../src/FirebaseRealtimeDatabase.php';
$db=Database::connect(require __DIR__.'/../config/config.php');
foreach(['medicine_categories','medicines','inventory','machines','machine_slots','transactions','transaction_items','payments','payment_events','dispensing_requests','dispensing_logs','stock_movements','notifications','activity_logs','system_settings'] as $table) {
    $ddl=$db->query("SHOW CREATE TABLE $table")->fetch(PDO::FETCH_NUM)[1];$ddl=preg_replace('/^\s*CONSTRAINT[^\n]+\n/m','',$ddl);$ddl=preg_replace('/,\n\)/',"\n)",$ddl);$db->exec(str_replace('CREATE TABLE','CREATE TEMPORARY TABLE',$ddl));
}
$db->exec("INSERT INTO medicine_categories(id,name) VALUES(1,'LAN Test')");
$db->exec("INSERT INTO medicines(id,category_id,name,generic_name,description,dosage_information,usage_instructions,unit_price,expiry_date) VALUES(1,1,'LAN test medicine','Test','Test','Label','Label',10,'2035-01-01')");
$db->exec('INSERT INTO inventory(medicine_id,quantity,reserved_quantity) VALUES(1,5,0)');
$db->exec("INSERT INTO machines(id,machine_code,name) VALUES(1,'LAN-TEST','Test')");
$db->exec("INSERT INTO machine_slots(id,machine_id,slot_number,medicine_id,motor_id,sensor_id,slot_status) VALUES(1,1,1,1,'TEST','TEST','ready')");
$gateway=new class implements DispenseCommandGateway {
    public function sendDispenseCommand(int $requestId,int $slot,int $quantity):array{throw new RuntimeException('No real or fake hardware commands allowed.');}
    public function retireDispenseCommand(int $requestId):void{throw new RuntimeException('No hardware recovery in LAN test.');}
};
$service=new KioskService($db,'LAN-TEST',$gateway);
function lanCheck(bool $ok,string $label):void{if(!$ok)throw new RuntimeException($label);echo "PASS $label\n";}
$token=bin2hex(random_bytes(32));
$demo=new KioskService($db,'LAN-TEST',$gateway,null,true,true);
$open=fn()=>$demo->checkout(['request_id'=>bin2hex(random_bytes(16)),'items'=>[['medicine_id'=>1,'quantity'=>1]]],$token);
$t=$open();$id=$t['databaseId'];$nonce='0123456789abcdef';
$protected=new KioskService($db,'LAN-TEST',$gateway,null,true,true,[$id]);
lanCheck(!$protected->hardwarePaymentSession(0,$nonce)['active'] && $protected->demoExpirationBlockers($id)===['TRANSACTION_REQUIRES_EXPLICIT_STAFF_APPROVAL'],'Protected existing purchase is never proposed for automatic binding');
try{$protected->expirePayment($id,$token);throw new RuntimeException('Protected purchase expired');}catch(KioskError $e){lanCheck($e->errorCode==='TRANSACTION_PROTECTED','Protected purchase reservation remains untouched without approval');}
$session=$demo->hardwarePaymentSession(0,$nonce);
lanCheck($session['controlled_demo_autobind'] && $session['transaction_id']===$id && $session['session_check']===$nonce,'Both backend opt-ins expose exact active session and freshness challenge');
lanCheck(!$service->hardwarePaymentSession(0,$nonce)['controlled_demo_autobind'],'Production default never enables automatic binding');
$disabled=new KioskService($db,'LAN-TEST',$gateway,null,false,true);
lanCheck(!$disabled->hardwarePaymentSession(0,$nonce)['controlled_demo_autobind'],'Automatic binding permission requires controlled demo expiration policy');
try{$demo->hardwarePaymentSession(0,'bad');throw new RuntimeException('Bad nonce accepted');}catch(KioskError $e){lanCheck($e->errorCode==='INVALID_SESSION_CHECK','Malformed freshness challenges rejected');}
$diag=new CoinPaymentDiagnostics($db,'LAN-TEST');
$report=['device_id'=>'AABBCCDDEEFF','bound_transaction_id'=>$id,'pending_events'=>0,'durable_events'=>0,'overflow_events'=>0,'overflow_pulses'=>0,'incomplete_pulses'=>false,'reconciliation_required'=>false,'boot_review_required'=>false,'storage_healthy'=>true,'backend_session_verified'=>true,'inhibit_supported'=>false,'automatic_handoff_safe'=>false,'binding_phase'=>0,'binding_review_required'=>false,'controlled_demo_autobind'=>true,'automatic_binding_blocker'=>'NONE'];
$diag->record($report);
lanCheck(!$demo->demoExpirationBlockers($id),'Healthy session-matched firmware demo telemetry permits demo checks');
$bad=$report;$bad['controlled_demo_autobind']=false;$diag->record($bad);
lanCheck(in_array('FIRMWARE_DEMO_MODE_UNCONFIRMED',$demo->demoExpirationBlockers($id),true),'Backend flag cannot override absent firmware opt-in');
$diag->record($report);
$first=$demo->verifyCoin($id,'demo-stable-five',5);$retry=$demo->verifyCoin($id,'demo-stable-five',5);
lanCheck($first['paymentEvent']=== $retry['paymentEvent'] && $retry['amountPaid']===5.0,'Exact payment receipt and stable retry credit only once');
lanCheck((int)$db->query('SELECT COUNT(*) FROM dispensing_requests')->fetchColumn()===0,'Partial payment never queues dispensing');
$paid=$demo->verifyCoin($id,'demo-second-five',5);$rid=$paid['dispensingRequestId'];
lanCheck($paid['paymentStatus']==='successful' && $paid['dispensingStatus']==='dispensing','Full verified payment creates existing dispensing request');
lanCheck(!$demo->snapshot($id)['customerHandoffSafe'],'Paid but not IR confirmed cannot release the customer session');
// Isolated sensor callback fixture, not physical sensor evidence or a hardware command.
$done=$demo->sensor($rid,1,true);$again=$demo->sensor($rid,1,true);
lanCheck($done['dispensingStatus']==='dispensed' && $done['dispensedQuantity']===1,'Existing IR confirmation callback completes one unit');
lanCheck((int)$db->query('SELECT quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===4 && (int)$db->query('SELECT COUNT(*) FROM stock_movements')->fetchColumn()===1,'Confirmed dispensing deducts stock exactly once despite repeated callback');
$db->exec("UPDATE system_settings SET setting_value=JSON_SET(setting_value,'$.reportedAtMs',0)");
lanCheck(!$demo->snapshot($id)['customerHandoffSafe'],'Completed purchase still waits for fresh post-completion telemetry');
$diag->record($report);$complete=$demo->snapshot($id);
lanCheck($complete['customerHandoffSafe'] && $complete['customerHandoffMode']==='controlled_demo_assumption','Fresh clean completion report authorizes only the explicit demo return policy');
lanCheck(!$service->snapshot($id)['customerHandoffSafe'],'Production never treats demo telemetry as physical isolation');
$bad=$report;$bad['pending_events']=1;$bad['durable_events']=1;$diag->record($bad);
lanCheck(!$demo->snapshot($id)['customerHandoffSafe'],'Late unconfirmed payment evidence prevents completion handoff');
$diag->record($report);
$new=$open();$next=$new['databaseId'];$session=$demo->hardwarePaymentSession($id,$nonce);
lanCheck($next!==$id && $session['previous_session_closed'] && $session['transaction_id']===$next,'Consecutive customer gets fresh ID and explicit previous-closure proof');
$report['bound_transaction_id']=$next;$diag->record($report);
$db->exec("UPDATE transactions SET created_at=DATE_SUB(NOW(),INTERVAL 6 MINUTE) WHERE id=$next");
lanCheck($demo->get($next,$token)['paymentStatus']==='pending' && in_array('CONTROLLER_EXPIRATION_DRAIN_UNCONFIRMED',$demo->demoExpirationBlockers($next,true),true),'A fresh pre-deadline report cannot expire a session before the controller drains boundary pulses');
$report['expiration_check_ready']=true;$diag->record($report);
$expired=$demo->get($next,$token);$repeat=$demo->expirePayment($next,$token);
lanCheck($expired['paymentStatus']==='cancelled' && $expired['paymentExpiry']['confirmed'] && $expired['paymentExpiry']===$repeat['paymentExpiry'],'Existing five-minute expiration is authoritative and idempotent in automatic-binding mode');
lanCheck((int)$db->query('SELECT reserved_quantity FROM inventory')->fetchColumn()===0,'Unpaid expiration releases reservation once');
$third=$open();$s=$demo->hardwarePaymentSession($next,$nonce);
lanCheck($s['previous_session_closed'] && $s['transaction_id']===$third['databaseId'],'Post-expiration proposal supports next automatic durable binding');
lanCheck((int)$db->query("SELECT COUNT(*) FROM transactions WHERE payment_status='successful' AND dispensing_status='dispensed'")->fetchColumn()===1,'Cancelled purchases remain in history and are excluded from completed sales');
echo "Automatic-demo fixtures use temporary tables; no live transactions, stock, motors or Firebase operated.\n";
