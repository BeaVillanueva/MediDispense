import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Transaction } from "@shared/medidispense";
import { paymentWindowState, paymentCountdownLabel, shouldCheckPaymentExpiration, paymentExpiryReturnSeconds } from "./paymentWindow";
import { paymentStatus } from "./kioskPurchase";
import { CheckoutPanel } from "@/components/kiosk/CheckoutPanel";

const base: Transaction = { id: "TEST-PAYMENT", databaseId: 1, items: [{ medicineId: 1, medicineName: "Test", quantity: 1, unitPrice: 10, subtotal: 10 }], total: 10, amountPaid: 0, change: 0, paymentStatus: "pending", dispensingStatus: "pending", requestedQuantity: 1, dispensedQuantity: 0, createdAt: "", slotNumber: 1, paymentWindow: { serverNowMs: 1000000, deadlineMs: 1300000, automaticExpirationEnabled: false, hardwarePauseSupported: false } };
function render(transaction: Transaction, error: string | null = null) {
  const finish = vi.fn(), back = vi.fn();
  const checkout = { transaction, insertedAmount: transaction.amountPaid, remainingAmount: Math.max(0, transaction.total - transaction.amountPaid), paymentStatus: paymentStatus(transaction, transaction.amountPaid), preview: false, busy: false, error, canGoBack: transaction.amountPaid === 0 && !error, simulationEnabled: false } as any;
  return { html: renderToStaticMarkup(React.createElement(CheckoutPanel, { checkout, onBack: back, onFinish: finish, onBrowse: vi.fn() })), finish, back };
}
describe("server-authoritative advisory payment window", () => {
  it("formats five minutes and zero as MM:SS", () => {
    expect(paymentCountdownLabel(paymentWindowState(base)!.seconds)).toBe("05:00");
    expect(paymentCountdownLabel(paymentWindowState(base, 300000)!.seconds)).toBe("00:00");
  });
  it("warns at exactly one minute and clamps overdue times", () => {
    expect(paymentWindowState(base, 239000)?.warning).toBe(false);
    expect(paymentWindowState(base, 240000)?.warning).toBe(true);
    expect(paymentWindowState(base, 400000)?.seconds).toBe(0);
  });
  it("refresh/reconnect keeps the same server deadline rather than starting five minutes again", () => {
    const refreshed = { ...base, paymentWindow: { ...base.paymentWindow!, serverNowMs: 1240000 } };
    expect(paymentWindowState(refreshed)?.seconds).toBe(60);
    expect(paymentWindowState(refreshed, 60000)?.elapsed).toBe(true);
    expect(base.amountPaid).toBe(0);
  });
  it.each(["successful", "cancelled", "failed"] as const)("does not time out %s payments", payment => {
    expect(paymentWindowState({ ...base, paymentStatus: payment }, 400000)).toBeNull();
  });
  it.each(["dispensing", "dispensed", "failed", "timeout"] as const)("does not interfere with %s dispensing", status => {
    expect(paymentWindowState({ ...base, dispensingStatus: status }, 400000)).toBeNull();
  });
  it("does not invent timing when the server has not supplied it", () => {
    expect(paymentWindowState({ ...base, paymentWindow: undefined })).toBeNull();
  });
  it("no-payment elapsed window preserves purchase and offers assistance instead of auto-return", () => {
    const { html, finish, back } = render({ ...base, paymentWindow: { ...base.paymentWindow!, serverNowMs: 1300000 } });
    expect(html).toContain("00:00");
    expect(html).toContain("purchase remains open for reconciliation");
    expect(html).not.toContain("Back to Quantity");
    expect(html).not.toContain("Payment session expired. No payment was received.");
    expect(finish).not.toHaveBeenCalled(); expect(back).not.toHaveBeenCalled();
  });
  it("partial payment is retained and never claimed to be physically paused/refunded", () => {
    const t = { ...base, amountPaid: 5, paymentWindow: { ...base.paymentWindow!, serverNowMs: 1300000 } };
    const { html } = render(t);
    expect(html).toContain("Coins recorded by the server remain saved");
    expect(html).toContain("cannot remotely pause coin acceptance");
    expect(html).not.toContain("Insert ₱5.00 more");
    expect(html).not.toContain("Back to Quantity");
    expect(t.amountPaid).toBe(5);
  });
  it("network failure asks for recovery without assuming zero or cancelling", () => {
    const { html, back, finish } = render(base, "Connection interrupted");
    expect(html).toContain("payment state cannot be confirmed");
    expect(html).toContain("Do not insert coins");
    expect(back).not.toHaveBeenCalled(); expect(finish).not.toHaveBeenCalled();
  });
});

describe("exact coin payment presentation", () => {
  it.each([[0, "20.00"], [10, "10.00"], [20, "0.00"]])("shows the backend balance for 20 pesos with %s inserted", (inserted, needed) => {
    const { html } = render({ ...base, total: 20, amountPaid: inserted, paymentStatus: inserted === 20 ? "successful" : "pending" });
    expect(html).toContain(`Amount Still Needed</span><strong>₱${needed}</strong>`);
    expect(html).toContain(`Coins Inserted</span><strong>₱${inserted.toFixed(2)}</strong>`);
    expect(html).not.toContain("Total amount");
    expect(html).not.toContain('class="kv-payment-amounts');
    expect(html).toContain("images/kiosk/payment/coins.png");
    expect(html).toContain("images/kiosk/payment/wallet.png");
    if (inserted < 20) {
      expect(html).toContain("Insert Exact Payment");
      expect(html).toContain("Please insert the exact amount. No change is provided.");
      expect(html).not.toContain("<progress");
    }
  });
  it("recovered partial payment retains the authoritative recorded amounts", () => {
    const snapshot = { ...base, total: 20, amountPaid: 10 };
    expect(render(snapshot).html).toContain("Amount Still Needed</span><strong>₱10.00</strong>");
    expect(render({ ...snapshot }).html).toContain("Coins Inserted</span><strong>₱10.00</strong>");
  });
  it("marks disconnected amounts as last confirmed and never instructs coin insertion", () => {
    const { html } = render({ ...base, total: 20, amountPaid: 10 }, "Connection interrupted");
    expect(html).toContain("Last confirmed amounts");
    expect(html).toContain("Coins Inserted</span><strong>₱10.00</strong>");
    expect(html).not.toContain("Please insert the exact amount");
  });
  it("preserves excess coins and displays assistance even when the backend reports paid", () => {
    const { html } = render({ ...base, total: 20, amountPaid: 25, paymentStatus: "successful" });
    expect(html).toContain("Overpayment - assistance needed");
    expect(html).toContain("Coins Inserted</span><strong>₱25.00</strong>");
    expect(html).toContain("Amount Still Needed</span><strong>₱0.00</strong>");
    expect(html).toContain("has not been refunded");
    expect(html).not.toContain("Transaction Successful!");
  });
});

describe("confirmed payment expiration screen", () => {
  it("keeps a completed demo purchase visible while awaiting clean controller telemetry", () => {
    const {html}=render({...base,amountPaid:10,total:10,paymentStatus:'successful',dispensingStatus:'dispensed',requestedQuantity:1,dispensedQuantity:1,customerHandoffSafe:false,paymentWindow:{...base.paymentWindow!,controlledDemoAutoBinding:true}});
    expect(html).toContain('Waiting for the machine payment status');
    expect(html).not.toContain('Returning to Choose Medicine in');
  });
  it("counts three seconds from server confirmation and does not restart on refresh", () => {
    const t={...base,paymentStatus:'cancelled' as const,paymentExpiry:{confirmed:true as const,returnAtMs:base.paymentWindow!.serverNowMs+3000}};
    expect(paymentExpiryReturnSeconds(t,0)).toBe(3);
    expect(paymentExpiryReturnSeconds(t,1000)).toBe(2);
    expect(paymentExpiryReturnSeconds(t,3000)).toBe(0);
    expect(paymentExpiryReturnSeconds({...t,paymentWindow:{...t.paymentWindow!,serverNowMs:t.paymentWindow!.serverNowMs+4000}},0)).toBe(0);
  });
  it("shows actionable backend blockers at zero without claiming cancellation", () => {
    const {html}=render({...base,paymentWindow:{...base.paymentWindow!,deadlineMs:0,controlledDemonstration:true,expirationBlockers:['CONTROLLER_DIAGNOSTICS_MISSING','UNCONFIRMED_PAYMENT_EVENTS']}});
    expect(html).toContain('No payment status report has been received');
    expect(html).toContain('Unconfirmed coin events must be reconciled');
    expect(html).not.toContain('Your purchase has been cancelled');
  });
  it("labels the opt-in controlled demonstration without claiming hardware inhibition", () => {
    const {html}=render({...base,paymentWindow:{...base.paymentWindow!,automaticExpirationEnabled:true,controlledDemonstration:true}});
    expect(html).toContain("Controlled demonstration");
    expect(html).toContain("Physical coin acceptance is not disabled.");
    expect(html).not.toContain("Payment Time Expired");
  });
  it("shows a three-second return only for persisted backend expiry confirmation", () => {
    const t = { ...base, paymentStatus: "cancelled" as const, dispensingStatus: "cancelled" as const, paymentExpiry: { confirmed: true as const, returnAtMs: base.paymentWindow!.serverNowMs + 3000 } };
    const { html } = render(t);
    expect(html).toContain("Payment Time Expired");
    expect(html).toContain("No payment was received. Your purchase has been cancelled.");
    expect(html).toContain("Returning to Choose Medicine in 3 seconds.");
    expect(html).toContain(base.id);
    expect(html).not.toContain("Back to Quantity");
  });
  it("never treats an ordinary cancellation as confirmed timeout", () => {
    const { html } = render({ ...base, paymentStatus: "cancelled", dispensingStatus: "cancelled" });
    expect(html).not.toContain("Payment Time Expired");
    expect(html).not.toContain("Returning to Choose Medicine in");
  });
});


describe("expiry verification eligibility",()=>{
  it("checks expired zero balances with PHP even if automatic expiry capability is disabled",()=>{
    expect(shouldCheckPaymentExpiration(base,true)).toBe(true);
    expect(shouldCheckPaymentExpiration(base,false)).toBe(false);
  });
  it("never treats partial, paid or dispensing transactions as unpaid expiry candidates",()=>{
    expect(shouldCheckPaymentExpiration({...base,amountPaid:5},true)).toBe(false);
    expect(shouldCheckPaymentExpiration({...base,paymentStatus:"successful",amountPaid:10},true)).toBe(false);
    expect(shouldCheckPaymentExpiration({...base,dispensingStatus:"dispensing"},true)).toBe(false);
    expect(shouldCheckPaymentExpiration(null,true)).toBe(false);
  });
});


describe("successful-purchase handoff protection",()=>{
  const done={...base,amountPaid:10,paymentStatus:"successful" as const,dispensingStatus:"dispensed" as const,requestedQuantity:1,dispensedQuantity:1};
  it("allows collection and shows success while retaining the session without physical handoff proof",()=>{
    const {html,finish}=render(done);
    expect(html).toContain("Transaction Successful!");expect(html).toContain("Please collect your medicine");expect(html).toContain("staff check is required before the next purchase");
    expect(html).not.toContain("Returning to medicines in");expect(html).not.toContain("Return to Choose Medicine <");expect(finish).not.toHaveBeenCalled();
  });
  it("offers normal automatic return only with explicit backend confirmation and exact payment",()=>{
    const {html}=render({...done,customerHandoffSafe:true});
    expect(html).toContain("Return to Choose Medicine");expect(html).toContain("Returning to medicines in");
  });
});
