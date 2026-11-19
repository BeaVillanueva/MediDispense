import type { Transaction } from "@shared/medidispense";

/** Explain backend handoff guards; never infer permission to clear the purchase. */
export function completedReturnMessage(transaction: Transaction) {
  const blockers=transaction.customerHandoffBlockers??(transaction.customerHandoffBlocker?[transaction.customerHandoffBlocker]:[]);
  if(blockers.includes("MULTIPLE_CONTROLLER_REPORTS"))return "Your medicine was delivered. Another machine connection needs staff verification before the next purchase.";
  if(blockers.some(c=>["CONTROLLER_DIAGNOSTICS_STALE","CONTROLLER_DIAGNOSTICS_MISSING"].includes(c)))return "Your medicine was delivered. The machine status is out of date. Please check its connection or ask staff for assistance.";
  if(blockers.some(c=>["UNCONFIRMED_PAYMENT_EVENTS","INCOMPLETE_COIN_PULSES","PAYMENT_RECONCILIATION_REQUIRED","COIN_QUEUE_OVERFLOW","PAYMENT_STORAGE_UNHEALTHY","CONTROLLER_BOOT_REVIEW_REQUIRED","CONTROLLER_BINDING_REVIEW_REQUIRED"].includes(c)))return "Your medicine was delivered. A staff check is required for the recorded coins before the next purchase. Your purchase details are saved.";
  if(transaction.paymentWindow?.controlledDemoAutoBinding&&!transaction.issueRecovery)return "Please collect your medicine. Waiting for the machine payment status before returning.";
  return "Please collect your medicine. A staff check is required before the next purchase.";
}
