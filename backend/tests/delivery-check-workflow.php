<?php
// Reuse connection-local fixtures only; legacy recovery regression checks run first.
require __DIR__.'/dispense-issue-recovery.php';
$gateway=new class implements DispenseCommandGateway,DispenseRecoveryReadGateway,DispenseInspectionGateway {
    public int $sent=0;public int $retired=0;public bool $fail=false;public bool $active=false;
    public function sendDispenseCommand(int $r,int $s,int $q):array{$this->sent++;throw new RuntimeException('No motor commands permitted.');}
    public function retireDispenseCommand(int $r):void{if($this->active||$this->fail)throw new RuntimeException('Another Firebase command is active.');$this->retired++;}
    public function recoveryRetirementState(int $r):string{return $this->active?'active':($this->fail?'unverified':'retired');}
    public function inspectionCommandIdle():bool{return !$this->active&&!$this->fail;}
};
$service=new KioskService($db,'LAN-TEST',$gateway);
function finding(array $t,string $outcome,int $qty,int $stock):array{return ['transaction_code'=>$t['id'],'request_key'=>bin2hex(random_bytes(16)),'expected_revision'=>0,'outcome'=>$outcome,'verified_quantity'=>$qty,'physical_stock'=>$stock,'notes'=>'Observed delivery from outside the machine.','obligation_status'=>$outcome==='dispensed_sensor_missed'?'delivery_verified':'pending','obligation_reference'=>'','inspection_mode'=>'external','external_observation_confirmed'=>true,'physically_inspected'=>false,'motor_stopped'=>false,'controller_disconnected'=>false];}
function failedPurchase(int $qty=1):array{global $service;$t=purchase($qty);return $service->sensor($t['dispensingRequestId'],1,false);}
function prepareInspection(array $t):array{global $service,$actor;return $service->prepareDeliveryInspection($t['databaseId'],['transaction_code'=>$t['id'],'request_key'=>bin2hex(random_bytes(16)),'machine_power_isolated'=>true,'motor_stopped'=>true,'controller_disconnected'=>true],$actor);}
function isolated(array $note,array $op):array{return array_replace($note,['inspection_mode'=>'isolated','inspection_key'=>$op['request_key'],'physically_inspected'=>true,'machine_power_isolated'=>true,'motor_stopped'=>true,'controller_disconnected'=>true]);}
clean();$t=failedPurchase();$b=finding($t,'not_dispensed',0,5);$before=[];foreach(['transactions','inventory','payments','payment_events','dispensing_requests','stock_movements'] as $table)$before[$table]=$db->query("SELECT * FROM $table")->fetchAll();
$note=$service->saveDeliveryCheck($t['databaseId'],$b,$actor);$service->saveDeliveryCheck($t['databaseId'],$b,$actor);
ok($note['verifiedQuantity']===0&&!$note['inventoryApplied'],'Connected, non-invasive zero-delivery review is an observation only');
foreach($before as $table=>$rows)ok($db->query("SELECT * FROM $table")->fetchAll()===$rows,'Observation preserves '.$table);
ok($gateway->retired===0&&$gateway->sent===0,'Observation does not contact motor/retirement gateways');
ok((int)$db->query("SELECT COUNT(*) FROM activity_logs WHERE action='admin_dispense_delivery_noted'")->fetchColumn()===1,'Observation retries have one audit record');
ok($service->dispensingIssueDetails($t['databaseId'],$actor)['deliveryCheck']['verifiedQuantity']===0,'Saved note returned separately from applied recovery');
denied(fn()=>$service->saveDeliveryCheck($t['databaseId'],array_replace($b,['notes'=>'Changed findings']),$actor),'EVENT_CONFLICT');
denied(fn()=>$service->saveDeliveryCheck($t['databaseId'],array_replace($b,['request_key'=>bin2hex(random_bytes(16)),'external_observation_confirmed'=>false]),$actor),'CONFIRMATION_REQUIRED');
denied(fn()=>$service->saveDeliveryCheck($t['databaseId'],$b,['id'=>2,'role_code'=>'staff']),'FORBIDDEN');
foreach([['verified_quantity'=>null],['outcome'=>'partial','verified_quantity'=>0],['obligation_status'=>'refund_documented','obligation_reference'=>'']] as $bad)denied(fn()=>$service->saveDeliveryCheck($t['databaseId'],array_replace($b,$bad),$actor),array_key_exists('obligation_status',$bad)?'OBLIGATION_REFERENCE_REQUIRED':(array_key_exists('physical_stock',$bad)?'INVALID_STOCK':'INVALID_QUANTITY'));
$unknown=array_replace($b,['request_key'=>bin2hex(random_bytes(16)),'expected_revision'=>1,'physical_stock'=>null]);$outside=$service->saveDeliveryCheck($t['databaseId'],$unknown,$actor);ok($outside['physicalStock']===null,'An unobservable external stock count is never guessed from recorded inventory');
$op=prepareInspection($t);denied(fn()=>$service->saveDeliveryCheck($t['databaseId'],array_replace(isolated($b,$op),['physical_stock'=>null]),$actor),'INVALID_STOCK');ok($service->hardwarePendingDispense()===['active'=>false],'Prepared inspection prevents dispatch');
denied(fn()=>$service->checkout(['request_id'=>bin2hex(random_bytes(16)),'items'=>[['medicine_id'=>1,'quantity'=>1]]],$token),'DISPENSING_UNRESOLVED');
$physical=isolated(array_replace($b,['request_key'=>bin2hex(random_bytes(16))]),$op);$saved=$service->saveDeliveryCheck($t['databaseId'],$physical,$actor);
ok($saved['dispensingStatus']==='failed'&&$saved['amountPaid']===10.0&&!$saved['issueRecovery']['returnRequested'],'Physical zero delivery preserves paid failed result and never reopens');
ok((int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===5,'Zero physical delivery deducts no tablets');
$return=['transaction_code'=>$t['id'],'request_key'=>bin2hex(random_bytes(16)),'expected_revision'=>1,'machine_power_isolated'=>true,'motor_stopped'=>true,'controller_disconnected'=>true];
controller(['pending_events'=>1]);denied(fn()=>$service->reopenAfterDeliveryCheck($t['databaseId'],$return,$actor),'REOPEN_BLOCKED');
ok($service->dispensingIssueDetails($t['databaseId'],$actor)['inspection']['active'],'Pending coins do not clear the inspection pause');
controller();$returned=$service->reopenAfterDeliveryCheck($t['databaseId'],$return,$actor);$service->reopenAfterDeliveryCheck($t['databaseId'],$return,$actor);
ok($returned['issueRecovery']['returnRequested']&&$returned['issueRecovery']['machineReuseReady'],'Separate authenticated reopening succeeds only after safety checks');
ok(!$service->dispensingIssueDetails($t['databaseId'],$actor)['inspection']['active'],'Confirmed reopening releases only its own inspection pause');
clean();$t=failedPurchase(3);$op=prepareInspection($t);$b=isolated(finding($t,'partial',1,4),$op);$r=$service->saveDeliveryCheck($t['databaseId'],$b,$actor);$service->saveDeliveryCheck($t['databaseId'],$b,$actor);
ok($r['dispensedQuantity']===1&&$r['dispensingStatus']==='failed'&&(int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===4,'Partial delivery reconciles only the declared physical unit exactly once');
clean();$t=failedPurchase(2);$op=prepareInspection($t);$b=isolated(finding($t,'dispensed_sensor_missed',2,3),$op);$r=$service->saveDeliveryCheck($t['databaseId'],$b,$actor);
ok($r['dispensingStatus']==='dispensed'&&!$r['issueRecovery']['returnRequested']&&(int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===3,'Full verified reconciliation remains separate from reopening');
clean();$t=failedPurchase();$gateway->active=true;denied(fn()=>prepareInspection($t),'INSPECTION_BLOCKED');$gateway->active=false;
$op=prepareInspection($t);denied(fn()=>$service->saveDeliveryCheck($t['databaseId'],isolated(finding($t,'not_dispensed',0,4),$op),$actor),'PHYSICAL_STOCK_MISMATCH');
ok((int)$db->query('SELECT quantity FROM inventory')->fetchColumn()===5&&$service->dispensingIssueDetails($t['databaseId'],$actor)['inspection']['active'],'Mismatch rolls back stock reconciliation and retains the safety pause');
echo "Separated delivery-check fixtures use temporary tables; live inventory, payments, firmware and journals untouched.\n";
