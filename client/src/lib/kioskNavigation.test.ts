import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const harness = vi.hoisted(() => ({ cells: [] as unknown[], cursor: 0, transaction: null as any, error: null as string | null, busy: false, start: vi.fn(), reset: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.cursor++;
    if (!(index in harness.cells)) harness.cells[index] = initial;
    return [harness.cells[index], (next: any) => { harness.cells[index] = typeof next === "function" ? next(harness.cells[index]) : next; }];
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: () => {},
}));
const medicine = { id: 1, name: "Example 500mg", genericName: "Example", category: "Example", dosage: "500 mg tablet", description: "Stored description", instructions: "", stockQuantity: 6, minimumStockLevel: 3, price: 5, expiryDate: "2099-01-01", imageUrl: "/example.jpg", slotNumber: 1, status: "in_stock", enabled: true, dateAdded: "", updatedAt: "" };
vi.mock("@/hooks/useKioskMedicines", () => ({ useKioskMedicines: () => ({ data: [medicine], refetch: async () => ({ data: [medicine] }), isError: false, isPending: false }) }));
vi.mock("@/hooks/useKioskCheckout", () => ({ useKioskCheckout: () => ({ transaction: harness.transaction, error: harness.error, busy: harness.busy, start: harness.start, reset: harness.reset, paymentStatus: "WAITING_FOR_COINS" }) }));
vi.mock("@/components/kiosk/CheckoutPanel", () => ({ CheckoutPanel: () => null }));
import Kiosk from "@/pages/Kiosk";
import { DraftNavigation } from "@/components/kiosk/DraftNavigation";
import { Confirmation, QuantityPicker } from "@/components/kiosk/KioskControls";
import { CheckoutPanel } from "@/components/kiosk/CheckoutPanel";

function tree() { harness.cursor = 0; return Kiosk(); }
function find(node: any, match: (node: ReactElement<any>) => boolean): any {
  if (Array.isArray(node)) { for (const child of node) { const found = find(child, match); if (found) return found; } }
  if (!node || typeof node !== "object" || !node.props) return undefined;
  return match(node) ? node : find(node.props.children, match);
}
function component(type: unknown) { return find(tree(), node => node.type === type)?.props; }
function select() {
  const button = find(tree(), node => node.type === "button" && Array.isArray(node.props.children) && node.props.children[0] === "Select ");
  expect(button).toBeTruthy(); button.props.onClick();
}
function quantity() { select(); component(DraftNavigation).onContinue(); }

describe("draft navigation and cancellation boundaries", () => {
  beforeEach(() => { harness.cells = []; harness.cursor = 0; harness.transaction = null; harness.error = null; harness.busy = false; harness.start.mockReset(); harness.reset.mockReset(); });
  it("preserves quantity going back to review and forward again without checkout", () => {
    quantity(); component(QuantityPicker).onChange(3);
    component(DraftNavigation).onBack();
    expect(component(DraftNavigation).primaryLabel).toBe("Continue");
    component(DraftNavigation).onContinue();
    expect(component(QuantityPicker).value).toBe(3);
    expect(harness.start).not.toHaveBeenCalled();
  });
  it("keeps a draft when Keep Purchase closes its confirmation", () => {
    quantity(); component(QuantityPicker).onChange(2);
    component(DraftNavigation).onCancel();
    expect(component(Confirmation).open).toBe(true);
    expect(component(Confirmation).cancelLabel).toBe("Keep Purchase");
    component(Confirmation).onCancel();
    expect(component(Confirmation).open).toBe(false);
    expect(component(QuantityPicker).value).toBe(2);
    expect(harness.reset).not.toHaveBeenCalled();
  });
  it.each(["review", "quantity"])("cancels only local %s state without a transaction API call", step => {
    select(); if (step === "quantity") component(DraftNavigation).onContinue();
    component(DraftNavigation).onCancel(); component(Confirmation).onConfirm();
    expect(component(DraftNavigation)).toBeUndefined();
    select(); component(DraftNavigation).onContinue();
    expect(component(QuantityPicker).value).toBe(1);
    expect(harness.reset).not.toHaveBeenCalled();
    expect(harness.start).not.toHaveBeenCalled();
  });
  it("submits only through Proceed to Payment using the selected quantity", async () => {
    quantity(); component(QuantityPicker).onChange(2);
    expect(harness.start).not.toHaveBeenCalled();
    await component(DraftNavigation).onContinue();
    // The button starts the existing asynchronous availability recheck.
    await Promise.resolve();
    expect(harness.start).toHaveBeenCalledWith(expect.objectContaining({ quantity: 2, totalAmount: 10 }));
  });
  it.each(["pending", "dispensing"])("hides draft cancellation for an active %s transaction", status => {
    quantity(); component(DraftNavigation).onCancel();
    harness.transaction = { id: "existing", items: [{ medicineId: 1, medicineName: medicine.name }], paymentStatus: status === "pending" ? "pending" : "successful", dispensingStatus: status };
    expect(component(CheckoutPanel)).toBeTruthy();
    expect(component(DraftNavigation)).toBeUndefined();
    component(Confirmation).onConfirm();
    expect(harness.cells[0]).toBe("quantity");
    expect(harness.reset).not.toHaveBeenCalled();
    expect(harness.start).not.toHaveBeenCalled();
  });
  it("preserves interrupted checkout state when draft cancellation becomes unsafe", () => {
    quantity(); component(DraftNavigation).onCancel(); harness.error = "Reconnect to recover";
    component(Confirmation).onConfirm();
    expect(component(QuantityPicker).value).toBe(1);
    expect(harness.cells[3]).toBeTruthy();
    expect(harness.reset).not.toHaveBeenCalled();
  });
});
