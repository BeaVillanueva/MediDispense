<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit;
require __DIR__.'/../src/Database.php';
require __DIR__.'/../src/KioskService.php';
require __DIR__.'/../src/MedicineInventory.php';
$db=Database::connect(require __DIR__.'/../config/config.php');
// Connection-local temporary tables shadow application tables; no live rows are changed.
foreach (['medicine_categories','medicines','inventory','machines','machine_slots','transaction_items'] as $table) {
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
$db->exec("INSERT INTO transaction_items(transaction_id,medicine_id,medicine_name_snapshot,quantity,unit_price_snapshot,subtotal) VALUES(1,1,'Original',1,10,10)");
$service=new MedicineInventory($db,'TEST'); $checks=0;
function verify(bool $ok,string $label):void { global $checks; if(!$ok) throw new RuntimeException($label); $checks++; echo "PASS $label\n"; }
function reject(callable $fn):void { try {$fn();} catch(KioskError $e) { verify(true,$e->errorCode); return; } throw new RuntimeException('Expected rejection'); }
$service->save(1,['name'=>'Updated','category_name'=>'Other','unit_price'=>12.50,'expiry_date'=>'2031-02-28','slot_number'=>3]);
$row=$db->query('SELECT * FROM medicines WHERE id=1')->fetch();
verify($row['name']==='Updated' && (int)$row['category_id']===2 && (float)$row['unit_price']===12.5 && $row['expiry_date']==='2031-02-28','Details update existing record');
verify((int)$db->query('SELECT quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===7,'Stock unchanged');
verify((int)$db->query('SELECT slot_number FROM machine_slots WHERE medicine_id=1')->fetchColumn()===3,'Slot moved');
reject(fn()=>$service->save(1,['name'=>'Must rollback','slot_number'=>2]));
verify($db->query('SELECT name FROM medicines WHERE id=1')->fetchColumn()==='Updated','Occupied slot leaves details unchanged');
foreach ([['expiry_date'=>'2030-02-30'],['unit_price'=>-1],['unit_price'=>1.234],['name'=>''],['stock_quantity'=>0],['category_name'=>'Missing'],['slot_number'=>99]] as $body) reject(fn()=>$service->save(1,$body));
$db->exec('UPDATE inventory SET reserved_quantity=1 WHERE medicine_id=1');
reject(fn()=>$service->save(1,[],true));
reject(fn()=>$service->save(1,['slot_number'=>null]));
$db->exec('UPDATE inventory SET reserved_quantity=0 WHERE medicine_id=1');
$result=$service->save(1,[],true);
verify($result['transaction_records_preserved']===1 && $db->query('SELECT medicine_name_snapshot FROM transaction_items WHERE medicine_id=1')->fetchColumn()==='Original','Transaction history preserved');
verify((int)$db->query('SELECT is_enabled FROM medicines WHERE id=1')->fetchColumn()===0,'Medicine archived');
verify((int)$db->query('SELECT quantity FROM inventory WHERE medicine_id=1')->fetchColumn()===7,'Archived stock preserved');
verify((int)$db->query('SELECT COUNT(*) FROM machine_slots WHERE medicine_id=1')->fetchColumn()===0,'Archived slot released');
echo "$checks checks passed; live records untouched.\n";
