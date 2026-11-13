import { useCallback, useEffect, useRef, useState } from "react";
import type { Transaction } from "@shared/medidispense";
import {
  KioskApiError,
  kioskApi,
  newPurchaseSession,
  purchaseSessionKey,
  purchaseSessionKeys,
  type PurchaseSession,
} from "@/lib/kioskApi";
import { apiBaseUrl, kioskDemo } from "@/lib/apiConfig";
import { KioskSessionError, readPurchaseSession, persistPurchaseSession, removePurchaseSession } from "@/lib/kioskSession";
import { logKioskDiagnostic } from "@/lib/kioskDiagnostics";
import { canReturnAfterDispensing } from "@/lib/medicineInformation";
import { recoveryConfirmed } from "@/lib/dispensingTimeout";
import {
  mayLeavePayment,
  paymentStatus,
  remainingAmount,
  type Purchase,
} from "@/lib/kioskPurchase";
import { useDemoKioskCheckout } from "./useDemoKioskCheckout";

export function useKioskCheckout() {
  const demo = useDemoKioskCheckout();
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(!kioskDemo);
  const [error, setError] = useState<string | null>(null);
  const [recoveryMessage,setRecoveryMessage]=useState<string|null>(null);
  const [canRetrySavedCheckout,setCanRetrySavedCheckout]=useState(false);
  const session = useRef<PurchaseSession | null>(null);
  const current = useRef<Transaction | null>(null);
  const locked = useRef(false);
  const generation = useRef(0);
  const save = useCallback((value: Transaction) => {
    current.current = value;
    setTransaction(value);
  }, []);
  const clear = useCallback(() => {
    try {removePurchaseSession(purchaseSessionKeys);} catch(e) {setError(e instanceof Error?e.message:"Unable to clear saved session.");return false;}
    generation.current++;
    session.current = null;
    current.current = null;
    setTransaction(null);
    setError(null);
    setRecoveryMessage(null);setCanRetrySavedCheckout(false);
    return true;
  }, []);
  const recover = useCallback(async (manual=false) => {
    if (locked.current) return;
    locked.current = true;
    setRecovering(true);
    setRecoveryMessage(null);setCanRetrySavedCheckout(false);
    const recoveryStarted=performance.now();
    try {
      const saved = session.current ?? readPurchaseSession(purchaseSessionKeys);
      if (!saved) {
        if(manual){setError(null);setRecoveryMessage("No saved purchase was found in this browser. Retry from review only if no coins were inserted; otherwise ask staff for assistance.");logKioskDiagnostic({operation:"recover_prepare",url:`${apiBaseUrl}/api/transactions/recover`,status:null,category:"no_saved_session",durationMs:performance.now()-recoveryStarted});}
        return;
      }
      session.current = saved;
      const value = await kioskApi.recover(saved);
      save(value);
      setError(null);
      if(manual)setRecoveryMessage("Purchase recovered. Showing the latest confirmed server status.");
    } catch(e) {
      if(e instanceof KioskSessionError)logKioskDiagnostic({operation:"recover_prepare",url:`${apiBaseUrl}/api/transactions/recover`,status:null,category:e.code,durationMs:performance.now()-recoveryStarted});
      if(e instanceof KioskApiError && e.status===404 && e.code==="TRANSACTION_NOT_FOUND") {
        setCanRetrySavedCheckout(!current.current);
        setError(current.current?"The original purchase could not be found on this server. Do not start another purchase; ask staff to check the API configuration.":"The saved checkout was not found on the server. You may explicitly retry the same saved request below. Do not insert coins until checkout is confirmed.");
      } else setError(e instanceof KioskSessionError?e.message:`Unable to recover the saved purchase. ${e instanceof KioskApiError?e.message:"Reconnect or ask staff for assistance."} Do not insert coins.`);
    } finally {
      locked.current = false;
      setRecovering(false);
    }
  }, [save]);
  useEffect(() => {
    if (!kioskDemo) void recover();
  }, [recover]);
  useEffect(() => {
    if (
      kioskDemo ||
      !transaction?.databaseId ||
      !session.current ||
      (transaction.dispensingStatus === "dispensed" && (transaction.issueRecovery ? recoveryConfirmed(transaction) : (!transaction.paymentWindow?.controlledDemoAutoBinding || transaction.customerHandoffSafe===true))) ||
      transaction.paymentStatus === "cancelled"
    )
      return;
    let disposed = false;
    let pending = false;
    const revision = generation.current;
    const poll = async () => {
      if (pending || locked.current || !session.current) return;
      pending = true;
      try {
        const value = await kioskApi.get(
          transaction.databaseId!,
          session.current
        );
        if (!disposed && revision === generation.current) {
          save(value);
          setError(null);
        }
      } catch {
        if (!disposed)
          setError(
            "Connection interrupted. Do not insert more coins. Your purchase is saved; reconnecting to check its status…"
          );
      } finally {
        pending = false;
      }
    };
    const timer = window.setInterval(poll, 1500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [
    transaction?.databaseId,
    transaction?.dispensingStatus,
    transaction?.paymentStatus,
    transaction?.customerHandoffSafe,
    transaction?.paymentWindow?.controlledDemoAutoBinding,
    transaction?.issueRecovery?.returnRequested,
    transaction?.issueRecovery?.machineReuseReady,
    save,
  ]);
  useEffect(() => {
    if (
      kioskDemo ||
      !transaction ||
      transaction.dispensingStatus === "dispensed" ||
      transaction.paymentStatus === "cancelled"
    )
      return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [transaction]);
  const reset = async () => {
    if (locked.current || recovering || error) return false;
    const t = current.current;
    if (!t) {
      return clear();
    }
    if(t.issueRecovery && !recoveryConfirmed(t)){setError('Physical recovery or the safe return request is incomplete. The purchase is retained for staff review.');return false;}
      if(t.dispensingStatus==='dispensed' && !canReturnAfterDispensing(t)) {
        setError('Your medicine was dispensed. The purchase is retained because safe handoff to the next customer has not been confirmed. Please ask staff for assistance.');
        return false;
      }
      if(t.dispensingStatus==='failed' && !t.adminRecovered) {
        setError('This dispensing issue requires staff recovery. The original payment and purchase session have been retained.');
        return false;
      }
    if (
      t.dispensingStatus === "dispensed" ||
      t.dispensingStatus === "failed" ||
      t.paymentStatus === "cancelled"
    ) {
      return clear();
    }
    if (!mayLeavePayment(t, t.amountPaid) || !session.current || !t.databaseId)
      return false;
    locked.current = true;
    setBusy(true);
    try {
      await kioskApi.cancel(t.databaseId, session.current);
      return clear();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Cancellation could not be confirmed."
      );
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  if (kioskDemo)
    return {
      ...demo,
      recovering: false,
      recover: async (_manual=false) => {},
      recoveryMessage:null,
      canRetrySavedCheckout:false,
      retrySavedCheckout:async()=>{},
      expirePayment:async()=>{},
      reset: async () => demo.reset(),
    };
  return {
    preview: false,
    simulationEnabled: false,
    transaction,
    busy: busy || recovering,
    recovering,
    recoveryMessage,
    canRetrySavedCheckout,
    retrySavedCheckout: async()=> {
      if(!canRetrySavedCheckout || !session.current || current.current || locked.current || recovering)return;
      locked.current=true;setBusy(true);setRecoveryMessage(null);setCanRetrySavedCheckout(false);
      try {save(await kioskApi.checkout(session.current));setError(null);setRecoveryMessage("Saved checkout confirmed. Showing the original purchase status.");}
      catch(e){setError(e instanceof Error?e.message:"Unable to confirm the saved checkout. Reconnect before retrying.");}
      finally {locked.current=false;setBusy(false);}
    },
    error,
    recover,
    expirePayment: async () => {
      const t=current.current;
      if(locked.current || recovering || !session.current || !t?.databaseId ||
        t.paymentStatus!=='pending' || t.dispensingStatus!=='pending' || t.amountPaid!==0) return;
      locked.current=true;setBusy(true);
      try { save(await kioskApi.expire(t.databaseId,session.current));setError(null); }
      catch(e) {
        // A simultaneous genuine coin/full payment wins over the expiry request.
        try {
          const latest=await kioskApi.get(t.databaseId,session.current);
          save(latest);
          // Expiry can lose a race to a real payment, or its response can be lost
          // after commit. Display the authoritative outcome rather than a stale error.
          if(latest.paymentExpiry?.confirmed || latest.paymentStatus==='successful' || latest.dispensingStatus==='dispensing' || latest.dispensingStatus==='dispensed') {
            setError(null);
            return;
          }
        }
        catch { /* Retain the original recoverable session when the network is unavailable. */ }
        setError(e instanceof Error?e.message:"Expiration could not be confirmed. Preserve this purchase and ask for assistance.");
      } finally {locked.current=false;setBusy(false);}
    },
    insertedAmount: transaction?.amountPaid ?? 0,
    remainingAmount: remainingAmount(
      transaction?.total ?? 0,
      transaction?.amountPaid ?? 0
    ),
    paymentStatus: paymentStatus(transaction, transaction?.amountPaid ?? 0),
    canGoBack:
      !busy &&
      !recovering &&
      !error &&
      (transaction?.paymentStatus === "cancelled" ||
        mayLeavePayment(transaction, transaction?.amountPaid ?? 0)),
    start: async (purchase: Purchase) => {
      if (locked.current || session.current || recovering || current.current)
        return;
      locked.current = true;
      setBusy(true);
      setError(null);
      setRecoveryMessage(null);setCanRetrySavedCheckout(false);
      const preparationStarted=performance.now();
      try {
        const next = newPurchaseSession(
          purchase.selectedMedicine.id,
          purchase.quantity
        );
        persistPurchaseSession(purchaseSessionKey,next);
        session.current = next;
        save(await kioskApi.checkout(next));
      } catch (e) {
        if (e instanceof KioskApiError && [400, 409, 422].includes(e.status) && e.code!=="REQUEST_CONFLICT") {
          if(clear())setError(e.message);
        } else if(e instanceof KioskSessionError) {
          logKioskDiagnostic({operation:"checkout_prepare",url:`${apiBaseUrl}/api/transactions/checkout`,status:null,category:e.code,durationMs:performance.now()-preparationStarted});
          setError(e.message);
        } else
          setError(
            `Checkout could not be confirmed. ${e instanceof KioskApiError?e.message:"Reconnect to recover the same saved purchase; do not insert coins."}`
          );
      } finally {
        locked.current = false;
        setBusy(false);
      }
    },
    // Intentionally inert: production customers cannot produce payment/sensor events.
    simulateCoin: (_amount: number) => {},
    confirmDemoUnit: async (_unit: number, _success: boolean) => {},
    reset,
  };
}
