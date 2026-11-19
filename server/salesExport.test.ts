import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const input = {
  event: "exported" as const,
  report_type: "sales" as const,
  record_count: 1,
  start_date: "2026-11-01",
  end_date: "2026-11-30",
  status: "successful",
  payment: "successful",
  medicine: "All medicines",
  search: "",
};
describe("sales export permissions and audit", () => {
  it.each(["csv", "xlsx", "pdf"] as const)(
    "denies staff %s exports before contacting PHP",
    async format => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const caller = appRouter.createCaller({
        req: { headers: {} },
        employeeRole: "staff",
      } as TrpcContext);
      await expect(
        caller.reports.activity({ ...input, format })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(fetch).not.toHaveBeenCalled();
    }
  );
  it.each(["csv", "xlsx", "pdf"] as const)(
    "passes the actual %s format to authenticated PHP audit",
    async format => {
      vi.stubEnv("MEDIDISPENSE_PHP_API_URL", "http://php.test");
      const fetch = vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
      vi.stubGlobal("fetch", fetch);
      const caller = appRouter.createCaller({
        req: { headers: {} },
        employeeRole: "admin",
      } as TrpcContext);
      await caller.reports.activity({ ...input, format });
      expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
        format,
        report_type: "sales",
        record_count: 1,
      });
    }
  );
});
