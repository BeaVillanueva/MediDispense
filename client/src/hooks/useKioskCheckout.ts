import { useCallback, useEffect, useRef, useState } from "react";
import type { Transaction } from "@shared/medidispense";
import {
  KioskApiError,
  kioskApi,
  newPurchaseSession,
  purchaseSessionKey,
  type PurchaseSession,
} from "@/lib/kioskApi";
import { kioskDemo } from "@/lib/apiConfig";
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
  const session = useRef<PurchaseSession | null>(null);
  const current = useRef<Transaction | null>(null);
  const locked = useRef(false);
  const generation = useRef(0);
  const save = useCallback((value: Transaction) => {
    current.current = value;
    setTransaction(value);
  }, []);
  const clear = useCallback(() => {
    generation.current++;
    localStorage.removeItem(purchaseSessionKey);
    session.current = null;
    current.current = null;
    setTransaction(null);
    setError(null);
  }, []);
  const recover = useCallback(async () => {
    if (locked.current) return;
    locked.current = true;
    setRecovering(true);
    setError(null);
    try {
      const raw = localStorage.getItem(purchaseSessionKey);
      if (!raw) {
        session.current = null;
        return;
      }
      const saved = JSON.parse(raw) as PurchaseSession;
      session.current = saved;
      let value: Transaction;
      try {
        value = await kioskApi.recover(saved);
      } catch (e) {
        if (e instanceof KioskApiError && e.code === "TRANSACTION_NOT_FOUND")
          value = await kioskApi.checkout(saved);
        else throw e;
      }
      save(value);
      setError(null);
    } catch {
      setError(
        "Unable to recover your purchase. Do not insert coins. Reconnect to check its status or ask pharmacy staff for help."
      );
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
      transaction.dispensingStatus === "dispensed" ||
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
      clear();
      return true;
    }
    if (t.dispensingStatus === "dispensed" || t.paymentStatus === "cancelled") {
      clear();
      return true;
    }
    if (!mayLeavePayment(t, t.amountPaid) || !session.current || !t.databaseId)
      return false;
    locked.current = true;
    setBusy(true);
    try {
      await kioskApi.cancel(t.databaseId, session.current);
      clear();
      return true;
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
      recover: async () => {},
      reset: async () => demo.reset(),
    };
  return {
    preview: false,
    simulationEnabled: false,
    transaction,
    busy: busy || recovering,
    recovering,
    error,
    recover,
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
      try {
        const next = newPurchaseSession(
          purchase.selectedMedicine.id,
          purchase.quantity
        );
        localStorage.setItem(purchaseSessionKey, JSON.stringify(next));
        session.current = next;
        save(await kioskApi.checkout(next));
      } catch (e) {
        if (e instanceof KioskApiError && [400, 409, 422].includes(e.status)) {
          clear();
          setError(e.message);
        } else
          setError(
            "Checkout response was interrupted. Reconnect to recover the same purchase; do not insert coins."
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
