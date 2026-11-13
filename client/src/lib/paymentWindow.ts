import type { Transaction } from "@shared/medidispense";

export function expirationBlockerMessage(code: string): string {
  const messages: Record<string,string> = {
    CONTROLLER_DIAGNOSTICS_MISSING: "No payment status report has been received from the machine. Reconnect the controller and check its diagnostics.",
    CONTROLLER_DIAGNOSTICS_STALE: "The machine payment status report is out of date. Check its Wi-Fi and backend connection.",
    MULTIPLE_CONTROLLER_REPORTS: "More than one controller is registered. Staff must identify the active machine.",
    CONTROLLER_SESSION_MISMATCH: "The controller has not confirmed this purchase. Staff must check the session binding.",
    BACKEND_SESSION_UNVERIFIED: "The controller has not verified the payment session with the server.",
    PAYMENT_STORAGE_UNHEALTHY: "The controller payment journal needs staff review.",
    UNCONFIRMED_PAYMENT_EVENTS: "Unconfirmed coin events must be reconciled before cancellation.",
    COIN_QUEUE_OVERFLOW: "The coin queue needs staff reconciliation.",
    INCOMPLETE_COIN_PULSES: "An incomplete coin pulse sequence needs staff review.",
    PAYMENT_RECONCILIATION_REQUIRED: "Payment reconciliation is required before cancellation.",
    CONTROLLER_BOOT_REVIEW_REQUIRED: "The controller requires its existing startup safety review.",
    CONTROLLER_BINDING_REVIEW_REQUIRED: "An interrupted session binding requires staff review.",
    FIRMWARE_DEMO_MODE_UNCONFIRMED: "The controller has not confirmed the supervised demonstration setting.",
    AUTOMATIC_BINDING_BLOCKED: "Automatic session binding is waiting for controller safety checks. Staff can inspect its diagnostics.",
    TRANSACTION_REQUIRES_EXPLICIT_STAFF_APPROVAL: "This existing purchase is protected and requires explicit staff approval before automatic processing.",
    CONTROLLER_EXPIRATION_DRAIN_UNCONFIRMED: "Waiting for the controller to finish checking coin pulses after the deadline. Do not insert more coins.",
  };
  return messages[code] ?? "The payment state needs staff verification before cancellation.";
}

export function paymentWindowState(transaction: Transaction | null, elapsedMs = 0) {
  const window = transaction?.paymentWindow;
  const active = transaction?.paymentStatus === "pending" && transaction.dispensingStatus === "pending";
  if (!active || !window || !Number.isFinite(window.deadlineMs) || !Number.isFinite(window.serverNowMs)) return null;
  const seconds = Math.max(0, Math.ceil((window.deadlineMs - window.serverNowMs - Math.max(0, elapsedMs)) / 1000));
  return { seconds, warning: seconds > 0 && seconds <= 60, elapsed: seconds === 0 };
}
export function paymentCountdownLabel(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function paymentExpiryReturnSeconds(transaction: Transaction | null, elapsedMs = 0): number {
  if(transaction?.paymentStatus !== 'cancelled' || !transaction.paymentExpiry?.confirmed || !transaction.paymentWindow)return 3;
  return Math.max(0,Math.ceil((transaction.paymentExpiry.returnAtMs-transaction.paymentWindow.serverNowMs-Math.max(0,elapsedMs))/1000));
}

/** A request for authoritative verification, never permission to clear a purchase. */
export function shouldCheckPaymentExpiration(transaction: Transaction | null, elapsed: boolean) {
  return elapsed && !!transaction?.databaseId && transaction.paymentStatus === "pending"
    && transaction.dispensingStatus === "pending" && transaction.amountPaid === 0;
}
