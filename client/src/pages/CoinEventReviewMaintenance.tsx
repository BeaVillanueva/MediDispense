import { useRef, useState } from 'react';
import { useFirebaseAuth } from '@/contexts/FirebaseAuthContext';
import { trpc } from '@/lib/trpc';
import { recoveryRequestKey } from '@/lib/dispenseIssue';

export default function CoinEventReviewMaintenance(){
  const auth=useFirebaseAuth();
  if(auth.profile?.role_code!=='super_admin')return <main className="page-content"><h1>Super Admin access required</h1><a href="/">Back to dashboard</a></main>;
  return <CoinReviewForm/>;
}
function CoinReviewForm(){
  const status=trpc.coinReviews.status.useQuery(undefined,{refetchInterval:5000});
  const authorize=trpc.coinReviews.authorize.useMutation();
  const [key]=useState(recoveryRequestKey);const lock=useRef(false);const submission=useRef<Parameters<typeof authorize.mutateAsync>[0]|null>(null);
  const [event,setEvent]=useState(''),[original,setOriginal]=useState(''),[total,setTotal]=useState(''),[notes,setNotes]=useState('');
  const [checks,setChecks]=useState<Record<string,boolean>>({});const [decision,setDecision]=useState('');const [error,setError]=useState('');
  const a=status.data?.attestation;const p=a?.payload;
  const valid=!!a&&!!p&&a.age_seconds<=30&&event===p.event_id&&!!original&&original!==event&&/^[1-9][0-9]*$/.test(total)&&notes.trim().length>=20&&['identity','isolated','stopped','path','payment'].every(k=>checks[k]);
  return <main className="page-stack machine-monitoring" style={{maxWidth:900,margin:'32px auto',padding:20}}>
    <a href="/">Back to dashboard</a><h1>Coin Event Review</h1>
    <p>Review one retained event without adding payment. Keep motor and coin-acceptor power isolated. This does not reopen the kiosk or clear other faults.</p>
    <button className="secondary-button" disabled={status.isFetching} onClick={()=>void status.refetch()}>Refresh evidence</button>
    {status.isPending&&<p role="status">Loading review evidence...</p>}
    {status.error&&<p role="alert">{status.error.message}</p>}
    {status.data&&!status.data.enabled&&<section className="panel" style={{padding:24}}><h2>Review workflow is not enabled</h2><p>Migration, a unique controller review key, and separately approved firmware upload are required. No event has been changed.</p></section>}
    {status.data?.enabled&&<section className="panel" style={{padding:24}}>
      <h2>Signed controller evidence</h2>
      {!a?<p>With power safely isolated, send REVIEW COIN STATUS from the approved controller firmware. Do not reset its journal.</p>:<><p>Controller: <strong>{a.device_id}</strong> · Transaction #{p!.transaction_id}</p><p style={{overflowWrap:'anywhere'}}>Event: <strong>{p!.event_id}</strong></p><p>{p!.pulses} pulses / ₱{p!.amount} interpretation · {p!.count} pending · Report age: {a.age_seconds}s</p></>}
      <form onSubmit={async e=>{e.preventDefault();if(lock.current||(!valid&&!submission.current)||!a||decision)return;if(submission.current&&(event!==submission.current.event_id||original!==submission.current.original_payment_event_id||Number(total)!==submission.current.verified_total||notes.trim()!==submission.current.notes||!["identity","isolated","stopped","path","payment"].every(k=>checks[k]))){setError("The previous request may already be saved. Refresh review history before changing its decision.");return;}lock.current=true;setError('');try{const payload=submission.current??{request_key:key,device_id:a.device_id,attestation_nonce:a.nonce,event_id:event,original_payment_event_id:original,verified_total:Number(total),notes:notes.trim(),machine_isolated:true,motors_stopped:true,coin_path_checked:true,no_additional_payment_confirmed:true};submission.current=payload;const result=await authorize.mutateAsync(payload);if(!result.authorized)throw new Error("Authorization was not confirmed.");setDecision(result.id);await status.refetch();}catch(e){setError(e instanceof Error?e.message:'Review was not confirmed.');}finally{lock.current=false;}}}>
        <fieldset disabled={authorize.isPending||!!decision} style={{border:0,padding:0}}><div className="form-grid">
          <label className="span-2">Type the full retained event ID<input value={event} onChange={e=>setEvent(e.target.value)} required maxLength={100}/></label>
          <label className="span-2">Original already-recorded payment event ID<input value={original} onChange={e=>setOriginal(e.target.value)} required maxLength={100}/></label>
          <label>Total physically accepted payment (pesos)<input inputMode="numeric" value={total} onChange={e=>setTotal(e.target.value)} required/></label>
          <label className="span-2">Evidence and review notes<textarea value={notes} onChange={e=>setNotes(e.target.value)} required minLength={20} maxLength={1000}/></label>
        </div>
        {Object.entries({identity:'I physically verified the installed controller ID.',isolated:'Motor and coin-acceptor power remain isolated.',stopped:'All motors are stopped.',path:'I checked the coin path and original payment evidence.',payment:'This event does not represent an additional accepted payment; the pulse cause remains unconfirmed.'}).map(([k,label])=><label key={k} style={{display:'flex',gap:10,margin:'14px 0'}}><input type="checkbox" checked={!!checks[k]} onChange={e=>setChecks({...checks,[k]:e.target.checked})}/>{label}</label>)}
        <button className="primary-button" disabled={(!valid&&!submission.current)||authorize.isPending}>Authorize exact event review</button></fieldset>
      </form>
      {error&&<p role="alert">{error}</p>}
      {decision&&<div role="status"><p>Decision saved. On the isolated controller, explicitly send:</p><code>APPLY COIN REVIEW {decision}</code><p>Wait for its durable archive acknowledgment. Do not clear NVS, add payment, or reopen the kiosk.</p></div>}
    </section>}
    {!!status.data?.reviews.length&&<section className="panel" style={{padding:24}}><h2>Event review history</h2>{status.data.reviews.map(r=><article key={r.id} style={{overflowWrap:'anywhere',padding:'12px 0'}}><strong>{r.id}</strong><p>{r.event_id}</p><p>{r.acknowledged_at?'Durable controller archive acknowledged':'Awaiting durable controller acknowledgment'} · Machine remains blocked</p></article>)}</section>}
  </main>;
}
