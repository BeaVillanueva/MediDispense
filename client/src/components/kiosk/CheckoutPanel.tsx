import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Coins, PackageOpen, TriangleAlert } from "lucide-react";
import type { useKioskCheckout } from "@/hooks/useKioskCheckout";
import { peso, SUCCESS_RESET_SECONDS } from "@/lib/kioskPurchase";
import { DevelopmentControls } from "./DevelopmentControls";
import { CoinPaymentIllustration } from "./CoinPaymentIllustration";
import type { Medicine } from "@shared/medidispense";
import { MedicineUsageGuide } from "./MedicineUsageGuide";
import { canShowUsageGuide } from "@/lib/medicineInformation";
import { dispensingConfirmationTimedOut, timeoutReturnSeconds } from "@/lib/dispensingTimeout";

export function CheckoutPanel({
  checkout,
  onFinish,
  onBack,
  onBrowse,
  medicine,
}: {
  checkout: ReturnType<typeof useKioskCheckout>;
  onFinish: () => void;
  onBack: () => void;
  onBrowse: () => void;
  medicine?: Medicine;
}) {
  const { transaction, insertedAmount, paymentStatus: status } = checkout;
  const [seconds, setSeconds] = useState(SUCCESS_RESET_SECONDS);
  const [waitSeconds, setWaitSeconds] = useState(0);
  useEffect(() => {
    const base = transaction?.dispensingWaitSeconds ?? 0;
    const started = Date.now();
    setWaitSeconds(base);
    const timer = window.setInterval(() => setWaitSeconds(base + (Date.now() - started) / 1000), 1000);
    return () => window.clearInterval(timer);
  }, [transaction?.id, transaction?.dispensingWaitSeconds]);
  const finish = useRef(onFinish);
  const browse = useRef(onBrowse);
  browse.current = onBrowse;
  const elapsed = Math.max(waitSeconds, transaction?.dispensingWaitSeconds ?? 0);
  const timedOut = !checkout.preview && dispensingConfirmationTimedOut(transaction, elapsed);
  const homeSeconds = timeoutReturnSeconds(elapsed);
  useEffect(() => {
    if (timedOut && homeSeconds === 0) browse.current();
  }, [timedOut, homeSeconds]);
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
  const complete = status === "SUCCESS" && canShowUsageGuide(transaction);
  const cancelled = transaction.paymentStatus === "cancelled";
  const failed = status === "DISPENSE_FAILED";
  const paid = transaction.paymentStatus === "successful";
  const progress = transaction.dispensedQuantity ?? 0;
  const requested = transaction.requestedQuantity ?? item.quantity;
  const excess = Math.max(
    0,
    Math.round((insertedAmount - transaction.total) * 100) / 100
  );
  const waiting = !cancelled && !paid && insertedAmount < transaction.total;
  const verifying = !cancelled && !waiting && !paid && !checkout.error;
  const disabled = checkout.busy || !!checkout.error;
  return (
    <section className={`kv-panel kv-checkout ${complete ? "kv-state-success" : failed || timedOut || checkout.error ? "kv-state-error" : paid ? "kv-state-dispensing" : verifying ? "kv-state-processing" : "kv-state-payment"}`} aria-busy={checkout.busy}>
      <div className={`kv-status-icon ${complete ? "kv-success" : !failed && !timedOut && !checkout.error && !paid ? "kv-payment-art" : ""}`} aria-hidden="true">
        {complete ? (
          <Check size={32} />
        ) : failed || timedOut || checkout.error ? (
          <TriangleAlert size={32} />
        ) : paid ? (
          <PackageOpen size={64} />
        ) : verifying ? (
          <Coins size={48} />
        ) : (
          <CoinPaymentIllustration />
        )}
      </div>
      <h1>
        {complete
          ? checkout.preview ? "Transaction Successful — simulation" : "Transaction Successful!"
          : timedOut
            ? "Dispensing confirmation timed out"
          : failed
            ? "Dispensing issue"
            : checkout.error
              ? "Assistance needed"
              : paid
                ? "Dispensing your medicine"
                : verifying
                  ? "Processing Payment…"
                : cancelled
                  ? "Purchase cancelled"
                  : "Insert Payment"}
      </h1>
      {(!waiting || checkout.preview) && <p>
        {complete
          ? checkout.preview
            ? "All requested units were confirmed in this preview. No physical medicine was dispensed."
            : "Please collect your medicine below. Thank you for using MediDispense."
          : timedOut
            ? "No dispensing confirmation was received for 2 minutes. Please ask staff for assistance. Do not insert more coins or start another purchase."
          : failed
            ? "Payment was received, but the machine could not confirm that all requested medicine was dispensed. Please contact assistance."
            : paid
              ? "Please wait. Do not remove your medicine until dispensing is complete."
              : cancelled
                ? "This unpaid purchase was cancelled or expired. No coins were recorded."
                : checkout.preview
                  ? "Coin slot payment only. This preview is not connected to a coin acceptor; do not insert real money."
                  : "Insert coins into the coin slot. Your payment updates here automatically."}
      </p>}
      {!complete && !paid && <p className="kv-payment-total">Total amount <strong>{peso(transaction.total)}</strong></p>}
      {paid && !complete && <div className="kv-purchase-identity">
        <strong>{item.medicineName}</strong>
        <span>
          Quantity: {requested} · {peso(item.unitPrice)} each
        </span>
      </div>}
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
      {!complete && !paid && (
        <div className="kv-payment-amounts kv-coin-amounts" role="status" aria-live="polite" aria-atomic="true">
          <div className="kv-amount-inserted">
            <span className="kv-money-icon kv-money-icon-inserted"><img src={`${import.meta.env.BASE_URL}images/kiosk/payment/coins.png`} alt="" aria-hidden="true" width={76} height={76} /></span>
            <div><span>Inserted</span><strong>{peso(insertedAmount)}</strong></div>
          </div>
          <div className="kv-amount-remaining">
            <span className="kv-money-icon kv-money-icon-remaining"><img src={`${import.meta.env.BASE_URL}images/kiosk/payment/wallet.png`} alt="" aria-hidden="true" width={76} height={76} /></span>
            <div><span>Remaining</span><strong>{peso(checkout.remainingAmount)}</strong></div>
          </div>
        </div>
      )}
      {waiting && (
        <>
          {insertedAmount > 0 && <p className="kv-partial-payment" role="status">Insert {peso(checkout.remainingAmount)} more to complete payment.</p>}
          <DevelopmentControls
            enabled={checkout.simulationEnabled}
            busy={disabled}
            coinInput
            onCoin={checkout.simulateCoin}
            onUnit={checkout.confirmDemoUnit}
          />
        </>
      )}
      {!cancelled && !waiting && !paid && !checkout.error && (
        <p className="kv-payment-complete" role="status">
          Please wait while we validate your payment.
        </p>
      )}
      {paid && !complete && !failed && !timedOut && (
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
      {timedOut && <div className="kv-message kv-error" role="alert"><strong>{progress} of {requested} units confirmed</strong><p>Your payment and purchase reference are saved. The motor status is unknown. Staff must check the machine before clearing this purchase.</p></div>}
      {timedOut && <><button className="kv-button kv-primary kv-wide" onClick={onBrowse}>Back to medicines</button><p role="status">Returning to medicines in {homeSeconds} seconds. New purchases are paused until staff resolves this dispense.</p></>}
      {failed && (
        <>
          <div className="kv-message kv-error" role="alert">
            <strong>
              {progress} of {requested} units confirmed
            </strong>
            <p>
              Only confirmed units were deducted from inventory. No automatic
              refund is available. Keep this reference for assistance.
            </p>
          </div>

          <button
            className="kv-button kv-primary kv-wide"
            onClick={onFinish}
            disabled={checkout.busy}
          >
            Start New Purchase
          </button>
        </>
      )}
      <p className="kv-reference">
        Purchase reference: <strong>{transaction.id}</strong>
      </p>
      {complete && (
        <>
          <MedicineUsageGuide name={item.medicineName} medicine={medicine} />
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
              <span>
                {checkout.preview ? "Total paid (simulation)" : "Total paid"}
              </span>
              <strong>{peso(transaction.amountPaid)}</strong>
            </div>
          </div>
          <button className="kv-button kv-primary kv-wide" onClick={onFinish}>
            Collect Your Medicine <ArrowRight size={22} />
          </button>
          <p className="kv-reset-note">
            Returning to medicines in {seconds} seconds.
          </p>
        </>
      )}
      {checkout.canGoBack && (
        <button className="kv-button kv-primary kv-wide" onClick={onBack}>
          <ArrowLeft size={22} /> Back to Review
        </button>
      )}
    </section>
  );
}
