import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyCoinEvent,
  mayLeavePayment,
  paymentStatus,
  purchaseTotal,
  quantityLimit,
  remainingAmount,
  reviewPurchase,
} from "../client/src/lib/kioskPurchase";

describe("Kiosk single-medicine coin purchase", () => {
  beforeEach(() => vi.resetModules());

  it("keeps a blocked slot unavailable after inventory refresh", async () => {
    const { store } = await import("./medidispenseStore");
    store.getMachine().slots[0].status = "blocked";
    expect(store.listMedicines(false).some(item => item.id === 1)).toBe(false);
    expect(() => store.checkout([{ medicineId: 1, quantity: 1 }])).toThrow();
  });

  it("excludes unassigned, disabled, expired and nonexistent-slot medicines", async () => {
    const { store } = await import("./medidispenseStore");
    const base = store.getMedicine(1)!;
    const nonexistent = store.createMedicine({ ...base, slotNumber: 99 });
    const disabled = store.createMedicine({
      ...base,
      slotNumber: null,
      enabled: false,
    });
    const catalog = store.listMedicines(false);
    expect(catalog.map(item => item.id)).not.toContain(nonexistent.id);
    expect(catalog.map(item => item.id)).not.toContain(disabled.id);
    expect(
      catalog.every(
        item =>
          item.enabled &&
          item.status !== "expired" &&
          store
            .getMachine()
            .slots.some(
              slot => slot.medicineId === item.id && slot.status !== "blocked"
            )
      )
    ).toBe(true);
    expect(() =>
      store.checkout([{ medicineId: nonexistent.id, quantity: 1 }])
    ).toThrow();
  });

  it("shows a sold-out assigned medicine but blocks purchase", async () => {
    const { store } = await import("./medidispenseStore");
    store.adjustStock(1, -store.getMedicine(1)!.stockQuantity, "test");
    expect(
      store.listMedicines(false).find(item => item.id === 1)?.stockQuantity
    ).toBe(0);
    expect(() => store.checkout([{ medicineId: 1, quantity: 1 }])).toThrow();
  });

  it("requires review when stock, price or eligibility changes", async () => {
    const { store } = await import("./medidispenseStore");
    const medicine = { ...store.getMedicine(1)! };
    const purchase = {
      selectedMedicine: medicine,
      quantity: 3,
      unitPrice: medicine.price,
      totalAmount: purchaseTotal(medicine.price, 3),
    };
    expect(reviewPurchase(purchase, [medicine]).changed).toBe(false);
    expect(
      reviewPurchase(purchase, [{ ...medicine, stockQuantity: 2 }]).changed
    ).toBe(true);
    expect(reviewPurchase(purchase, [{ ...medicine, price: 99 }]).changed).toBe(
      true
    );
    expect(reviewPurchase(purchase, []).changed).toBe(true);
    expect(
      reviewPurchase(purchase, [{ ...medicine, enabled: false }]).changed
    ).toBe(true);
    expect(purchase.quantity).toBe(3);
  });

  it("enforces one medicine and positive whole-unit quantities within stock", async () => {
    const { store } = await import("./medidispenseStore");
    expect(() => store.checkout([])).toThrow();
    expect(() =>
      store.checkout([
        { medicineId: 1, quantity: 1 },
        { medicineId: 2, quantity: 1 },
      ])
    ).toThrow();
    expect(() =>
      store.checkout([
        { medicineId: 1, quantity: 1 },
        { medicineId: 1, quantity: 1 },
      ])
    ).toThrow();
    for (const quantity of [0, -1, 1.5, 10000])
      expect(() => store.checkout([{ medicineId: 1, quantity }])).toThrow();
    const medicine = store.getMedicine(1)!;
    expect(quantityLimit(medicine)).toBe(medicine.stockQuantity);
    expect(quantityLimit(medicine, 5)).toBe(5);
    expect(quantityLimit({ ...medicine, stockQuantity: 2 }, 5)).toBe(2);
    expect(quantityLimit({ ...medicine, stockQuantity: 0 })).toBe(0);
  });

  it("tracks exact totals, partial coins and overpayment without clamping or duplicate coin events", async () => {
    const { store } = await import("./medidispenseStore");
    const transaction = store.checkout([{ medicineId: 1, quantity: 3 }]);
    expect(purchaseTotal(0.1, 3)).toBe(0.3);
    expect(purchaseTotal(10, 3)).toBe(30);
    expect(paymentStatus(null, 0)).toBe("IDLE");
    expect(paymentStatus(transaction, 0)).toBe("WAITING_FOR_COINS");
    expect(mayLeavePayment(transaction, 0)).toBe(true);
    const partial = applyCoinEvent(
      { insertedAmount: 0, eventIds: [] },
      { id: "coin-1", amount: 20 }
    );
    expect(paymentStatus(transaction, partial.insertedAmount)).toBe("PARTIAL");
    expect(remainingAmount(transaction.total, partial.insertedAmount)).toBe(10);
    expect(mayLeavePayment(transaction, partial.insertedAmount)).toBe(false);
    expect(applyCoinEvent(partial, { id: "coin-1", amount: 20 })).toBe(partial);
    const overpaid = applyCoinEvent(partial, { id: "coin-2", amount: 20 });
    expect(overpaid.insertedAmount).toBe(40);
    expect(paymentStatus(transaction, 30)).toBe("PAID");
    expect(paymentStatus(transaction, 40)).toBe("OVERPAYMENT");
    expect(remainingAmount(transaction.total, 40)).toBe(0);
    store.verifyPayment(transaction.id, 40);
    expect(transaction.amountPaid).toBe(40);
    expect(transaction.change).toBe(0);
    expect(mayLeavePayment(transaction, 40)).toBe(false);
  });

  it("deducts one confirmed unit at a time, handles duplicate events and only succeeds after all units", async () => {
    const { store } = await import("./medidispenseStore");
    const before = store.getMedicine(1)!.stockQuantity;
    const transaction = store.checkout([{ medicineId: 1, quantity: 3 }]);
    expect(transaction.amountPaid).toBe(0);
    expect(() => store.requestDispense(transaction.id)).toThrow();
    expect(() =>
      store.verifyPayment(transaction.id, transaction.total - 1)
    ).toThrow();
    store.verifyPayment(transaction.id, transaction.total);
    store.requestDispense(transaction.id);
    expect(store.getMedicine(1)!.stockQuantity).toBe(before);
    expect(() => store.verifyDispense(transaction.id, true)).toThrow();
    expect(() => store.verifyDispense(transaction.id, true, 2)).toThrow();
    store.verifyDispense(transaction.id, true, 1);
    expect(transaction.dispensedQuantity).toBe(1);
    expect(paymentStatus(transaction, transaction.total)).toBe("DISPENSING");
    expect(store.getMedicine(1)!.stockQuantity).toBe(before - 1);
    store.verifyDispense(transaction.id, true, 1);
    expect(store.getMedicine(1)!.stockQuantity).toBe(before - 1);
    store.verifyDispense(transaction.id, true, 2);
    expect(transaction.dispensingStatus).toBe("dispensing");
    store.verifyDispense(transaction.id, true, 3);
    expect(paymentStatus(transaction, transaction.total)).toBe("SUCCESS");
    expect(transaction.dispensedQuantity).toBe(3);
    store.requestDispense(transaction.id);
    store.verifyDispense(transaction.id, true, 3);
    expect(store.getMedicine(1)!.stockQuantity).toBe(before - 3);
    expect(transaction.dispensingStatus).toBe("dispensed");
  });

  it("preserves partial results when the third unit fails without retrying or claiming success", async () => {
    const { store } = await import("./medidispenseStore");
    const before = store.getMedicine(1)!.stockQuantity;
    const transaction = store.checkout([{ medicineId: 1, quantity: 3 }]);
    store.verifyPayment(transaction.id, transaction.total);
    store.requestDispense(transaction.id);
    store.verifyDispense(transaction.id, true, 1);
    store.verifyDispense(transaction.id, true, 2);
    store.verifyDispense(transaction.id, false, 3);
    expect(transaction.requestedQuantity).toBe(3);
    expect(transaction.dispensedQuantity).toBe(2);
    expect(paymentStatus(transaction, transaction.total)).toBe(
      "DISPENSE_FAILED"
    );
    expect(store.getMedicine(1)!.stockQuantity).toBe(before - 2);
    expect(() => store.requestDispense(transaction.id)).toThrow();
    expect(() => store.verifyDispense(transaction.id, true, 3)).toThrow();
    expect(mayLeavePayment(transaction, transaction.total)).toBe(false);
  });
});
