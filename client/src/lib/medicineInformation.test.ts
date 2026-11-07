import { describe, expect, it } from "vitest";
import { canShowUsageGuide, medicineLabelDetails } from "./medicineInformation";

describe("medicine information", () => {
  it("reads strength and form only from existing catalog labels", () => {
    expect(medicineLabelDetails({ name: "Cetirizine 10mg", dosage: "10 mg tablet.", description: "" })).toEqual({ strength: "10 mg", type: "Tablet" });
    expect(medicineLabelDetails({ name: "Vitamins", dosage: "Follow product label.", description: "Supplement." })).toEqual({ strength: undefined, type: undefined });
    expect(medicineLabelDetails()).toEqual({ strength: undefined, type: undefined });
  });
  it("never shows a usage guide based on payment alone or partial dispensing", () => {
    const transaction = { paymentStatus: "successful" as const, dispensingStatus: "dispensed" as const, requestedQuantity: 2, dispensedQuantity: 2, items: [] };
    expect(canShowUsageGuide(transaction)).toBe(true);
    expect(canShowUsageGuide({ ...transaction, dispensingStatus: "pending" })).toBe(false);
    expect(canShowUsageGuide({ ...transaction, dispensingStatus: "dispensing" })).toBe(false);
    expect(canShowUsageGuide({ ...transaction, dispensingStatus: "failed" })).toBe(false);
    expect(canShowUsageGuide({ ...transaction, dispensedQuantity: 1 })).toBe(false);
    expect(canShowUsageGuide({ ...transaction, paymentStatus: "pending" })).toBe(false);
    expect(canShowUsageGuide({ ...transaction, requestedQuantity: 0, dispensedQuantity: 0 })).toBe(false);
  });
});
