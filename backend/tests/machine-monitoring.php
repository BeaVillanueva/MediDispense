<?php
require __DIR__.'/../src/MachineMonitoring.php';
function checkMonitoring(bool $ok,string $label):void{if(!$ok)throw new RuntimeException($label);echo "PASS $label\n";}
$legacy=['connection_status'=>'online','heartbeat_age_seconds'=>99999,'last_payload'=>'{"coin_acceptor_status":"Ready"}','coin_acceptor_status'=>'Ready'];
$new=['device_id'=>'2C8C6AF3AF48','fresh'=>true,'retired'=>false,'ageSeconds'=>2,'reportedAtMs'=>100000,'backend_session_verified'=>true];
$old=array_replace($new,['device_id'=>'20799D470968','fresh'=>false,'ageSeconds'=>9999,'reportedAtMs'=>1]);
$result=MachineMonitoring::project($legacy,[$old,$new]);
checkMonitoring($result['connection_status']==='online'&&$result['controller_device_id']===$new['device_id'],'Fresh authenticated new report overrides stale legacy heartbeat');
checkMonitoring($result['heartbeat_age_seconds']===2,'Uses server diagnostic freshness');
checkMonitoring($result['coin_acceptor_status']==='Unknown'&&$result['motor_status']==='Unknown'&&$result['sensor_status']==='Unknown','Connection does not fabricate component readiness');
checkMonitoring($result['esp32_status']==='Connected','Controller connection is distinguished from hardware readiness');
checkMonitoring(MachineMonitoring::project($legacy,[$old])['connection_status']==='offline','Stale diagnostics remain offline');
checkMonitoring(MachineMonitoring::project($legacy,[$old,$new+[]])['controller_ambiguous']===false,'Historical stale record is not a live-controller ambiguity');
$other=array_replace($old,['fresh'=>true]);$ambiguous=MachineMonitoring::project($legacy,[$other,$new]);
checkMonitoring($ambiguous['controller_ambiguous']&&$ambiguous['connection_status']==='offline'&&$ambiguous['controller_device_id']===null,'Two live controllers require verification');
checkMonitoring(MachineMonitoring::project($legacy,[array_replace($new,['backend_session_verified'=>false])])['connection_status']==='offline','Unverified backend session does not become online');
checkMonitoring(MachineMonitoring::project($legacy,[array_replace($new,['retired'=>true])])['connection_status']==='offline','Retired-only evidence does not establish connection');
checkMonitoring(MachineMonitoring::project($legacy,[])['monitoring_source']==='legacy_heartbeat','Legacy heartbeat preserved where no diagnostics exist');
checkMonitoring($old['fresh']===false&&$legacy['coin_acceptor_status']==='Ready','Projection does not mutate its source history');
