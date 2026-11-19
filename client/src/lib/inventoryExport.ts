import {
  inventoryStockStatus,
  type InventoryReportData,
} from "@shared/inventoryReport";
import { inDateRange, reportCsv } from "./adminFilters";
import {
  salesExcel,
  salesPdf,
  type ReportLayout,
  type SalesExportFormat,
} from "./salesExport";
import { salesReport } from "./salesReport";

export const stockLabels = {
  in_stock: "In Stock",
  low_stock: "Low Stock",
  out_of_stock: "Out of Stock",
};
export function inventoryExportModel(
  data: InventoryReportData,
  medicine: string,
  status: string,
  start: string,
  end: string
) {
  const rows = data.items.filter(
    i =>
      (medicine === "all" || String(i.id) === medicine) &&
      (status === "all" || inventoryStockStatus(i) === status)
  );
  const ids = new Set(rows.map(i => i.id));
  const movements = data.movements.filter(
    i =>
      (medicine === "all" || String(i.medicineId) === medicine) &&
      (status === "all" || ids.has(i.medicineId)) &&
      inDateRange(i.createdAt, start, end)
  );
  const additions = movements.reduce((n, i) => n + Math.max(0, i.change), 0),
    deductions = movements.reduce((n, i) => n + Math.max(0, -i.change), 0);
  const medicineName =
    medicine === "all"
      ? "All medicines"
      : (data.items.find(i => String(i.id) === medicine)?.name ??
        data.movements.find(i => String(i.medicineId) === medicine)?.name ??
        "Selected medicine");
  return {
    rows,
    movements,
    additions,
    deductions,
    medicineName,
    status,
    start,
    end,
  };
}
export async function inventoryExportBlob(
  model: ReturnType<typeof inventoryExportModel>,
  format: SalesExportFormat,
  generatedAt = new Date()
) {
  const {
    rows,
    movements,
    additions,
    deductions,
    medicineName,
    status,
    start,
    end,
  } = model;
  if (format === "csv")
    return new Blob(
      [
        "\uFEFF",
        reportCsv([
          ["MediDispense Inventory Report"],
          ["Medicine", medicineName],
          ["Stock status", status],
          ["Movement start", start || "All"],
          ["Movement end", end || "All"],
          ["Current inventory is not a historical snapshot"],
          [
            "Medicine",
            "Available stock",
            "On hand",
            "Reserved",
            "Stock status",
            "Expiry",
            "Last updated",
          ],
          ...rows.map(i => [
            i.name,
            i.available,
            i.quantity,
            i.reserved,
            stockLabels[inventoryStockStatus(i)],
            i.expiry ?? "",
            i.updatedAt,
          ]),
          [],
          ["Recorded additions", additions],
          ["Recorded deductions", deductions],
          ["Net movement", additions - deductions],
          [
            "Movement date",
            "Medicine",
            "Previous",
            "Change",
            "New stock",
            "Type",
            "Reason",
            "Responsible",
          ],
          ...movements.map(i => [
            i.createdAt,
            i.name,
            i.previous,
            i.change,
            i.next,
            i.type,
            i.reason,
            i.actor,
          ]),
        ]),
      ],
      { type: "text/csv;charset=utf-8" }
    );
  const layout: ReportLayout = {
    title: "INVENTORY REPORT",
    quantityOnly: true,
    basis: `Stock filter: ${stockLabels[status as keyof typeof stockLabels] ?? "All stock statuses"}. Current stock is not historical. Period applies only to recorded movements; movement status follows current stock. Dates: PHT.`,
    sections: [
      {
        name: "Summary",
        title: "A. Inventory Summary",
        headers: ["Metric", "Quantity"],
        rows: [
          ["Total medicines", rows.length],
          ["Available stock", rows.reduce((n, i) => n + i.available, 0)],
          [
            "Low stock medicines",
            rows.filter(i => inventoryStockStatus(i) === "low_stock").length,
          ],
          [
            "Out of stock medicines",
            rows.filter(i => i.available === 0).length,
          ],
          ["Recorded additions", additions],
          ["Recorded deductions", deductions],
          ["Net movement", additions - deductions],
        ],
      },
      {
        name: "Current Inventory",
        title: "B. Current Inventory",
        headers: [
          "Medicine",
          "Available",
          "On hand",
          "Reserved",
          "Stock status",
          "Expiry",
          "Last updated (PHT)",
        ],
        pdfWidths: ["*", 35, 35, 35, 55, 55, 70],
        rows: rows.map(i => [
          i.name,
          i.available,
          i.quantity,
          i.reserved,
          stockLabels[inventoryStockStatus(i)],
          i.expiry ?? "Not recorded",
          i.updatedAt,
        ]),
      },
      {
        name: "Stock Movements",
        title: "C. Recorded Stock Movements",
        headers: [
          "Date (PHT)",
          "Medicine",
          "Previous",
          "Change",
          "New stock",
          "Type",
          "Reason",
          "Responsible",
        ],
        pdfWidths: [65, "*", 32, 30, 32, 45, 65, 55],
        rows: movements.map(i => [
          i.createdAt,
          i.name,
          i.previous,
          i.change,
          i.next,
          i.type,
          i.reason,
          i.actor,
        ]),
      },
    ],
  };
  const context = {
    report: salesReport([], "", "", "all"),
    start,
    end,
    medicine: medicineName,
    generatedAt,
  };
  const bytes = await (format === "xlsx"
    ? salesExcel(context, layout)
    : salesPdf(context, layout));
  return new Blob([new Uint8Array(bytes).buffer], {
    type:
      format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/pdf",
  });
}
