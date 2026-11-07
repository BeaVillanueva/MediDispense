import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { demoEnabled } from "./phpApi";
import { createContext } from "./_core/context";

const context = {
  req: { headers: { authorization: "Bearer test-only-token" } },
  res: {},
  user: null,
  employeeRole: "super_admin",
  employeeId: 1,
  employeeFirebaseUid: "test",
} as unknown as TrpcContext;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("PHP production data boundary", () => {
  it("loads inventory reports from PHP and restricts staff access", async () => {
    vi.stubEnv("MEDIDISPENSE_PHP_API_URL", "http://php.test");
    const data = { items: [], movements: [] };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data }) });
    vi.stubGlobal("fetch", fetch);
    expect(await appRouter.createCaller(context).reports.inventory()).toEqual(data);
    expect(fetch).toHaveBeenCalledWith("http://php.test/api/reports/inventory", expect.objectContaining({ method: "GET" }));
    await expect(appRouter.createCaller({ ...context, employeeRole: "staff" }).reports.inventory()).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("records report events through the authenticated PHP API and rejects staff", async () => {
    vi.stubEnv("MEDIDISPENSE_PHP_API_URL", "http://php.test");
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { success: true } }) });
    vi.stubGlobal("fetch", fetch);
    const input = { event: "exported" as const, report_type: "transactions" as const, record_count: 30, start_date: "", end_date: "", status: "failed", payment: "all", medicine: "All medicines", search: "" };
    await appRouter.createCaller(context).reports.activity(input);
    expect(fetch).toHaveBeenCalledWith("http://php.test/api/reports/activity", expect.objectContaining({ method: "POST", body: JSON.stringify(input) }));
    await expect(appRouter.createCaller({ ...context, employeeRole: "staff" }).reports.activity(input)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("propagates the backend capacity rejection without reporting a successful update", async () => {
    vi.stubEnv("MEDIDISPENSE_DEMO", "false");
    vi.stubEnv("MEDIDISPENSE_PHP_API_URL", "http://php.test");
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ error: { message: "You can only add up to 6 more items." } }) });
    vi.stubGlobal("fetch", fetch);
    await expect(appRouter.createCaller(context).inventory.restock({ medicineId: 123, quantity: 7 })).rejects.toThrow("only add up to 6");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([1, 4, 6])("restocks by %i without replacing stock and rejects invalid input", async (added) => {
    vi.stubEnv("MEDIDISPENSE_DEMO", "false");
    vi.stubEnv("MEDIDISPENSE_PHP_API_URL", "http://php.test");
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { previous_quantity: 4, new_quantity: 4 + added } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 123, stockQuantity: 4 + added }] }) });
    vi.stubGlobal("fetch", fetch);
    const caller = appRouter.createCaller(context);
    for (const quantity of [0, -1, 1.5, 11, 100]) {
      await expect(caller.inventory.restock({ medicineId: 123, quantity })).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(await caller.inventory.restock({ medicineId: 123, quantity: added })).toEqual({ id: 123, stockQuantity: 4 + added });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({medicine_id:123, delta:added, reason:"Restock", operation:"restock"});
  });
  it("forwards the PHP session and denies a Firebase token when PHP reports expiry", async () => {
    vi.stubEnv("MEDIDISPENSE_PHP_API_URL", "http://php.test");
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetch);
    const ctx = await createContext({ req: { headers: { authorization: "Bearer test-only-token", cookie: "medidispense_session=test-only-session" } }, res: {} } as Parameters<typeof createContext>[0]);
    expect(ctx.employeeRole).toBeNull();
    expect(fetch.mock.calls[0][1].headers.Cookie).toBe("medidispense_session=test-only-session");
  });
  it("does not expose preview payment or dispense mutations by default", async () => {
    vi.stubEnv("MEDIDISPENSE_DEMO", "false");
    const caller = appRouter.createCaller(context);
    await expect(
      caller.kiosk.verifyPayment({ transactionId: "TXN-test", amountPaid: 999 })
    ).rejects.toThrow("simulation is disabled");
    await expect(
      caller.kiosk.verifyDispense({
        transactionId: "TXN-test",
        success: true,
        unitNumber: 1,
      })
    ).rejects.toThrow("simulation is disabled");
  });
  it("cannot enable demo in production even with an explicit flag", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MEDIDISPENSE_DEMO", "true");
    expect(demoEnabled()).toBe(false);
  });
  it("admin list and inventory adjustments use PHP and never the preview stock", async () => {
    vi.stubEnv("MEDIDISPENSE_DEMO", "false");
    vi.stubEnv("MEDIDISPENSE_PHP_API_URL", "http://php.test");
    const medicine = {
      id: 123,
      name: "Database medicine",
      price: 12,
      stockQuantity: 6,
    };
    const fetch = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ data: [medicine] }),
      });
    vi.stubGlobal("fetch", fetch);
    const caller = appRouter.createCaller(context);
    expect(await caller.medicines.list()).toEqual([medicine]);
    expect(
      await caller.inventory.adjust({
        medicineId: 123,
        delta: 1,
        reason: "Restock",
      })
    ).toEqual(medicine);
    expect(fetch.mock.calls.map(call => call[0])).toEqual([
      "http://php.test/api/medicines",
      "http://php.test/api/inventory/adjust",
      "http://php.test/api/medicines",
    ]);
  });
});
