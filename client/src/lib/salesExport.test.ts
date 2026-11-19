import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import type { Transaction } from "@shared/medidispense";
import { salesReport } from "./salesReport";
import {
  salesExcel,
  salesPdf,
  salesPdfDefinition,
  salesExportBlob,
  reportTimestamp,
  type SalesExport,
} from "./salesExport";

const purchase = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: "TXN-TEST",
  createdAt: "2026-11-01 10:30:00",
  paymentStatus: "successful",
  dispensingStatus: "dispensed",
  total: 30,
  amountPaid: 50,
  change: 0,
  slotNumber: 1,
  items: [
    {
      medicineId: 1,
      medicineName: "Medicine A",
      quantity: 2,
      unitPrice: 5,
      subtotal: 10,
    },
    {
      medicineId: 2,
      medicineName: "Medicine B",
      quantity: 1,
      unitPrice: 20,
      subtotal: 20,
    },
  ],
  ...overrides,
});
const model = (transactions = [purchase()], medicine = "all"): SalesExport => ({
  report: salesReport(transactions, "2026-11-01", "2026-11-30", medicine),
  start: "2026-11-01",
  end: "2026-11-30",
  medicine: medicine === "all" ? "All medicines" : "Medicine B",
  generatedAt: new Date("2026-11-14T01:00:00Z"),
});
describe("professional sales exports", () => {
  it("preserves filtered, completed-sale totals across every section", () => {
    const m = model(
      [
        purchase(),
        purchase({ paymentStatus: "cancelled" }),
        purchase({ dispensingStatus: "failed" }),
        purchase({ createdAt: "2026-10-31 23:59:00" }),
      ],
      "2"
    );
    expect(m.report.cents).toBe(2000);
    expect(m.report.units).toBe(1);
    for (const rows of [m.report.daily, m.report.monthly, m.report.medicines])
      expect(rows.reduce((n, r) => n + r.cents, 0)).toBe(m.report.cents);
    expect(
      m.report.records
        .flatMap(r => r.items)
        .reduce((n, i) => n + Math.round(i.subtotal * 100), 0)
    ).toBe(m.report.cents);
  });
  it("formats MySQL and offset timestamps in Philippine time", () => {
    expect(reportTimestamp("2026-11-01 00:30:00")).toBe(
      reportTimestamp("2026-10-31T16:30:00Z")
    );
    expect(reportTimestamp(new Date("2026-11-14T01:00:00Z"))).toContain(
      "09:00"
    );
  });
  it("creates a valid styled workbook with native numeric cells and print settings", async () => {
    const bytes = await salesExcel(model());
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    expect(book.worksheets).toHaveLength(5);
    const summary = book.getWorksheet("Summary")!;
    expect(summary.getCell("B9").value).toBe(30);
    expect(summary.getCell("B12").value).toBe(30);
    expect(summary.getCell("B9").numFmt).toContain("₱");
    const details = book.getWorksheet("Transactions")!;
    expect(details.getCell("B9").value).toBeInstanceOf(Date);
    expect(details.getCell("F9").value).toBe(10);
    expect(details.getCell("F10").value).toBe(20);
    expect(details.views[0]).toMatchObject({ state: "frozen", ySplit: 8 });
    expect(details.pageSetup).toMatchObject({ paperSize: 9, fitToWidth: 1 });
    expect(details.headerFooter.oddFooter).toContain("Page &P of &N");
    expect(summary.getCell("A2").value).toBe(
      "Triple J Grocery Store and Pharmacy"
    );
  });
  it("keeps untrusted medicine names as text, never spreadsheet formulas", async () => {
    const t = purchase();
    t.items[0].medicineName = '=HYPERLINK("https://invalid")';
    const b = new ExcelJS.Workbook();
    await b.xlsx.load(
      (await salesExcel(model([t]))) as unknown as ExcelJS.Buffer
    );
    expect(b.getWorksheet("Transactions")!.getCell("C9").type).toBe(
      ExcelJS.ValueType.String
    );
  });
  it("creates a real multi-page A4 PDF with repeated table headers and footer", async () => {
    const m = model(
      Array.from({ length: 80 }, (_, i) => purchase({ id: `TXN-${i}` }))
    );
    const bytes = await salesPdf(m);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.28, 0);
    expect(pdf.getPage(0).getHeight()).toBeCloseTo(841.89, 0);
    expect(pdf.getTitle()).toBe("MediDispense Sales Report");
    const definition = salesPdfDefinition(m);
    expect(JSON.stringify(definition.content)).toContain('"headerRows":2');
    expect(typeof definition.footer).toBe("function");
  }, 30000);
  it("supports empty reports and retains the existing raw CSV data", async () => {
    const empty = model([]);
    expect(empty.report.cents).toBe(0);
    expect(JSON.stringify(salesPdfDefinition(empty))).toContain(
      "No completed sales match"
    );
    const csv = await (await salesExportBlob(model(), "csv")).text();
    expect(csv).toContain('"Total sales (PHP)","30.00"');
    expect(csv).toContain('"TXN-TEST"');
    expect((await salesPdf(empty)).length).toBeGreaterThan(1000);
  });
});
