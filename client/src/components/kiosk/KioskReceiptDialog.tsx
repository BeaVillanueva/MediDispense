import type {Transaction} from '@shared/medidispense';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import TransactionReceiptSummary from '@/components/TransactionReceiptSummary';
import {canViewEReceipt} from '@/lib/transactionReceipt';
import '@/components/transaction-record.css';
import './kiosk-receipt.css';

export function KioskReceiptDialog({transaction,open,seconds,held,onClose}:{transaction:Transaction;open:boolean;seconds:number;held:boolean;onClose:()=>void}){
  if(!canViewEReceipt(transaction))return null;
  return <Dialog open={open} onOpenChange={value=>{if(!value)onClose();}}><DialogContent className="kv-receipt-dialog transaction-record receipt-card" style={{width:'min(620px, calc(100vw - 32px))',maxWidth:620,maxHeight:'85dvh',overflowY:'auto'}} onPointerDownOutside={event=>event.preventDefault()}>
    <div className="kv-receipt-brand">MediDispense</div><DialogTitle className="kv-receipt-title">E-Receipt</DialogTitle>
    <DialogDescription>Triple J Grocery Store and Pharmacy</DialogDescription>
    <TransactionReceiptSummary transaction={transaction} successful/>
    <p className="kv-receipt-idle" role="status">{held?'Take your time. Select Done when finished.':`Closes in ${seconds} seconds. Touch anywhere to keep it open.`}</p>
    <button className="kv-button kv-primary kv-wide" onClick={onClose}>Done</button>
  </DialogContent></Dialog>;
}
