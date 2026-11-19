import { afterEach, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const start = {
  request_key: "a".repeat(32),
  slot_number: 1,
  action: "replace" as const,
};
it("denies staff direct slot removal/replacement and physical completion calls", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const caller = appRouter.createCaller({
    req: { headers: {} },
    employeeRole: "staff",
  } as TrpcContext);
  await expect(caller.inventory.begin(start)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    caller.inventory.complete({
      request_key: start.request_key,
      machine_powered_off: true,
      motors_stopped: true,
      no_unrecorded_coins: true,
      information_approved: true,
      old_stock_removed: true,
      new_stock_loaded: false,
      reason: "Physical removal",
    })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(fetch).not.toHaveBeenCalled();
});
it("passes authenticated admin maintenance requests without simulating success", async () => {
  vi.stubEnv("MEDIDISPENSE_PHP_API_URL", "http://php.test");
  const fetch = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({ data: { ...start, status: "active" } }),
    });
  vi.stubGlobal("fetch", fetch);
  const caller = appRouter.createCaller({
    req: { headers: {} },
    employeeRole: "admin",
  } as TrpcContext);
  await caller.inventory.begin(start);
  expect(fetch.mock.calls[0][0]).toContain("/api/inventory/maintenance/start");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(start);
});
it("rejects a fourth slot before contacting PHP", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const caller = appRouter.createCaller({
    req: { headers: {} },
    employeeRole: "admin",
  } as TrpcContext);
  await expect(
    caller.inventory.begin({ ...start, slot_number: 4 })
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(fetch).not.toHaveBeenCalled();
});
