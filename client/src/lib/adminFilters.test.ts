import { describe, expect, it } from "vitest";
import {
  transactionStatus,
  inDateRange,
  matchesActivity,
  reportCsv,
} from "./adminFilters";

describe("admin filters", () => {
  it("distinguishes completed purchases from paid, failed and cancelled dispensing", () => {
    expect(
      transactionStatus({
        paymentStatus: "successful",
        dispensingStatus: "dispensed",
      })
    ).toBe("successful");
    expect(
      transactionStatus({
        paymentStatus: "successful",
        dispensingStatus: "dispensing",
      })
    ).toBe("pending");
    expect(
      transactionStatus({
        paymentStatus: "successful",
        dispensingStatus: "timeout",
      })
    ).toBe("failed");
    expect(
      transactionStatus({
        paymentStatus: "cancelled",
        dispensingStatus: "pending",
      })
    ).toBe("cancelled");
    expect(
      transactionStatus({
        paymentStatus: "pending",
        dispensingStatus: "cancelled",
      })
    ).toBe("cancelled");
  });
  it("includes both date boundaries and supports open-ended ranges", () => {
    expect(inDateRange("2026-10-31 23:59:59", "2026-10-01", "2026-10-31")).toBe(
      true
    );
    expect(inDateRange("2026-11-01 00:00:00", "", "2026-10-31")).toBe(false);
    expect(inDateRange("2026-10-01", "2026-10-01", "")).toBe(true);
    expect(inDateRange("invalid", "2026-10-01", "")).toBe(false);
    expect(inDateRange("2026-10-15", "2026-10-31", "2026-10-01")).toBe(false);
  });
  it("maps existing audit action names including restock deltas", () => {
    expect(matchesActivity("report_exported", "Reports")).toBe(true);
    expect(matchesActivity("report_generated", "Reports")).toBe(true);
    expect(matchesActivity("transaction_cancelled", "Cancelled")).toBe(true);
    expect(matchesActivity("medicine_dispensed", "Dispense")).toBe(true);
    expect(matchesActivity("user_logged_in", "Login")).toBe(true);
    expect(matchesActivity("admin_inactivity_logout", "Logout")).toBe(true);
    expect(matchesActivity("medicine_archived", "Delete")).toBe(true);
    expect(matchesActivity("medicine_created", "Add")).toBe(true);
    expect(matchesActivity("admin_login_failed", "Failed/Error")).toBe(true);
    expect(matchesActivity("admin_account_unlocked", "Failed/Error")).toBe(
      false
    );
    expect(
      matchesActivity("inventory_adjusted", "Restock", '{"delta":5}')
    ).toBe(true);
    expect(matchesActivity("stock_adjusted", "Restock", '{"change":5}')).toBe(
      true
    );
    expect(
      matchesActivity("inventory_adjusted", "Restock", '{"delta":-5}')
    ).toBe(false);
  });
  it("exports supplied filtered rows with CSV escaping and formula protection", () => {
    expect(
      reportCsv([
        ["Medicine", "Status"],
        ['A, "B"', "cancelled"],
      ])
    ).toBe('"Medicine","Status"\r\n"A, ""B""","cancelled"');
    expect(reportCsv([["=1+1"]])).toBe('"\'=1+1"');
  });
});
