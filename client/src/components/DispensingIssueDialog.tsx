import { Package, ScanLine, Boxes, Pill, Coins } from "lucide-react";
import {peso} from "@/lib/kioskPurchase";
import {recoveryBlockerText,recoveryErrorText,recoveryOutcomeText,recoveryWarningText} from "@/lib/recoveryPresentation";
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Transaction } from '@shared/medidispense';
import { trpc } from '@/lib/trpc';
import { recoveryRequestKey, recoveryFormErrors, recoveryFormSignature, type RecoveryForm } from '@/lib/dispenseIssue';
import './dispensing-issue.css';

export function DispensingIssueDialog({ transaction, onClose, onChanged }: {transaction:Transaction;onClose:()=>void;onChanged:()=>void}) {
  const details=trpc.transactions.issueDetails.useQuery({id:transaction.databaseId!},{refetchInterval:5000});
  const current=details.data?.transaction??transaction;
  const prior=current.issueRecovery;
  const requested=current.requestedQuantity??current.items[0]?.quantity??0;
  const sensor=current.sensorConfirmedQuantity??current.dispensedQuantity??0;
  const [form,setForm]=useState<RecoveryForm>({outcome:'',quantity:'',stock:'',notes:'',obligation:'pending',reference:'',complete:false,inspected:false,stopped:false,disconnected:false});
  const [key,setKey]=useState(recoveryRequestKey);
  const [formRevision,setFormRevision]=useState(transaction.issueRecovery?.revision??0);
  const [savedSignature,setSavedSignature]=useState<string|null>(null);
  const [status,setStatus]=useState('');
  const [refreshFailed,setRefreshFailed]=useState(false);
  const [returnConfirmed,setReturnConfirmed]=useState(false);
  const lock=useRef(false);
  const submission=useRef<{signature:string;input:unknown}|null>(null);
  const signature=recoveryFormSignature(form);
  const update=(change:Partial<RecoveryForm>)=>{setForm(f=>({...f,...change}));setStatus('');setReturnConfirmed(false);};
  const mutation=trpc.transactions.resolveIssue.useMutation({
    onSuccess:async(result,input)=>{
      setSavedSignature(submission.current?.signature??null);
      setFormRevision(result.issueRecovery?.revision??input.expectedRevision+1);
      setKey(recoveryRequestKey());submission.current=null;
      const returned=input.returnToKiosk&&result.issueRecovery?.returnRequested===true&&result.issueRecovery.machineReuseReady;
      setReturnConfirmed(!!returned);
      setStatus(returned?'Check complete. The connected kiosk will return to Choose Medicine.':'Check saved. The kiosk status has been updated.');
      const refreshed=await details.refetch();setRefreshFailed(!!refreshed.error);
      if(refreshed.error)setStatus('Check saved, but the kiosk status could not be refreshed. Please check again.');
      onChanged();toast.success(returned?'Check complete. Kiosk reopening confirmed.':'Check saved.');
    },
    onSettled:()=>{lock.current=false;},
  });
  const localErrors=recoveryFormErrors(form,sensor,prior?.verifiedQuantity??sensor,requested);
  const revisionChanged=formRevision!==(prior?.revision??0);
  const loading=!details.data;
  const canSave=!loading&&!details.error&&!mutation.isPending&&!revisionChanged&&!localErrors.length;
  const dirty=savedSignature!==signature;
  const serverBlockers=details.data?.returnEligibility?.blockers.map(b=>recoveryBlockerText(b.code))??['The kiosk still needs checking.'];
  const returnReasons=loading?['Checking the latest purchase details...']:details.error||refreshFailed?['The kiosk status could not be checked. Please try again.']:mutation.error?[recoveryErrorText(mutation.error.message)]:revisionChanged?['This check was updated. Load the saved check before continuing.']:localErrors.length?localErrors:!prior||dirty?['Save this check first.']:!details.data?.returnEligibility?.ready?serverBlockers:form.stock!==''&&Number(form.stock)!==details.data.recordedStock?['The stock record changed. Count the remaining tablets again and save.']:[];
  const canReturn=canSave&&!returnReasons.length&&!returnConfirmed;
  const external=form.outcome!=='dispensed_sensor_missed'&&form.obligation!=='pending';
  const saved=details.data?.history[0];
  const reload=async()=>{if(lock.current)return;const r=await details.refetch();setRefreshFailed(!!r.error);if(!r.error)mutation.reset();};
  return <div className="modal-backdrop issue-backdrop"><form className="modal-card dispense-issue-modal" role="dialog" aria-modal="true" aria-labelledby="issue-title" onSubmit={event=>{
    event.preventDefault();const returning=(event.nativeEvent as SubmitEvent).submitter?.getAttribute('data-return')==='true';
    if(lock.current||!canSave||!form.outcome||returning&&!canReturn)return;
    const input={id:current.databaseId!,transactionCode:current.id,requestKey:key,expectedRevision:formRevision,outcome:form.outcome,verifiedQuantity:Number(form.quantity),physicallyInspected:true as const,motorStopped:true as const,controllerDisconnected:true as const,inspectionComplete:form.outcome==='partial'?form.complete:true,physicalStock:form.stock===''?undefined:Number(form.stock),obligationStatus:form.outcome==='dispensed_sensor_missed'?'delivery_verified' as const:form.obligation,obligationReference:external?form.reference:'',notes:form.notes,returnToKiosk:returning};
    // Retain the exact unchanged submission for idempotent retries after a lost response.
    const previous=submission.current;
    const payload=previous?.signature===signature?previous.input as typeof input:input;
    const intent={...payload,returnToKiosk:returning};
    submission.current={signature,input:intent};lock.current=true;setStatus('');mutation.mutate(intent);
  }}>
    <header className="issue-header">
      <div className="issue-heading"><div className="issue-heading-icon"><Pill size={26}/></div><div><h2 id="issue-title">Check Medicine Delivery</h2><p><strong>{current.items.map(i=>i.medicineName).join(', ')}</strong><span>Slot {current.slotNumber}</span></p><small className="issue-reference">{current.id}</small></div></div>
      <div className="issue-status"><span><Coins size={16}/> Payment recorded</span><b>{peso(current.amountPaid)}</b><strong>{current.dispensingStatus==='dispensed'?'Delivery recorded':current.dispensingStatus==='dispensing'?'In progress':'Needs checking'}</strong></div>
    </header>
    <div className="issue-body">
      <div className="issue-stats"><div><Package size={21}/><span>Tablets ordered</span><strong>{requested}</strong></div><div><ScanLine size={21}/><span>Machine counted</span><strong>{sensor}</strong></div><div><Boxes size={21}/><span>Stock on record</span><strong>{details.data?.recordedStock??'Not available'}</strong></div></div>
      {details.error&&<p className="issue-error" role="alert">{recoveryErrorText(details.error.message)}</p>}
      <fieldset className="issue-columns" disabled={mutation.isPending||loading||!!details.error}>
        <section className="issue-section"><h3 className="issue-step-heading"><span>1</span>Check the delivery</h3>
          <label htmlFor="issue-outcome">What came out?<select id="issue-outcome" required value={form.outcome} onChange={e=>update({outcome:e.target.value as RecoveryForm['outcome']})}><option value="">Choose what you found</option><option value="dispensed_sensor_missed">All tablets came out</option><option value="not_dispensed">No tablets came out</option><option value="partial">Only some tablets came out</option></select></label>
          <div className="issue-input-pair"><label htmlFor="issue-quantity">Tablets that came out<input id="issue-quantity" required inputMode="numeric" pattern="[0-3]" placeholder="Enter total" value={form.quantity} onChange={e=>{if(/^[0-3]?$/.test(e.target.value))update({quantity:e.target.value});}}/></label><label htmlFor="issue-stock">Tablets left in the slot<input id="issue-stock" inputMode="numeric" pattern="[0-9]|10" placeholder="Count 0 to 10" value={form.stock} onChange={e=>{if(/^\d{0,2}$/.test(e.target.value))update({stock:e.target.value});}}/></label></div>
          <small>Enter the total for this purchase, including tablets already counted. Count the remaining stock before reopening.</small>
          {form.outcome==='partial'&&<label className="issue-check"><input id="issue-complete" type="checkbox" checked={form.complete} onChange={e=>update({complete:e.target.checked})}/>I finished checking. The missing tablets did not come out.</label>}
          {form.outcome&&form.outcome!=='dispensed_sensor_missed'&&<><label htmlFor="issue-obligation">Does the customer still need help?<select id="issue-obligation" value={form.obligation} onChange={e=>update({obligation:e.target.value as RecoveryForm['obligation']})}><option value="pending">Still needs a refund or replacement</option><option value="refund_documented">Refund already given</option><option value="replacement_documented">Replacement already provided</option></select></label>{external&&<label htmlFor="issue-reference">Proof or reference<input id="issue-reference" required minLength={5} maxLength={200} value={form.reference} onChange={e=>update({reference:e.target.value})}/><small>Record the refund or replacement handled separately.</small></label>}</>}
          <label htmlFor="issue-notes">What did you check?<textarea id="issue-notes" required minLength={5} maxLength={1000} placeholder="Briefly describe what you found." value={form.notes} onChange={e=>update({notes:e.target.value})}/></label>
        </section>
        <section className="issue-section issue-review"><h3 className="issue-step-heading"><span>2</span>Confirm the safety checks</h3>
          <dl><dt>Your delivery count</dt><dd>{form.quantity||'Not entered'}</dd><dt>Already recorded</dt><dd>{prior?.verifiedQuantity??sensor}</dd><dt>Saved check</dt><dd>{prior?'Available':'Not saved'}</dd></dl>
          {saved&&<button type="button" className="secondary-button" onClick={()=>{
            const values:RecoveryForm={...form,outcome:saved.outcome as RecoveryForm['outcome'],quantity:String(saved.verifiedQuantity),stock:saved.physicalStock==null?'':String(saved.physicalStock),notes:saved.notes,obligation:saved.obligationStatus==='refund_documented'?'refund_documented':saved.obligationStatus==='replacement_documented'?'replacement_documented':'pending',reference:saved.obligationReference,complete:saved.inspectionComplete??false,inspected:false,stopped:false,disconnected:false};
            setForm(values);setFormRevision(saved.revision);setSavedSignature(recoveryFormSignature(values));setKey(recoveryRequestKey());submission.current=null;setReturnConfirmed(false);setStatus('Saved check loaded. Confirm it still matches what you found.');
          }}>Use saved check</button>}
          <div className="issue-check-progress">{[form.inspected,form.stopped,form.disconnected].filter(Boolean).length} of 3 safety checks confirmed</div>
          <label className="issue-check"><input id="issue-inspected" type="checkbox" checked={form.inspected} onChange={e=>update({inspected:e.target.checked})}/>I checked the machine and the medicine in person.</label>
          <label className="issue-check"><input id="issue-stopped" type="checkbox" checked={form.stopped} onChange={e=>update({stopped:e.target.checked})}/>All moving parts have stopped.</label>
          <label className="issue-check"><input id="issue-disconnected" type="checkbox" checked={form.disconnected} onChange={e=>update({disconnected:e.target.checked})}/>The control board is switched off or disconnected.</label>
          <small>Keep it disconnected until the safety check is complete. This form does not release tablets or send refunds.</small>
          {!!details.data?.returnEligibility?.warnings?.length&&<aside className="issue-follow-up" aria-label="Customer follow-up"><strong>Customer follow-up</strong>{details.data.returnEligibility.warnings.map(w=><p key={w.code}>{recoveryWarningText(w.code)}</p>)}</aside>}
        </section>
      </fieldset>
      {!!details.data?.history.length&&<details className="issue-history"><summary>Saved checks ({details.data.history.length})</summary>{details.data.history.map(h=><article key={h.revision}><strong>Check {h.revision}: {recoveryOutcomeText(h.outcome)}</strong><p>{h.createdAt}<br/>Tablets delivered: {h.verifiedQuantity}. Machine counted: {h.sensorConfirmedQuantity}.<br/>{h.notes}</p><details><summary>Original saved details</summary><pre>{JSON.stringify(h,null,2)}</pre></details></article>)}</details>}
      {(details.error||mutation.error||!!details.data?.returnEligibility?.blockers.length)&&<details className="issue-history"><summary>Details for further assistance</summary><p>{details.error?.message??mutation.error?.message}</p>{details.data?.returnEligibility?.blockers.map(b=><p key={b.code}>{b.message}</p>)}</details>}
    </div>
    <footer className="issue-footer">
      {status&&<p className="issue-success" role="status">{status}</p>}
      {mutation.error&&<p className="issue-error" role="alert">{recoveryErrorText(mutation.error.message)}</p>}
      <div className="issue-footer-state"><p id="issue-return-reason">{returnConfirmed?'Check complete. The kiosk can return to Choose Medicine.':mutation.isPending?'Saving and checking…':returnReasons[0]??'Ready to reopen. The system will check safety again before continuing.'}</p><button type="button" className="issue-refresh" disabled={mutation.isPending} onClick={()=>void reload()}>Check again</button></div>
      <div className="issue-actions"><button type="button" className="secondary-button" disabled={mutation.isPending} onClick={onClose}>Close</button><button type="submit" className="secondary-button" disabled={!canSave||mutation.isPending}>Save Check</button><button type="submit" data-return="true" className="primary-button" aria-describedby="issue-return-reason" disabled={!canReturn||mutation.isPending}>Reopen Kiosk</button></div>
    </footer>
  </form></div>;
}
