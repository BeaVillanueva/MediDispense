import TransactionDetailsSummary from "./TransactionDetailsSummary";
import TransactionReceiptSummary from "./TransactionReceiptSummary";
import {useState} from 'react';
import {Printer,X} from 'lucide-react';
import type {Transaction} from '@shared/medidispense';
import {trpc} from '@/lib/trpc';
import {canViewEReceipt} from '@/lib/transactionReceipt';
import './transaction-record.css';

const date=(value:string)=>{const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString([],{dateStyle:'medium',timeStyle:'short'});};
const activityLabels:Record<string,string>={transaction_cancelled:'Purchase cancelled',payment_session_expired:'Payment time ended',dispensing_failed:'Medicine delivery needs checking',dispensing_confirmation_timeout:'Delivery confirmation was not received',admin_dispense_issue_reviewed:'Staff delivery review saved',admin_dispense_recovered:'Staff checked the delivery',dispense_stock_reconciled:'Stock count checked',controller_retired:'Machine controller replaced'};
const label=(value:string)=>activityLabels[value]??value.replaceAll('_',' ');

/** Reuses the original receipt markup and print classes for both record views. */
export function TransactionRecordDialog({transaction,onClose}:{transaction:Transaction;onClose:()=>void}) {
  const record=trpc.transactions.details.useQuery({id:transaction.databaseId??0},{enabled:!!transaction.databaseId});
  const current=record.data?.transaction??transaction;
  const eligible=!!record.data&&!record.error&&canViewEReceipt(current);
  const [printing,setPrinting]=useState(false),[printError,setPrintError]=useState('');
  const quantity=eligible?current.receipt!.deliveredQuantity:current.dispensedQuantity??0;
  return <div className="modal-backdrop receipt-backdrop" onClick={onClose}><div className={`modal-card receipt-card transaction-record ${eligible?'receipt-print-area':'record-purchase-details'}`} role="dialog" aria-modal="true" aria-labelledby="record-title" onClick={e=>e.stopPropagation()}>
    <div className="receipt-heading"><div><div className="panel-kicker">MediDispense</div><h2 id="record-title">{eligible?'E-Receipt':'Transaction Details'}</h2>{eligible&&<p className="receipt-store">Triple J Grocery Store and Pharmacy</p>}</div><button className="icon-button receipt-close" onClick={onClose} aria-label="Close transaction record"><X size={18}/></button></div>
    {record.isPending&&transaction.databaseId&&<p role="status">Loading the latest transaction…</p>}
    {record.error&&<p className="record-error" role="alert">{record.error.message} <button className="secondary-button" onClick={()=>void record.refetch()}>Retry</button></p>}
    {eligible?<TransactionReceiptSummary transaction={current} successful/>:<TransactionDetailsSummary transaction={current}/>}
    {eligible&&current.receipt?.deliveryVerification==='admin_physical'&&<p className="record-verification">Medicine delivery was checked and confirmed by staff.</p>}
    {!eligible&&<section className="record-details"><details className="record-extra"><summary>More details</summary><h3>Saved purchase information</h3><dl><dt>Medicine quantity recorded</dt><dd>{quantity}</dd><dt>Machine count</dt><dd>{current.sensorConfirmedQuantity??'Not recorded'}</dd><dt>Slot</dt><dd>{current.slotNumber??'Not recorded'}</dd></dl>{record.data?.reason&&<p><strong>Original saved note:</strong> {record.data.reason}</p>}
      {current.issueRecovery&&<><h3>Staff review</h3><p>Staff recorded {current.issueRecovery.verifiedQuantity} delivered.<br/>{current.issueRecovery.reviewRequired?'A follow-up check is needed.':'Staff review saved.'}<br/>{current.issueRecovery.obligationStatus==='delivery_verified'?'Medicine delivery was checked.':'Check the saved staff notes for any customer assistance needed.'}</p></>}
      {!current.issueRecovery&&current.adminRecovered&&<><h3>Staff review</h3><p>Staff checked a stopped delivery. Stock count {current.stockReconciled?'checked':'needs checking'}. Medicine delivery still needs checking.</p></>}
      <p className="record-notice">A receipt is available only after payment and medicine delivery are confirmed.</p></details>
      <details className="record-extra"><summary>Activity history</summary>{record.data?.history.length?record.data.history.map(event=><article key={event.id}><strong>{label(event.action)}</strong><small>{date(event.createdAt)}{event.actorId?` · Staff #${event.actorId}`:''}</small><p>{event.description}</p>{Object.entries(event.details).map(([key,value])=><p key={key}><strong>{label(key)}:</strong> {String(value)}</p>)}</article>):<p>{record.isPending&&transaction.databaseId?'Loading activity history…':'No activity history is available for this purchase.'}</p>}</details>
    </section>}
    {printError&&<p className="record-error" role="alert">{printError}</p>}
    <div className="modal-actions receipt-actions">{eligible&&<button className="secondary-button" disabled={printing||record.isFetching} onClick={async()=>{
      setPrinting(true);setPrintError('');
      try{const latest=await record.refetch();if(latest.error||!latest.data||!canViewEReceipt(latest.data.transaction)){setPrintError('Receipt could not be confirmed. Review the latest transaction details before printing.');return;}window.requestAnimationFrame(()=>window.print());}
      catch{setPrintError('The latest receipt could not be loaded. No print request was sent.');}
      finally{setPrinting(false);}
    }}><Printer size={16}/>{printing?'Checking…':'Print Receipt'}</button>}<button className="primary-button" onClick={onClose}>Done</button></div>
    {eligible&&<p className="receipt-save-note receipt-actions">Your browser’s print options may also support saving as PDF.</p>}
  </div></div>;
}
