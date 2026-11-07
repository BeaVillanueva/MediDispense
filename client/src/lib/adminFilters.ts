import type { Transaction } from "@shared/medidispense";

export const transactionStatuses = [
  "all",
  "successful",
  "pending",
  "cancelled",
  "failed",
] as const;
export function transactionStatus(
  txn: Pick<Transaction, "paymentStatus" | "dispensingStatus">
) {
  if (
    txn.paymentStatus === "failed" ||
    ["failed", "timeout"].includes(txn.dispensingStatus)
  )
    return "failed";
  if (txn.paymentStatus === "cancelled" || txn.dispensingStatus === "cancelled")
    return "cancelled";
  return txn.paymentStatus === "successful" &&
    txn.dispensingStatus === "dispensed"
    ? "successful"
    : "pending";
}
export function dateKey(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T"));
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function inDateRange(value: string, from: string, to: string) {
  if (!from && !to) return true;
  const date = dateKey(value);
  return !!date && (!from || date >= from) && (!to || date <= to);
}
export const activityActions = [
  "All",
  "Login",
  "Logout",
  "Add",
  "Update",
  "Delete",
  "Restock",
  "Dispense",
  "Reports",
  "Cancelled",
  "Failed/Error",
] as const;
export function matchesActivity(
  action: string,
  category: string,
  metadata?: string | null
) {
  if (category === "All") return true;
  const patterns: Record<string, RegExp> = {
    Login: /login|logged_in/,
    Logout: /logout|logged_out/,
    Add: /added|created|inserted/,
    Update: /updated|changed|adjusted|unlocked|activated/,
    Delete: /deleted|removed|archived/,
    Restock: /restock/,
    Dispense: /dispens/,
    Reports: /report_(generated|exported)/,
    Cancelled: /cancelled|canceled/,
    "Failed/Error": /fail|error|timeout|rejected|locked/,
  };
  if (
    category === "Restock" &&
    /stock_adjusted|inventory_adjusted/i.test(action)
  ) {
    try {
      const data = JSON.parse(metadata ?? "{}");
      return Number(data.change ?? data.delta) > 0;
    } catch {
      return false;
    }
  }
  if (category === "Failed/Error" && /unlocked/i.test(action)) return false;
  return patterns[category]?.test(action.toLowerCase()) ?? false;
}
export function reportCsv(rows: unknown[][]) {
  return rows
    .map(row =>
      row
        .map(value => {
          let text = String(value ?? "");
          if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
          return `"${text.replaceAll('"', '""')}"`;
        })
        .join(",")
    )
    .join("\r\n");
}
