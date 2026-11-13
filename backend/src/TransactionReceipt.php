<?php
declare(strict_types=1);

/** Read-only evidence policy. Never changes a transaction to make a receipt available. */
final class TransactionReceipt {
    private static function cents(mixed $v): ?int {
        return is_numeric($v)&&is_finite((float)$v)&&(float)$v>=0?(int)round((float)$v*100):null;
    }
    public static function evaluate(array $t,?array $payment,?array $request,array $items,?array $review,bool $legacyRecovery=false): array {
        $reasons=[];$total=self::cents($t['total_amount']??null);$paid=self::cents($t['amount_paid']??null);
        $finalPayment=($t['payment_status']??'')==='successful' && $payment && ($payment['status']??'')==='successful' && !empty($payment['verified_at']) && $total!==null && $total>0 && $paid===$total && self::cents($payment['amount_inserted']??null)===$paid && self::cents($payment['amount_due']??null)===$total;
        if(!$finalPayment)$reasons[]='PAYMENT_NOT_FINALIZED';
        $coins=$payment&&($payment['payment_method']??'')==='coin_acceptor';
        if(!$coins)$reasons[]='PAYMENT_METHOD_UNVERIFIED';
        if(($t['currency']??'PHP')!=='PHP')$reasons[]='CURRENCY_UNSUPPORTED';
        if(($t['dispensing_status']??'')!=='dispensed')$reasons[]='DISPENSING_NOT_COMPLETED';
        $requested=array_sum(array_map(fn($i)=>(int)$i['quantity'],$items));
        $lineTotal=0;
        foreach($items as $line){$subtotal=self::cents($line['subtotal']??null);$unit=self::cents($line['unitPrice']??null);if($subtotal===null||$unit===null||$unit*(int)$line['quantity']!==$subtotal)$reasons[]='ITEM_TOTAL_UNVERIFIED';$lineTotal+=$subtotal??0;}
        if($lineTotal!==$total)$reasons[]='ITEM_TOTAL_UNVERIFIED';
        $delivered=$review?(int)($review['verifiedQuantity']??0):(int)($request['dispensed_quantity']??0);
        $proof=null;
        if(!$request || (int)($request['transaction_id']??0)!==(int)$t['id'] || ($request['request_status']??'')!=='success' || empty($request['completed_at']) || (int)$request['quantity']!==$requested || count($items)!==1 || $requested<1 || $delivered!==$requested)$reasons[]='DELIVERY_NOT_VERIFIED';
        elseif($review){
            if((int)($review['request_id']??0)===(int)$request['id'] && (int)($review['transaction_id']??0)===(int)$t['id'] && ($review['outcome']??'')==='dispensed_sensor_missed' && ($review['inspectionComplete']??false)===true && ($review['stockVerified']??false)===true && ($review['reviewRequired']??true)===false && ($review['obligationStatus']??'')==='delivery_verified' && ($review['confirmationSource']??'')==='authenticated_admin_physical_inspection' && (int)($review['adminId']??0)>0)$proof='admin_physical';
            else $reasons[]='RECOVERY_NOT_FINALIZED';
        }elseif($legacyRecovery)$reasons[]='RECOVERY_NOT_FINALIZED';
        else $proof='sensor';
        return ['eligible'=>!$reasons,'blockers'=>array_values(array_unique($reasons)),'paymentFinalized'=>(bool)$finalPayment,'paymentMethod'=>$coins?'coins':null,'recordedPaymentMethod'=>$payment['payment_method']??null,'deliveredQuantity'=>$delivered,'deliveryVerification'=>$proof];
    }
}
