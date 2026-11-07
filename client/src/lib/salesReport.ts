import type { Transaction } from "@shared/medidispense";
import { reportCsv } from "./adminFilters";

export function salesDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}( |$)/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map(key => parts.find(p => p.type === key)?.value).join("-");
}

export function salesReport(transactions: Transaction[], start: string, end: string, product: string) {
  const records = transactions.flatMap(t => {
    const date = salesDate(t.createdAt);
    if (t.paymentStatus !== "successful" || t.dispensingStatus !== "dispensed" || !date || (start && date < start) || (end && date > end)) return [];
    const items = t.items.filter(i => product === "all" || String(i.medicineId) === product);
    if (!items.length) return [];
    return [{ id: t.id, date, items, units: items.reduce((n, i) => n + i.quantity, 0), cents: items.reduce((n, i) => n + Math.round(i.subtotal * 100), 0) }];
  }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  type Group = { label: string; units: number; cents: number; transactions: number };
  const daily = new Map<string, Group>(), monthly = new Map<string, Group>(), medicines = new Map<string, Group>();
  const add = (map: Map<string, Group>, key: string, label: string, units: number, cents: number) => {
    const row = map.get(key) ?? { label, units: 0, cents: 0, transactions: 0 };
    row.units += units; row.cents += cents; row.transactions++; map.set(key, row);
  };
  for (const record of records) {
    add(daily, record.date, record.date, record.units, record.cents);
    add(monthly, record.date.slice(0, 7), record.date.slice(0, 7), record.units, record.cents);
    const perPurchase = new Map<number, { name: string; units: number; cents: number }>();
    for (const item of record.items) {
      const row = perPurchase.get(item.medicineId) ?? { name: item.medicineName, units: 0, cents: 0 };
      row.units += item.quantity; row.cents += Math.round(item.subtotal * 100); perPurchase.set(item.medicineId, row);
    }
    perPurchase.forEach((item, id) => add(medicines, String(id), item.name, item.units, item.cents));
  }
  return { records, daily: Array.from(daily.values()), monthly: Array.from(monthly.values()), medicines: Array.from(medicines.values()).sort((a,b) => b.cents-a.cents), cents: records.reduce((n,r) => n+r.cents,0), units: records.reduce((n,r) => n+r.units,0) };
}

export function salesCsv(report: ReturnType<typeof salesReport>, start: string, end: string, medicine: string) {
  return reportCsv([
    ["MediDispense Sales Report"], ["Start date", start || "All"], ["End date", end || "All"], ["Medicine", medicine],
    ["Basis", "Successful payment and completed dispensing; transaction date (Asia/Manila); stored item subtotals; excludes overpayment"],
    ["Total sales (PHP)", (report.cents/100).toFixed(2)], ["Transactions", report.records.length], ["Units sold", report.units], [],
    ...([['Daily',report.daily],['Monthly',report.monthly],['Medicine',report.medicines]] as const).flatMap(([label, rows]) => [[label,"Transactions","Units","Sales (PHP)"], ...rows.map(r => [r.label,r.transactions,r.units,(r.cents/100).toFixed(2)]), []]),
    ["Transaction", "Date", "Medicine", "Quantity", "Unit price (PHP)", "Subtotal (PHP)"],
    ...report.records.flatMap(r => r.items.map(i => [r.id,r.date,i.medicineName,i.quantity,i.unitPrice.toFixed(2),i.subtotal.toFixed(2)])),
  ]);
}
