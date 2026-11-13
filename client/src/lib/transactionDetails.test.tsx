import React from 'react';
import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import TransactionDetailsSummary,{transactionOverview} from '@/components/TransactionDetailsSummary';
import type {Transaction} from '@shared/medidispense';
const base:Transaction={id:'TXN-DETAILS',databaseId:166,slotNumber:2,createdAt:'2026-11-14T01:00:00+08:00',items:[{medicineId:2,medicineName:'Vitamins',quantity:1,unitPrice:10,subtotal:10}],paymentStatus:'cancelled',dispensingStatus:'cancelled',amountPaid:0,total:10,change:0,dispensedQuantity:0};
describe('plain-language purchase details',()=>{
  it('explains a zero-payment cancellation using readable cards',()=>{
    const html=renderToStaticMarkup(<TransactionDetailsSummary transaction={base}/>);
    for(const text of ['Purchase cancelled','No payment is recorded','Vitamins','Payment recorded','Delivery recorded','0 of 1',base.id,'10.00'])expect(html).toContain(text);
    for(const text of ['reconciliation','Sensor-confirmed','finalized','E-Receipt'])expect(html).not.toContain(text);
  });
  it('does not imply a cancelled paid purchase has no customer obligation',()=>{const message=transactionOverview({...base,amountPaid:5}).message;expect(message).toContain('payment is recorded');expect(message).toContain('assistance');expect(message).not.toContain('refund');});
  it('does not turn missing delivery evidence into a zero count',()=>{expect(renderToStaticMarkup(<TransactionDetailsSummary transaction={{...base,dispensedQuantity:undefined}}/>)).toContain('Not confirmed');});
  it('distinguishes waiting for payment and partial payment',()=>{expect(transactionOverview({...base,paymentStatus:'pending',dispensingStatus:'pending'}).title).toBe('Waiting for payment');expect(transactionOverview({...base,paymentStatus:'pending',dispensingStatus:'pending',amountPaid:5}).title).toBe('Payment in progress');});
  it.each(['failed','timeout'] as const)('keeps %s delivery outcomes flagged for staff',dispensingStatus=>{expect(transactionOverview({...base,paymentStatus:'successful',amountPaid:10,dispensingStatus}).title).toBe('Medicine delivery needs checking');});
});
