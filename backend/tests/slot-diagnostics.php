<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit;
require __DIR__.'/../src/Database.php';
$db=Database::connect(require __DIR__.'/../config/config.php');
$queries=[
 'slots'=>"SELECT s.id,s.slot_number,s.slot_status,m.name,i.quantity,i.reserved_quantity,i.last_counted_at,m.expiry_date FROM machine_slots s LEFT JOIN medicines m ON m.id=s.medicine_id LEFT JOIN inventory i ON i.medicine_id=m.id ORDER BY s.id",
 'requests'=>"SELECT dr.id,dr.transaction_id,dr.slot_id,dr.request_status,t.dispensing_status,dr.requested_at,dr.completed_at FROM dispensing_requests dr JOIN transactions t ON t.id=dr.transaction_id ORDER BY dr.id DESC LIMIT 25",
 'unresolved'=>"SELECT dr.id,dr.transaction_id,dr.slot_id,dr.request_status,t.dispensing_status FROM dispensing_requests dr JOIN transactions t ON t.id=dr.transaction_id WHERE t.dispensing_status='dispensing' OR dr.request_status IN ('pending','sent','dispensing')",
 'recovery_audit'=>"SELECT id,action,created_at,metadata FROM activity_logs WHERE action IN ('admin_dispense_recovered','dispense_stock_reconciled','stock_adjusted') ORDER BY id DESC LIMIT 30",
];
foreach($queries as $label=>$sql) echo $label.': '.json_encode($db->query($sql)->fetchAll(),JSON_PRETTY_PRINT).PHP_EOL;
