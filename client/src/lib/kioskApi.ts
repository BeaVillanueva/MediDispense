import type { Medicine, Transaction } from "@shared/medidispense";
import { apiBaseUrl } from "./apiConfig";
import { logKioskDiagnostic } from "./kioskDiagnostics";
import type { PurchaseSession } from "./kioskSession";
export { newPurchaseSession, type PurchaseSession } from "./kioskSession";

export class KioskApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  session?: PurchaseSession,
  body?: unknown
): Promise<T> {
  const url=`${apiBaseUrl}${path}`;
  const operation=path.includes("/checkout")?"checkout":path.includes("/recover")?"recover":"request";
  const started=performance.now();
  const controller=new AbortController();
  let timedOut=false;let status:number|null=null;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},10000);
  try {
  const target=new URL(url,typeof location==="undefined"?"http://localhost":location.origin);
  if(typeof location!=="undefined"&&location.protocol==="https:"&&target.protocol==="http:") throw new KioskApiError("The HTTPS kiosk cannot call an HTTP backend. Configure an HTTPS API URL or same-origin proxy.","MIXED_CONTENT",0);
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(session ? { "X-Kiosk-Token": session.token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: controller.signal,
    cache: "no-store",
  });
  status=response.status;
  let payload;
  try {payload=await response.json();} catch {if(timedOut)throw new Error();throw new KioskApiError("The API returned an invalid response. Check the API URL and PHP server logs.","INVALID_RESPONSE",response.status);}
  if(response.ok && (!payload || typeof payload!=="object" || !("data" in payload))) throw new KioskApiError("The API response did not contain purchase data. Check the API URL and server routing.","INVALID_RESPONSE",response.status);
  if (!response.ok)
    throw new KioskApiError(
      payload?.error?.message ??
        "The medicine service is unavailable. Please try again.",
      payload?.error?.code ?? "SERVICE_UNAVAILABLE",
      response.status
    );
  if(operation!=="request")logKioskDiagnostic({operation,url,status,category:"success",durationMs:performance.now()-started});
  return payload.data as T;
  } catch(error) {
    const category=error instanceof KioskApiError?(error.code==="MIXED_CONTENT"?"configuration":error.code==="INVALID_RESPONSE"?"invalid_response":"http_error"):timedOut?"timeout":error instanceof TypeError?"network_or_cors":"request_error";
    logKioskDiagnostic({operation,url,status,category,durationMs:performance.now()-started});
    if(error instanceof KioskApiError)throw error;
    throw new KioskApiError(timedOut?"The medicine service did not respond in time. Recover the saved purchase before trying again.":"Cannot reach the medicine service. Check Wi-Fi, the API address, and CORS; recover the saved purchase before trying again.",timedOut?"REQUEST_TIMEOUT":"NETWORK_ERROR",0);
  } finally {clearTimeout(timer);}
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
const previousApiBase=(import.meta.env.VITE_API_BASE_URL??"").trim().replace(/\/+$/,"");
export const purchaseSessionKeys=Array.from(new Set([purchaseSessionKey,`medidispense-purchase:${previousApiBase}`]));
