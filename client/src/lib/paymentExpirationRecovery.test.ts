import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "@shared/medidispense";
const h=vi.hoisted(()=>({cells:[] as any[],refs:[] as any[],state:0,ref:0,expire:vi.fn(),get:vi.fn(),recover:vi.fn(),cancel:vi.fn(),remove:vi.fn()}));
vi.mock("react",()=>({useState:(initial:any)=>{const i=h.state++;if(!(i in h.cells))h.cells[i]=initial;return[h.cells[i],(next:any)=>{h.cells[i]=typeof next==="function"?next(h.cells[i]):next;}];},useRef:(initial:any)=>{const i=h.ref++;return h.refs[i]??(h.refs[i]={current:initial});},useCallback:(fn:any)=>fn,useEffect:()=>{}}));
vi.mock("@/lib/apiConfig",()=>({apiBaseUrl:"http://test",kioskDemo:false}));
vi.mock("@/hooks/useDemoKioskCheckout",()=>({useDemoKioskCheckout:()=>({})}));
vi.mock("@/lib/kioskApi",()=>({kioskApi:{expire:h.expire,get:h.get,recover:h.recover,cancel:h.cancel},KioskApiError:class extends Error{},newPurchaseSession:vi.fn(),purchaseSessionKey:"test",purchaseSessionKeys:["test"]}));
vi.mock("@/lib/kioskSession",()=>({KioskSessionError:class extends Error{},readPurchaseSession:()=>({requestId:"same-original-session",token:"a".repeat(64),medicineId:1,quantity:1}),persistPurchaseSession:vi.fn(),removePurchaseSession:h.remove}));
vi.mock("@/lib/kioskDiagnostics",()=>({logKioskDiagnostic:vi.fn()}));
import { useKioskCheckout } from "@/hooks/useKioskCheckout";
const base={id:"TXN-TEST1234567890",databaseId:1,total:20,amountPaid:0,paymentStatus:"pending",dispensingStatus:"pending",items:[{medicineId:1,medicineName:"Test",quantity:1}],paymentWindow:{deadlineMs:1,serverNowMs:2,automaticExpirationEnabled:false,hardwarePauseSupported:false}} as Transaction;
function render(){h.state=0;h.ref=0;return useKioskCheckout();}
async function mount(){h.recover.mockResolvedValue({...base});await render().recover();return render();}
describe("payment expiration verification and recovery",()=>{
  beforeEach(()=>{h.cells=[];h.refs=[];[h.expire,h.get,h.recover,h.cancel,h.remove].forEach(fn=>fn.mockReset());});
  it("clears only a server-confirmed expired session when the return callback runs",async()=>{
    const checkout=await mount();
    h.expire.mockResolvedValue({...base,paymentStatus:'cancelled',dispensingStatus:'cancelled',paymentExpiry:{confirmed:true,returnAtMs:3002}});
    await checkout.expirePayment();
    expect(render().transaction?.paymentExpiry?.confirmed).toBe(true);
    expect(h.remove).not.toHaveBeenCalled();
    expect(await render().reset()).toBe(true);
    expect(h.remove).toHaveBeenCalledOnce();
    expect(render().transaction).toBeNull();
  });
  it("requests backend verification even when hardware capability is unavailable, without clearing the session",async()=>{
    const checkout=await mount();h.expire.mockRejectedValue(new Error("Hardware isolation is not verified"));h.get.mockResolvedValue({...base});
    await checkout.expirePayment();
    expect(h.expire).toHaveBeenCalledWith(1,expect.objectContaining({requestId:"same-original-session"}));
    expect(render().transaction?.databaseId).toBe(1);expect(render().error).toContain("not verified");
    expect(h.remove).not.toHaveBeenCalled();expect(h.cancel).not.toHaveBeenCalled();
  });
  it("a lost expiry response recovers the already-confirmed cancellation rather than showing stale failure",async()=>{
    const checkout=await mount();h.expire.mockRejectedValue(new Error("Network interrupted"));
    h.get.mockResolvedValue({...base,paymentStatus:"cancelled",dispensingStatus:"cancelled",paymentExpiry:{confirmed:true,returnAtMs:5}});
    await checkout.expirePayment();expect(render().transaction?.paymentExpiry?.confirmed).toBe(true);expect(render().error).toBeNull();expect(h.remove).not.toHaveBeenCalled();
  });
  it("full payment wins an expiration race and keeps the genuine dispensing state",async()=>{
    const checkout=await mount();h.expire.mockRejectedValue(new Error("Payment in progress"));h.get.mockResolvedValue({...base,amountPaid:20,paymentStatus:"successful",dispensingStatus:"dispensing"});
    await checkout.expirePayment();expect(render().transaction?.amountPaid).toBe(20);expect(render().transaction?.dispensingStatus).toBe("dispensing");expect(render().error).toBeNull();expect(h.remove).not.toHaveBeenCalled();
  });
  it("backend disconnection retains recovery credentials and the original purchase",async()=>{
    const checkout=await mount();h.expire.mockRejectedValue(new Error("Backend disconnected"));h.get.mockRejectedValue(new Error("Backend disconnected"));
    await checkout.expirePayment();expect(render().transaction?.id).toBe(base.id);expect(render().error).toContain("disconnected");expect(h.remove).not.toHaveBeenCalled();expect(h.cancel).not.toHaveBeenCalled();
  });
  it("does not request expiration of a known partially paid purchase",async()=>{
    h.recover.mockResolvedValue({...base,amountPaid:5});await render().recover();await render().expirePayment();expect(h.expire).not.toHaveBeenCalled();expect(render().transaction?.amountPaid).toBe(5);
  });
  it("retains a successfully dispensed purchase until backend-confirmed handoff",async()=>{
    h.recover.mockResolvedValue({...base,amountPaid:20,paymentStatus:"successful",dispensingStatus:"dispensed",requestedQuantity:1,dispensedQuantity:1,customerHandoffSafe:false});
    await render().recover();expect(await render().reset()).toBe(false);expect(h.remove).not.toHaveBeenCalled();expect(render().transaction?.paymentStatus).toBe("successful");
  });
  it("does not clear an unrecovered dispensing failure",async()=>{
    h.recover.mockResolvedValue({...base,amountPaid:20,paymentStatus:"successful",dispensingStatus:"failed",adminRecovered:false});
    await render().recover();expect(await render().reset()).toBe(false);expect(h.remove).not.toHaveBeenCalled();
  });
  it("keeps a partial admin review even when the legacy recovered flag is true",async()=>{
    h.recover.mockResolvedValue({...base,amountPaid:20,paymentStatus:'successful',dispensingStatus:'failed',adminRecovered:true,issueRecovery:{reviewRequired:true,machineReuseReady:false,returnRequested:false}});
    await render().recover();expect(await render().reset()).toBe(false);expect(h.remove).not.toHaveBeenCalled();
  });
  it("returns the kiosk only after the backend confirms admin reconciliation and return",async()=>{
    h.recover.mockResolvedValue({...base,amountPaid:20,paymentStatus:'successful',dispensingStatus:'dispensed',requestedQuantity:1,dispensedQuantity:1,issueRecovery:{reviewRequired:false,machineReuseReady:true,returnRequested:true}});
    await render().recover();expect(await render().reset()).toBe(true);expect(h.remove).toHaveBeenCalledOnce();
  });

});
