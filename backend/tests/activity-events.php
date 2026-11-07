<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit;
require __DIR__.'/../src/Database.php';
require __DIR__.'/../src/KioskService.php';
require __DIR__.'/../src/FirebaseRealtimeDatabase.php';
$db=Database::connect(require __DIR__.'/../config/config.php');
// Connection-local temporary tables shadow application tables; no live rows are changed.
foreach (['medicine_categories','medicines','inventory','machines','machine_slots','transaction_items','transactions','payments','dispensing_requests','dispensing_logs','stock_movements','notifications','activity_logs'] as $table) {
    $ddl=$db->query("SHOW CREATE TABLE $table")->fetch(PDO::FETCH_NUM)[1];
    $ddl=preg_replace('/^\s*CONSTRAINT[^\n]+\n/m','',$ddl);
    $ddl=preg_replace('/,\n\)/',"\n)",$ddl);
    $db->exec(str_replace('CREATE TABLE','CREATE TEMPORARY TABLE',$ddl));
}
$db->exec("INSERT INTO medicine_categories(id,name,is_active) VALUES(1,'Test',1),(2,'Other',1)");
$db->exec("INSERT INTO medicines(id,category_id,name,generic_name,description,dosage_information,usage_instructions,unit_price,expiry_date) VALUES(1,1,'Original','Generic','Description','Label','Label',10,'2030-01-01'),(2,1,'Occupied','Generic','Description','Label','Label',10,'2030-01-01')");
$db->exec('INSERT INTO inventory(medicine_id,quantity,reserved_quantity) VALUES(1,7,0),(2,3,0)');
$db->exec("INSERT INTO machines(id,machine_code,name) VALUES(1,'TEST','Test')");
$db->exec("INSERT INTO machine_slots(id,machine_id,slot_number,medicine_id,motor_id,sensor_id,slot_status) VALUES(1,1,1,1,'M1','S1','ready'),(2,1,2,2,'M2','S2','ready'),(3,1,3,NULL,'M3','S3','blocked')");

$service=new KioskService($db,'TEST',new FirebaseRealtimeDatabase('https://unused.invalid'));
function check(bool $ok,string $label):void { if(!$ok) throw new RuntimeException($label); echo "PASS $label\n"; }
$token=bin2hex(random_bytes(32));
$purchase=fn()=>$service->checkout(['request_id'=>bin2hex(random_bytes(16)),'items'=>[['medicine_id'=>1,'quantity'=>1]]],$token);
$t=$purchase(); $service->cancel($t['databaseId'],$token); $service->cancel($t['databaseId'],$token);
check((int)$db->query("SELECT COUNT(*) FROM activity_logs WHERE action='transaction_cancelled'")->fetchColumn()===1,'Cancellation logged once despite retry');
$t=$purchase(); $db->exec("UPDATE transactions SET expires_at=DATE_SUB(NOW(),INTERVAL 1 HOUR) WHERE id=".$t['databaseId']); $service->expireUnpaid();
check($db->query("SELECT description FROM activity_logs ORDER BY id DESC LIMIT 1")->fetchColumn()==='Unpaid purchase expired','Expiry cancellation has accurate reason');
$db->exec('UPDATE medicines SET unit_price=0 WHERE id=1');
$t=$purchase(); $service->sensor($t['dispensingRequestId'],1,true); $service->sensor($t['dispensingRequestId'],1,true);
check((int)$db->query("SELECT COUNT(*) FROM activity_logs WHERE action='medicine_dispensed'")->fetchColumn()===1,'Confirmed dispense logged once despite retry');
check((int)$db->query('SELECT quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===6,'Sensor success still deducts exactly one unit');
$t=$purchase(); $service->sensor($t['dispensingRequestId'],1,false);
check((int)$db->query("SELECT COUNT(*) FROM activity_logs WHERE action='dispensing_failed' AND actor_type='hardware' AND actor_user_id IS NULL")->fetchColumn()===1,'Hardware failure logged without invented admin');
check((int)$db->query('SELECT quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===6,'Failed dispense does not deduct stock');
echo "Live records untouched; no Firebase calls made.\n";
