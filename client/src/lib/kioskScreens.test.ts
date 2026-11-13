import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Medicine } from "@shared/medidispense";
import { purchaseTotal } from "./kioskPurchase";

const state = vi.hoisted(() => ({ view: "browse", selectedId: null as number | null, quantity: 1, purchase: null as unknown, hook: 0, start: vi.fn() }));
vi.mock("react", async importOriginal => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, useState: (initial: unknown) => {
    const index = state.hook++;
    const overrides = [state.view, state.selectedId, state.quantity, state.purchase];
    return original.useState(index < overrides.length ? overrides[index] : initial);
  }};
});
const medicine: Medicine = { id: 1, name: "Example 500mg", genericName: "Example", category: "Pain Relief", description: "Stored medicine description.", dosage: "500 mg tablet.", instructions: "Follow the supplied label.", stockQuantity: 6, minimumStockLevel: 3, price: 5, expiryDate: "2099-01-01", imageUrl: "/images/biogesic.jpg", slotNumber: 1, status: "in_stock", enabled: true, dateAdded: "", updatedAt: "" };
vi.mock("@/hooks/useKioskMedicines", () => ({ useKioskMedicines: () => ({ data: [medicine], refetch: vi.fn(), isError: false, isPending: false }) }));
vi.mock("@/hooks/useKioskCheckout", () => ({ useKioskCheckout: () => ({ busy: false, transaction: null, start: state.start, reset: vi.fn(), error: null }) }));
// These integrations are outside this presentation test; exercise the real quantity control.
vi.mock("@/components/kiosk/CheckoutPanel", () => ({ CheckoutPanel: () => null }));
import Kiosk from "@/pages/Kiosk";

function render(view: string, quantity = 1) {
  state.hook = 0;
  state.view = view;
  state.quantity = quantity;
  state.selectedId = view === "browse" ? null : medicine.id;
  state.purchase = view === "quantity" ? { selectedMedicine: medicine, quantity, unitPrice: medicine.price, totalAmount: purchaseTotal(medicine.price, quantity) } : null;
  return renderToStaticMarkup(React.createElement(Kiosk));
}

describe("tablet kiosk purchase screens", () => {
  beforeEach(() => state.start.mockClear());
  it("shows medicine cards without the introduction or physical slot identifiers", () => {
    const html = render("browse");
    expect(html).toContain(medicine.name);
    expect(html).not.toContain("What do you need today");
    expect(html).not.toContain("Choose your medicine");
    expect(html).not.toMatch(/Slot\s*1/);
    expect(html).toContain("/ tablet");
    expect(html).toContain("6 tablets available");
    expect(html.indexOf("Review</strong>")).toBeLessThan(html.indexOf("Quantity</strong>"));
  });
  it("reviews stored medicine information before quantity without creating checkout", () => {
    const html = render("review");
    expect(html).toContain(medicine.description);
    expect(html).not.toContain(medicine.instructions);
    expect(html).not.toContain("Dosage &amp; Usage Guidelines");
    expect(html).not.toContain("Dosage guidance is not yet available");
    expect(html).toContain("Continue <");
    expect(html).not.toContain('aria-label="Quantity for');
    expect(html.split("Example 500mg</h2>")).toHaveLength(2);
    expect(html).not.toContain("kv-dosage-name");
    expect(state.start).not.toHaveBeenCalled();
  });
  it("shows quantity controls and a calculated total without creating checkout", () => {
    const html = render("quantity", 3);
    expect(html).toContain("Proceed to Payment");
    expect(html).toContain("Back</button>");
    expect(html).not.toContain("Back to Review");
    expect(html).toContain("15.00");
    expect(html).toMatch(/<output[^>]*>3<\/output>/);
    expect(html).not.toMatch(/Slot\s*1/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Increase Example 500mg quantity"/);
    expect(state.start).not.toHaveBeenCalled();
  });
  it("uses packaging and pharmacist fallbacks when stored information is missing", () => {
    const saved = { description: medicine.description, dosage: medicine.dosage, instructions: medicine.instructions };
    Object.assign(medicine, { description: "", dosage: "", instructions: "" });
    try {
      const html = render("review");
      expect(html).toContain("Medicine information is not available");
      expect(html).toContain("ask a pharmacist");
      expect(html).not.toContain("every 4");
    } finally { Object.assign(medicine, saved); }
  });
  it("omits the guidelines section even when approved guidance exists", () => {
    medicine.usageGuidance = { approvalStatus: "approved", medicineName: medicine.name, strength: "500 mg", formulation: "tablet", purpose: "TEST approved purpose", ageGroup: "TEST adults", dose: "TEST reviewed dose", frequency: "TEST reviewed frequency", minimumInterval: "TEST interval", maximumDailyDose: "TEST maximum", precautions: "TEST precautions", sourceLabel: "Approved reference", sourceUrl: "https://example.org/label", approvedAt: "2026-01-01", reviewDueAt: "2099-01-01" };
    try {
      const html = render("review");
      expect(html).not.toContain("TEST dose");
      expect(html).not.toContain("Dosage &amp; Usage Guidelines");
      expect(html).not.toContain("Dosage guidance is not yet available");
      medicine.usageGuidance.minimumInterval = null;
      medicine.usageGuidance.maximumDailyDose = null;
      const optional = render("review");
      expect(optional).not.toContain("Minimum interval");
      expect(optional).not.toContain("Maximum daily dose");
    } finally { delete medicine.usageGuidance; }
  });

});
