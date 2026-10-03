import type { Medicine, Transaction } from "@shared/medidispense";

export type Purchase = {
  selectedMedicine: Medicine;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
};
export type PaymentStatus =
  | "IDLE"
  | "WAITING_FOR_COINS"
  | "PARTIAL"
  | "PAID"
  | "OVERPAYMENT"
  | "DISPENSING"
  | "SUCCESS"
  | "DISPENSE_FAILED";
export const peso = (value: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    value
  );
export const cents = (value: number) => Math.round(value * 100);
export const purchaseTotal = (price: number, quantity: number) =>
  (cents(price) * quantity) / 100;
// No artificial five-unit cap. Configure a positive integer when policy is agreed.
export const MAX_PURCHASE_QUANTITY: number | undefined = undefined;
export const SUCCESS_RESET_SECONDS = 20;
export function purchasable(medicine: Medicine) {
  return (
    medicine.enabled &&
    medicine.slotNumber !== null &&
    medicine.stockQuantity > 0 &&
    medicine.status !== "expired" &&
    medicine.status !== "out_of_stock"
  );
}
export function quantityLimit(
  medicine: Medicine,
  configuredLimit = MAX_PURCHASE_QUANTITY
) {
  const cap =
    configuredLimit !== undefined &&
    Number.isInteger(configuredLimit) &&
    configuredLimit > 0
      ? configuredLimit
      : Infinity;
  return purchasable(medicine)
    ? Math.max(0, Math.min(medicine.stockQuantity, cap))
    : 0;
}
export function reviewPurchase(purchase: Purchase, catalog: Medicine[]) {
  const current = catalog.find(
    item => item.id === purchase.selectedMedicine.id
  );
  return {
    current,
    changed:
      !current ||
      quantityLimit(current) < purchase.quantity ||
      cents(current.price) !== cents(purchase.unitPrice),
  };
}
export type CoinBalance = { insertedAmount: number; eventIds: string[] };
// Future trusted backend coin events need stable IDs and must preserve overpayment.
export function applyCoinEvent(
  balance: CoinBalance,
  event: { id: string; amount: number }
): CoinBalance {
  if (
    !event.id ||
    !Number.isFinite(event.amount) ||
    cents(event.amount) <= 0 ||
    balance.eventIds.includes(event.id)
  )
    return balance;
  return {
    insertedAmount: (cents(balance.insertedAmount) + cents(event.amount)) / 100,
    eventIds: [...balance.eventIds, event.id],
  };
}
export const remainingAmount = (total: number, inserted: number) =>
  Math.max(cents(total) - cents(inserted), 0) / 100;
export function paymentStatus(
  transaction: Transaction | null,
  inserted: number
): PaymentStatus {
  if (!transaction) return "IDLE";
  const requested =
    transaction.requestedQuantity ?? transaction.items[0]?.quantity ?? 0;
  if (
    transaction.dispensingStatus === "failed" ||
    transaction.dispensingStatus === "timeout"
  )
    return "DISPENSE_FAILED";
  if (
    transaction.dispensingStatus === "dispensed" &&
    transaction.dispensedQuantity === requested &&
    requested > 0
  )
    return "SUCCESS";
  if (transaction.dispensingStatus === "dispensing") return "DISPENSING";
  if (cents(inserted) > cents(transaction.total)) return "OVERPAYMENT";
  if (cents(inserted) >= cents(transaction.total)) return "PAID";
  return inserted > 0 ? "PARTIAL" : "WAITING_FOR_COINS";
}
export function mayLeavePayment(
  transaction: Transaction | null,
  inserted: number
) {
  return (
    inserted === 0 &&
    (!transaction ||
      (transaction.paymentStatus === "pending" &&
        transaction.dispensingStatus === "pending"))
  );
}
