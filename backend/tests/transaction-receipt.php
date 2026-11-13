<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli')exit;
require __DIR__.'/../src/TransactionReceipt.php';
function receiptCheck(bool $ok,string $message):void{if(!$ok)throw new RuntimeException($message);echo "PASS $message\n";}
$t=['id'=>1,'payment_status'=>'successful','dispensing_status'=>'dispensed','currency'=>'PHP','total_amount'=>'10.00','amount_paid'=>'10.00'];
$p=['status'=>'successful','verified_at'=>'2026-11-13 10:00:00','payment_method'=>'coin_acceptor','amount_due'=>'10.00','amount_inserted'=>'10.00'];
$r=['id'=>5,'transaction_id'=>1,'request_status'=>'success','completed_at'=>'2026-11-13 10:01:00','quantity'=>2,'dispensed_quantity'=>2];
$items=[['quantity'=>2,'unitPrice'=>5.0,'subtotal'=>10.0]];
$evaluate=fn($tx=null,$pay=null,$req=null,$review=null,$legacy=false)=>TransactionReceipt::evaluate($tx??$t,$pay??$p,$req??$r,$items,$review,$legacy);
receiptCheck($evaluate()['eligible']&&$evaluate()['deliveryVerification']==='sensor','Paid and fully sensor-confirmed purchase has an E-Receipt');
foreach(['cancelled','failed','pending'] as $status)receiptCheck(!$evaluate(array_replace($t,['payment_status'=>$status]))['eligible'],'No successful receipt for payment '.$status);
foreach(['cancelled','failed','pending','dispensing','timeout'] as $status)receiptCheck(!$evaluate(array_replace($t,['dispensing_status'=>$status]))['eligible'],'No successful receipt for dispensing '.$status);
receiptCheck(!$evaluate($t,array_replace($p,['verified_at'=>null]))['eligible'],'Paid status alone does not replace payment verification');
receiptCheck(!$evaluate($t,array_replace($p,['amount_inserted'=>'5.00']))['eligible'],'Mismatched payment ledger cannot produce a successful receipt');
receiptCheck(!$evaluate(array_replace($t,['amount_paid'=>'15.00']),array_replace($p,['amount_inserted'=>'15.00']))['eligible'],'Excess payment requires reconciliation rather than an exact-payment receipt');
receiptCheck(!$evaluate($t,$p,array_replace($r,['dispensed_quantity'=>1]))['eligible'],'Requested quantity cannot replace actual delivery proof');
receiptCheck(!$evaluate($t,$p,array_replace($r,['transaction_id'=>2]))['eligible'],'A different transaction request cannot authorize a receipt');
$review=['transaction_id'=>1,'request_id'=>5,'outcome'=>'dispensed_sensor_missed','verifiedQuantity'=>2,'inspectionComplete'=>true,'stockVerified'=>true,'reviewRequired'=>false,'obligationStatus'=>'delivery_verified','confirmationSource'=>'authenticated_admin_physical_inspection','adminId'=>1];
$missed=array_replace($r,['dispensed_quantity'=>0]);
receiptCheck($evaluate($t,$p,$missed,$review)['eligible']&&$evaluate($t,$p,$missed,$review)['deliveryVerification']==='admin_physical','Final verified physical recovery can receive a receipt without fabricating IR evidence');
foreach([['reviewRequired'=>true],['stockVerified'=>false],['obligationStatus'=>'pending'],['verifiedQuantity'=>1],['request_id'=>99],['adminId'=>0]] as $change)receiptCheck(!$evaluate($t,$p,$missed,array_replace($review,$change))['eligible'],'Incomplete or mismatched recovered delivery remains details-only');
receiptCheck(!$evaluate($t,$p,$r,null,true)['eligible'],'Legacy recovery marker alone is not a finalized physical delivery');
receiptCheck(!TransactionReceipt::evaluate($t,$p,$r,[['quantity'=>2,'unitPrice'=>4,'subtotal'=>8]],null)['eligible'],'Unverified item totals remain details-only');
echo "Receipt policy fixtures are pure data: no database writes or hardware calls.\n";
