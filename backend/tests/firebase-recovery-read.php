<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../src/FirebaseRealtimeDatabase.php';
$cases=[
 ['retired',200,['request_id'=>45,'status'=>'failed'],['request_id'=>45,'status'=>'failed','source'=>'admin_recovery']],
 ['active',200,['request_id'=>99,'status'=>'pending'],null],
 ['active',200,['request_id'=>99,'status'=>'dispensing'],null],
 ['retired',200,['request_id'=>99,'status'=>'success'],['request_id'=>45,'status'=>'failed','source'=>'admin_recovery']],
 ['retired',200,null,['request_id'=>45,'status'=>'failed','source'=>'admin_recovery']],
 ['unverified',200,'invalid command',null],
 ['unverified',200,['request_id'=>45,'status'=>'failed'],null],
 ['unverified',403,null,null],
 ['unverified',200,null,['request_id'=>99,'status'=>'failed','source'=>'admin_recovery']],
 ['unverified',200,null,['request_id'=>45,'status'=>'success','source'=>'hardware']],
];
$count=0;
foreach($cases as [$expected,$status,$command,$receipt]) {
 $methods=[];
 $transport=static function(string $method,string $path,?array $body,array $headers)use(&$methods,$status,$command,$receipt):array{
  $methods[]=$method;if($method!=='GET'||$body!==null)throw new RuntimeException('Read-only inspection attempted a mutation');
  return ['status'=>$status,'etag'=>null,'data'=>$path==='/dispense'?$command:$receipt];
 };
 $gateway=new FirebaseRealtimeDatabase('https://fixture.invalid',$transport);
 if($gateway->recoveryRetirementState(45)!==$expected)throw new RuntimeException('Unexpected retirement inspection result');
 if(array_filter($methods,fn($m)=>$m!=='GET'))throw new RuntimeException('Unexpected Firebase write');
 $count++;echo "PASS Read-only retirement state $count: $expected\n";
}
echo "Read-only Firebase fixtures use in-memory transports, never the configured database.\n";
foreach([[null,'idle'],[['status'=>'success'],'idle'],[['status'=>'failed'],'idle'],[['status'=>'pending'],'active'],[['status'=>'dispensing'],'active'],[['status'=>'unknown'],'unverified'],['invalid','unverified']] as [$command,$expected]){
 $gateway=new FirebaseRealtimeDatabase('https://fixture.invalid',static function($method,$path,$body,$headers)use($command){if($method!=='GET'||$path!=='/dispense'||$body!==null)throw new RuntimeException('Mutation attempted');return ['status'=>200,'etag'=>null,'data'=>$command];});
 if($gateway->controllerReplacementState()!==$expected)throw new RuntimeException('Replacement command guard failed');echo "PASS Replacement read-only Firebase state: $expected\n";
}
