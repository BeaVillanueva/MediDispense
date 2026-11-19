<?php
// Connection-local temporary fixtures and fake hardware only.
require __DIR__.'/delivery-check-workflow.php';
clean();$t=failedPurchase();$id=$t['databaseId'];
$snapshot=$service->snapshot($id);
ok(!$snapshot['dispensingRecovery']['ready']&&!$snapshot['dispensingRecovery']['reviewSaved'],'Paid failure cannot return before physical recovery');
controller(['pending_events'=>1,'durable_events'=>1,'reconciliation_required'=>true]);
$snapshot=$service->snapshot($id);$codes=array_column($snapshot['dispensingRecovery']['blockers'],'code');
ok(in_array('REVIEW_NOT_SAVED',$codes)&&in_array('UNRESOLVED_COIN_EVENTS',$codes),'Kiosk sees both missing review and coin blockers rather than only the first');
controller();$op=prepareInspection($t);$saved=$service->saveDeliveryCheck($id,isolated(finding($t,'not_dispensed',0,5),$op),$actor);
ok(!$saved['dispensingRecovery']['ready']&&in_array('SAFE_RETURN_NOT_REQUESTED',array_column($saved['dispensingRecovery']['blockers'],'code')),'Saved physical check alone does not authorize return');
$return=['transaction_code'=>$t['id'],'request_key'=>bin2hex(random_bytes(16)),'expected_revision'=>1,'machine_power_isolated'=>true,'motor_stopped'=>true,'controller_disconnected'=>true];
$returned=$service->reopenAfterDeliveryCheck($id,$return,$actor);
ok($returned['dispensingRecovery']['ready'],'Explicit safe return is visible to the original kiosk');
$payments=$db->query('SELECT * FROM payment_events')->fetchAll();$requests=$db->query('SELECT * FROM dispensing_requests')->fetchAll();
$service->get($id,$token);$service->recover($db->query('SELECT checkout_key FROM transactions WHERE id='.$id)->fetchColumn(),$token);
$service->verifyCoin($id,'payment-0',10);
ok($payments===$db->query('SELECT * FROM payment_events')->fetchAll()&&$requests===$db->query('SELECT * FROM dispensing_requests')->fetchAll()&&$gateway->sent===0,'Status refresh and duplicate payment receipt never send another dispense or add credit');
controller(['pending_events'=>1,'durable_events'=>1,'reconciliation_required'=>true]);
ok(!$service->get($id,$token)['dispensingRecovery']['ready'],'New coin faults revoke previously safe kiosk readiness');
controller();controller(['device_id'=>'112233445566']);
ok(in_array('CONTROLLER_UNVERIFIED',array_column($service->get($id,$token)['dispensingRecovery']['blockers'],'code')),'Controller ambiguity blocks a previously approved return');
$db->exec("DELETE FROM system_settings WHERE setting_key LIKE 'coin_diag:%:112233445566'");
$gateway->active=true;
ok(in_array('ACTIVE_FIREBASE_COMMAND',array_column($service->get($id,$token)['dispensingRecovery']['blockers'],'code')),'Independent command verification blocks a renewed Firebase operation');
echo "Kiosk issue-return tests passed; no live records or hardware touched.\n";
