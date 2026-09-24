import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import type { EmployeeRole } from "@shared/rbac";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  employeeRole: EmployeeRole | null;
  employeeId: number | null;
  employeeFirebaseUid: string | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let employeeRole: EmployeeRole | null = null;
  let employeeId: number | null = null;
  let employeeFirebaseUid: string | null = null;

  const phpApiUrl = process.env.MEDIDISPENSE_PHP_API_URL?.replace(/\/$/, "");
  const authorization = opts.req.headers.authorization;
  if (phpApiUrl && authorization?.startsWith("Bearer ")) {
    try {
      const response = await fetch(`${phpApiUrl}/api/auth/profile`, {
        method: "POST",
        headers: { Authorization: authorization, "X-MediDispense-RBAC": "1" },
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        const payload = await response.json() as { data?: { profile?: { id?: number; firebase_uid?: string; role_code?: EmployeeRole } } };
        const role = payload.data?.profile?.role_code;
        if (role === "super_admin" || role === "admin" || role === "staff") {
          employeeRole = role;
          employeeId = payload.data?.profile?.id ?? null;
          employeeFirebaseUid = payload.data?.profile?.firebase_uid ?? null;
        }
      }
    } catch {
      employeeRole = null;
    }
  }

  // Firebase bearer tokens are verified by the PHP bridge above. Do not pass
  // them through the legacy Manus HS256 session verifier; it will correctly
  // reject Firebase's RS256 token as an unsupported algorithm.
  if (!(typeof authorization === "string" && authorization.startsWith("Bearer "))) {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch (error) {
      // Authentication is optional for public procedures.
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    employeeRole,
    employeeId,
    employeeFirebaseUid,
  };
}
