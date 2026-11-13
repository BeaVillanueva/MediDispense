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
$demo=new KioskService($db,'LAN-TEST',$gateway,null,true);
$t=$demo->checkout(['request_id'=>bin2hex(random_bytes(16)),'items'=>[['medicine_id'=>1,'quantity'=>1]]],$token);
$id=$t['databaseId'];
function deniedDemo(callable $f):void {try{$f();throw new RuntimeException('Unexpected expiration');}catch(KioskError $e){lanCheck($e->errorCode==='HARDWARE_ISOLATION_REQUIRED','Uncertain telemetry blocks demo expiration');}}
$db->exec("UPDATE transactions SET created_at=DATE_SUB(NOW(),INTERVAL 6 MINUTE) WHERE id=$id");
deniedDemo(fn()=>$demo->expirePayment($id,$token));
lanCheck($demo->get($id,$token)['paymentWindow']['expirationBlockers']===['CONTROLLER_DIAGNOSTICS_MISSING'],'Polling exposes missing controller report without cancellation');
$diag=new CoinPaymentDiagnostics($db,'LAN-TEST');
$report=['device_id'=>'AABBCCDDEEFF','bound_transaction_id'=>$id,'pending_events'=>0,'durable_events'=>0,'overflow_events'=>0,'overflow_pulses'=>0,'incomplete_pulses'=>false,'reconciliation_required'=>false,'boot_review_required'=>false,'storage_healthy'=>true,'backend_session_verified'=>true,'inhibit_supported'=>false,'automatic_handoff_safe'=>false,'binding_phase'=>0,'binding_review_required'=>false];
foreach(['pending_events'=>1,'incomplete_pulses'=>true,'storage_healthy'=>false,'boot_review_required'=>true,'binding_review_required'=>true,'bound_transaction_id'=>0] as $key=>$value) {
    $diag->record(array_replace($report,[$key=>$value]));deniedDemo(fn()=>$demo->expirePayment($id,$token));
    lanCheck(count($demo->demoExpirationBlockers($id))>0,'Blocked queue reports explicit diagnostic reason');
}
$diag->record($report);
$db->exec("UPDATE system_settings SET setting_value=JSON_SET(setting_value,'$.reportedAtMs',0)");
deniedDemo(fn()=>$demo->expirePayment($id,$token));
lanCheck(in_array('CONTROLLER_DIAGNOSTICS_STALE',$demo->demoExpirationBlockers($id),true),'Stale controller has an explicit expiration blocker');
$diag->record($report);
deniedDemo(fn()=>$service->expirePayment($id,$token));
$expired=$demo->get($id,$token); // normal transaction polling closes a due demo purchase
$repeat=$demo->expirePayment($id,$token);
lanCheck($expired['paymentStatus']==='cancelled' && $expired['paymentExpiry']['confirmed'],'Demo polling closes genuinely unpaid transaction in MySQL');
lanCheck($expired['paymentExpiry']['returnAtMs']===$repeat['paymentExpiry']['returnAtMs'],'Demo expiry is idempotent and retains three-second return timestamp');
lanCheck((int)$db->query('SELECT reserved_quantity FROM inventory')->fetchColumn()===0,'Demo releases reservation without changing stock');
$meta=json_decode($db->query("SELECT metadata FROM activity_logs WHERE action='payment_session_expired'")->fetchColumn(),true);
lanCheck($meta['controlled_demonstration']===true && $meta['hardware_isolation_verified']===false,'Audit explicitly records demo assumption without fake hardware isolation');
try{$demo->coin($id,'late-demo-event',5);throw new RuntimeException('Late coin accepted');}catch(KioskError $e){lanCheck($e->errorCode==='PAYMENT_CLOSED','Late event rejected for reconciliation, never moved to another purchase');}
$new=$demo->checkout(['request_id'=>bin2hex(random_bytes(16)),'items'=>[['medicine_id'=>1,'quantity'=>1]]],$token);
lanCheck($new['databaseId']!==$id,'Next demo checkout creates a fresh transaction ID');
$newId=$new['databaseId'];$report['bound_transaction_id']=$newId;$diag->record($report);
lanCheck($demo->get($newId,$token)['paymentStatus']==='pending','New purchase is not prematurely expired');
$db->exec("UPDATE transactions SET created_at=DATE_SUB(NOW(),INTERVAL 6 MINUTE) WHERE id=$newId");
$demo->coin($newId,'near-deadline',5);
lanCheck($demo->get($newId,$token)['amountPaid']===5.0,'Partial boundary payment remains recoverable');
$paid=$demo->coin($newId,'full-payment',5);
lanCheck($demo->get($newId,$token)['paymentStatus']==='successful','Full payment continues existing dispensing workflow');
lanCheck((int)$db->query('SELECT COUNT(*) FROM dispensing_requests')->fetchColumn()===1,'Only full payment queues dispensing; expiration never dispenses');
echo "Demo checks use connection-local temporary tables; no live inventory or hardware modified.\n";
