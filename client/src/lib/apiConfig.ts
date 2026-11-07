// Public URL only. No database/hardware/Firebase private credentials belong here.
export function resolveApiBase(configured: string, development: boolean, hostname: string) {
  const explicit = configured.trim().replace(/\/+$/, "");
  const local = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]" || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  let localConfiguration = !explicit;
  try { localConfiguration ||= local(new URL(explicit).hostname); } catch { /* Preserve explicit relative URLs. */ }
  if (development && local(hostname) && localConfiguration) return `http://${hostname}/medidispense/backend/public`;
  return explicit;
}
export const apiBaseUrl = resolveApiBase(
  import.meta.env.VITE_API_BASE_URL ?? "",
  import.meta.env.DEV,
  typeof window === "undefined" ? "" : window.location.hostname,
);
export const kioskDemo =
  import.meta.env.DEV && import.meta.env.VITE_KIOSK_DEMO === "true";
