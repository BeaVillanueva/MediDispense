<?php
// Temporary tables and fake Firebase only; no live actions.
require __DIR__.'/delivery-check-workflow.php';
function staleController():void{global $db;$db->exec("UPDATE system_settings SET setting_value=JSON_SET(setting_value,'$.reportedAtMs',0) WHERE setting_key LIKE 'coin_diag:%'");}
function pausePatch(array $patch):void{global $db;$key='delivery_inspection:LAN-TEST';$q=$db->prepare('SELECT setting_value FROM system_settings WHERE setting_key=?');$q->execute([$key]);$value=json_decode($q->fetchColumn(),true);$q=$db->prepare('UPDATE system_settings SET setting_value=? WHERE setting_key=?');$q->execute([json_encode(array_replace($value,$patch)),$key]);}
clean();$t=failedPurchase();staleController();denied(fn()=>prepareInspection($t),'INSPECTION_BLOCKED');
ok(!$service->dispensingIssueDetails($t['databaseId'],$actor)['inspection']['active'],'Stale controller cannot authorize a new pause');
controller();$op=prepareInspection($t);controller(['pending_events'=>1,'durable_events'=>1,'reconciliation_required'=>true]);staleController();
$b=isolated(finding($t,'not_dispensed',0,5),$op);$payments=$db->query('SELECT * FROM payments')->fetchAll();$events=$db->query('SELECT * FROM payment_events')->fetchAll();$settings=$db->query("SELECT setting_value FROM system_settings WHERE setting_key LIKE 'coin_diag:%'")->fetchAll();
$r=$service->saveDeliveryCheck($t['databaseId'],$b,$actor);$service->saveDeliveryCheck($t['databaseId'],$b,$actor);
ok($r['stockReconciled']&&!$r['dispensingRecovery']['ready'],'Valid isolated findings save while controller is offline, without authorizing reopening');
ok((int)$db->query("SELECT COUNT(*) FROM activity_logs WHERE action='admin_dispense_issue_reviewed'")->fetchColumn()===1,'Offline duplicate submission has one reconciliation audit');
ok($payments===$db->query('SELECT * FROM payments')->fetchAll()&&$events===$db->query('SELECT * FROM payment_events')->fetchAll()&&$settings===$db->query("SELECT setting_value FROM system_settings WHERE setting_key LIKE 'coin_diag:%'")->fetchAll(),'Offline save preserves payments, coin ledger and controller journal evidence');
ok((int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===5&&$service->dispensingIssueDetails($t['databaseId'],$actor)['inspection']['active'],'Offline zero delivery changes no quantity and keeps purchases paused');
$return=['transaction_code'=>$t['id'],'request_key'=>bin2hex(random_bytes(16)),'expected_revision'=>1,'machine_power_isolated'=>true,'motor_stopped'=>true,'controller_disconnected'=>true];denied(fn()=>$service->reopenAfterDeliveryCheck($t['databaseId'],$return,$actor),'REOPEN_BLOCKED');
pausePatch(['authorization_expires_at_ms'=>0]);$service->saveDeliveryCheck($t['databaseId'],$b,$actor);
ok((int)$db->query("SELECT COUNT(*) FROM activity_logs WHERE action='admin_dispense_issue_reviewed'")->fetchColumn()===1,'Confirmed retry returns the prior receipt even after authorization expires');
$new=array_replace($b,['request_key'=>bin2hex(random_bytes(16)),'expected_revision'=>1]);denied(fn()=>$service->saveDeliveryCheck($t['databaseId'],$new,$actor),'INSPECTION_EXPIRED');
ok($service->dispensingIssueDetails($t['databaseId'],$actor)['inspection']['active'],'Expired save authorization does not release the pause');
clean();$t=failedPurchase();$b=isolated(finding($t,'not_dispensed',0,5),['request_key'=>'missing']);denied(fn()=>$service->saveDeliveryCheck($t['databaseId'],$b,$actor),'INSPECTION_REQUIRED');
$op=prepareInspection($t);$b=isolated(finding($t,'not_dispensed',0,5),$op);denied(fn()=>$service->saveDeliveryCheck($t['databaseId'],array_replace($b,['inspection_key'=>'wrong']),$actor),'INSPECTION_REQUIRED');
pausePatch(['status'=>'completed']);denied(fn()=>$service->saveDeliveryCheck($t['databaseId'],$b,$actor),'INSPECTION_REQUIRED');
ok(!$service->snapshot($t['databaseId'])['issueRecovery'],'Missing, mismatched and closed pauses save no physical audit');
clean();$t=failedPurchase();$op=prepareInspection($t);$b=isolated(finding($t,'not_dispensed',0,5),$op);$b['obligation_status']='refund_documented';$b['obligation_reference']='fixture-refund';$service->saveDeliveryCheck($t['databaseId'],$b,$actor);staleController();
$new=array_replace($b,['request_key'=>bin2hex(random_bytes(16)),'expected_revision'=>1]);denied(fn()=>$service->saveDeliveryCheck($t['databaseId'],array_replace($new,['obligation_status'=>'pending','obligation_reference'=>'']),$actor),'RECOVERY_FINALIZED');
$saved=$service->saveDeliveryCheck($t['databaseId'],$new,$actor);
ok($saved['issueRecovery']['revision']===2&&$saved['issueRecovery']['obligationStatus']==='refund_documented','Existing finalized follow-up can be retained in a new offline inspection without altering its outcome');
controller(['device_id'=>'112233445566']);$changed=array_replace($new,['request_key'=>bin2hex(random_bytes(16)),'expected_revision'=>2]);denied(fn()=>$service->saveDeliveryCheck($t['databaseId'],$changed,$actor),'INSPECTION_BLOCKED');
ok($gateway->sent===0,'No offline save or failure dispatches a motor command');
echo "Offline inspection tests passed; live records, firmware and NVS untouched.\n";
