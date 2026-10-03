import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { Transaction } from "@shared/medidispense";
import {
  applyCoinEvent,
  mayLeavePayment,
  paymentStatus,
  remainingAmount,
  type CoinBalance,
  type Purchase,
} from "@/lib/kioskPurchase";

// Development adapter only. Replace with authenticated backend coin/status events
// for production; never wire a motor or a production sensor callback into React.
export function useKioskCheckout() {
  const simulationEnabled =
    import.meta.env.DEV && import.meta.env.VITE_KIOSK_SIMULATION !== "false";
  const create = trpc.kiosk.checkout.useMutation({ retry: false });
  const payment = trpc.kiosk.verifyPayment.useMutation({ retry: false });
  const dispense = trpc.kiosk.requestDispense.useMutation({ retry: false });
  const sensor = trpc.kiosk.verifyDispense.useMutation({ retry: false });
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [balance, setBalance] = useState<CoinBalance>({
    insertedAmount: 0,
    eventIds: [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const blocked = useRef(false);
  const current = useRef<Transaction | null>(null);
  const coins = useRef(balance);
  const save = (value: Transaction) => {
    current.current = value;
    setTransaction(value);
  };
  async function run(action: () => Promise<void>) {
    if (locked.current || blocked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch {
      blocked.current = true;
      setError(
        "We could not confirm the last step. Please contact pharmacy staff. Do not insert more coins or refresh this page. No refund has been issued."
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      !transaction ||
      paymentStatus(transaction, balance.insertedAmount) === "SUCCESS"
    )
      return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [transaction, balance.insertedAmount]);
  const reset = () => {
    if (locked.current || blocked.current) return false;
    if (
      !mayLeavePayment(current.current, coins.current.insertedAmount) &&
      paymentStatus(current.current, coins.current.insertedAmount) !== "SUCCESS"
    )
      return false;
    current.current = null;
    coins.current = { insertedAmount: 0, eventIds: [] };
    setTransaction(null);
    setBalance(coins.current);
    setError(null);
    return true;
  };
  return {
    preview: true as const,
    simulationEnabled,
    transaction,
    busy,
    error,
    insertedAmount: balance.insertedAmount,
    remainingAmount: remainingAmount(
      transaction?.total ?? 0,
      balance.insertedAmount
    ),
    paymentStatus: paymentStatus(transaction, balance.insertedAmount),
    canGoBack:
      !busy && !error && mayLeavePayment(transaction, balance.insertedAmount),
    start: (purchase: Purchase) =>
      run(async () => {
        if (current.current || !simulationEnabled) return;
        const created = await create.mutateAsync({
          items: [
            {
              medicineId: purchase.selectedMedicine.id,
              quantity: purchase.quantity,
            },
          ],
        });
        save(created);
        if (created.total === 0) {
          save(
            await payment.mutateAsync({
              transactionId: created.id,
              amountPaid: 0,
            })
          );
          save(await dispense.mutateAsync({ transactionId: created.id }));
        }
      }),
    // This is a simulation entry point, not proof of real payment. Production
    // must ingest a backend-verified cumulative balance and transaction state.
    simulateCoin: (amount: number) => {
      const value = current.current;
      if (
        !simulationEnabled ||
        !value ||
        locked.current ||
        blocked.current ||
        value.paymentStatus !== "pending" ||
        coins.current.insertedAmount >= value.total
      )
        return;
      const next = applyCoinEvent(coins.current, {
        id: crypto.randomUUID(),
        amount,
      });
      coins.current = next;
      setBalance(next);
      if (next.insertedAmount >= value.total)
        void run(async () => {
          save(
            await payment.mutateAsync({
              transactionId: value.id,
              amountPaid: next.insertedAmount,
            })
          );
          save(await dispense.mutateAsync({ transactionId: value.id }));
        });
    },
    confirmDemoUnit: (unitNumber: number, success: boolean) =>
      run(async () => {
        const value = current.current;
        if (
          !simulationEnabled ||
          !value ||
          value.dispensingStatus !== "dispensing"
        )
          return;
        save(
          await sensor.mutateAsync({
            transactionId: value.id,
            unitNumber,
            success,
          })
        );
      }),
    reset,
  };
}
