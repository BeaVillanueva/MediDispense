<?php
declare(strict_types=1);
require __DIR__.'/../src/FirebaseRealtimeDatabase.php';
$records=[];$writes=0;$races=0;$checks=0;
$transport=static function($method,$path,$data,$headers)use(&$records,&$writes,&$races):array {
    if($method==='GET')return ['status'=>200,'etag'=>'"test-version"','data'=>$records[$path]??null];
    if($races>0){$races--; $records[$path]['status']='updated-concurrently';return ['status'=>412,'data'=>null];}
    $writes++;$records[$path]=$data;return ['status'=>200,'data'=>$data];
};
$firebase=new FirebaseRealtimeDatabase('https://unused.invalid',$transport);
function refCheck(bool $ok,string $message):void{global $checks;if(!$ok)throw new RuntimeException($message);$checks++;echo "PASS $message\n";}
$ref='TXN-ABCDEF123456789012345678';
$firebase->syncTransactionReference('payments',121,$ref);
refCheck($records['/transaction_tracking/payments/121']===['transaction_id'=>121,'transaction_reference'=>$ref],'Payment identity uses original numeric ID and reference');
$before=$writes;$firebase->syncTransactionReference('payments',121,$ref);
refCheck($writes===$before,'Repeat sync produces no duplicate or unnecessary write');
$firebase->syncTransactionReference('dispensing',121,$ref,61);
refCheck($records['/transaction_tracking/dispensing/61']['request_id']===61&&$records['/transaction_tracking/dispensing/61']['transaction_id']===121,'Dispense metadata binds request and transaction');
$records['/transaction_tracking/payments/122']=['status'=>'successful','amount_paid'=>20,'timestamp'=>123,'transaction_id'=>122];
$firebase->syncTransactionReference('payments',122,$ref);
refCheck($records['/transaction_tracking/payments/122']['amount_paid']===20&&$records['/transaction_tracking/payments/122']['status']==='successful'&&$records['/transaction_tracking/payments/122']['timestamp']===123,'Existing values and timestamps preserved');
$before=$records;
try{$firebase->syncTransactionReference('payments',121,'TXN-CONFLICT12345678');throw new LogicException('Conflict accepted');}catch(RuntimeException $e){refCheck($e->getMessage()==='REFERENCE_IDENTITY_CONFLICT'&&$before===$records,'Conflicting reference is reported without overwrite');}
try{$firebase->syncTransactionReference('dispensing',999,$ref,61);throw new LogicException('Wrong relationship accepted');}catch(RuntimeException $e){refCheck($e->getMessage()==='REFERENCE_IDENTITY_CONFLICT','Mismatched request relationship rejected');}
try{$firebase->syncTransactionReference('payments',121,'');throw new LogicException('Missing reference accepted');}catch(InvalidArgumentException $e){refCheck(true,'Missing identity is never generated or guessed');}
$records['/transaction_tracking/payments/123']=['status'=>'old'];$races=1;
$firebase->syncTransactionReference('payments',123,$ref);
refCheck($records['/transaction_tracking/payments/123']['status']==='updated-concurrently','ETag retry preserves concurrent non-identity updates');
$command=$firebase->sendReferencedDispenseCommand(61,2,1,121,$ref);
refCheck($command['request_id']===61&&$command['transaction_id']===121&&$command['transaction_reference']===$ref,'New command carries correct identifiers');
refCheck($command['slot']===2&&$command['quantity']===1&&$command['status']==='pending'&&$command['dispensed']===0,'Required firmware command fields unchanged');
$records['/dispense']['status']='success';$records['/dispense']['dispensed']=1;
$before=$writes;$repeat=$firebase->sendReferencedDispenseCommand(61,2,1,121,$ref);
refCheck($writes===$before&&$repeat['status']==='success'&&$repeat['dispensed']===1,'Repeated command identity never resets dispensing results');
try{$firebase->sendReferencedDispenseCommand(61,2,1,999,$ref);throw new LogicException('Command conflict accepted');}catch(RuntimeException $e){refCheck($e->getMessage()==='REFERENCE_IDENTITY_CONFLICT','Command reference mismatch cannot silently overwrite identity');}
$legacy=$firebase->sendDispenseCommand(62,1,2);
refCheck(!isset($legacy['transaction_reference'])&&$legacy['request_id']===62,'Legacy gateway interface remains compatible');
echo "$checks reference transport checks passed; no network or live Firebase used.\n";
