import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { demoEnabled } from "./phpApi";

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
