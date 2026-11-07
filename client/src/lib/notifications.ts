import type { Alert } from "@shared/medidispense";

export function productionNotifications(alerts: Alert[]) {
  return alerts.filter(alert => alert.details?.is_test !== true && alert.details?.is_test !== "true"
    && !/^\s*\[TEST(?:\]|\s)/i.test(alert.title) && !/^\s*\[TEST(?:\]|\s)/i.test(alert.message));
}

export function notificationSummary(alert: Alert) {
  const medicine = typeof alert.details?.medicine_name === "string" ? alert.details.medicine_name : "";
  const slot = alert.details?.slot_number;
  const stock = alert.kind === "low_stock" || alert.kind === "out_of_stock";
  const urgent = alert.kind === "dispensing_failure" || alert.severity === "danger";
  const quantity = alert.details?.available_stock;
  return {
    title: alert.kind === "dispensing_failure" ? "Dispensing Issue Alert" : alert.kind === "low_stock" ? "Low Stock Alert" : alert.kind === "out_of_stock" ? "Out of Stock" : alert.title,
    medicine: medicine ? `${medicine}${typeof slot === "number" ? ` — Slot ${slot}` : ""}` : "",
    description: stock && typeof quantity === "number" ? quantity === 0 ? "Out of stock. Restocking required." : `${quantity} units remaining.`
      : alert.kind === "dispensing_failure" && medicine ? "Assistance required. Please inspect the dispensing mechanism." : alert.message,
    tone: urgent ? "urgent" : stock ? "stock" : "neutral",
    highPriority: urgent,
  };
}
