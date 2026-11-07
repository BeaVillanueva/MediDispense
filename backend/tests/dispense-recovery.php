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

final class RecoveryGateway implements DispenseCommandGateway {
    public int $sent = 0;
    public int $retired = 0;
    public bool $fail = false;
    public function sendDispenseCommand(int $requestId,int $slot,int $quantity): array { $this->sent++; return []; }
    public function retireDispenseCommand(int $requestId): void {
        if ($this->fail) throw new RuntimeException('Simulated Firebase failure');
        $this->retired++;
    }
}
$gateway = new RecoveryGateway();
$service=new KioskService($db,'TEST',$gateway);
function check(bool $ok,string $label):void { if(!$ok) throw new RuntimeException($label); echo "PASS $label\n"; }
$token=bin2hex(random_bytes(32));
$purchase=fn()=>$service->checkout(['request_id'=>bin2hex(random_bytes(16)),'items'=>[['medicine_id'=>1,'quantity'=>1]]],$token);
$t=$purchase();
$id=$t['databaseId'];
$db->exec("UPDATE transactions SET payment_status='successful',amount_paid=total_amount,dispensing_status='dispensing' WHERE id=$id");
$db->exec("INSERT INTO dispensing_requests(transaction_id,machine_id,slot_id,quantity,dispensed_quantity,request_status,command_reference,command_payload) VALUES($id,1,1,1,0,'sent','test-recovery','{}')");
$requestId=(int)$db->lastInsertId();
$body=['transaction_code'=>$t['id'],'motor_stopped'=>true,'controller_disconnected'=>true,'reason'=>'Motor stopped; callback missing'];
$actor=['id'=>1,'role_code'=>'admin'];
$service->get($id,$token);
check((int)$db->query("SELECT COUNT(*) FROM activity_logs WHERE action='dispensing_confirmation_timeout'")->fetchColumn()===0,'No premature timeout audit');
$db->exec("UPDATE dispensing_requests SET sent_at=DATE_SUB(NOW(),INTERVAL 130 SECOND) WHERE id=$requestId");
$observed=$service->get($id,$token);
$restored=$service->recover($db->query("SELECT checkout_key FROM transactions WHERE id=$id")->fetchColumn(),$token);
check($observed['dispensingWaitSeconds']>=130 && $restored['dispensingWaitSeconds']>=130,'Reload keeps the server dispensing deadline');
check((int)$db->query("SELECT COUNT(*) FROM activity_logs WHERE action='dispensing_confirmation_timeout'")->fetchColumn()===1,'Timeout audit recorded once across polls and reload');
check($restored['dispensingStatus']==='dispensing' && !$restored['adminRecovered'],'Timeout alone never finalizes failure');
check($gateway->retired===0 && $gateway->sent===0,'Timeout never sends or resets hardware');
check(count(array_filter($service->medicines(),fn($m)=>$m['machineReady']===false))>0,'Catalog reports unresolved machine lock');
function rejected(callable $action,string $label):void {
    try { $action(); } catch (Throwable $e) { echo "PASS $label\n"; return; }
    throw new RuntimeException($label);
}
rejected(fn()=>$service->checkout(['request_id'=>bin2hex(random_bytes(16)),'items'=>[['medicine_id'=>2,'quantity'=>1]]],bin2hex(random_bytes(32))),'Another browser cannot bypass unresolved dispense');
rejected(fn()=>$service->recoverStoppedDispense($id,$body,['id'=>2,'role_code'=>'staff']),'Staff forbidden');
rejected(fn()=>$service->recoverStoppedDispense($id,array_replace($body,['motor_stopped'=>false]),$actor),'Motor confirmation required');
rejected(fn()=>$service->recoverStoppedDispense($id,array_replace($body,['controller_disconnected'=>false]),$actor),'Controller confirmation required');
rejected(fn()=>$service->recoverStoppedDispense($id,array_replace($body,['transaction_code'=>'wrong']),$actor),'Exact transaction required');
$gateway->fail=true;
rejected(fn()=>$service->recoverStoppedDispense($id,$body,$actor),'Firebase failure blocks recovery');
check($service->snapshot($id)['dispensingStatus']==='dispensing','Failed recovery rolls back transaction');
check((int)$db->query('SELECT reserved_quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===1,'Failed recovery preserves reservation');
check($db->query('SELECT slot_status FROM machine_slots WHERE id=1')->fetchColumn()==='ready','Failed recovery rolls back slot change');
$gateway->fail=false;
$result=$service->recoverStoppedDispense($id,$body,$actor);
check($result['adminRecovered'] && $result['dispensingStatus']==='failed','Recovery is explicit failure, never success');
check(!$result['stockReconciled'],'Recovery alone explicitly reports missing physical verification');
check($result['paymentStatus']==='successful' && $result['amountPaid']===10.0,'Payment preserved');
check((int)$db->query('SELECT quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===7,'Physical stock count unchanged');
check((int)$db->query('SELECT reserved_quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===0,'Only reservation released');
check($db->query('SELECT slot_status FROM machine_slots WHERE id=1')->fetchColumn()==='blocked','Slot quarantined');
check((int)$db->query('SELECT COUNT(*) FROM dispensing_logs')->fetchColumn()===0,'No sensor confirmation invented');
check((int)$db->query('SELECT COUNT(*) FROM stock_movements')->fetchColumn()===0,'No inventory movement invented');
$service->recoverStoppedDispense($id,$body,$actor);
check($gateway->retired===1 && $gateway->sent===0,'Retry is idempotent; no motor command sent');
check((int)$db->query("SELECT COUNT(*) FROM activity_logs WHERE action='admin_dispense_recovered' AND actor_user_id=1")->fetchColumn()===1,'Admin audit recorded once');
rejected(fn()=>$service->sensor($requestId,1,true),'Late callback cannot deduct inventory');
rejected(fn()=>$service->sent($requestId),'Recovered request cannot be resent');
check($gateway->sent===0,'Resend rejection happens before hardware call');
$next=$service->checkout(['request_id'=>bin2hex(random_bytes(16)),'items'=>[['medicine_id'=>2,'quantity'=>1]]],$token);
check($next['paymentStatus']==='pending','Backend permits new purchase after safe recovery');
$service->cancel($next['databaseId'],$token);
// A partially confirmed purchase must retain its genuine deduction and progress.
$db->exec("UPDATE machine_slots SET slot_status='ready' WHERE id=1");
$db->exec('UPDATE medicines SET unit_price=0 WHERE id=1');
$partial=$service->checkout(['request_id'=>bin2hex(random_bytes(16)),'items'=>[['medicine_id'=>1,'quantity'=>2]]],$token);
$service->sensor($partial['dispensingRequestId'],1,true);
$partialResult=$service->recoverStoppedDispense($partial['databaseId'],array_replace($body,['transaction_code'=>$partial['id']]),['id'=>3,'role_code'=>'super_admin']);
check($partialResult['dispensedQuantity']===1,'Confirmed partial quantity preserved');
check((int)$db->query('SELECT quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===6,'Existing confirmed deduction preserved');
check((int)$db->query('SELECT COUNT(*) FROM stock_movements')->fetchColumn()===1,'Recovery adds no second inventory deduction');
check((int)$db->query('SELECT reserved_quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===0,'Only unconfirmed reservation released');
check($service->get($partial['databaseId'],$token)['adminRecovered']===true,'Kiosk token receives persisted recovery flag');
rejected(fn()=>$service->sensor($partial['dispensingRequestId'],1,true),'Even a replayed confirmed success cannot overwrite recovery');
check($service->snapshot($partial['databaseId'])['dispensingStatus']==='failed','Final recovery status survives late callback');
rejected(fn()=>$service->recoverStoppedDispense($partial['databaseId'],array_replace($body,['transaction_code'=>$partial['id'],'physical_stock'=>11]),$actor),'Recount enforces capacity');
rejected(fn()=>$service->recoverStoppedDispense($partial['databaseId'],array_replace($body,['transaction_code'=>$partial['id'],'physical_stock'=>1.5]),$actor),'Recount requires whole units');
$paymentRows=$db->query('SELECT * FROM payments ORDER BY id')->fetchAll();
$countedBody=array_replace($body,['transaction_code'=>$partial['id'],'physical_stock'=>5]);
$service->recoverStoppedDispense($partial['databaseId'],$countedBody,$actor);
check($service->snapshot($partial['databaseId'])['stockReconciled'],'Physical reconciliation is persisted and exposed to staff');
check($db->query('SELECT slot_status FROM machine_slots WHERE id=1')->fetchColumn()==='ready','Physical recount reopens recovered slot');
check((int)$db->query('SELECT quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===5,'Stock uses explicit admin physical count');
check((int)$db->query("SELECT COUNT(*) FROM stock_movements WHERE change_type='adjustment'")->fetchColumn()===1,'Recount difference is an audited adjustment, not a dispense');
$service->recoverStoppedDispense($partial['databaseId'],$countedBody,$actor);
check((int)$db->query("SELECT COUNT(*) FROM stock_movements WHERE change_type='adjustment'")->fetchColumn()===1,'Recount retry does not adjust stock twice');
check($db->query('SELECT * FROM payments ORDER BY id')->fetchAll()===$paymentRows,'Recovery and recount preserve every payment record');
$readyCatalog=$service->medicines();
check(count(array_filter($readyCatalog,fn($m)=>$m['id']===1 && $m['machineReady'] && $m['slotReady'] && $m['availableForPurchase'] && $m['unavailableReason']===null && $m['stockQuantity']===5))===1,'Recovered medicine is selectable from live catalog again');
$newPurchase=$purchase();
check($newPurchase['dispensingStatus']==='dispensing','Recovered slot supports a new purchase');
$service->sensor($newPurchase['dispensingRequestId'],1,true);
check($service->snapshot($newPurchase['databaseId'])['dispensingStatus']==='dispensed','Next purchase can finish normally');
echo "Live records untouched; no Firebase or hardware calls made.\n";
