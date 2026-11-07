<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../vendor/autoload.php';
require_once __DIR__.'/../src/Database.php';
require_once __DIR__.'/../src/KioskService.php';
require_once __DIR__.'/../src/FirebaseRealtimeDatabase.php';
require_once __DIR__.'/../src/AlertService.php';
require_once __DIR__.'/../src/AlertEmail.php';
$db=Database::connect(require __DIR__.'/../config/config.php');
foreach(['roles','users','medicines','medicine_categories','inventory','machines','machine_slots','machine_status','transactions','transaction_items','dispensing_requests','dispensing_logs','notifications','activity_logs','system_settings','alert_incidents','alert_recipients','notification_reads','notification_dismissals','alert_email_jobs','alert_email_attempts'] as $table) {
    $ddl=$db->query("SHOW CREATE TABLE $table")->fetch(PDO::FETCH_NUM)[1];
    $ddl=preg_replace('/^\s*CONSTRAINT[^\n]+\n/m','',$ddl);$ddl=preg_replace('/,\n\)/',"\n)",$ddl);
    $db->exec(str_replace('CREATE TABLE','CREATE TEMPORARY TABLE',$ddl));
}
$db->exec("INSERT INTO roles(id,code,name) VALUES(1,'super_admin','Admin')");
$db->exec("INSERT INTO users(id,employee_id,firebase_uid,email,display_name,role_id,email_verified_at) VALUES(1,'THRESHOLD','threshold','test@example.invalid','Test',1,NOW())");
$db->exec("INSERT INTO medicine_categories(id,name) VALUES(1,'Test')");
$db->exec("INSERT INTO medicines(id,category_id,name,generic_name,description,dosage_information,usage_instructions,unit_price,expiry_date,minimum_stock_level) VALUES(1,1,'Threshold test','Test','Test','Label','Label',10,'2035-01-01',3)");
$db->exec('INSERT INTO inventory(medicine_id,quantity,reserved_quantity) VALUES(1,5,0)');
$db->exec("INSERT INTO machines(id,machine_code,name) VALUES(1,'THRESHOLD','Test')");
$db->exec("INSERT INTO machine_slots(id,machine_id,slot_number,medicine_id,motor_id,sensor_id,slot_status) VALUES(1,1,1,1,'TEST','TEST','ready')");
$db->exec("INSERT INTO system_settings(setting_key,setting_value) VALUES('alert_monitor_started_at',NOW())");
$alerts=new AlertService($db,120,'medidispense_threshold_fixture');
$alerts->saveRecipients([['user_id'=>1,'low_stock'=>true,'dispensing_failure'=>true]],['id'=>1,'role_code'=>'super_admin']);
$gateway=new class implements DispenseCommandGateway {
    public function sendDispenseCommand(int $id,int $slot,int $quantity):array{throw new RuntimeException('No hardware permitted');}
    public function retireDispenseCommand(int $id):void{throw new RuntimeException('No hardware permitted');}
};
$service=new KioskService($db,'THRESHOLD',$gateway);
function stockCheck(bool $ok,string $label):void{if(!$ok)throw new RuntimeException($label);echo "PASS $label\n";}
foreach([5=>'in_stock',4=>'in_stock',3=>'low_stock',2=>'low_stock',1=>'low_stock',0=>'out_of_stock'] as $quantity=>$expected) {
    $db->exec("UPDATE inventory SET quantity=$quantity,reserved_quantity=0 WHERE medicine_id=1");$alerts->scan();$alerts->scan();
    stockCheck($service->medicines(false)[0]['status']===$expected,"$quantity available = $expected");
    $q=$db->query("SELECT n.notification_type,a.details FROM alert_incidents a JOIN notifications n ON n.id=a.notification_id WHERE a.resolved_at IS NULL")->fetch();
    stockCheck($quantity>=4?!$q:($q['notification_type']===$expected),"Dashboard incident matches $quantity units");
    if($quantity===3) {
        $incident=$db->query('SELECT * FROM alert_incidents LIMIT 1')->fetch();
        [$subject,$html,$text]=AlertEmailTemplate::render($incident);
        stockCheck(str_contains($subject,'Low Stock Alert')&&str_contains($text,'Low Stock Threshold: 3'),'Low stock email uses threshold 3');
    }
}
stockCheck((int)$db->query('SELECT COUNT(*) FROM alert_incidents')->fetchColumn()===1&&(int)$db->query('SELECT COUNT(*) FROM alert_email_jobs')->fetchColumn()===1,'3 → 2 → 1 → 0 retains one incident and one email job');
$incident=$db->query('SELECT * FROM alert_incidents LIMIT 1')->fetch();[$subject,$html,$text]=AlertEmailTemplate::render($incident);
stockCheck(str_contains($subject,'Out of Stock Alert')&&str_contains($text,'Available Stock: 0')&&str_contains($text,'Low Stock Threshold: 3'),'Zero-stock email is labeled Out of Stock with threshold 3');
$db->exec('UPDATE inventory SET quantity=4,reserved_quantity=1 WHERE medicine_id=1');$alerts->scan();
$catalog=$service->medicines(false)[0];
stockCheck($catalog['stockQuantity']===4&&$catalog['availableStockQuantity']===3&&$catalog['status']==='low_stock','Admin classification uses availability without changing on-hand quantity');
$db->exec('UPDATE inventory SET quantity=4,reserved_quantity=0 WHERE medicine_id=1');$alerts->scan();
stockCheck((int)$db->query('SELECT COUNT(*) FROM alert_incidents WHERE resolved_at IS NULL')->fetchColumn()===0,'Four available resolves the low-stock cycle');
$db->exec('UPDATE medicines SET minimum_stock_level=5 WHERE id=1');$alerts->scan();
$old=$db->query('SELECT * FROM alert_incidents WHERE resolved_at IS NULL')->fetch();
$db->exec("UPDATE alert_email_jobs SET status='sent',attempts=1,sent_at=NOW() WHERE incident_id=".(int)$old['id']);
$db->exec('UPDATE medicines SET minimum_stock_level=3 WHERE id=1');$alerts->scan();$alerts->scan();
stockCheck((int)$db->query('SELECT COUNT(*) FROM alert_incidents WHERE resolved_at IS NULL')->fetchColumn()===0,'Old threshold-5 incident at quantity 4 is reconciled under threshold 3');
stockCheck((int)$db->query('SELECT COUNT(*) FROM alert_email_jobs WHERE status=\'sent\' AND attempts=1')->fetchColumn()===1,'Reconciliation preserves sent email and does not resend');
stockCheck(!in_array((int)$old['notification_id'],array_map(fn($n)=>(int)$n['id'],$alerts->notifications(1)),true),'Outdated resolved threshold-5 alert is hidden from the production dropdown');
stockCheck(in_array((int)$old['notification_id'],array_map(fn($n)=>(int)$n['id'],$alerts->notifications(1,true)),true),'Outdated threshold-5 alert remains in audit history');
echo "Live stock, transactions, SMTP and hardware untouched.\n";
