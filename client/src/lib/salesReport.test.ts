import { describe, expect, it } from "vitest";
import type { Transaction } from "@shared/medidispense";
import { salesCsv, salesDate, salesReport } from "./salesReport";
const transaction = (values: Partial<Transaction> = {}): Transaction => ({ id:"T1", items:[{medicineId:1,medicineName:"Historical medicine",quantity:2,unitPrice:10.25,subtotal:20.5}], total:20.5, amountPaid:50, change:0, paymentStatus:"successful", dispensingStatus:"dispensed", createdAt:"2026-11-01 10:00:00", slotNumber:1, ...values });
describe("sales report", () => {
  it("counts only fully completed paid purchases and excludes excess payment", () => {
    const result=salesReport([transaction(),transaction({id:"T2",paymentStatus:"pending"}),transaction({id:"T3",dispensingStatus:"failed"}),transaction({id:"T4",paymentStatus:"cancelled"}),transaction({id:"T5",dispensingStatus:"dispensing"})],"","","all");
    expect(result.cents).toBe(2050); expect(result.units).toBe(2); expect(result.records).toHaveLength(1);
    expect(result.daily[0].cents).toBe(2050); expect(result.monthly[0].cents).toBe(2050);
  });
  it("filters selected item subtotals rather than whole mixed purchases", () => {
    const result=salesReport([transaction({items:[{medicineId:1,medicineName:"A",quantity:1,unitPrice:10,subtotal:10},{medicineId:2,medicineName:"B",quantity:1,unitPrice:20,subtotal:20}],total:30})],"2026-11-01","2026-11-01","2");
    expect(result.cents).toBe(2000); expect(result.units).toBe(1); expect(result.medicines[0].label).toBe("B");
    expect(salesReport([transaction()],"2026-11-02","","all").records).toHaveLength(0);
  });
  it("uses Philippine dates for offset timestamps", () => {
    expect(salesDate("2026-10-31T16:30:00Z")).toBe("2026-11-01");
    expect(salesDate("2026-11-01 00:30:00")).toBe("2026-11-01");
  });
  it("exports every matched record and all breakdowns", () => {
    const report=salesReport(Array.from({length:20},(_,n)=>transaction({id:`TX-${n}`})),"","","all");
    const csv=salesCsv(report,"","","All medicines");
    expect(csv).toContain('"TX-19"'); expect(csv).toContain('"Total sales (PHP)","410.00"');
    expect(csv).toContain('"Monthly"'); expect(csv).toContain('"Historical medicine"');
    expect(salesReport([],"","","all").cents).toBe(0);
  });
});
