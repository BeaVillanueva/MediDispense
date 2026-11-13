<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../src/Database.php';require __DIR__.'/../src/KioskService.php';require __DIR__.'/../src/FirebaseRealtimeDatabase.php';
$db=Database::connect(require __DIR__.'/../config/config.php');
foreach(['medicine_categories','medicines','inventory','machines','machine_slots','transactions','transaction_items','payments','payment_events','dispensing_requests','dispensing_logs','stock_movements','notifications','activity_logs'] as $table) {
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
$isolator=new class implements PaymentIsolationGateway {
    public bool $isolated=false;
    public int $pendingPulses=0;
    public function isSafelyIsolated(int $machineId,int $transactionId):bool {return $this->isolated && $this->pendingPulses===0;}
};
// Test-only proof adapter; production has no isolation adapter and cannot enable expiry.
$safeService=new KioskService($db,'LAN-TEST',$gateway,$isolator);
$open=fn()=>$safeService->checkout(['request_id'=>bin2hex(random_bytes(16)),'items'=>[['medicine_id'=>1,'quantity'=>1]]],$token);
function expiryDenied(callable $action,string $code):void {try{$action();throw new RuntimeException('Unsafe expiration accepted');}catch(KioskError $e){lanCheck($e->errorCode===$code,$code);}}
$t=$open();$id=$t['databaseId'];
expiryDenied(fn()=>$safeService->expirePayment($id,$token),'PAYMENT_NOT_EXPIRED');
$db->exec("UPDATE transactions SET created_at=DATE_SUB(NOW(),INTERVAL 6 MINUTE) WHERE id=$id");
expiryDenied(fn()=>$service->expirePayment($id,$token),'HARDWARE_ISOLATION_REQUIRED');
expiryDenied(fn()=>$safeService->expirePayment($id,$token),'HARDWARE_ISOLATION_REQUIRED');
lanCheck($service->get($id,$token)['paymentStatus']==='pending','Missing/offline hardware proof preserves the zero-balance transaction');
expiryDenied(fn()=>$safeService->expirePayment($id,bin2hex(random_bytes(32))),'TRANSACTION_NOT_FOUND');
$db->prepare('INSERT INTO payment_events(transaction_id,event_id,amount) VALUES(?,?,?)')->execute([$id,'reconcile-test',0]);
expiryDenied(fn()=>$safeService->expirePayment($id,$token),'PAYMENT_RECONCILIATION_REQUIRED');
$db->prepare('DELETE FROM payment_events WHERE transaction_id=? AND event_id=?')->execute([$id,'reconcile-test']);
$isolator->isolated=true;
$isolator->pendingPulses=1;
expiryDenied(fn()=>$safeService->expirePayment($id,$token),'HARDWARE_ISOLATION_REQUIRED');
lanCheck($service->get($id,$token)['paymentStatus']==='pending'&&(int)$db->query('SELECT reserved_quantity FROM inventory')->fetchColumn()===1,'Pending physical coin pulses prevent cancellation even with zero recorded amount');
$isolator->pendingPulses=0;
$expired=$safeService->expirePayment($id,$token);
$again=$safeService->expirePayment($id,$token);
lanCheck($expired['paymentStatus']==='cancelled'&&$expired['paymentExpiry']['confirmed']===true,'Verified test isolation enables persisted expiry via existing cancelled lifecycle');
lanCheck($expired['paymentExpiry']['returnAtMs']===$again['paymentExpiry']['returnAtMs'],'Repeated expiration preserves the original three-second return deadline');
lanCheck((int)$db->query('SELECT reserved_quantity FROM inventory')->fetchColumn()===0,'Expiry releases the original reservation once');
lanCheck((int)$db->query("SELECT COUNT(*) FROM activity_logs WHERE action='payment_session_expired'")->fetchColumn()===1,'Expiry audit recorded exactly once');
expiryDenied(fn()=>$safeService->coin($id,'late-old-session',5),'PAYMENT_CLOSED');
$new=$open();$newId=$new['databaseId'];
lanCheck($newId!==$id&&$safeService->hardwarePaymentSession()['transaction_id']===$newId,'New checkout can follow confirmed isolated expiry; old transaction ID stays closed');
$db->exec("UPDATE transactions SET created_at=DATE_SUB(NOW(),INTERVAL 6 MINUTE) WHERE id=$newId");
$partial=$safeService->coin($newId,'boundary',5);
expiryDenied(fn()=>$safeService->expirePayment($newId,$token),'PAYMENT_IN_PROGRESS');
lanCheck($safeService->get($newId,$token)['amountPaid']===5.0,'Coin first at expiration boundary wins; payment remains recorded');
$full=$safeService->coin($newId,'complete',5);
expiryDenied(fn()=>$safeService->expirePayment($newId,$token),'PAYMENT_IN_PROGRESS');
lanCheck($full['paymentStatus']==='successful'&&$full['dispensingStatus']==='dispensing','Full payment retains existing dispensing queue');
lanCheck((int)$db->query('SELECT COUNT(*) FROM dispensing_requests')->fetchColumn()===1,'Repeated expiry never creates a duplicate dispense');
lanCheck((int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===5,'No physical stock deductions or hardware calls in expiration tests');
echo "All expiration fixtures were connection-local temporary tables. No real hardware proof was simulated in production.\n";
