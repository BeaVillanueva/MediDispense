import {useState} from 'react';
import {trpc} from '@/lib/trpc';
import './controller-replacement.css';
export function replacementFormBlocker(oldId:string,newId:string,confirmed:boolean,pending=false):string {
  if(pending)return 'Verification is in progress.';
  if(!oldId)return 'Select the old controller ID first.';
  if(!newId)return 'Select the installed controller ID.';
  if(oldId===newId)return 'Old and installed controllers must be different.';
  if(!confirmed)return 'Confirm all three physical checks before continuing.';
  return '';
}
export default function ControllerReplacement(){
  const reports=trpc.machine.controllers.useQuery(undefined,{refetchInterval:5000});
  const [oldId,setOldId]=useState(''),[newId,setNewId]=useState('');
  const [disconnected,setDisconnected]=useState(false),[coins,setCoins]=useState(false),[identity,setIdentity]=useState(false),[message,setMessage]=useState('');
  const retire=trpc.machine.retireController.useMutation();
  const blocker=replacementFormBlocker(oldId,newId,disconnected&&coins&&identity,retire.isPending);
  return <details className="panel mm-technical controller-replacement" open><summary>Replace machine controller</summary>
    <p>Preserves payment journals and transaction history. Keep the old board disconnected. This does not cancel purchases.</p>
    {reports.error&&<p role="alert">{reports.error.message}</p>}
    {reports.isPending&&<p role="status">Checking registered controllers...</p>}
    {reports.data?.map(d=><p key={d.device_id} className="controller-report"><strong>{d.device_id}</strong> — {d.registrationStatus}; {d.fresh?'fresh':'stale'} ({Math.round(d.ageSeconds)}s), purchase #{d.bound_transaction_id||'none'}, {d.pending_events} pending events.</p>)}
    <div className="controller-replacement-form">
      <label className="controller-field">Old controller ID<select value={oldId} onChange={e=>setOldId(e.target.value)} required><option value="">Select old controller</option>{reports.data?.map(d=><option key={d.device_id} value={d.device_id}>{d.device_id} — {d.registrationStatus}</option>)}</select></label>
      <label className="controller-field">Installed controller ID<select value={newId} onChange={e=>setNewId(e.target.value)} required><option value="">Select installed controller</option>{reports.data?.map(d=><option key={d.device_id} value={d.device_id}>{d.device_id} — {d.fresh?'fresh':'stale'}</option>)}</select></label>
      <label><input type="checkbox" checked={disconnected} onChange={e=>setDisconnected(e.target.checked)}/> Old controller is powered off and disconnected.</label>
      <label><input type="checkbox" checked={coins} onChange={e=>setCoins(e.target.checked)}/> Coin path and journal checked; no unrecorded coins.</label>
      <label><input type="checkbox" checked={identity} onChange={e=>setIdentity(e.target.checked)}/> I physically verified the installed controller ID.</label>
      {blocker&&<p id="controller-form-blocker" className="controller-form-hint" role="status">{blocker}</p>}
      <button className="primary-button" aria-describedby={blocker?'controller-form-blocker':undefined} disabled={!!blocker} onClick={async()=>{
        setMessage('');try{await retire.mutateAsync({old_device_id:oldId,new_device_id:newId,old_disconnected:true,no_unrecorded_coins:true,new_physically_verified:true});setMessage('Old controller registration retired. History preserved.');await reports.refetch();}catch(e){setMessage(e instanceof Error?e.message:'Replacement could not be verified.');}
      }}>{retire.isPending?'Verifying replacement...':'Verify & Retire Old Controller'}</button>
      {message&&<p role="status">{message}</p>}
    </div>
  </details>;
}
