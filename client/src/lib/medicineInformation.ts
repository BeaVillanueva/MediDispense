import type { Medicine, Transaction } from "@shared/medidispense";

export const USAGE_FALLBACK = "Please refer to the medicine packaging or consult a pharmacist for proper dosage and usage instructions.";

/** Countable forms, with the operator-confirmed Vitamins tablet label. */
export function medicineSaleUnit(medicine: Pick<Medicine, "name" | "dosage" | "description">) {
  const label = `${medicine.name} ${medicine.dosage} ${medicine.description}`;
  return label.match(/\b(tablet|capsule|softgel|lozenge|sachet|patch|suppository)(?:s|es)?\b/i)?.[1].toLowerCase()
    ?? (medicine.name.trim().toLowerCase()==='vitamins'?'tablet':'unit');
}

export function medicineStockLabel(medicine: Medicine) {
  const count = medicine.availableStockQuantity ?? medicine.stockQuantity;
  const unit = medicineSaleUnit(medicine);
  const plural = unit === "suppository" ? "suppositories" : unit === "patch" ? "patches" : `${unit}s`;
  return `${count} ${count === 1 ? unit : plural} available`;
}

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

export function canReturnAfterDispensing(transaction: Transaction | null) {
  if(transaction?.issueRecovery)return canShowUsageGuide(transaction) && transaction.issueRecovery.returnRequested && transaction.issueRecovery.machineReuseReady && !(transaction.issueRecovery.machineReviewRequired??transaction.issueRecovery.reviewRequired);
  return !!transaction && canShowUsageGuide(transaction) && transaction.customerHandoffSafe === true
    && Math.round(transaction.amountPaid * 100) === Math.round(transaction.total * 100);
}
