import { describe, expect, it } from "vitest";
import { canShowUsageGuide, canReturnAfterDispensing, medicineLabelDetails, medicineSaleUnit, medicineStockLabel } from "./medicineInformation";
import type { Medicine } from "@shared/medidispense";

describe("medicine information", () => {
  it("labels countable forms without assuming an unspecified supplement is a tablet", () => {
    expect(medicineSaleUnit({ name: "Example", dosage: "500 mg tablet", description: "" })).toBe("tablet");
    expect(medicineSaleUnit({ name: "Example capsules", dosage: "", description: "" })).toBe("capsule");
    expect(medicineSaleUnit({ name: "Vitamins", dosage: "Follow product label", description: "Supplement" })).toBe("tablet");
    expect(medicineSaleUnit({ name: "Other supplement", dosage: "Follow product label", description: "Supplement" })).toBe("unit");
    expect(medicineStockLabel({name:'Vitamins',dosage:'Follow product label',description:'Supplement',stockQuantity:9} as Medicine)).toBe('9 tablets available');
  });
  it("uses available stock rather than on-hand stock and handles singular units", () => {
    const medicine = { name: "Example", dosage: "500 mg tablet", description: "", stockQuantity: 7, availableStockQuantity: 3 } as Medicine;
    expect(medicineStockLabel(medicine)).toBe("3 tablets available");
    expect(medicineStockLabel({ ...medicine, availableStockQuantity: 1 })).toBe("1 tablet available");
    expect(medicineStockLabel({ ...medicine, availableStockQuantity: 0 })).toBe("0 tablets available");
  });
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
  it("does not confuse successful dispensing or an empty software queue with safe next-customer handoff",()=>{
    const paid={paymentStatus:"successful",dispensingStatus:"dispensed",requestedQuantity:1,dispensedQuantity:1,items:[{quantity:1}],total:20,amountPaid:20} as import("@shared/medidispense").Transaction;
    expect(canReturnAfterDispensing(paid)).toBe(false);
    expect(canReturnAfterDispensing({...paid,customerHandoffSafe:false})).toBe(false);
    expect(canReturnAfterDispensing({...paid,customerHandoffSafe:true})).toBe(true);
    expect(canReturnAfterDispensing({...paid,customerHandoffSafe:true,amountPaid:25})).toBe(false);
    expect(canReturnAfterDispensing({...paid,customerHandoffSafe:true,dispensingStatus:"failed"})).toBe(false);
  });

});
