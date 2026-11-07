import type { Medicine, Transaction } from "@shared/medidispense";

export const USAGE_FALLBACK = "Please refer to the medicine packaging or consult a pharmacist for proper dosage and usage instructions.";

/** Display existing label metadata only; never infer a dose or schedule. */
export function medicineLabelDetails(medicine?: Pick<Medicine, "name" | "dosage" | "description">) {
  const strength = medicine?.name.match(/\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|IU)(?:\s*\/\s*\d*(?:\.\d+)?\s*(?:ml|l))?\b/i)?.[0]
    ?? medicine?.dosage.match(/\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|IU)\b/i)?.[0];
  const form = `${medicine?.name ?? ""} ${medicine?.dosage ?? ""} ${medicine?.description ?? ""}`.match(/\b(tablet|capsule|softgel|syrup|solution|suspension|cream|ointment)s?\b/i)?.[1];
  return { strength: strength?.replace(/(\d)([a-z])/i, "$1 $2"), type: form ? form[0].toUpperCase() + form.slice(1).toLowerCase() : undefined };
}

export function canShowUsageGuide(transaction: Pick<Transaction, "paymentStatus" | "dispensingStatus" | "dispensedQuantity" | "requestedQuantity" | "items">) {
  const requested = transaction.requestedQuantity ?? transaction.items[0]?.quantity ?? 0;
  return transaction.paymentStatus === "successful" && transaction.dispensingStatus === "dispensed"
    && requested > 0 && transaction.dispensedQuantity === requested;
}
