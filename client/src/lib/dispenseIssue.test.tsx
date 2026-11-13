import {beforeEach,describe,expect,it,vi} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Transaction,DispenseIssueDetails} from '@shared/medidispense';
import {canReviewDispensingIssue,validPhysicalQuantity,recoveryFormErrors,recoveryFormSignature,type RecoveryForm} from './dispenseIssue';
import {recoveryConfirmed} from './dispensingTimeout';
import {canReturnAfterDispensing} from './medicineInformation';
const h=vi.hoisted(()=>({data:null as DispenseIssueDetails|null}));
vi.mock('@/lib/trpc',()=>({trpc:{transactions:{issueDetails:{useQuery:()=>({data:h.data,isPending:!h.data,isFetching:false,isError:false,error:null,refetch:vi.fn()})},resolveIssue:{useMutation:()=>({isPending:false,error:null,mutate:vi.fn()})}}}}));
import {DispensingIssueDialog} from '@/components/DispensingIssueDialog';
const transaction:Transaction={id:'TXN-REVIEW-TEST',databaseId:1,items:[{medicineId:1,medicineName:'Test medicine',quantity:3,unitPrice:10,subtotal:30}],total:30,amountPaid:30,change:0,paymentStatus:'successful',dispensingStatus:'failed',createdAt:'',requestedQuantity:3,dispensedQuantity:1,sensorConfirmedQuantity:1,dispensingRequestId:2,slotNumber:1};
const review:NonNullable<Transaction['issueRecovery']>={revision:1,outcome:'partial',verifiedQuantity:2,sensorConfirmedQuantity:1,requestedQuantity:3,reviewRequired:true,inspectionComplete:false,stockVerified:true,returnRequested:false,machineReuseReady:false,obligationStatus:'pending'};
beforeEach(()=>{h.data={transaction,recordedStock:5,history:[],returnEligibility:{ready:false,blockers:[{code:'REVIEW_NOT_SAVED',message:'Save your review first.'}]}};vi.stubGlobal('crypto',{getRandomValues:(a:Uint8Array)=>a.fill(1)});});
describe('admin physical dispensing review',()=>{
  it('explains missing quantities and physical confirmations without assuming a result',()=>{
    const form:RecoveryForm={outcome:'',quantity:'',stock:'',notes:'',obligation:'pending',reference:'',complete:false,inspected:false,stopped:false,disconnected:false};
    expect(recoveryFormErrors(form,0,0,1)).toContain('Enter how many tablets came out.');
    expect(recoveryFormErrors(form,0,0,1)).toContain('Confirm that you checked the machine and medicine.');
  });
  it('requires another saved review when physical facts change, not when confirmations are rechecked',()=>{
    const form:RecoveryForm={outcome:'dispensed_sensor_missed',quantity:'1',stock:'4',notes:'Verified physical delivery',obligation:'pending',reference:'',complete:true,inspected:true,stopped:true,disconnected:true};
    expect(recoveryFormErrors(form,0,0,1)).toEqual([]);
    expect(recoveryFormSignature({...form,stock:'3'})).not.toBe(recoveryFormSignature(form));
    expect(recoveryFormSignature({...form,inspected:false})).toBe(recoveryFormSignature(form));
    expect(recoveryFormErrors({...form,inspected:false},0,0,1)).not.toEqual([]);
  });
  it('offers review for paid failed/unresolved issues and leaves historical completion alone',()=>{
    expect(canReviewDispensingIssue(transaction)).toBe(true);
    expect(canReviewDispensingIssue({...transaction,paymentStatus:'pending'})).toBe(false);
    expect(canReviewDispensingIssue({...transaction,dispensingStatus:'dispensed'})).toBe(false);
    expect(canReviewDispensingIssue({...transaction,dispensingStatus:'dispensed',issueRecovery:review})).toBe(true);
  });
  it('validates cumulative quantities without losing confirmed or previously reconciled units',()=>{
    expect(validPhysicalQuantity('partial','2',1,2,3)).toBe(true);
    expect(validPhysicalQuantity('partial','1',1,2,3)).toBe(false);
    expect(validPhysicalQuantity('dispensed_sensor_missed','2',1,1,3)).toBe(false);
    expect(validPhysicalQuantity('dispensed_sensor_missed','3',1,2,3)).toBe(true);
    expect(validPhysicalQuantity('not_dispensed','0',1,1,3)).toBe(false);
    for(const value of ['-1','1.5','4',''])expect(validPhysicalQuantity('partial',value,0,0,3)).toBe(false);
  });
  it('shows transaction evidence, physical outcomes, explicit safety confirmations and obligation choices',()=>{
    const html=renderToStaticMarkup(<DispensingIssueDialog transaction={transaction} onClose={()=>{}} onChanged={()=>{}}/>);
    for(const text of ['Check Medicine Delivery','Test medicine','TXN-REVIEW-TEST','Machine counted','Tablets ordered','All tablets came out','No tablets came out','Only some tablets came out','Tablets that came out','checked the machine','moving parts have stopped','switched off or disconnected','Reopen Kiosk'])expect(html).toContain(text);
    expect(html).toContain('disabled=""');
    expect(html).toContain('This form does not release tablets or send refunds');
    expect(html).not.toContain('restock-modal');
    expect(html).toContain('placeholder="Enter total" value=""');
  });
  it('requires complete backend recovery and an explicit return request before clearing the kiosk',()=>{
    expect(recoveryConfirmed({...transaction,adminRecovered:true,issueRecovery:review})).toBe(false);
    expect(recoveryConfirmed({...transaction,issueRecovery:{...review,reviewRequired:false,machineReuseReady:true}})).toBe(false);
    expect(recoveryConfirmed({...transaction,issueRecovery:{...review,reviewRequired:false,machineReuseReady:true,returnRequested:true}})).toBe(true);
  });
  it('retains customer follow-up without mistaking it for a machine safety lock',()=>{
    const pending={...transaction,issueRecovery:{...review,inspectionComplete:true,reviewRequired:true,machineReviewRequired:false,customerObligationPending:true,returnRequested:true,machineReuseReady:true}};
    expect(recoveryConfirmed(pending)).toBe(true);
    expect(recoveryConfirmed({...pending,issueRecovery:{...pending.issueRecovery,machineReviewRequired:true}})).toBe(false);
  });
  it('permits a physically confirmed full delivery return only when backend machine checks pass',()=>{
    const t={...transaction,dispensingStatus:'dispensed' as const,dispensedQuantity:3,issueRecovery:{...review,verifiedQuantity:3,reviewRequired:false,returnRequested:true,machineReuseReady:true}};
    expect(canReturnAfterDispensing(t)).toBe(true);
    expect(canReturnAfterDispensing({...t,issueRecovery:{...t.issueRecovery,machineReuseReady:false}})).toBe(false);
  });
});
