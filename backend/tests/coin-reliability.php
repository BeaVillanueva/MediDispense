<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../src/Database.php';require __DIR__.'/../src/KioskService.php';require __DIR__.'/../src/FirebaseRealtimeDatabase.php';
$db=Database::connect(require __DIR__.'/../config/config.php');
$persistentFixtureSettings=$db->query("SELECT setting_key,setting_value FROM system_settings WHERE setting_key LIKE 'coin_diag:%:AABBCCDDEEFF' ORDER BY setting_key")->fetchAll();
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
require __DIR__.'/../src/CoinPaymentDiagnostics.php';
$token=bin2hex(random_bytes(32));
$open=fn()=>$service->checkout(['request_id'=>bin2hex(random_bytes(16)),'items'=>[['medicine_id'=>1,'quantity'=>1]]],$token);
$t=$open();$id=$t['databaseId'];
$first=$service->verifyCoin($id,'stable-coin-id',5);$retry=$service->verifyCoin($id,'stable-coin-id',5);
lanCheck($first['paymentEvent']===$retry['paymentEvent'],'Lost response retry returns the same explicit stored event receipt');
lanCheck($retry['paymentEvent']===['recorded'=>true,'transactionId'=>$id,'eventId'=>'stable-coin-id','amount'=>5.0],'Receipt binds event, amount and numeric payment transaction');
lanCheck($retry['amountPaid']===5.0&&(int)$db->query('SELECT COUNT(*) FROM payment_events')->fetchColumn()===1,'Stable ID retry does not duplicate credit');
try{$service->verifyCoin($id,'stable-coin-id',10);throw new RuntimeException('Changed retry accepted');}catch(KioskError $e){lanCheck($e->errorCode==='EVENT_CONFLICT','Conflicting amount under the same ID requires reconciliation');}
$next=$open();
lanCheck($service->hardwarePaymentSession($id)['transaction_id']===$id,'Partially paid original session remains selected');
$paid=$service->verifyCoin($id,'second-stable-id',5);
$session=$service->hardwarePaymentSession($id);
lanCheck(!$session['active']&&!$session['previous_session_closed'],'Controller bound to dispensing purchase cannot jump to the next customer');
$service->sensor($paid['dispensingRequestId'],1,false);
$session=$service->hardwarePaymentSession($id);
lanCheck(!$session['active'],'Unrecovered failed dispensing still blocks session transition');
$service->cancel($next['databaseId'],$token);$after=$open();
$session=$service->hardwarePaymentSession($next['databaseId']);
lanCheck($session['active']&&$session['previous_session_closed']&&!$session['automatic_handoff_safe'],'Backend closure is a lifecycle fact, never a fake inhibit acknowledgement');
$ten=$service->verifyCoin($after['databaseId'],'normal-ten',10);
lanCheck($ten['paymentEvent']['amount']===10.0&&$ten['amountPaid']===10.0,'Normal P10 event has an exact authoritative receipt');
$tenAgain=$service->verifyCoin($after['databaseId'],'normal-ten',10);
lanCheck($tenAgain['amountPaid']===10.0,'Duplicate P10 retry is not credited twice');
$diag=new CoinPaymentDiagnostics($db,'LAN-TEST');
$report=['device_id'=>'AABBCCDDEEFF','bound_transaction_id'=>$id,'pending_events'=>2,'durable_events'=>1,'incomplete_pulses'=>true,'reconciliation_required'=>true,'boot_review_required'=>true,'storage_healthy'=>true,'binding_phase'=>1,'previous_binding_transaction_id'=>$id,'proposed_transaction_id'=>$after['databaseId'],'binding_review_required'=>true,'backend_session_verified'=>false,'inhibit_supported'=>false,'automatic_handoff_safe'=>false,'overflow_events'=>0,'overflow_pulses'=>0];
$before=$db->query('SELECT * FROM transactions ORDER BY id')->fetchAll();
$diag->record($report);$read=$diag->read()[0];
lanCheck($read['pending_events']===2&&$read['incomplete_pulses']&&$read['fresh'],'Read-only diagnostics expose pending/incomplete events and freshness');
lanCheck($read['binding_phase']===1&&$read['binding_review_required'],'Interrupted binding diagnostics remain review-required without authorizing handoff');
lanCheck(!$read['automatic_handoff_safe']&&!$read['inhibit_supported'],'Pending diagnostics cannot become isolation proof');
$withHead=$report;
$withHead+=['oldest_event_id'=>'stable-review-event','oldest_event_transaction_id'=>$id,'oldest_event_pulses'=>5,'oldest_event_amount'=>5,'oldest_event_requires_review'=>true];
$diag->record($withHead);$head=$diag->read()[0];
lanCheck($head['oldest_event_id']==='stable-review-event'&&$head['oldest_event_requires_review'],'Diagnostics retain stable event ownership details for manual reconciliation');
$db->exec("UPDATE system_settings SET setting_value=JSON_SET(setting_value,'$.reportedAtMs',0) WHERE setting_key LIKE 'coin_diag:%'");
lanCheck(!$diag->read()[0]['fresh'],'Stale diagnostic snapshots cannot be treated as fresh zero-pulse evidence');
$assessment=$diag->selfServiceAssessment();
lanCheck(!$assessment['automatic_self_service_available']&&in_array('COIN_ACCEPTANCE_CONTROL_UNVERIFIED',$assessment['blockers'],true),'Self-service assessment never equates diagnostics with acceptance-control proof');
$emptyHealthy=['fresh'=>true,'pending_events'=>0,'incomplete_pulses'=>false,'storage_healthy'=>true,'overflow_events'=>0,'overflow_pulses'=>0,'binding_phase'=>0,'reconciliation_required'=>false];
lanCheck(CoinPaymentDiagnostics::handoffBlockers($emptyHealthy)===['COIN_ACCEPTANCE_CONTROL_UNVERIFIED'],'Consecutive customers cannot be authorized merely by an empty healthy queue');
$pending=$emptyHealthy;$pending['pending_events']=1;$pending['incomplete_pulses']=true;
lanCheck(in_array('UNCONFIRMED_PAYMENT_EVENTS',CoinPaymentDiagnostics::handoffBlockers($pending),true)&&in_array('INCOMPLETE_COIN_PULSE_SEQUENCE',CoinPaymentDiagnostics::handoffBlockers($pending),true),'Late/incomplete coins retain handoff blockers');
$restart=$emptyHealthy;$restart['binding_phase']=1;$restart['fresh']=false;
lanCheck(in_array('INTERRUPTED_PAYMENT_BINDING',CoinPaymentDiagnostics::handoffBlockers($restart),true)&&in_array('PAYMENT_DIAGNOSTICS_UNAVAILABLE_OR_STALE',CoinPaymentDiagnostics::handoffBlockers($restart),true),'Power/network uncertainty cannot become an automatic authorization');
$bad=$report;$bad['inhibit_supported']=true;
try{$diag->record($bad);throw new RuntimeException('Fake capability accepted');}catch(KioskError $e){lanCheck($e->errorCode==='UNSUPPORTED_CAPABILITY','Invented inhibit capability rejected');}
$bad=$report;$bad['bound_transaction_id']=9999;
try{$diag->record($bad);throw new RuntimeException('Unknown session accepted');}catch(KioskError $e){lanCheck($e->errorCode==='TRANSACTION_MISMATCH','Unknown transaction diagnostics are not rebound to another purchase');}
lanCheck($db->query('SELECT * FROM transactions ORDER BY id')->fetchAll()===$before,'Diagnostic reporting never changes transaction state or amounts');
lanCheck((int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===5,'No physical stock or hardware operated in reliability fixtures');
$db->exec('DROP TEMPORARY TABLE system_settings');
lanCheck($db->query("SELECT setting_key,setting_value FROM system_settings WHERE setting_key LIKE 'coin_diag:%:AABBCCDDEEFF' ORDER BY setting_key")->fetchAll()===$persistentFixtureSettings,'Fixture telemetry never leaks into persistent system settings');
echo "Coin reliability API checks passed using temporary tables only.\n";
