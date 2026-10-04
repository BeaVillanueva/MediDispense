import type { Medicine, Transaction } from "@shared/medidispense";
import { apiBaseUrl } from "./apiConfig";

export class KioskApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number
  ) {
    super(message);
  }
}
export type PurchaseSession = {
  requestId: string;
  token: string;
  medicineId: number;
  quantity: number;
};
async function request<T>(
  path: string,
  session?: PurchaseSession,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session ? { "X-Kiosk-Token": session.token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || !("data" in payload))
    throw new KioskApiError(
      payload?.error?.message ??
        "The medicine service is unavailable. Please try again.",
      payload?.error?.code ?? "SERVICE_UNAVAILABLE",
      response.status
    );
  return payload.data as T;
}
export const kioskApi = {
  medicines: () => request<Medicine[]>("/api/medicines?available=1"),
  checkout: (session: PurchaseSession) =>
    request<Transaction>("/api/transactions/checkout", session, {
      request_id: session.requestId,
      items: [{ medicine_id: session.medicineId, quantity: session.quantity }],
    }),
  recover: (session: PurchaseSession) =>
    request<Transaction>(
      `/api/transactions/recover?request_id=${encodeURIComponent(session.requestId)}`,
      session
    ),
  get: (id: number, session: PurchaseSession) =>
    request<Transaction>(`/api/transactions/${id}`, session),
  cancel: (id: number, session: PurchaseSession) =>
    request<Transaction>(`/api/transactions/${id}/cancel`, session, {}),
};
// Only recovery credentials are cached, never payment/stock/success state.
export const purchaseSessionKey = `medidispense-purchase:${apiBaseUrl}`;
export function newPurchaseSession(
  medicineId: number,
  quantity: number
): PurchaseSession {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return {
    requestId: crypto.randomUUID(),
    token: Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(
      ""
    ),
    medicineId,
    quantity,
  };
}
