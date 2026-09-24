import { describe, expect, it } from "vitest";
import { store } from "./medidispenseStore";

describe("MediDispense dispensing workflow", () => {
  it("does not deduct stock when payment is verified but dispensing is not sensor-confirmed", () => {
    const before = store.getMedicine(1)?.stockQuantity ?? 0;
    const transaction = store.checkout([{ medicineId: 1, quantity: 1 }]);
    store.verifyPayment(transaction.id, transaction.total);
    store.requestDispense(transaction.id);
    expect(store.getMedicine(1)?.stockQuantity).toBe(before);
  });

  it("deducts stock only after a successful sensor confirmation", () => {
    const before = store.getMedicine(1)?.stockQuantity ?? 0;
    const transaction = store.listTransactions().find((item) => item.dispensingStatus === "dispensing");
    expect(transaction).toBeDefined();
    if (!transaction) return;
    store.verifyDispense(transaction.id, true);
    expect(store.getMedicine(1)?.stockQuantity).toBe(before - 1);
    expect(store.listTransactions().find((item) => item.id === transaction.id)?.dispensingStatus).toBe("dispensed");
  });

  it("records a failed dispensing event without deducting inventory", () => {
    const before = store.getMedicine(2)?.stockQuantity ?? 0;
    const transaction = store.checkout([{ medicineId: 2, quantity: 1 }]);
    store.verifyPayment(transaction.id, transaction.total);
    store.requestDispense(transaction.id);
    store.verifyDispense(transaction.id, false);
    expect(store.getMedicine(2)?.stockQuantity).toBe(before);
    expect(store.listTransactions().find((item) => item.id === transaction.id)?.dispensingStatus).toBe("failed");
  });
});
