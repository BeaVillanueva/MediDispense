import type {Transaction} from '@shared/medidispense';

export function canViewEReceipt(t:Transaction):boolean {
  const evidence=t.receipt;
  if(!evidence?.eligible||!evidence.paymentFinalized||evidence.paymentMethod!=='coins'||!['sensor','admin_physical'].includes(evidence.deliveryVerification??''))return false;
  const requested=t.items.reduce((sum,item)=>sum+item.quantity,0);
  if(t.items.length!==1||t.adminRecovered&&!t.issueRecovery)return false;
  if(t.paymentStatus!=='successful'||t.dispensingStatus!=='dispensed'||requested<1||evidence.deliveredQuantity!==requested||t.dispensedQuantity!==requested||Math.round(t.amountPaid*100)!==Math.round(t.total*100))return false;
  if(t.issueRecovery&&(evidence.deliveryVerification!=='admin_physical'||t.issueRecovery.reviewRequired||!t.issueRecovery.inspectionComplete||!t.issueRecovery.stockVerified||t.issueRecovery.obligationStatus!=='delivery_verified'))return false;
  return true;
}
export function receiptUnavailableReason(t:Transaction):string {
  const reasons:Record<string,string>={PAYMENT_NOT_FINALIZED:'Payment is not finalized or requires reconciliation.',PAYMENT_METHOD_UNVERIFIED:'The recorded payment method is not verified.',CURRENCY_UNSUPPORTED:'The payment currency requires review.',ITEM_TOTAL_UNVERIFIED:'Recorded item totals require verification.',DISPENSING_NOT_COMPLETED:'Dispensing has not completed successfully.',DELIVERY_NOT_VERIFIED:'The successfully delivered quantity has not been fully verified.',RECOVERY_NOT_FINALIZED:'Physical recovery or customer fulfillment still requires review.'};
  return (t.receipt?.blockers??[]).map(code=>reasons[code]??'Transaction evidence requires review.').join(' ')||'A successful purchase receipt requires finalized payment and verified delivery.';
}
