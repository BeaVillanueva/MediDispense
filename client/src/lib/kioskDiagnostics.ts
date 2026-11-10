export type KioskDiagnostic = {
  operation: string; url: string; status: number | null; category: string; durationMs: number;
};

/** Never log request bodies, headers, recovery keys, query strings or raw errors. */
export function logKioskDiagnostic(event: KioskDiagnostic) {
  let url = "invalid-url";
  try {
    const parsed = new URL(event.url, typeof location === "undefined" ? "http://localhost" : location.origin);
    url = parsed.origin + parsed.pathname.replace(/\/transactions\/\d+/g, "/transactions/:id");
  } catch { /* Do not echo malformed configuration, which could contain credentials. */ }
  const safe = { operation:event.operation, url, status:event.status, category:event.category, durationMs:Math.max(0,Math.round(event.durationMs)) };
  if(event.category === "success") console.info("[MediDispense kiosk]",safe);
  else console.warn("[MediDispense kiosk]",safe);
}
