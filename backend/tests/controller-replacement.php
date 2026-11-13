<?php
// Reuse isolated connection-local fixture setup; it never writes live records.
require __DIR__.'/payment-demo-expiration.php';
$db->exec("DELETE FROM dispensing_requests");$db->exec("UPDATE transactions SET payment_status='cancelled',dispensing_status='cancelled',amount_paid=0");$db->exec('DELETE FROM payment_events');$db->exec('UPDATE payments SET amount_inserted=0');$db->exec("DELETE FROM system_settings WHERE setting_key LIKE 'coin_diag:%'");
$diag=new CoinPaymentDiagnostics($db,'LAN-TEST',fn()=>'idle');$old='20799D470968';$new='2C8C6AF3AF48';$report['device_id']=$old;$report['bound_transaction_id']=0;$diag->record($report);
$db->exec("UPDATE system_settings SET setting_value=JSON_SET(setting_value,'$.reportedAtMs',0) WHERE setting_key LIKE 'coin_diag:%'");
$report['device_id']=$new;$diag->record($report);
lanCheck(count($diag->activeReports())===2,'Stale unretired controller does not silently disappear');
lanCheck($demo->demoExpirationBlockers($newId)===['MULTIPLE_CONTROLLER_REPORTS'],'Unreviewed replacement blocks expiration');
$body=['old_device_id'=>$old,'new_device_id'=>$new,'old_disconnected'=>true,'no_unrecorded_coins'=>true,'new_physically_verified'=>true];$actor=['id'=>1,'role_code'=>'super_admin'];
function rejectReplacement(callable $fn,string $code):void{try{$fn();throw new RuntimeException('Unsafe replacement accepted');}catch(KioskError $e){lanCheck($e->errorCode===$code,$code);}}
rejectReplacement(fn()=>$diag->retire($body,['id'=>1,'role_code'=>'staff']),'FORBIDDEN');
rejectReplacement(fn()=>$diag->retire($body,['id'=>1,'role_code'=>'admin']),'FORBIDDEN');
rejectReplacement(fn()=>$diag->retire(array_replace($body,['old_disconnected'=>false]),$actor),'PHYSICAL_VERIFICATION_REQUIRED');
$report['pending_events']=1;$diag->record($report);rejectReplacement(fn()=>$diag->retire($body,$actor),'COIN_REVIEW_REQUIRED');$report['pending_events']=0;$diag->record($report);
rejectReplacement(fn()=>(new CoinPaymentDiagnostics($db,'LAN-TEST',fn()=>'active'))->retire($body,$actor),'FIREBASE_COMMAND_UNVERIFIED');
rejectReplacement(fn()=>(new CoinPaymentDiagnostics($db,'LAN-TEST'))->retire($body,$actor),'FIREBASE_COMMAND_UNVERIFIED');
$db->exec("UPDATE system_settings SET setting_value=JSON_SET(setting_value,'$.reportedAtMs',0) WHERE setting_key LIKE '%2C8C6AF3AF48'");
rejectReplacement(fn()=>$diag->retire($body,$actor),'CONTROLLER_UNVERIFIED');$diag->record($report);
$db->exec("INSERT INTO dispensing_requests(transaction_id,machine_id,slot_id,quantity,request_status) VALUES($newId,1,1,1,'queued')");
rejectReplacement(fn()=>$diag->retire($body,$actor),'ACTIVE_DISPENSING');$db->exec('DELETE FROM dispensing_requests');
$result=$diag->retire($body,$actor);lanCheck($result['retired']&&count($diag->activeReports())===1,'Reviewed old registration retired without deleting its diagnostics');
lanCheck(count($diag->read())===2,'Both diagnostic histories retained');
lanCheck($diag->retire($body,$actor)['already_retired'],'Replacement duplicate is idempotent');
lanCheck((int)$db->query("SELECT COUNT(*) FROM activity_logs WHERE action='controller_retired'")->fetchColumn()===1,'One audit entry for repeated retirement');
$report['bound_transaction_id']=$newId;$diag->record($report);
lanCheck(!in_array('MULTIPLE_CONTROLLER_REPORTS',$demo->demoExpirationBlockers($newId),true),'Expiration uses reviewed active controller');
$report['device_id']=$old;$diag->record($report);
lanCheck(count($diag->activeReports())===2,'Retired controller reporting again restores ambiguity');
rejectReplacement(fn()=>$diag->retire($body,$actor),'OLD_CONTROLLER_ONLINE');
