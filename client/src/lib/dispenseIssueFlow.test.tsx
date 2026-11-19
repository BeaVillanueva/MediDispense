import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
const h = vi.hoisted(() => ({
  cells: [] as any[],
  refs: [] as any[],
  state: 0,
  ref: 0,
  data: null as any,
  options: null as any,
  prepareOptions: null as any,
  reopenOptions: null as any,
  error: null as any,
  mutate: vi.fn(),
  prepare: vi.fn(),
  reopen: vi.fn(),
  refetch: vi.fn(),
  close: vi.fn(),
  changed: vi.fn(),
  success: vi.fn(),
  sequence: 0,
}));
vi.mock("react", async original => ({
  ...(await original<typeof import("react")>()),
  useState: (value: any) => {
    const i = h.state++;
    if (!(i in h.cells))
      h.cells[i] = typeof value === "function" ? value() : value;
    return [
      h.cells[i],
      (next: any) => {
        h.cells[i] = typeof next === "function" ? next(h.cells[i]) : next;
      },
    ];
  },
  useRef: (value: any) => {
    const i = h.ref++;
    return h.refs[i] ?? (h.refs[i] = { current: value });
  },
}));
vi.mock("sonner", () => ({ toast: { success: h.success } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    transactions: {
      issueDetails: {
        useQuery: () => ({ data: h.data, error: null, refetch: h.refetch }),
      },
      saveDeliveryCheck: {
        useMutation: (options: any) => {
          h.options = options;
          return { mutate: h.mutate, isPending: false, error: h.error };
        },
      },
      prepareDeliveryInspection: {
        useMutation: (options: any) => {
          h.prepareOptions = options;
          return { mutate: h.prepare, isPending: false };
        },
      },
      reopenAfterReview: {
        useMutation: (options: any) => {
          h.reopenOptions = options;
          return { mutate: h.reopen, isPending: false };
        },
      },
    },
  },
}));
import { DispensingIssueDialog } from "@/components/DispensingIssueDialog";
const original = {
  id: "TXN-TEST-REVIEW",
  databaseId: 1,
  items: [
    {
      medicineId: 1,
      medicineName: "Test tablet",
      quantity: 1,
      unitPrice: 10,
      subtotal: 10,
    },
  ],
  total: 10,
  amountPaid: 10,
  change: 0,
  paymentStatus: "successful",
  dispensingStatus: "failed",
  createdAt: "",
  requestedQuantity: 1,
  dispensedQuantity: 0,
  sensorConfirmedQuantity: 0,
  slotNumber: 1,
  dispensingRequestId: 2,
} as const;
function render() {
  h.state = 0;
  h.ref = 0;
  return DispensingIssueDialog({
    transaction: original as any,
    onClose: h.close,
    onChanged: h.changed,
  });
}
function find(node: any, predicate: (n: any) => boolean): any {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = find(n, predicate);
      if (r) return r;
    }
    return null;
  }
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
function byId(id: string) {
  return find(render(), n => n.props?.id === id);
}
function button(text: string) {
  return find(render(), n => n.type === "button" && n.props.children === text);
}
function value(id: string, value: string) {
  byId(id).props.onChange({ target: { value } });
}
function check(id: string) {
  byId(id).props.onChange({ target: { checked: true } });
}
function fill(outcome = "not_dispensed", stock = "1") {
  value("issue-outcome", outcome);
  value("issue-stock", stock);
  value("issue-notes", "Checked the actual delivery result.");
  check("issue-inspected");
}
function submit() {
  find(render(), n => n.type === "form").props.onSubmit({
    preventDefault: vi.fn(),
  });
}
function saved(ready = true) {
  const review = {
    revision: 1,
    outcome: "not_dispensed",
    verifiedQuantity: 0,
    sensorConfirmedQuantity: 0,
    requestedQuantity: 1,
    reviewRequired: true,
    machineReviewRequired: false,
    inspectionComplete: true,
    stockVerified: true,
    returnRequested: false,
    machineReuseReady: ready,
    obligationStatus: "pending",
  };
  return {
    ...h.data,
    transaction: { ...original, issueRecovery: review },
    returnEligibility: {
      ready,
      blockers: ready ? [] : [{ code: "UNRESOLVED_COIN_EVENTS" }],
    },
    history: [
      {
        ...review,
        adminId: 1,
        createdAt: "2026-11-15",
        physicalStock: 1,
        notes: "Checked the actual delivery result.",
        obligationReference: "",
      },
    ],
  };
}
async function prepared() {
  value("issue-mode", "isolated");
  check("issue-power");
  check("issue-stopped");
  check("issue-disconnected");
  button("Pause for physical inspection").props.onClick();
  h.data.inspection = {
    active: true,
    key: "prepared-key",
    eligible: true,
    blockers: [],
  };
  await h.prepareOptions.onSuccess({ request_key: "prepared-key" });
  h.prepareOptions.onSettled();
}
beforeEach(() => {
  h.cells = [];
  h.refs = [];
  h.state = 0;
  h.ref = 0;
  h.sequence = 0;
  h.error = null;
  h.data = {
    transaction: original,
    recordedStock: 1,
    history: [],
    deliveryCheck: null,
    inspection: { active: false, key: null, eligible: true, blockers: [] },
    returnEligibility: {
      ready: false,
      blockers: [{ code: "REVIEW_NOT_SAVED" }],
    },
  };
  [h.mutate, h.prepare, h.reopen, h.refetch, h.close, h.changed, h.success].forEach(f =>
    f.mockReset()
  );
  h.refetch.mockImplementation(async () => ({ data: h.data, error: null }));
  vi.stubGlobal("crypto", {
    getRandomValues: (a: Uint8Array) => a.fill(++h.sequence),
  });
});
describe("compact separated delivery checks", () => {
  it('requires loading the recorded follow-up before resaving an already finalized physical check',async()=>{
    h.data=saved(false);h.data.transaction.issueRecovery={...h.data.transaction.issueRecovery,reviewRequired:false,obligationStatus:'refund_documented'};
    h.data.history[0]={...h.data.history[0],reviewRequired:false,obligationStatus:'refund_documented',obligationReference:'refund01'};
    await prepared();fill();
    expect(button('Save Check').props.disabled).toBe(true);
    expect(JSON.stringify(render())).toContain('A finalized check is already saved. Select Load saved check');
    button('Load saved check').props.onClick();
    for(const id of ['issue-power','issue-stopped','issue-disconnected','issue-inspected'])check(id);
    expect(button('Save Check').props.disabled).toBe(false);
    submit();expect(h.mutate.mock.calls[0][0]).toMatchObject({quantity:0,stock:1,obligation:'refund_documented',reference:'refund01'});
    expect(h.reopen).not.toHaveBeenCalled();
  });
  it('explains that an authorized isolated save does not require the machine online',async()=>{
    await prepared();expect(JSON.stringify(render())).toContain('Save Check does not require the machine to be online');
  });
  it.each(['external','isolated'] as const)('closes only after a confirmed %s save and refreshes admin status without reopening',async mode=>{
    if(mode==='isolated')await prepared();
    fill();submit();submit();
    expect(h.mutate).toHaveBeenCalledOnce();expect(h.close).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();
    h.changed.mockClear();
    await h.options.onSuccess({},h.mutate.mock.calls[0][0]);
    expect(h.success).toHaveBeenCalledWith('Delivery check saved successfully.');
    expect(h.changed).toHaveBeenCalledOnce();expect(h.close).toHaveBeenCalledOnce();
    expect(h.reopen).not.toHaveBeenCalled();
  });
  it('keeps the modal and entered findings open when saving fails',()=>{
    fill();submit();h.error=new Error('Network connection interrupted');h.options.onSettled();
    expect(JSON.stringify(render())).toContain('The connection was interrupted. Check the connection, then try again.');
    expect(byId('issue-quantity').props.value).toBe('0');
    expect(h.close).not.toHaveBeenCalled();expect(h.changed).not.toHaveBeenCalled();expect(h.success).not.toHaveBeenCalled();expect(h.reopen).not.toHaveBeenCalled();
  });
  it("requires an explicit result, sets none to zero and all to ordered quantity", () => {
    expect(byId("issue-outcome").props.value).toBe("");
    expect(byId("issue-quantity").props.value).toBe("");
    value("issue-outcome", "not_dispensed");
    expect(byId("issue-quantity").props.value).toBe("0");
    expect(byId("issue-quantity").props.readOnly).toBe(true);
    value("issue-outcome", "dispensed_sensor_missed");
    expect(byId("issue-quantity").props.value).toBe("1");
    expect(byId("issue-quantity").props.readOnly).toBe(true);
    value("issue-outcome", "partial");
    expect(byId("issue-quantity").props.value).toBe("");
    expect(byId("issue-quantity").props.readOnly).toBe(false);
  });
  it("saves non-invasive zero findings without inventing isolation or refunds", () => {
    fill();
    expect(button("Save Check").props.disabled).toBe(false);
    expect(button("Reopen Kiosk")).toBeNull();
    submit();
    submit();
    expect(h.mutate).toHaveBeenCalledOnce();
    expect(h.mutate.mock.calls[0][0]).toMatchObject({
      mode: "external",
      quantity: 0,
      stock: 1,
      observed: true,
      inspected: false,
      stopped: false,
      disconnected: false,
      powerIsolated: false,
      obligation: "pending",
      reference: "",
    });
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.reopen).not.toHaveBeenCalled();
    expect(h.close).not.toHaveBeenCalled();
  });
  it("rejects missing counts, invalid partial amounts and false safety confirmations", () => {
    h.data.transaction = { ...original, requestedQuantity: 3 };
    value("issue-outcome", "partial");
    value("issue-stock", "1");
    value("issue-notes", "Checked result.");
    expect(button("Save Check").props.disabled).toBe(true);
    value("issue-quantity", "0");
    check("issue-inspected");
    expect(button("Save Check").props.disabled).toBe(true);
    value("issue-quantity", "3");
    expect(button("Save Check").props.disabled).toBe(true);
    value("issue-quantity", "1");
    expect(button("Save Check").props.disabled).toBe(false);
    value("issue-stock", "");
    expect(button("Save Check").props.disabled).toBe(false);
    submit();
    expect(h.mutate.mock.calls[0][0].stock).toBeNull();
  });
  it("requires real references only for supported documented customer follow-up", () => {
    fill();
    value("issue-obligation", "refund_documented");
    expect(button("Save Check").props.disabled).toBe(true);
    value("issue-reference", "ACTUAL-REF-123");
    expect(button("Save Check").props.disabled).toBe(false);
    submit();
    expect(h.mutate.mock.calls[0][0]).toMatchObject({
      obligation: "refund_documented",
      reference: "ACTUAL-REF-123",
    });
  });
  it("prepares hands-on isolation separately and never assumes the power confirmations", async () => {
    value("issue-mode", "isolated");
    expect(button("Pause for physical inspection").props.disabled).toBe(true);
    expect(button("Save Check").props.disabled).toBe(true);
    await prepared();
    fill();
    expect(button("Save Check").props.disabled).toBe(false);
    submit();
    expect(h.mutate.mock.calls[0][0]).toMatchObject({
      mode: "isolated",
      inspectionKey: "prepared-key",
      inspected: true,
      powerIsolated: true,
      stopped: true,
      disconnected: true,
    });
    expect(h.reopen).not.toHaveBeenCalled();
  });
  it("shows reopening only after a saved physical reconciliation and backend eligibility", async () => {
    await prepared();
    fill();
    submit();
    h.data = saved(false);
    await h.options.onSuccess({}, h.mutate.mock.calls[0][0]);
    h.options.onSettled();
    expect(h.close).toHaveBeenCalledOnce();
    // Reopen the modal explicitly; saving never invokes the reopen workflow.
    h.cells=[];h.refs=[];
    button('Load saved check').props.onClick();
    expect(button("Reopen Kiosk")).toBeNull();
    expect(JSON.stringify(render())).toContain(
      "Some inserted coins still need checking"
    );
    h.data = saved(true);
    expect(button("Reopen Kiosk")).not.toBeNull();
    button("Reopen Kiosk").props.onClick();
    expect(button("Confirm Reopen").props.disabled).toBe(true);
    for (const id of ["reopen-power", "reopen-stopped", "reopen-disconnected"])
      check(id);
    button("Confirm Reopen").props.onClick();
    expect(h.reopen.mock.calls[0][0]).toMatchObject({
      expectedRevision: 1,
      machinePowerIsolated: true,
      motorStopped: true,
      controllerDisconnected: true,
    });
  });
  it("retains exact payload and request key for retries after an interrupted response", () => {
    fill();
    submit();
    const first = h.mutate.mock.calls[0][0];
    h.options.onSettled();
    h.error = new Error("Network interrupted");
    submit();
    expect(h.mutate.mock.calls[1][0]).toEqual(first);
    expect(h.close).not.toHaveBeenCalled();
  });
  it("closes a confirmed save without waiting for a follow-up dashboard refresh", async () => {
    await prepared();
    fill();
    submit();
    h.data = saved(true);
    h.changed.mockReturnValueOnce(new Promise(()=>{}));
    await h.options.onSuccess({}, h.mutate.mock.calls[0][0]);
    h.options.onSettled();
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.success).toHaveBeenCalledWith('Delivery check saved successfully.');
    expect(h.reopen).not.toHaveBeenCalled();
    expect(button("Reopen Kiosk")).toBeNull();
  });
});
