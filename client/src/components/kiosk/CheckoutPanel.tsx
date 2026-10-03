import { useEffect, useRef, useState } from "react";
import { Check, Coins, LoaderCircle, TriangleAlert } from "lucide-react";
import type { useKioskCheckout } from "@/hooks/useKioskCheckout";
import { peso, SUCCESS_RESET_SECONDS } from "@/lib/kioskPurchase";
import { NoChangeNotice } from "./KioskControls";
import { DevelopmentControls } from "./DevelopmentControls";

export function CheckoutPanel({
  checkout,
  onFinish,
  onBack,
}: {
  checkout: ReturnType<typeof useKioskCheckout>;
  onFinish: () => void;
  onBack: () => void;
}) {
  const { transaction, insertedAmount, paymentStatus: status } = checkout;
  const [seconds, setSeconds] = useState(SUCCESS_RESET_SECONDS);
  const finish = useRef(onFinish);
  finish.current = onFinish;
  useEffect(() => {
    if (status !== "SUCCESS") return;
    const deadline = Date.now() + SUCCESS_RESET_SECONDS * 1000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSeconds(left);
      if (left === 0) finish.current();
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [status]);
  if (!transaction) return null;
  const item = transaction.items[0];
  const complete = status === "SUCCESS";
  const failed = status === "DISPENSE_FAILED";
  const paid = transaction.paymentStatus === "successful";
  const progress = transaction.dispensedQuantity ?? 0;
  const requested = transaction.requestedQuantity ?? item.quantity;
  const excess = Math.max(
    0,
    Math.round((insertedAmount - transaction.total) * 100) / 100
  );
  const waiting = !paid && insertedAmount < transaction.total;
  const disabled = checkout.busy || !!checkout.error;
  return (
    <section className="kv-panel kv-checkout" aria-busy={checkout.busy}>
      <div className={`kv-status-icon ${complete ? "kv-success" : ""}`}>
        {complete ? (
          <Check size={32} />
        ) : failed || checkout.error ? (
          <TriangleAlert size={32} />
        ) : paid ? (
          <LoaderCircle size={32} className={failed ? "" : "kv-spin"} />
        ) : (
          <Coins size={32} />
        )}
      </div>
      <p className="kv-eyebrow">
        {complete
          ? "Confirmed simulation"
          : failed
            ? "Assistance needed"
            : paid
              ? "Payment complete"
              : "Coin payment"}
      </p>
      <h1>
        {complete
          ? "Medicine dispensed — simulation"
          : failed
            ? "Dispensing issue"
            : checkout.error
              ? "Assistance needed"
              : paid
                ? "Dispensing your medicine"
                : "Insert the exact amount"}
      </h1>
      <p>
        {complete
          ? "All requested units were confirmed in this preview. No physical medicine was dispensed. Thank you for using MediDispense."
          : failed
            ? "Payment was received, but the machine could not confirm that all requested medicine was dispensed. Please contact assistance."
            : paid
              ? "Please wait. Do not remove your medicine until dispensing is complete."
              : "Coin slot payment only. This preview is not connected to a coin acceptor; do not insert real money."}
      </p>
      <div className="kv-purchase-identity">
        <strong>{item.medicineName}</strong>
        <span>
          Quantity: {requested} · {peso(item.unitPrice)} each
        </span>
      </div>
      <NoChangeNotice />
      {excess > 0 && (
        <div className="kv-message kv-error" role="alert">
          <strong>OVERPAYMENT · {peso(excess)} excess inserted</strong>
          <p>
            The full {peso(insertedAmount)} has been recorded. This machine
            cannot provide change. The excess has not been refunded. Please
            contact assistance.
          </p>
        </div>
      )}
      {!complete && (
        <div className="kv-payment-amounts kv-coin-amounts">
          <div>
            <span>Total to pay</span>
            <strong>{peso(transaction.total)}</strong>
          </div>
          <div>
            <span>Inserted</span>
            <strong>{peso(insertedAmount)}</strong>
          </div>
          <div>
            <span>Remaining</span>
            <strong>{peso(checkout.remainingAmount)}</strong>
          </div>
        </div>
      )}
      {waiting && (
        <>
          <progress
            aria-label="Coin payment progress"
            max={Math.max(transaction.total, 1)}
            value={insertedAmount}
          />
          <p role="status">
            {insertedAmount > 0
              ? "Payment in progress. Inserted coins cannot be returned."
              : "Please prepare the exact amount before inserting coins."}
          </p>
          <DevelopmentControls
            enabled={checkout.simulationEnabled}
            busy={disabled}
            coinInput
            onCoin={checkout.simulateCoin}
            onUnit={checkout.confirmDemoUnit}
          />
        </>
      )}
      {!waiting && !paid && !checkout.error && (
        <p className="kv-payment-complete" role="status">
          PAYMENT COMPLETE · Verifying payment before dispensing. Please wait.
        </p>
      )}
      {paid && !complete && !failed && (
        <div aria-live="polite">
          <h2 className="kv-unit-progress">
            {transaction.dispensingStatus === "dispensing"
              ? `Dispensing ${Math.min(progress + 1, requested)} of ${requested}`
              : "Preparing dispensing request…"}
          </h2>
          <progress
            aria-label="Confirmed medicine units"
            max={requested}
            value={progress}
          />
          <p>
            {progress} of {requested} units confirmed
          </p>
          {transaction.dispensingStatus === "dispensing" && (
            <DevelopmentControls
              enabled={checkout.simulationEnabled}
              busy={disabled}
              coinInput={false}
              unitNumber={progress + 1}
              onCoin={checkout.simulateCoin}
              onUnit={checkout.confirmDemoUnit}
            />
          )}
        </div>
      )}
      {failed && (
        <div className="kv-message kv-error" role="alert">
          <strong>
            {progress} of {requested} units confirmed
          </strong>
          <p>
            Only confirmed units were deducted from preview inventory. No
            automatic refund is available. Keep this reference for assistance.
          </p>
        </div>
      )}
      <p className="kv-reference">
        Purchase reference: <strong>{transaction.id}</strong>
      </p>
      {complete && (
        <>
          <div className="kv-receipt">
            <div className="kv-receipt-line">
              <span>Confirmed quantity</span>
              <strong>{progress}</strong>
            </div>
            <div className="kv-receipt-line">
              <span>Purchase total</span>
              <strong>{peso(transaction.total)}</strong>
            </div>
            <div className="kv-receipt-line">
              <span>Total paid (simulation)</span>
              <strong>{peso(transaction.amountPaid)}</strong>
            </div>
          </div>
          <button className="kv-button kv-primary kv-wide" onClick={onFinish}>
            Done
          </button>
          <p className="kv-reset-note">
            Returning to medicines in {seconds} seconds.
          </p>
        </>
      )}
      {checkout.canGoBack && (
        <button className="kv-button kv-secondary kv-wide" onClick={onBack}>
          Back to review
        </button>
      )}
    </section>
  );
}
