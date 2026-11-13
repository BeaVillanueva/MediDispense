import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Coins, PackageOpen, TriangleAlert } from "lucide-react";
import type { useKioskCheckout } from "@/hooks/useKioskCheckout";
import { peso, remainingAmount, SUCCESS_RESET_SECONDS } from "@/lib/kioskPurchase";
import { DevelopmentControls } from "./DevelopmentControls";
import { CoinPaymentIllustration } from "./CoinPaymentIllustration";
import type { Medicine } from "@shared/medidispense";
import { KioskReceiptDialog } from './KioskReceiptDialog';
import { canViewEReceipt } from '@/lib/transactionReceipt';
import { useKioskReceipt } from '@/hooks/useKioskReceipt';
import { canShowUsageGuide, canReturnAfterDispensing } from "@/lib/medicineInformation";
import { dispensingConfirmationTimedOut, timeoutReturnSeconds, recoveryConfirmed } from "@/lib/dispensingTimeout";
import { usePaymentWindow } from "@/hooks/usePaymentWindow";
import { paymentCountdownLabel, shouldCheckPaymentExpiration, expirationBlockerMessage, paymentExpiryReturnSeconds } from "@/lib/paymentWindow";

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
  const { transaction, paymentStatus: status } = checkout;
  const receiptEligible=!!transaction && !checkout.preview && !checkout.error && status==='SUCCESS' && canViewEReceipt(transaction);
  const receipt=useKioskReceipt(receiptEligible,transaction?.id);
  const receiptFinished=useRef<string|null>(null);
  const safeCompletedReturn=checkout.preview === true || canReturnAfterDispensing(transaction);
  const insertedAmount = transaction?.amountPaid ?? 0;
  const paymentWindow = usePaymentWindow(checkout.preview ? null : transaction);
  const [seconds, setSeconds] = useState(SUCCESS_RESET_SECONDS);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [expiryElapsed, setExpiryElapsed] = useState(0);
  const attemptedExpiry = useRef<string | null>(null);
  const expiryFinish = useRef<string | null>(null);
  const safelyExpired = transaction?.paymentStatus === "cancelled" && transaction?.paymentExpiry?.confirmed === true;
  const expiryReturnSeconds = paymentExpiryReturnSeconds(transaction,expiryElapsed);
  useEffect(() => {
    if(!transaction || !shouldCheckPaymentExpiration(transaction, paymentWindow?.elapsed === true) ||
       checkout.busy || checkout.error || attemptedExpiry.current===transaction.id) return;
    attemptedExpiry.current=transaction.id;
    void checkout.expirePayment();
  }, [transaction, paymentWindow?.elapsed, checkout.busy, checkout.error]);
  useEffect(() => {
    if(!safelyExpired) return;
    const start=performance.now();
    setExpiryElapsed(0);
    const timer=window.setInterval(()=>setExpiryElapsed(performance.now()-start),100);
    return ()=>window.clearInterval(timer);
  }, [safelyExpired, transaction?.paymentWindow?.serverNowMs]);
  useEffect(() => {
    if(!safelyExpired || expiryReturnSeconds>0 || !transaction || checkout.error || checkout.busy || expiryFinish.current===transaction.id) return;
    expiryFinish.current=transaction.id;
    void onFinish();
  }, [safelyExpired, expiryReturnSeconds, transaction?.id, checkout.error, checkout.busy, onFinish]);
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
  useEffect(()=>{
    if(!receiptEligible||!receipt.expired||!safeCompletedReturn||checkout.busy||checkout.error||receiptFinished.current===transaction?.id)return;
    receiptFinished.current=transaction!.id;
    finish.current();
  },[receiptEligible,receipt.expired,safeCompletedReturn,checkout.busy,checkout.error,transaction?.id]);
  useEffect(() => {
    if (status !== "SUCCESS" || !safeCompletedReturn || receiptEligible || checkout.busy || checkout.error) return;
    const deadline = Date.now() + SUCCESS_RESET_SECONDS * 1000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSeconds(left);
      if (left === 0) finish.current();
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [status, safeCompletedReturn,receiptEligible,checkout.busy,checkout.error]);
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
  const amountStillNeeded = remainingAmount(transaction.total, insertedAmount);
  const waiting = !cancelled && !paid && insertedAmount < transaction.total;
  const verifying = !cancelled && !waiting && !paid && !checkout.error;
  const disabled = checkout.busy || !!checkout.error;
  return (
    <section className={`kv-panel kv-checkout ${complete && excess === 0 ? "kv-state-success" : failed || timedOut || checkout.error ? "kv-state-error" : paid ? "kv-state-dispensing" : verifying ? "kv-state-processing" : "kv-state-payment"}`} aria-busy={checkout.busy}>
      <div className={`kv-status-icon ${complete && excess === 0 ? "kv-success" : !failed && !timedOut && !checkout.error && !paid ? "kv-payment-art" : ""}`} aria-hidden="true">
        {excess > 0 ? (
          <TriangleAlert size={32} />
        ) : complete ? (
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
        {safelyExpired ? "Payment Time Expired" : excess > 0
          ? "Overpayment - assistance needed"
          : complete
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
                  : paymentWindow?.elapsed ? "Payment assistance needed" : "Insert Exact Payment"}
      </h1>
      {waiting && !checkout.error && !paymentWindow?.elapsed && !checkout.preview && <p className="kv-exact-instructions">Please insert the exact amount. No change is provided.</p>}
      {safelyExpired && <><p>No payment was received. Your purchase has been cancelled.</p><p role="status">Returning to Choose Medicine in {expiryReturnSeconds} seconds.</p></>}
      {!safelyExpired && (!waiting || checkout.preview) && <p>
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
      {waiting && transaction.paymentWindow?.controlledDemonstration && <p role="status">Controlled demonstration — no coins may be inserted after the deadline. Physical coin acceptance is not disabled.</p>}
      {waiting && !checkout.preview && <aside className={`kv-payment-window ${paymentWindow?.warning || paymentWindow?.elapsed ? "kv-payment-window-warning" : ""}`} aria-label="Payment time">
        {paymentWindow ? <>
          <div className="kv-payment-window-clock"><span>Payment Time Remaining</span><strong role="timer" aria-label="Payment time remaining" aria-live="off">{paymentCountdownLabel(paymentWindow.seconds)}</strong></div>
          {paymentWindow.warning && !checkout.error && <p role="status">Your payment session will expire soon. Please insert coins to continue.</p>}
          {paymentWindow.elapsed && !!transaction.paymentWindow?.expirationBlockers?.length && <div role="status" aria-label="Payment expiration blockers"><strong>Cancellation is waiting for verification</strong><ul>{transaction.paymentWindow.expirationBlockers.map(code=><li key={code}>{expirationBlockerMessage(code)}</li>)}</ul></div>}
          {paymentWindow.elapsed && <p role="alert">{insertedAmount > 0 ? "Payment time elapsed. Coins recorded by the server remain saved. Please ask for assistance." : "Payment time elapsed. No payment has been confirmed by the server. Please ask for assistance."} Do not insert more coins. The machine cannot remotely pause coin acceptance; your purchase remains open for reconciliation.</p>}
          {checkout.error && <p role="status">Connection interrupted. The payment state cannot be confirmed. Do not insert coins; reconnect to recover this purchase.</p>}
        </> : <p role="status">Waiting for server payment timing. Do not insert coins until the connection and payment session are confirmed.</p>}
      </aside>}
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
      {!complete && !cancelled && (
        <div className="kv-exact-payment-amounts" role="status" aria-live="polite" aria-atomic="true">
          {checkout.error && <p className="kv-confirmed-amounts-note">Last confirmed amounts. Reconnect to check the latest payment state; do not insert coins.</p>}
          <div className="kv-payment-icon-cards">
            <div className="kv-payment-icon-card">
              <img src={`${import.meta.env.BASE_URL}images/kiosk/payment/coins.png`} alt="" aria-hidden="true" width={64} height={64} />
              <div className="kv-exact-inserted"><span>Coins Inserted</span><strong>{peso(insertedAmount)}</strong></div>
            </div>
            <div className="kv-payment-icon-card">
              <img src={`${import.meta.env.BASE_URL}images/kiosk/payment/wallet.png`} alt="" aria-hidden="true" width={64} height={64} />
              <div className="kv-exact-needed"><span>Amount Still Needed</span><strong>{peso(amountStillNeeded)}</strong></div>
            </div>
          </div>
        </div>
      )}
      {waiting && (
        <>
          {insertedAmount > 0 && !paymentWindow?.elapsed && <p className="kv-partial-payment" role="status">Payment has started, so returning or cancelling is unavailable. Ask staff if you need assistance; your purchase reference is preserved.</p>}
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

          {(checkout.preview || (transaction.issueRecovery ? recoveryConfirmed(transaction) : transaction.adminRecovered)) && <button
            className="kv-button kv-primary kv-wide"
            onClick={onFinish}
            disabled={checkout.busy}
          >
            Start New Purchase
          </button>}
        </>
      )}
      <p className="kv-reference">
        Purchase reference: <strong>{transaction.id}</strong>
      </p>
      {complete && (
        <>
          {receiptEligible && <>
            <button className="kv-button kv-secondary kv-wide" onClick={receipt.reopen}>View E-Receipt</button>
            <KioskReceiptDialog transaction={transaction} open={receipt.open} seconds={receipt.seconds} held={receipt.held} onClose={()=>{receipt.close();if(safeCompletedReturn&&!checkout.busy&&!checkout.error)onFinish();}}/>
          </>}
          {safeCompletedReturn ? <>
            <button className="kv-button kv-primary kv-wide" disabled={checkout.busy||!!checkout.error} onClick={onFinish}>Return to Choose Medicine <ArrowRight size={22} /></button>
            {!receiptEligible&&<p className="kv-reset-note">Returning to medicines in {seconds} seconds.</p>}
          </> : <p className="kv-message" role="status">{transaction.paymentWindow?.controlledDemoAutoBinding&&!transaction.issueRecovery?"Please collect your medicine. Waiting for the machine payment status before returning.":"Please collect your medicine. A staff check is required before the next purchase."}</p>}
        </>
      )}
      {checkout.canGoBack && !paymentWindow?.elapsed && !safelyExpired && (
        <button className="kv-button kv-secondary kv-wide" onClick={onBack}>
          <ArrowLeft size={20} /> Back to Quantity
        </button>
      )}
    </section>
  );
}
