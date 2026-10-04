import { config } from "dotenv";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";
import type {
  Alert,
  DashboardSummary,
  MachineStatus,
  Medicine,
  Transaction,
} from "@shared/medidispense";
config({ path: ".env.local", quiet: true });
export const demoEnabled = () =>
  process.env.NODE_ENV !== "production" &&
  process.env.MEDIDISPENSE_DEMO === "true";
export const phpBase = () =>
  (
    process.env.MEDIDISPENSE_PHP_API_URL ||
    process.env.VITE_API_BASE_URL ||
    ""
  ).replace(/\/$/, "");
export async function phpRequest<T>(
  ctx: TrpcContext,
  path: string,
  method = "GET",
  body?: unknown
): Promise<T> {
  if (!phpBase())
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The PHP API URL is not configured.",
    });
  const response = await fetch(`${phpBase()}${path}`, {
    method,
    headers: {
      ...(ctx.req.headers.authorization
        ? { Authorization: ctx.req.headers.authorization }
        : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok)
    throw new TRPCError({
      code:
        response.status === 403
          ? "FORBIDDEN"
          : response.status === 401
            ? "UNAUTHORIZED"
            : "BAD_REQUEST",
      message: payload?.error?.message ?? "The PHP service is unavailable.",
    });
  return payload.data as T;
}
export const phpMedicines = (ctx: TrpcContext) =>
  phpRequest<Medicine[]>(ctx, "/api/medicines");
export const phpSummary = (ctx: TrpcContext) =>
  phpRequest<DashboardSummary>(ctx, "/api/dashboard/summary");
export const phpTransactions = (ctx: TrpcContext) =>
  phpRequest<Transaction[]>(ctx, "/api/transactions?format=client");
export async function phpAlerts(ctx: TrpcContext): Promise<Alert[]> {
  const rows = await phpRequest<any[]>(ctx, "/api/notifications");
  return rows.map(r => ({
    id: Number(r.id),
    kind: r.notification_type,
    title: r.title,
    message: r.message,
    severity: r.severity,
    createdAt: r.created_at,
    read: !!Number(r.is_read),
  }));
}
export async function phpMachine(ctx: TrpcContext): Promise<MachineStatus> {
  const { machine: m, slots } = await phpRequest<any>(
    ctx,
    "/api/machine/status"
  );
  return {
    machineName: m.name,
    machineId: m.machine_code,
    online: m.connection_status === "online",
    lastCommunication: m.last_communication_at ?? "",
    esp32Status: m.esp32_status ?? "Unknown",
    motorStatus: m.motor_status ?? "Unknown",
    sensorStatus: m.sensor_status ?? "Unknown",
    coinAcceptorStatus: m.coin_acceptor_status ?? "Unknown",
    slots: slots.map((s: any) => ({
      slotNumber: Number(s.slot_number),
      medicineId: s.medicine_id ? Number(s.medicine_id) : null,
      medicineName: s.medicine_name,
      motorId: s.motor_id,
      sensorId: s.sensor_id,
      quantity: Number(s.quantity),
      status: s.slot_status,
      lastDispensingAt: s.last_dispensing_at,
    })),
  };
}
