import type { Transaction } from "@shared/medidispense";

export const DISPENSING_CONFIRMATION_TIMEOUT_SECONDS = 120;
export const TIMEOUT_RETURN_HOME_SECONDS = 20;

export function timeoutReturnSeconds(elapsed: number) {
  return Math.max(0, Math.ceil(DISPENSING_CONFIRMATION_TIMEOUT_SECONDS + TIMEOUT_RETURN_HOME_SECONDS - elapsed));
}

// Call only with a server response, never a client-derived timeout state.
export function recoveryConfirmed(transaction: Transaction | null) {
  if(transaction?.issueRecovery)return ['failed','dispensed'].includes(transaction.dispensingStatus) && transaction.issueRecovery.returnRequested && transaction.issueRecovery.machineReuseReady && !(transaction.issueRecovery.machineReviewRequired??transaction.issueRecovery.reviewRequired);
  return transaction?.dispensingStatus === "failed" && transaction.adminRecovered === true;
}

// A missing acknowledgment is not proof of a stopped motor or a failed drop.
export function dispensingConfirmationTimedOut(transaction: Transaction | null, seconds: number) {
  return transaction?.paymentStatus === "successful" &&
    ["pending", "dispensing"].includes(transaction.dispensingStatus) &&
    seconds >= DISPENSING_CONFIRMATION_TIMEOUT_SECONDS;
}
