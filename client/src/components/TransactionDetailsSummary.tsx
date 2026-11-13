import {CircleX,Clock,TriangleAlert,Pill,Coins,Package} from 'lucide-react';
import type {Transaction} from '@shared/medidispense';

export function transactionOverview(t:Transaction){
  const paid=t.amountPaid>0;
  if(t.paymentStatus==='cancelled'||t.dispensingStatus==='cancelled')return {title:'Purchase cancelled',tone:'cancelled',icon:CircleX,message:paid?'This purchase was cancelled. A payment is recorded; please ask staff for assistance.':'This purchase was cancelled. No payment is recorded.'};
  if(['failed','timeout'].includes(t.dispensingStatus))return {title:'Medicine delivery needs checking',tone:'warning',icon:TriangleAlert,message:'Please ask staff to check whether the medicine came out.'};
  if(t.dispensingStatus==='dispensing')return {title:'Medicine is being released',tone:'info',icon:Package,message:'The purchase is still in progress. Please wait for confirmation.'};
  if(t.paymentStatus==='pending')return {title:paid?'Payment in progress':'Waiting for payment',tone:'info',icon:Clock,message:paid?'Some payment is recorded. This purchase is not yet complete.':'No payment is recorded yet. This purchase is still open.'};
  return {title:'Purchase needs checking',tone:'warning',icon:TriangleAlert,message:'Please ask staff to check the payment and medicine delivery.'};
}
export default function TransactionDetailsSummary({transaction:t}:{transaction:Transaction}){
  const overview=transactionOverview(t),Icon=overview.icon;
  const money=(n:number)=>{try{return new Intl.NumberFormat('en-PH',{style:'currency',currency:t.currency??'PHP'}).format(n);}catch{return `${t.currency??'PHP'} ${n.toFixed(2)}`;}};
  const requested=t.items.reduce((n,i)=>n+i.quantity,0);
  const delivered=t.issueRecovery?.verifiedQuantity??t.dispensedQuantity;
  const when=new Date(t.createdAt);
  const payment=t.amountPaid===0?'No payment recorded':t.amountPaid>t.total?'Extra payment recorded':t.amountPaid<t.total?'Partly paid':t.paymentStatus==='successful'?'Paid':'Payment needs checking';
  return <div className="purchase-details-summary">
    <section className={`purchase-status purchase-status-${overview.tone}`}><div className="purchase-status-icon"><Icon size={26}/></div><div><h3>{overview.title}</h3><p>{overview.message}</p></div></section>
    <div className="purchase-medicines">{t.items.map((item,index)=><article className="purchase-medicine" key={`${item.medicineId}-${index}`}><div className="purchase-medicine-icon"><Pill size={23}/></div><div><h3>{item.medicineName}</h3><p>{item.quantity} requested × {money(item.unitPrice)}</p></div><strong>{money(item.subtotal)}</strong></article>)}</div>
    <div className="purchase-facts"><section><div className="purchase-fact-label"><Coins size={19}/>Payment recorded</div><strong>{money(t.amountPaid)}</strong><span>{payment}</span></section><section><div className="purchase-fact-label"><Package size={19}/>Delivery recorded</div><strong>{delivered==null?'Not confirmed':`${delivered} of ${requested}`}</strong><span>{delivered==null?'Please ask staff to check':delivered===0?'No delivery recorded':'Recorded medicine quantity'}</span></section></div>
    <dl className="purchase-reference"><div><dt>Purchase total</dt><dd>{money(t.total)}</dd></div><div><dt>Reference number</dt><dd>{t.id}</dd></div><div><dt>Date &amp; time</dt><dd>{Number.isNaN(when.getTime())?t.createdAt:when.toLocaleString([],{dateStyle:'medium',timeStyle:'short'})}</dd></div></dl>
  </div>;
}
