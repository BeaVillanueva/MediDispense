<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../src/Database.php';require __DIR__.'/../src/KioskService.php';require __DIR__.'/../src/FirebaseRealtimeDatabase.php';
$db=Database::connect(require __DIR__.'/../config/config.php');
foreach(['medicine_categories','medicines','inventory','machines','machine_slots','transactions','transaction_items','payments','payment_events','system_settings','dispensing_requests','dispensing_logs','stock_movements','notifications','activity_logs'] as $table) {
    $ddl=$db->query("SHOW CREATE TABLE $table")->fetch(PDO::FETCH_NUM)[1];$ddl=preg_replace('/^\s*CONSTRAINT[^\n]+\n/m','',$ddl);$ddl=preg_replace('/,\n\)/',"\n)",$ddl);$db->exec(str_replace('CREATE TABLE','CREATE TEMPORARY TABLE',$ddl));
}
$db->exec("INSERT INTO medicine_categories(id,name) VALUES(1,'LAN Test')");
$db->exec("INSERT INTO medicines(id,category_id,name,generic_name,description,dosage_information,usage_instructions,unit_price,expiry_date) VALUES(1,1,'LAN test medicine','Test','Test','Label','Label',10,'2035-01-01')");
$db->exec('INSERT INTO inventory(medicine_id,quantity,reserved_quantity) VALUES(1,5,0)');
$db->exec("INSERT INTO machines(id,machine_code,name) VALUES(1,'LAN-TEST','Test')");
$db->exec("INSERT INTO machine_slots(id,machine_id,slot_number,medicine_id,motor_id,sensor_id,slot_status) VALUES(1,1,1,1,'TEST','TEST','ready')");
require __DIR__.'/../src/TransactionReferenceSync.php';
$gateway=new class implements DispenseCommandGateway,TransactionReferenceGateway {
    public array $references=[];public array $commands=[];
    public function syncTransactionReference(string $kind,int $transactionId,string $reference,?int $requestId=null):void{$this->references[]=[$kind,$transactionId,$reference,$requestId];}
    public function sendReferencedDispenseCommand(int $requestId,int $slot,int $quantity,int $transactionId,string $reference):array{$this->commands[]=[$requestId,$slot,$quantity,$transactionId,$reference];return [];}
    public function sendDispenseCommand(int $requestId,int $slot,int $quantity):array{throw new RuntimeException('Expected referenced command');}
    public function retireDispenseCommand(int $requestId):void{throw new RuntimeException('No recovery in identity fixture');}
};
$service=new KioskService($db,'LAN-TEST',$gateway);
$token=bin2hex(random_bytes(32));
$purchase=fn($key)=>$service->checkout(['request_id'=>$key,'items'=>[['medicine_id'=>1,'quantity'=>1]]],$token);
$history=$purchase(bin2hex(random_bytes(16)));$historical=$db->query('SELECT * FROM transactions ORDER BY id LIMIT 1')->fetch();
$sync=new TransactionReferenceSync($db,$gateway);$sync->initialize();$sync->run();
function flowCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);echo "PASS $message\n";}
flowCheck(count($gateway->references)===0,'Existing transactions are not backfilled');
$key=bin2hex(random_bytes(16));$t=$purchase($key);$sync->run();
flowCheck($gateway->references[0]===['payments',$t['databaseId'],$t['id'],null],'Payment metadata comes from stored authoritative identity');
$recovered=$service->recover($key,$token);$replayed=$purchase($key);
flowCheck($recovered['id']===$t['id']&&$replayed['databaseId']===$t['databaseId'],'Refresh and repeated checkout reuse numeric and public identifiers');
$paid=$service->coin($t['databaseId'],'reference-payment',10);$sync->run();
$request=$paid['dispensingRequestId'];
flowCheck($gateway->references[1]===['dispensing',$t['databaseId'],$t['id'],$request],'Background dispense metadata matches the request relationship');
$sync->run();flowCheck(count($gateway->references)===2,'Background retries do not duplicate completed metadata writes');
$service->sent($request);
flowCheck($gateway->commands[0]===[$request,1,1,$t['databaseId'],$t['id']],'Dispatch keeps original numeric IDs and adds stored TXN reference');
$failed=$service->sensor($request,1,false);
flowCheck($failed['paymentStatus']==='successful'&&$failed['dispensingStatus']==='failed','Successful payment remains successful after failed dispensing');
flowCheck($db->query('SELECT * FROM transactions ORDER BY id LIMIT 1')->fetch()===$historical,'Historical transaction identity and receipt source unchanged');
flowCheck((int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===5,'Identity synchronization never deducts inventory');
echo "All identity-flow checks used temporary tables and a recording test gateway; no real Firebase or hardware calls.\n";
