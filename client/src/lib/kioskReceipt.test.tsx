import React from 'react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {startReceiptIdleTimer} from '@/hooks/useKioskReceipt';
import TransactionReceiptSummary from '@/components/TransactionReceiptSummary';
import {CheckoutPanel} from '@/components/kiosk/CheckoutPanel';
import {paymentStatus} from '@/lib/kioskPurchase';
import {canReturnAfterReceiptDone} from '@/lib/transactionReceipt';
import type {Transaction} from '@shared/medidispense';
const completed:Transaction={id:'TXN-RECEIPT-KIOSK',databaseId:1,slotNumber:1,createdAt:'2026-11-14T01:00:00+08:00',items:[{medicineId:1,medicineName:'Example medicine',quantity:1,unitPrice:10,subtotal:10}],total:10,amountPaid:10,change:0,paymentStatus:'successful',dispensingStatus:'dispensed',dispensedQuantity:1,requestedQuantity:1,customerHandoffSafe:true,receipt:{eligible:true,blockers:[],paymentFinalized:true,paymentMethod:'coins',deliveredQuantity:1,deliveryVerification:'sensor'}};
function screen(t:Transaction){return renderToStaticMarkup(<CheckoutPanel checkout={{transaction:t,paymentStatus:paymentStatus(t,t.amountPaid),preview:false,busy:false,error:null,canGoBack:false,simulationEnabled:false} as any} onFinish={vi.fn()} onBack={vi.fn()} onBrowse={vi.fn()}/>);}
describe('receipt inactivity display',()=>{
  beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
  it('expires once after five untouched seconds',()=>{const tick=vi.fn(),expire=vi.fn();const stop=startReceiptIdleTimer(new EventTarget(),tick,expire,vi.fn());vi.advanceTimersByTime(4900);expect(expire).not.toHaveBeenCalled();vi.advanceTimersByTime(100);expect(expire).toHaveBeenCalledOnce();vi.advanceTimersByTime(10000);expect(expire).toHaveBeenCalledOnce();stop();});
  it.each(['pointerdown','keydown','wheel'])('holds the receipt when the customer uses %s',event=>{const target=new EventTarget(),expire=vi.fn(),hold=vi.fn();const stop=startReceiptIdleTimer(target,vi.fn(),expire,hold);vi.advanceTimersByTime(3000);target.dispatchEvent(new Event(event));vi.advanceTimersByTime(30000);expect(hold).toHaveBeenCalledOnce();expect(expire).not.toHaveBeenCalled();stop();});
  it('cleans up countdown and interaction listeners',()=>{const target=new EventTarget(),expire=vi.fn(),hold=vi.fn();const stop=startReceiptIdleTimer(target,vi.fn(),expire,hold);stop();target.dispatchEvent(new Event('pointerdown'));vi.advanceTimersByTime(10000);expect(expire).not.toHaveBeenCalled();expect(hold).not.toHaveBeenCalled();});
});
describe('customer receipt eligibility and success presentation',()=>{
  it('always provides Check Status for paid dispensing failures without an unsafe return',()=>{
    const failed={...completed,dispensingStatus:'failed' as const,dispensedQuantity:0,receipt:undefined,dispensingRecovery:{ready:false,reviewSaved:false,returnRequested:false,blockers:[{code:'UNRESOLVED_COIN_EVENTS',message:'Review required'}]}};
    const html=screen(failed);expect(html).toContain('Check Status');expect(html).toContain('recorded coin issue');expect(html).not.toContain('Return to Choose Medicine');expect(html).not.toContain('>Okay</button>');
  });
  it('offers return only after explicit backend recovery confirmation',()=>{
    const html=screen({...completed,dispensingStatus:'failed',adminRecovered:true,dispensingRecovery:{ready:true,reviewSaved:true,returnRequested:true,blockers:[]}});
    expect(html).toContain('Check Status');expect(html).toContain('Return to Choose Medicine');
  });
  it('does not return automatically after a recovered full delivery when a command or coin blocker reappears',()=>{
    const html=screen({...completed,adminRecovered:true,issueRecovery:{revision:1,outcome:'dispensed_sensor_missed',verifiedQuantity:1,sensorConfirmedQuantity:0,requestedQuantity:1,reviewRequired:false,inspectionComplete:true,stockVerified:true,returnRequested:true,machineReuseReady:true,obligationStatus:'delivery_verified'},dispensingRecovery:{ready:false,reviewSaved:true,returnRequested:true,blockers:[{code:'ACTIVE_FIREBASE_COMMAND',message:'Active command'}]}});
    expect(html).not.toContain('Return to Choose Medicine');expect(html).toContain('Check Status');
  });
  it('shows no kiosk E-Receipt and returns to medicines after a completed purchase',()=>{const html=screen(completed);expect(html).toContain('Return to Choose Medicine');expect(html).toContain('Returning to medicines in');expect(html).not.toContain('E-Receipt');expect(html).not.toContain('role="dialog"');expect(html).not.toContain('>Okay</button>');});
  it('uses real confirmed receipt values in the shared receipt summary',()=>{const html=renderToStaticMarkup(<TransactionReceiptSummary transaction={completed} successful/>);expect(html).toContain(completed.id);expect(html).toContain('Example medicine');expect(html).toContain('Coins');expect(html).toContain('Completed');expect(html).toContain('10.00');expect(html).not.toContain('Medicine Usage Guide');expect(html).not.toContain('Dosage');});
  it.each(['pending','dispensing','failed','timeout'] as const)('does not show a successful receipt for %s dispensing',dispensingStatus=>{expect(screen({...completed,dispensingStatus,dispensedQuantity:0})).not.toContain('E-Receipt');});
  it('does not show receipts without backend eligibility or for overpayment',()=>{expect(screen({...completed,receipt:undefined})).not.toContain('E-Receipt');expect(screen({...completed,amountPaid:15})).not.toContain('E-Receipt');});
  it('keeps the machine reuse guard even with a verified delivery receipt',()=>{const html=screen({...completed,customerHandoffSafe:false});expect(html).toContain('staff check is required');expect(html).toContain('Check Status');expect(html).toContain('>Done</button>');expect(html).not.toContain('Return to Choose Medicine');expect(html).not.toContain('E-Receipt');});
});
describe('Done on a verified e-receipt',()=>{
  it('allows returning to Choose Medicine even when controller handoff diagnostics are stale',()=>{expect(canReturnAfterReceiptDone({...completed,customerHandoffSafe:false,customerHandoffBlockers:['CONTROLLER_DIAGNOSTICS_STALE']})).toBe(true);});
  it('never allows it for unverified, overpaid, failed or recovery purchases',()=>{
    expect(canReturnAfterReceiptDone(null)).toBe(false);
    expect(canReturnAfterReceiptDone({...completed,receipt:undefined})).toBe(false);
    expect(canReturnAfterReceiptDone({...completed,amountPaid:15})).toBe(false);
    expect(canReturnAfterReceiptDone({...completed,dispensingStatus:'failed',dispensedQuantity:0})).toBe(false);
    expect(canReturnAfterReceiptDone({...completed,adminRecovered:true})).toBe(false);
    expect(canReturnAfterReceiptDone({...completed,receipt:{...completed.receipt!,deliveryVerification:'admin_physical'}})).toBe(false);
    expect(canReturnAfterReceiptDone({...completed,dispensingRecovery:{ready:false,reviewSaved:false,returnRequested:false,blockers:[]}})).toBe(false);
  });
});
