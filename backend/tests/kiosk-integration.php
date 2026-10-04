<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require __DIR__.'/../src/KioskService.php';
// Only creates a unique disposable database on the isolated local test server.
// Never points at the configured application database or reimports its schema.
$port=(int)(getenv('KIOSK_TEST_PORT')?:33317);
if($port===3306) throw new RuntimeException('Use an isolated test port, not the application server.');
$db=new PDO("mysql:host=127.0.0.1;port=$port;charset=utf8mb4",'root','',[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,PDO::ATTR_EMULATE_PREPARES=>false]);
$name='medidispense_kiosk_test_'.bin2hex(random_bytes(5));
$schema=file_get_contents(__DIR__.'/../../database/schema.sql');
$schema=str_replace('medidispense',$name,$schema);
$db->exec($schema);
$db->exec(file_get_contents(__DIR__.'/../../database/migrations/2026_10_04_kiosk_transactions.sql'));
$db->exec("INSERT INTO medicines(category_id,name,generic_name,description,dosage_information,usage_instructions,unit_price,expiry_date) VALUES(1,'Test medicine','Test generic','Stored description','Stored label','Stored instructions',10,DATE_ADD(CURDATE(),INTERVAL 1 YEAR)),(1,'No stock','Test generic','Stored description','Stored label','Stored instructions',12,DATE_ADD(CURDATE(),INTERVAL 1 YEAR))");
$db->exec("INSERT INTO inventory(medicine_id,quantity) VALUES(1,8),(2,0)");
$db->exec("UPDATE machine_slots SET medicine_id=1,slot_status='ready' WHERE id=1");
$db->exec("UPDATE machine_slots SET medicine_id=2,slot_status='ready' WHERE id=2");
$service=new KioskService($db,'MD-001');$checks=0;
function check(bool $value,string $label):void {global $checks;if(!$value)throw new RuntimeException('FAIL: '.$label);$checks++;echo "PASS: $label\n";}
function denied(callable $call,string $code):void {try{$call();throw new RuntimeException('Expected '.$code);}catch(KioskError $e){check($e->errorCode===$code,$code);}}
function purchase(KioskService $service,int $quantity=3,int $medicine=1):array {$token=bin2hex(random_bytes(32));$key=bin2hex(random_bytes(16));$body=['request_id'=>$key,'items'=>[['medicine_id'=>$medicine,'quantity'=>$quantity]],'total'=>0,'unit_price'=>0];return [$service->checkout($body,$token),$token,$body];}
check(count($service->medicines())===1,'PHP/MySQL catalog excludes out of stock');
denied(fn()=>purchase($service,1,2),'OUT_OF_STOCK');
denied(fn()=>purchase($service,99),'OUT_OF_STOCK');
[$t,$token,$body]=purchase($service);
$id=$t['databaseId'];
check($t['total']===30.0,'Backend ignores browser total and uses stored price');
check((int)$db->query('SELECT quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===8,'Checkout reserves without inventory deduction');
check($service->checkout($body,$token)['databaseId']===$id,'Repeated checkout is idempotent');
denied(fn()=>purchase($service,6),'OUT_OF_STOCK');
check($service->recover($body['request_id'],$token)['paymentStatus']==='pending','Recovery never invents paid/success');
denied(fn()=>$service->get($id,bin2hex(random_bytes(32))),'TRANSACTION_NOT_FOUND');
$t=$service->coin($id,'coin1',20);
check($t['insertedAmount']===20.0&&$t['paymentStatus']==='pending','Partial coins persist');
denied(fn()=>$service->cancel($id,$token),'PAYMENT_IN_PROGRESS');
$t=$service->coin($id,'coin1',20);check($t['insertedAmount']===20.0,'Duplicate coin ignored');
denied(fn()=>$service->coin($id,'coin1',10),'EVENT_CONFLICT');
$t=$service->coin($id,'coin2',20);$request=$t['dispensingRequestId'];
check($t['coinStatus']==='OVERPAYMENT'&&$t['insertedAmount']===40.0&&$t['change']===0,'Overpayment preserved without fake change');
check($t['dispensingStatus']==='dispensing'&&$t['dispensedQuantity']===0,'Payment creates queued request, not success');
check((int)$db->query('SELECT quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===8,'Payment does not deduct inventory');
$service->sent($request);
denied(fn()=>$service->sensor($request,2,true),'DISPENSE_NOT_ALLOWED');
$t=$service->sensor($request,1,true);check($t['dispensedQuantity']===1,'One confirmation advances one unit');
$service->sensor($request,1,true);check((int)$db->query('SELECT quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===7,'Duplicate sensor never deducts twice');
$service->sensor($request,2,true);$t=$service->sensor($request,3,false);
check($t['dispensingStatus']==='failed'&&$t['dispensedQuantity']===2,'Partial failure retains two confirmed units');
check((int)$db->query('SELECT quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===6,'Only two confirmed units deducted');
denied(fn()=>$service->sensor($request,3,true),'EVENT_CONFLICT');
check((int)$db->query('SELECT reserved_quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===0,'Failed remaining units release reservations');
[$cancelled,$cancelToken]=purchase($service,1);$service->cancel($cancelled['databaseId'],$cancelToken);
check($service->get($cancelled['databaseId'],$cancelToken)['paymentStatus']==='cancelled','Unpaid cancellation is persisted');
[$done,$doneToken]=purchase($service,2);$done=$service->coin($done['databaseId'],'exact',20);$service->sensor($done['dispensingRequestId'],1,true);$done=$service->sensor($done['dispensingRequestId'],2,true);
check($done['dispensingStatus']==='dispensed'&&$done['dispensedQuantity']===2,'Success requires every unit');
$db->exec('UPDATE medicines SET unit_price=12 WHERE id=1');$db->exec('UPDATE inventory SET quantity=1 WHERE medicine_id=1');
check($service->medicines()[0]['price']===12.0,'Admin database price is reflected in kiosk');
[$last,$lastToken]=purchase($service,1);denied(fn()=>purchase($service,1),'OUT_OF_STOCK');
$last=$service->coin($last['databaseId'],'last',12);$service->sensor($last['dispensingRequestId'],1,true);$service->sensor($last['dispensingRequestId'],1,true);
check((int)$db->query('SELECT quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===0,'Final unit cannot be oversold or go negative');
$db->exec('UPDATE inventory SET quantity=3 WHERE medicine_id=1');
[$expired,$expiredToken]=purchase($service,1);
$db->exec('UPDATE transactions SET expires_at=DATE_SUB(NOW(),INTERVAL 11 MINUTE) WHERE id='.(int)$expired['databaseId']);
check($service->get($expired['databaseId'],$expiredToken)['paymentStatus']==='cancelled','Unpaid session expires without losing coins');
check((int)$db->query('SELECT reserved_quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===0,'Expired reservation released');
$db->exec("UPDATE machine_slots SET slot_status='blocked' WHERE id=1");
check(count($service->medicines())===0,'Blocked slot is excluded from catalog');
denied(fn()=>purchase($service,1),'SLOT_UNAVAILABLE');
$db->exec("UPDATE machine_slots SET slot_status='ready' WHERE id=1");
$db->exec('UPDATE medicines SET unit_price=0 WHERE id=1');
[$free,$freeToken]=purchase($service,1);
check($free['paymentStatus']==='successful'&&$free['dispensingStatus']==='dispensing'&&$free['dispensedQuantity']===0,'Free stored price queues confirmation without inventing coins or success');
$service->sensor($free['dispensingRequestId'],1,true);
$db->exec('UPDATE medicines SET unit_price=12 WHERE id=1');
echo "Passed $checks database integration checks. Isolated database: $name\n";
file_put_contents(__DIR__.'/../../tmp/kiosk-test-database.txt',$name);
