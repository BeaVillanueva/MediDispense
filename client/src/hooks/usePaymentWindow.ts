import { useEffect, useState } from "react";
import type { Transaction } from "@shared/medidispense";
import { paymentWindowState } from "@/lib/paymentWindow";

/** Advisory clock only; never calls cancel, reset, checkout or a hardware endpoint. */
export function usePaymentWindow(transaction: Transaction | null) {
  const key = `${transaction?.id}:${transaction?.paymentWindow?.serverNowMs}`;
  const [tick, setTick] = useState({ key, elapsed: 0 });
  useEffect(() => {
    const start = performance.now();
    const wallStart = Date.now();
    setTick({ key, elapsed: 0 });
    const timer = window.setInterval(() => setTick({ key, elapsed: Math.max(0, performance.now() - start, Date.now() - wallStart) }), 250);
    return () => window.clearInterval(timer);
  }, [key]);
  return paymentWindowState(transaction, tick.key === key ? tick.elapsed : 0);
}
