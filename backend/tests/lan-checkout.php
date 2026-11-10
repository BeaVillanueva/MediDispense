<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../src/Database.php';require __DIR__.'/../src/KioskService.php';require __DIR__.'/../src/FirebaseRealtimeDatabase.php';
$db=Database::connect(require __DIR__.'/../config/config.php');
foreach(['medicine_categories','medicines','inventory','machines','machine_slots','transactions','transaction_items','payments','dispensing_requests','dispensing_logs','stock_movements','notifications','activity_logs'] as $table) {
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
$key='a541db37-5cf0-46ae-8bbc-6009f2999194';$token=bin2hex(random_bytes(32));$body=['request_id'=>$key,'items'=>[['medicine_id'=>1,'quantity'=>1]]];
$first=$service->checkout($body,$token);
// Treat the first response as lost; recovery must find the already committed purchase.
$recovered=$service->recover($key,$token);$retry=$service->checkout($body,$token);
lanCheck($first['databaseId']===$recovered['databaseId']&&$first['databaseId']===$retry['databaseId'],'Lost checkout response and explicit retry recover the same original transaction');
lanCheck((int)$db->query('SELECT COUNT(*) FROM transactions')->fetchColumn()===1&&(int)$db->query('SELECT COUNT(*) FROM payments')->fetchColumn()===1,'No duplicate transaction or payment record');
lanCheck((int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===5&&(int)$db->query('SELECT reserved_quantity FROM inventory')->fetchColumn()===1,'Recovery neither deducts stock nor reserves it twice');
lanCheck($recovered['paymentStatus']==='pending'&&$recovered['amountPaid']===0.0&&$recovered['dispensingStatus']==='pending','LAN checkout waits for genuine coin input and never starts hardware');
try{$service->recover($key,bin2hex(random_bytes(32)));throw new RuntimeException('Wrong token accepted');}catch(KioskError $e){lanCheck($e->errorCode==='TRANSACTION_NOT_FOUND','Recovery remains protected by original private token, independent of cookies');}
$service->cancel($first['databaseId'],$token);$after=$service->checkout($body,$token);
lanCheck($after['databaseId']===$first['databaseId']&&$after['paymentStatus']==='cancelled','Replaying an old key cannot restart a cancelled payment');
lanCheck((int)$db->query('SELECT COUNT(*) FROM dispensing_requests')->fetchColumn()===0,'No dispensing request or Firebase command created');
echo "Live records untouched. No hardware, SMTP or coin calls made.\n";
