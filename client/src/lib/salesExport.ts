import type { Content, TDocumentDefinitions } from "pdfmake/interfaces";
import { salesCsv, salesReport } from "./salesReport";

export type SalesExportFormat = "csv" | "xlsx" | "pdf";
export type SalesExport = {
  report: ReturnType<typeof salesReport>;
  start: string;
  end: string;
  medicine: string;
  generatedAt: Date;
};
export type ReportLayout = {
  title: string;
  basis: string;
  quantityOnly?: boolean;
  sections: {
    name: string;
    title: string;
    headers: string[];
    rows: (string | number | Date)[][];
    pdfWidths?: (number | "*")[];
  }[];
};
const business = "Triple J Grocery Store and Pharmacy";
const basis =
  "Paid purchases with completed dispensing. Stored item subtotals; excess payments excluded. Dates: Philippine time (PHT).";
const currency = (value: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
    value
  );

/** MySQL timestamps are Philippine wall time; ISO timestamps retain their offset. */
export function philippineDate(value: string | Date): Date {
  const date =
    value instanceof Date
      ? value
      : new Date(
          /^\d{4}-\d{2}-\d{2}( |$)/.test(value)
            ? `${value.replace(" ", "T")}${value.length === 10 ? "T00:00:00" : ""}+08:00`
            : value
        );
  if (!Number.isFinite(date.getTime()))
    throw new Error(
      "A report timestamp is invalid. Please review the transaction record."
    );
  return date;
}
export const reportTimestamp = (value: string | Date) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(philippineDate(value));
const excelDate = (value: string | Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(philippineDate(value));
  const p = (key: string) => Number(parts.find(v => v.type === key)?.value);
  return new Date(
    Date.UTC(
      p("year"),
      p("month") - 1,
      p("day"),
      p("hour"),
      p("minute"),
      p("second")
    )
  );
};
function sections(model: SalesExport): ReportLayout["sections"] {
  const r = model.report;
  return [
    {
      name: "Summary",
      title: "A. Sales Summary",
      headers: ["Metric", "Value"],
      rows: [
        ["Total sales", r.cents / 100],
        ["Completed transactions", r.records.length],
        ["Units sold", r.units],
        [
          "Average sales per transaction",
          r.records.length ? r.cents / 100 / r.records.length : 0,
        ],
      ],
    },
    ...(
      [
        ["Daily Sales", "B. Daily Sales Breakdown", r.daily],
        ["Monthly Sales", "C. Monthly Sales Summary", r.monthly],
        ["Sales by Medicine", "D. Sales by Medicine", r.medicines],
      ] as const
    ).map(([name, title, groups]) => ({
      name,
      title,
      headers: [
        name === "Sales by Medicine"
          ? "Medicine"
          : name === "Daily Sales"
            ? "Date"
            : "Month",
        "Completed transactions",
        "Units sold",
        "Total sales",
      ],
      rows: groups.map(g => [
        name === "Daily Sales"
          ? excelDate(g.label)
          : name === "Monthly Sales"
            ? excelDate(`${g.label}-01`)
            : g.label,
        g.transactions,
        g.units,
        g.cents / 100,
      ]),
    })),
    {
      name: "Transactions",
      title: "E. Detailed Transactions",
      headers: [
        "Transaction reference",
        "Date and time (PHT)",
        "Medicine",
        "Quantity",
        "Unit price",
        "Subtotal",
      ],
      rows: r.records.flatMap(t =>
        t.items.map(i => [
          t.id,
          excelDate(t.createdAt),
          i.medicineName,
          i.quantity,
          i.unitPrice,
          Math.round(i.subtotal * 100) / 100,
        ])
      ),
    },
  ];
}
const metadata = (m: SalesExport) => [
  "MediDispense",
  business,
  "Automated Medicine Vending System",
  "SALES REPORT",
  `Reporting period: ${m.start || "Beginning of records"} to ${m.end || "Latest records"}`,
  `Medicine: ${m.medicine}`,
  `Generated: ${reportTimestamp(m.generatedAt)} PHT`,
  basis,
];

export async function salesExcel(
  model: SalesExport,
  layout?: ReportLayout
): Promise<Uint8Array> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MediDispense";
  workbook.created = model.generatedAt;
  for (const section of layout?.sections ?? sections(model)) {
    const sheet = workbook.addWorksheet(section.name, {
      views: [{ state: "frozen", ySplit: 8 }],
      pageSetup: {
        paperSize: 9,
        orientation: section.headers.length > 4 ? "landscape" : "portrait",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        printTitlesRow: "1:8",
      },
    });
    const columns = section.headers.length;
    const half = Math.floor(columns / 2);
    const headerCell = (
      row: number,
      first: number,
      last: number,
      text: string,
      prominent = false
    ) => {
      if (first < last) sheet.mergeCells(row, first, row, last);
      const cell = sheet.getCell(row, first);
      cell.value = text;
      cell.font = {
        name: "Calibri",
        size: prominent ? 16 : 10,
        bold: row <= 2,
        color: { argb: "FF17365D" },
      };
      cell.alignment = { wrapText: true, vertical: "middle" };
    };
    headerCell(1, 1, half, "MediDispense", true);
    headerCell(1, half + 1, columns, layout?.title ?? "SALES REPORT", true);
    headerCell(2, 1, columns, business);
    headerCell(3, 1, columns, "Automated Medicine Vending System");
    headerCell(4, 1, half, metadata(model)[4]);
    headerCell(4, half + 1, columns, metadata(model)[5]);
    headerCell(5, 1, half, metadata(model)[6]);
    headerCell(5, half + 1, columns, layout?.basis ?? basis);
    [1, 2, 3].forEach(row => {
      sheet.getRow(row).height = 24;
    });
    sheet.getRow(4).height = 36;
    sheet.getRow(5).height = layout ? 84 : 60;
    sheet.mergeCells(7, 1, 7, columns);
    sheet.getCell(7, 1).value = section.title;
    sheet.getCell(7, 1).font = {
      bold: true,
      size: 13,
      color: { argb: "FF17365D" },
    };
    sheet.getRow(8).values = section.headers;
    section.rows.forEach(row => sheet.addRow(row));
    if (!section.rows.length) {
      sheet.mergeCells(9, 1, 9, columns);
      sheet.getCell(9, 1).value = layout
        ? "No records match the selected filters."
        : "No completed sales match the selected filters.";
    }
    for (let row = 8; row <= sheet.rowCount; row++) {
      sheet.getRow(row).height = section.name === "Transactions" ? 38 : 30;
      sheet.getRow(row).eachCell({ includeEmpty: true }, (cell, column) => {
        cell.font = {
          name: "Calibri",
          size: 10,
          bold: row === 8,
          color: { argb: row === 8 ? "FFFFFFFF" : "FF17365D" },
        };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: row === 8 ? "FF245C96" : row % 2 ? "FFF1F6FC" : "FFFFFFFF",
          },
        };
        cell.border = {
          bottom: { style: "thin", color: { argb: "FFD5E3F3" } },
        };
        cell.alignment = {
          wrapText: true,
          vertical: "middle",
          horizontal: typeof cell.value === "number" ? "right" : "left",
        };
        if (typeof cell.value === "number" && layout?.quantityOnly)
          cell.numFmt = "#,##0";
        else if (typeof cell.value === "number")
          cell.numFmt =
            section.name === "Summary"
              ? row === 9 || row === 12
                ? '"₱"#,##0.00'
                : "#,##0"
              : column === columns ||
                  (section.name === "Transactions" && column === 5)
                ? '"₱"#,##0.00'
                : "#,##0";
        if (cell.value instanceof Date)
          cell.numFmt =
            section.name === "Transactions"
              ? "dd mmm yyyy hh:mm AM/PM"
              : section.name === "Monthly Sales"
                ? "mmm yyyy"
                : "dd mmm yyyy";
      });
    }
    section.headers.forEach((header, index) => {
      const lengths = section.rows.map(row =>
        row[index] instanceof Date ? 24 : String(row[index] ?? "").length
      );
      sheet.getColumn(index + 1).width = Math.min(
        44,
        Math.max(
          section.name === "Summary" ? 34 : 16,
          header.length + 2,
          ...lengths.map(n => n + 2)
        )
      );
    });
    sheet.autoFilter = {
      from: { row: 8, column: 1 },
      to: { row: Math.max(8, 8 + section.rows.length), column: columns },
    };
    sheet.pageSetup.printArea = `A1:${sheet.getColumn(columns).letter}${sheet.rowCount}`;
    sheet.headerFooter.oddFooter = `&LMediDispense | ${business}&RPage &P of &N`;
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export function salesPdfDefinition(
  model: SalesExport,
  layout?: ReportLayout
): TDocumentDefinitions {
  const content: Content[] = [
    {
      columns: [
        { text: "MediDispense", bold: true, fontSize: 18 },
        {
          text: layout?.title ?? "SALES REPORT",
          bold: true,
          fontSize: 17,
          alignment: "right",
        },
      ],
      color: "#17365D",
      margin: [0, 0, 0, 6],
    },
    { text: business, bold: true, fontSize: 10, margin: [0, 0, 0, 4] },
    { text: "Automated Medicine Vending System", margin: [0, 0, 0, 12] },
    {
      columns: [
        {
          width: "*",
          stack: [
            { text: "REPORTING PERIOD", bold: true, color: "#245C96" },
            {
              text:
                (model.start || "Beginning of records") +
                " to " +
                (model.end || "Latest records"),
              margin: [0, 4, 0, 0],
            },
          ],
        },
        {
          width: "*",
          stack: [
            { text: "MEDICINE", bold: true, color: "#245C96" },
            { text: model.medicine, margin: [0, 4, 0, 0] },
          ],
        },
        {
          width: "*",
          stack: [
            { text: "GENERATED (PHT)", bold: true, color: "#245C96" },
            { text: reportTimestamp(model.generatedAt), margin: [0, 4, 0, 0] },
          ],
        },
      ],
      columnGap: 16,
      margin: [0, 0, 0, 10],
    },
    {
      text: layout?.basis ?? basis,
      color: "#526B88",
      fontSize: 8,
      margin: [0, 0, 0, 14],
    },
  ];
  for (const section of sections(model)) {
    const count = section.headers.length;
    const rows = section.rows.map((row, ri) =>
      row.map((value, ci) => {
        let text =
          value instanceof Date
            ? section.name === "Transactions"
              ? reportTimestamp(new Date(value.getTime() - 8 * 3600000))
              : new Intl.DateTimeFormat("en-PH", {
                  timeZone: "UTC",
                  month: "short",
                  year: "numeric",
                  ...(section.name === "Daily Sales"
                    ? { day: "2-digit" as const }
                    : {}),
                }).format(value)
            : typeof value === "number"
              ? (section.name === "Summary"
                  ? ri === 0 || ri === 3
                  : ci === count - 1 ||
                    (section.name === "Transactions" && ci === 4)) &&
                !layout?.quantityOnly
                ? currency(value)
                : value.toLocaleString("en-PH")
              : value;
        return {
          text: String(text),
          alignment:
            typeof value === "number" ? ("right" as const) : ("left" as const),
        };
      })
    );
    content.push({
      table: {
        headerRows: 2,
        keepWithHeaderRows: 1,
        widths:
          ("pdfWidths" in section ? section.pdfWidths : undefined) ??
          (section.name === "Transactions"
            ? [100, 72, "*", 30, 55, 55]
            : section.name === "Summary"
              ? ["*", 140]
              : ["*", 95, 65, 95]),
        body: [
          [
            {
              text: section.title,
              colSpan: count,
              bold: true,
              fontSize: 12,
              color: "#17365D",
              fillColor: "#E8F1FC",
            },
            ...Array.from({ length: count - 1 }, () => ({})),
          ],
          section.headers.map(text => ({
            text,
            bold: true,
            color: "#FFFFFF",
            fillColor: "#245C96",
          })),
          ...(rows.length
            ? rows
            : [
                [
                  {
                    text: layout
                      ? "No records match the selected filters."
                      : "No completed sales match the selected filters.",
                    colSpan: count,
                  },
                  ...Array.from({ length: count - 1 }, () => ({})),
                ],
              ]),
        ],
      },
      layout: {
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => "#D5E3F3",
        vLineColor: () => "#D5E3F3",
        paddingTop: () => 7,
        paddingBottom: () => 7,
        paddingLeft: () => 5,
        paddingRight: () => 5,
        fillColor: row => (row > 1 && row % 2 === 0 ? "#F3F7FC" : null),
      },
      margin: [0, 0, 0, 18],
    });
  }
  return {
    pageSize: "A4",
    pageMargins: [36, 32, 36, 46],
    defaultStyle: { font: "Roboto", fontSize: 8.5, color: "#253B54" },
    info: {
      title: `MediDispense ${layout?.title ?? "Sales Report"}`,
      author: business,
      subject: `Sales report — ${model.medicine}`,
    },
    content,
    footer: (page, total) => ({
      columns: [
        {
          text: "MediDispense · Triple J Grocery Store and Pharmacy",
          width: "*",
        },
        { text: `Page ${page} of ${total}`, alignment: "right", width: 90 },
      ],
      fontSize: 8,
      color: "#526B88",
      margin: [36, 15, 36, 0],
    }),
  };
}
export async function salesPdf(
  model: SalesExport,
  layout?: ReportLayout
): Promise<Uint8Array> {
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  pdfMake.addVirtualFileSystem(fonts);
  return new Uint8Array(
    await pdfMake.createPdf(salesPdfDefinition(model, layout)).getBuffer()
  );
}
export async function salesExportBlob(
  model: SalesExport,
  format: SalesExportFormat
): Promise<Blob> {
  if (format === "csv")
    return new Blob(
      [
        "\uFEFF",
        salesCsv(model.report, model.start, model.end, model.medicine),
      ],
      { type: "text/csv;charset=utf-8" }
    );
  const bytes =
    format === "xlsx" ? await salesExcel(model) : await salesPdf(model);
  return new Blob([new Uint8Array(bytes).buffer], {
    type:
      format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/pdf",
  });
}
