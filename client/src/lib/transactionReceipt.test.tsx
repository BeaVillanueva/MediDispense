import {beforeEach,describe,expect,it,vi} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {Transaction,TransactionRecordDetails} from '@shared/medidispense';
import {canViewEReceipt} from './transactionReceipt';
const h=vi.hoisted(()=>({data:null as TransactionRecordDetails|null}));
vi.mock('@/lib/trpc',()=>({trpc:{transactions:{details:{useQuery:()=>({data:h.data,error:null,isPending:false,isFetching:false,refetch:vi.fn()})}}}}));
import {TransactionRecordDialog} from '@/components/TransactionRecordDialog';
const complete:Transaction={id:'TXN-RECEIPT-TEST',databaseId:1,createdAt:'2026-11-13T10:00:00+08:00',currency:'PHP',items:[{medicineId:1,medicineName:'Paracetamol 500mg',quantity:2,unitPrice:5,subtotal:10}],requestedQuantity:2,dispensedQuantity:2,sensorConfirmedQuantity:2,total:10,amountPaid:10,change:0,paymentStatus:'successful',dispensingStatus:'dispensed',slotNumber:1,receipt:{eligible:true,blockers:[],paymentFinalized:true,paymentMethod:'coins',deliveredQuantity:2,deliveryVerification:'sensor'}};
const review:NonNullable<Transaction['issueRecovery']>={revision:1,outcome:'dispensed_sensor_missed',verifiedQuantity:2,sensorConfirmedQuantity:0,requestedQuantity:2,reviewRequired:false,machineReviewRequired:false,customerObligationPending:false,inspectionComplete:true,stockVerified:true,returnRequested:false,machineReuseReady:false,obligationStatus:'delivery_verified'};
function render(t:Transaction){h.data={transaction:t,reason:null,history:[]};return renderToStaticMarkup(<TransactionRecordDialog transaction={t} onClose={()=>{}}/>);}
beforeEach(()=>{h.data=null;});
describe('verified E-Receipt and transaction details',()=>{
  it('shows a completed paid and delivered purchase as a printable branded E-Receipt',()=>{
    expect(canViewEReceipt(complete)).toBe(true);
    const html=render(complete);
    for(const text of ['E-Receipt','MediDispense','Triple J Grocery Store and Pharmacy','TXN-RECEIPT-TEST','Paracetamol 500mg','₱5.00','₱10.00','Total amount paid','Coins','Paid','Completed','Print Receipt'])expect(html).toContain(text);
    expect(html).toContain('receipt-print-area');expect(html).not.toContain('>Transaction Details<');
  });
  it.each(['cancelled','failed','pending'] as const)('keeps %s payments in details without an E-Receipt',paymentStatus=>{
    const t={...complete,paymentStatus,dispensingStatus:paymentStatus==='cancelled'?'cancelled' as const:'failed' as const};
    expect(canViewEReceipt(t)).toBe(false);const html=render(t);
    expect(html).toContain('Transaction Details');expect(html).not.toContain('>E-Receipt<');expect(html).not.toContain('Print Receipt');expect(html).not.toContain('receipt-print-area');
  });
  it.each(['failed','pending','dispensing','timeout'] as const)('rejects %s dispensing even after payment',dispensingStatus=>{
    expect(canViewEReceipt({...complete,dispensingStatus})).toBe(false);
  });
  it('requires backend evidence and does not infer receipt eligibility from status alone',()=>{
    expect(canViewEReceipt({...complete,receipt:undefined})).toBe(false);
    expect(canViewEReceipt({...complete,receipt:{...complete.receipt!,paymentFinalized:false}})).toBe(false);
    expect(canViewEReceipt({...complete,amountPaid:15})).toBe(false);
    expect(canViewEReceipt({...complete,dispensedQuantity:1})).toBe(false);
    expect(canViewEReceipt({...complete,adminRecovered:true,issueRecovery:null})).toBe(false);
  });
  it('accepts finalized physical recovery independently of current machine return readiness',()=>{
    const recovered={...complete,sensorConfirmedQuantity:0,issueRecovery:review,receipt:{...complete.receipt!,deliveryVerification:'admin_physical' as const}};
    expect(canViewEReceipt(recovered)).toBe(true);expect(render(recovered)).toContain('Medicine delivery was checked and confirmed by staff');
  });
  it('does not issue a receipt for outstanding recovery or fulfillment/payment issues',()=>{
    for(const r of [{...review,reviewRequired:true},{...review,stockVerified:false},{...review,obligationStatus:'pending' as const}])expect(canViewEReceipt({...complete,issueRecovery:r,receipt:{...complete.receipt!,deliveryVerification:'admin_physical'}})).toBe(false);
  });
  it('preserves cancellation reason and recovery/audit details without presenting success',()=>{
    const t={...complete,paymentStatus:'cancelled' as const,dispensingStatus:'cancelled' as const,amountPaid:0,dispensedQuantity:0,receipt:{...complete.receipt!,eligible:false,blockers:['PAYMENT_NOT_FINALIZED','DISPENSING_NOT_COMPLETED']}};
    h.data={transaction:t,reason:'No payment received; cancelled by operator.',history:[{id:1,actorId:1,action:'transaction_cancelled',description:'Purchase cancelled; history retained.',createdAt:t.createdAt,details:{reason:'No payment received'}}]};
    const html=renderToStaticMarkup(<TransactionRecordDialog transaction={t} onClose={()=>{}}/>);
    expect(html).toContain('No payment received; cancelled by operator.');expect(html).toContain('Activity history');expect(html).toContain('Purchase cancelled; history retained.');expect(html).not.toContain('Print Receipt');
    expect(html).toContain('Purchase cancelled');expect(html).toMatch(/<details class="record-extra"><summary>More details/);expect(html).not.toMatch(/<details[^>]*open/);
  });
});
