import type {Transaction} from '@shared/medidispense';
import {canViewEReceipt} from '@/lib/transactionReceipt';

/** Shared receipt/details presentation; eligibility remains backend-evidence based. */
export default function TransactionReceiptSummary({transaction:t,successful}:{transaction:Transaction;successful:boolean}){
  const receipt=successful&&canViewEReceipt(t);
  const money=(n:number)=>{try{return new Intl.NumberFormat('en-PH',{style:'currency',currency:t.currency??'PHP'}).format(n);}catch{return `${t.currency??'PHP'} ${n.toFixed(2)}`;}};
  const date=new Date(t.createdAt);
  const label=(s:string)=>s.replaceAll('_',' ');
  return <>
    <div className="receipt-meta"><span>Transaction / reference</span><strong>{t.id}</strong><span>Date and time</span><strong>{Number.isNaN(date.getTime())?t.createdAt:date.toLocaleString([],{dateStyle:'medium',timeStyle:'short'})}</strong></div>
    <div className="receipt-items"><div className="receipt-row receipt-table-head"><span>Medicine</span><span>{receipt?'Dispensed':'Requested'}</span><span>Unit price</span><span>Total</span></div>{t.items.map((item,index)=><div className="receipt-row" key={`${item.medicineId}-${index}`}><span>{item.medicineName}</span><span>{receipt?t.receipt!.deliveredQuantity:item.quantity}</span><span>{money(item.unitPrice)}</span><strong>{money(item.subtotal)}</strong></div>)}</div>
    <div className="receipt-totals"><div><span>Purchase amount</span><strong>{money(t.total)}</strong></div><div><span>{receipt?'Total amount paid':'Recorded payment'}</span><strong>{money(t.amountPaid)}</strong></div><div><span>Payment method</span><span>{t.receipt?.paymentMethod==='coins'?'Coins':label(t.receipt?.recordedPaymentMethod??'Not recorded')}</span></div><div><span>Payment status</span><strong>{receipt?'Paid':label(t.paymentStatus)}</strong></div><div><span>Dispensing status</span><strong>{receipt?'Completed':label(t.dispensingStatus)}</strong></div></div>
  </>;
}
