import type { Transaction } from "@shared/medidispense";

export const DISPENSING_CONFIRMATION_TIMEOUT_SECONDS = 120;
export const TIMEOUT_RETURN_HOME_SECONDS = 20;

export function timeoutReturnSeconds(elapsed: number) {
  return Math.max(0, Math.ceil(DISPENSING_CONFIRMATION_TIMEOUT_SECONDS + TIMEOUT_RETURN_HOME_SECONDS - elapsed));
}

// Call only with a server response, never a client-derived timeout state.
export function recoveryConfirmed(transaction: Transaction | null) {
  if(transaction?.dispensingRecovery && !transaction.dispensingRecovery.ready)return false;
  if(transaction?.issueRecovery)return ['failed','dispensed'].includes(transaction.dispensingStatus) && transaction.issueRecovery.returnRequested && transaction.issueRecovery.machineReuseReady && !(transaction.issueRecovery.machineReviewRequired??transaction.issueRecovery.reviewRequired);
  return transaction?.dispensingStatus === "failed" && transaction.adminRecovered === true;
}

export function dispensingRecoveryMessage(transaction:Transaction|null) {
  if(recoveryConfirmed(transaction))return "Staff checks are complete. You can return to Choose Medicine.";
  const codes=transaction?.dispensingRecovery?.blockers.map(b=>b.code)??[];
  if(codes.some(c=>['UNRESOLVED_COIN_EVENTS','CONTROLLER_RECONCILIATION_REQUIRED','INCOMPLETE_COIN_PULSES','COIN_STORAGE_UNHEALTHY','PAYMENT_RECONCILIATION_REQUIRED'].includes(c)))return "Staff must check a recorded coin issue before the machine can be used again. Do not insert more coins.";
  if(codes.some(c=>['CONTROLLER_UNVERIFIED','CONTROLLER_DIAGNOSTICS_STALE','PAYMENT_SESSION_UNVERIFIED','UNKNOWN_PAYMENT_OWNER'].includes(c)))return "The machine connection needs staff verification before another purchase.";
  if(codes.some(c=>['ACTIVE_DISPENSING_REQUEST','ACTIVE_FIREBASE_COMMAND','ACTIVE_MOTOR','OTHER_PURCHASE_PENDING','ACTIVE_PAYMENT_SESSION'].includes(c)))return "The machine is still handling an earlier operation. Please ask staff to check it.";
  if(codes.some(c=>['COMMAND_RETIREMENT_UNCONFIRMED','FIREBASE_VERIFICATION_REQUIRED'].includes(c)))return "Staff must confirm that the dispenser has stopped and its previous operation is closed.";
  if(codes.includes('SAFE_RETURN_NOT_REQUESTED'))return "The delivery check is saved. Staff still need to approve reopening the machine.";
  return "Staff must finish the medicine delivery and stock check before another purchase. Your payment is saved.";
}

// A missing acknowledgment is not proof of a stopped motor or a failed drop.
export function dispensingConfirmationTimedOut(transaction: Transaction | null, seconds: number) {
  return transaction?.paymentStatus === "successful" &&
    ["pending", "dispensing"].includes(transaction.dispensingStatus) &&
    seconds >= DISPENSING_CONFIRMATION_TIMEOUT_SECONDS;
}
