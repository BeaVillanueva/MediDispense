import { expect, it } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { inventoryExportBlob, inventoryExportModel } from "./inventoryExport";
import type { InventoryReportData } from "@shared/inventoryReport";
const data: InventoryReportData = {
  items: [
    {
      id: 1,
      name: "Medicine A",
      quantity: 5,
      reserved: 2,
      available: 3,
      threshold: 3,
      expiry: "2027-12-31",
      updatedAt: "2026-11-01 10:00:00",
    },
    {
      id: 2,
      name: "Medicine B",
      quantity: 9,
      reserved: 0,
      available: 9,
      threshold: 3,
      expiry: null,
      updatedAt: "2026-11-01 10:00:00",
    },
  ],
  movements: [
    {
      id: 1,
      medicineId: 1,
      name: "Medicine A",
      previous: 6,
      next: 5,
      change: -1,
      type: "sale",
      reason: "Dispensed",
      actor: "Machine",
      createdAt: "2026-11-01 10:00:00",
    },
    {
      id: 2,
      medicineId: 1,
      name: "Medicine A",
      previous: 0,
      next: 6,
      change: 6,
      type: "restock",
      reason: "Restock",
      actor: "Admin",
      createdAt: "2026-10-01 10:00:00",
    },
  ],
};
it("preserves stock/status filters and applies dates only to movements", () => {
  const m = inventoryExportModel(
    data,
    "all",
    "low_stock",
    "2026-11-01",
    "2026-11-30"
  );
  expect(m.rows.map(i => i.id)).toEqual([1]);
  expect(m.movements.map(i => i.id)).toEqual([1]);
  expect(m.additions).toBe(0);
  expect(m.deductions).toBe(1);
  expect(
    inventoryExportModel(data, "2", "all", "", "").rows[0].available
  ).toBe(9);
});
it("exports compact workbook headers on every sheet with integer stock values", async () => {
  const m = inventoryExportModel(data, "all", "all", "", "");
  const blob = await inventoryExportBlob(m, "xlsx");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await blob.arrayBuffer());
  expect(book.worksheets).toHaveLength(3);
  for (const sheet of book.worksheets) {
    expect(sheet.getCell("A1").value).toBe("MediDispense");
    expect(sheet.getCell("A4").value).toContain("Reporting period:");
    expect(sheet.getCell("A8").value).toBeTruthy();
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 8 });
  }
  expect(book.getWorksheet("Summary")!.getCell("B1").value).toBe(
    "INVENTORY REPORT"
  );
  const current = book.getWorksheet("Current Inventory")!;
  expect(current.getCell("B9").value).toBe(3);
  expect(current.getCell("B9").numFmt).toBe("#,##0");
  expect(current.getCell("E9").value).toBe("Low Stock");
});
it("generates valid A4 PDF and retains raw CSV movement data", async () => {
  const m = inventoryExportModel(data, "all", "all", "", "");
  const pdf = await PDFDocument.load(
    await (await inventoryExportBlob(m, "pdf")).arrayBuffer()
  );
  expect(pdf.getTitle()).toBe("MediDispense INVENTORY REPORT");
  expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.28, 0);
  const csv = await (await inventoryExportBlob(m, "csv")).text();
  expect(csv).toContain('"Recorded additions","6"');
  expect(csv).toContain('"Recorded deductions","1"');
  expect(csv).toContain('"Medicine A","3","5","2","Low Stock"');
});
