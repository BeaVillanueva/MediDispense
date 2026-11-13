import {beforeEach,describe,expect,it,vi} from 'vitest';
import React from 'react';
const h=vi.hoisted(()=>({cells:[] as any[],refs:[] as any[],state:0,ref:0,data:null as any,options:null as any,error:null as any,mutate:vi.fn(),refetch:vi.fn(),close:vi.fn(),changed:vi.fn(),sequence:0}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:(value:any)=>{const i=h.state++;if(!(i in h.cells))h.cells[i]=typeof value==='function'?value():value;return[h.cells[i],(next:any)=>{h.cells[i]=typeof next==='function'?next(h.cells[i]):next;}];},useRef:(value:any)=>{const i=h.ref++;return h.refs[i]??(h.refs[i]={current:value});}}));
vi.mock('sonner',()=>({toast:{success:vi.fn()}}));
vi.mock('@/lib/trpc',()=>({trpc:{transactions:{issueDetails:{useQuery:()=>({data:h.data,error:null,refetch:h.refetch})},resolveIssue:{useMutation:(options:any)=>{h.options=options;return{mutate:h.mutate,isPending:false,error:h.error,reset:()=>{h.error=null;}};}}}}}));
import {DispensingIssueDialog} from '@/components/DispensingIssueDialog';
const original={id:'TXN-TEST-REVIEW',databaseId:1,items:[{medicineId:1,medicineName:'Test tablet',quantity:1,unitPrice:10,subtotal:10}],total:10,amountPaid:10,change:0,paymentStatus:'successful',dispensingStatus:'failed',createdAt:'',requestedQuantity:1,dispensedQuantity:0,sensorConfirmedQuantity:0,slotNumber:1,dispensingRequestId:2} as const;
function render(){h.state=0;h.ref=0;return DispensingIssueDialog({transaction:original as any,onClose:h.close,onChanged:h.changed});}
function find(node:any,predicate:(n:any)=>boolean):any {if(!node||typeof node!=='object')return null;if(Array.isArray(node)){for(const n of node){const r=find(n,predicate);if(r)return r;}return null;}if(predicate(node))return node;return find(node.props?.children,predicate);}
function byId(id:string){return find(render(),n=>n.props?.id===id);}
function button(text:string){return find(render(),n=>n.type==='button'&&n.props.children===text);}
function value(id:string,value:string){byId(id).props.onChange({target:{value}});}
function check(id:string){byId(id).props.onChange({target:{checked:true}});}
function fill(){value('issue-outcome','dispensed_sensor_missed');value('issue-quantity','1');value('issue-stock','4');value('issue-notes','Physically verified the delivered tablet.');check('issue-inspected');check('issue-stopped');check('issue-disconnected');}
function submit(returning=false){find(render(),n=>n.type==='form').props.onSubmit({preventDefault:vi.fn(),nativeEvent:{submitter:{getAttribute:()=>returning?'true':null}}});}
function saved(ready=true,blockers:any[]=[]){const review={revision:1,outcome:'dispensed_sensor_missed',verifiedQuantity:1,sensorConfirmedQuantity:0,requestedQuantity:1,reviewRequired:!ready,inspectionComplete:true,stockVerified:true,returnRequested:false,machineReuseReady:ready,obligationStatus:'delivery_verified'};return{transaction:{...original,dispensingStatus:'dispensed',dispensedQuantity:1,issueRecovery:review},recordedStock:4,returnEligibility:{ready,blockers},history:[{...review,adminId:1,createdAt:'2026-11-13',originalDispensingStatus:'failed',physicalStock:4,notes:'Physically verified the delivered tablet.',obligationReference:''}]};}
async function confirmSave(ready=true,blockers:any[]=[]){const input=h.mutate.mock.calls.at(-1)![0];h.data=saved(ready,blockers);await h.options.onSuccess(h.data.transaction,input);h.options.onSettled();return input;}
beforeEach(()=>{h.cells=[];h.refs=[];h.state=0;h.ref=0;h.sequence=0;h.error=null;h.data={transaction:original,recordedStock:5,history:[],returnEligibility:{ready:false,blockers:[{code:'REVIEW_NOT_SAVED',message:'Save this check first.'}]}};[h.mutate,h.refetch,h.close,h.changed].forEach(f=>f.mockReset());h.refetch.mockImplementation(async()=>({data:h.data,error:null}));vi.stubGlobal('crypto',{getRandomValues:(a:Uint8Array)=>a.fill(++h.sequence)});});
describe('save and return recovery workflow',()=>{
  it('never assumes outcome or delivered quantity, including after changing the outcome',()=>{
    expect(byId('issue-outcome').props.value).toBe('');expect(byId('issue-quantity').props.value).toBe('');
    value('issue-outcome','dispensed_sensor_missed');expect(byId('issue-quantity').props.value).toBe('');
    value('issue-outcome','not_dispensed');expect(byId('issue-quantity').props.value).toBe('');
  });
  it('keeps Save Check open, refreshes eligibility, then enables authenticated Return',async()=>{
    fill();expect(button('Save Check').props.disabled).toBe(false);expect(button('Reopen Kiosk').props.disabled).toBe(true);expect(byId('issue-return-reason').props.children).toBe('Save this check first.');
    submit();submit();expect(h.mutate).toHaveBeenCalledOnce();const first=await confirmSave();
    expect(h.close).not.toHaveBeenCalled();expect(h.refetch).toHaveBeenCalledOnce();expect(button('Reopen Kiosk').props.disabled).toBe(false);
    submit(true);const next=h.mutate.mock.calls.at(-1)![0];expect(next.expectedRevision).toBe(1);expect(next.requestKey).not.toBe(first.requestKey);expect(next.returnToKiosk).toBe(true);expect(next.verifiedQuantity).toBe(1);
    const result={...h.data.transaction,issueRecovery:{...h.data.transaction.issueRecovery,revision:2,returnRequested:true}};h.data={...h.data,transaction:result};await h.options.onSuccess(result,next);h.options.onSettled();
    expect(h.changed).toHaveBeenCalledTimes(2);expect(button('Reopen Kiosk').props.disabled).toBe(true);expect(byId('issue-return-reason').props.children).toContain('Check complete. The kiosk can return to Choose Medicine.');
  });
  it('shows the exact backend blocker beside the disabled primary action after Save',async()=>{
    fill();submit();await confirmSave(false,[{code:'ACTIVE_DISPENSING_REQUEST',message:'Another dispensing request is still active or pending.'}]);
    expect(button('Reopen Kiosk').props.disabled).toBe(true);expect(byId('issue-return-reason').props.children).toBe('Another medicine delivery is still waiting or in progress.');expect(h.close).not.toHaveBeenCalled();
  });
  it('keeps Return enabled for historical follow-up warnings when the backend reports no machine blocker',async()=>{
    fill();submit();await confirmSave();
    h.data.returnEligibility.warnings=[{code:'HISTORICAL_FAILED_PURCHASES',message:'Historical failed purchases remain for customer follow-up.'}];
    expect(button('Reopen Kiosk').props.disabled).toBe(false);
    expect(find(render(),n=>n.props?.['aria-label']==='Customer follow-up')).toBeTruthy();
  });
  it('requires saving changed review facts again',async()=>{
    fill();submit();await confirmSave();value('issue-notes','Additional verified physical observations.');
    expect(button('Reopen Kiosk').props.disabled).toBe(true);expect(byId('issue-return-reason').props.children).toBe('Save this check first.');
  });
  it('displays backend API failures instead of claiming success or leaving Return clickable',async()=>{
    fill();submit();await confirmSave();h.error=new Error('Another Firebase command is active.');
    expect(button('Reopen Kiosk').props.disabled).toBe(true);expect(byId('issue-return-reason').props.children).toContain('Another medicine delivery is still open.');
  });
  it('blocks Return after a failed eligibility refresh and retries without a mutation',async()=>{
    fill();submit();h.refetch.mockResolvedValueOnce({error:new Error('Network interrupted')});await confirmSave();
    expect(button('Reopen Kiosk').props.disabled).toBe(true);expect(byId('issue-return-reason').props.children).toContain('kiosk status could not be checked');
    button('Check again').props.onClick();await Promise.resolve();await Promise.resolve();expect(h.mutate).toHaveBeenCalledOnce();expect(button('Reopen Kiosk').props.disabled).toBe(false);
  });
  it('loads saved values only through explicit admin action and still requires physical confirmations',()=>{
    h.data=saved();expect(byId('issue-quantity').props.value).toBe('');button('Use saved check').props.onClick();
    expect(byId('issue-quantity').props.value).toBe('1');expect(button('Reopen Kiosk').props.disabled).toBe(true);
    check('issue-inspected');check('issue-stopped');check('issue-disconnected');expect(button('Reopen Kiosk').props.disabled).toBe(false);
  });
  it('clears old confirmations when a saved review is loaded again',()=>{
    h.data=saved();fill();button('Use saved check').props.onClick();
    for(const id of ['issue-inspected','issue-stopped','issue-disconnected'])expect(byId(id).props.checked).toBe(false);
    expect(button('Reopen Kiosk').props.disabled).toBe(true);expect(h.mutate).not.toHaveBeenCalled();
  });
});
