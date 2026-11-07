import { describe, expect, it } from "vitest";
import type { Transaction } from "@shared/medidispense";
import { dispensingConfirmationTimedOut, timeoutReturnSeconds, recoveryConfirmed } from "./dispensingTimeout";

const transaction = { paymentStatus: "successful", dispensingStatus: "dispensing" } as Transaction;
describe("dispensing confirmation timeout", () => {
  it("returns home 20 seconds after the persisted timeout, even after reload", () => {
    expect(timeoutReturnSeconds(120)).toBe(20);
    expect(timeoutReturnSeconds(133)).toBe(7);
    expect(timeoutReturnSeconds(140)).toBe(0);
    expect(timeoutReturnSeconds(3600)).toBe(0);
  });
  it("unlocks recovery only from the backend finalized marker", () => {
    expect(recoveryConfirmed(transaction)).toBe(false);
    expect(recoveryConfirmed({ ...transaction, adminRecovered: true })).toBe(false);
    expect(recoveryConfirmed({ ...transaction, dispensingStatus: "failed", adminRecovered: true })).toBe(true);
    expect(recoveryConfirmed(null)).toBe(false);
  });
  it("waits two minutes and recognizes old restored purchases immediately", () => {
    expect(dispensingConfirmationTimedOut(transaction, 119)).toBe(false);
    expect(dispensingConfirmationTimedOut(transaction, 120)).toBe(true);
    expect(dispensingConfirmationTimedOut(transaction, 3600)).toBe(true);
  });
  it("does not override actual terminal results or unpaid purchases", () => {
    for (const dispensingStatus of ["dispensed", "failed", "cancelled", "timeout"] as const)
      expect(dispensingConfirmationTimedOut({ ...transaction, dispensingStatus }, 3600)).toBe(false);
    expect(dispensingConfirmationTimedOut({ ...transaction, paymentStatus: "pending" }, 3600)).toBe(false);
    expect(dispensingConfirmationTimedOut(null, 3600)).toBe(false);
  });
  it("does not change transaction or payment state", () => {
    const original = { ...transaction };
    dispensingConfirmationTimedOut(transaction, 120);
    expect(transaction).toEqual(original);
  });
});
