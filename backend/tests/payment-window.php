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
$open=fn()=>$service->checkout(['request_id'=>bin2hex(random_bytes(16)),'items'=>[['medicine_id'=>1,'quantity'=>1]]],$token);
$t=$open();$id=$t['databaseId'];
lanCheck(abs($t['paymentWindow']['deadlineMs']-$t['paymentWindow']['serverNowMs']-300000)<1500,'Server issues a persistent five-minute advisory deadline');
lanCheck($t['paymentWindow']['automaticExpirationEnabled']===false&&$t['paymentWindow']['hardwarePauseSupported']===false,'No unsupported hardware/automatic expiry capability claimed');
$db->exec("UPDATE transactions SET created_at=DATE_SUB(NOW(),INTERVAL 6 MINUTE),expires_at=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE id=$id");
$before=$service->get($id,$token);$deadline=$before['paymentWindow']['deadlineMs'];
$service->expireUnpaid();$service->expireUnpaid();
$after=$service->get($id,$token);
lanCheck($after['paymentStatus']==='pending'&&(int)$db->query('SELECT reserved_quantity FROM inventory')->fetchColumn()===1,'No coins/offline hardware: repeated timeout sweeps preserve transaction and reservation');
lanCheck($after['paymentWindow']['deadlineMs']===$deadline&&$deadline<$after['paymentWindow']['serverNowMs'],'Refresh/reconnect does not restart the deadline');
lanCheck($service->hardwarePaymentSession()['transaction_id']===$id,'Late pulse remains associated with original unpaid purchase');
$partial=$service->coin($id,'boundary-coin',5);
$service->expireUnpaid();
lanCheck($service->get($id,$token)['amountPaid']===5.0&&$partial['paymentStatus']==='pending','Coin at/after advisory deadline is recorded without auto-cancellation');
try{$service->cancel($id,$token);throw new RuntimeException('Partial payment cancelled');}catch(KioskError $e){lanCheck($e->errorCode==='PAYMENT_IN_PROGRESS','Partial payment cannot be cancelled through existing workflow');}
$repeat=$service->coin($id,'boundary-coin',5);
lanCheck($repeat['amountPaid']===5.0,'Duplicate coin event does not charge twice');
$paid=$service->coin($id,'full-payment',5);
$service->expireUnpaid();$done=$service->get($id,$token);
lanCheck($done['paymentStatus']==='successful'&&$done['dispensingStatus']==='dispensing','Full payment follows existing queue; timeout never interrupts dispensing');
lanCheck((int)$db->query('SELECT COUNT(*) FROM dispensing_requests')->fetchColumn()===1,'Exactly one queued request; no timeout-created dispatch');
lanCheck((int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===5,'No physical inventory deducted and no hardware command invoked');
echo "Payment window tests use temporary tables only. Automatic expiry intentionally not enabled.\n";
