// Public URL only. No database/hardware/Firebase private credentials belong here.
export function resolveApiBase(configured: string, development: boolean, hostname: string, protocol = "http:") {
  const explicit = configured.trim().replace(/\/+$/, "");
  const local = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]" || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (explicit.startsWith("/")) return explicit;
  let configuredUrl: URL | undefined;
  try { configuredUrl = explicit ? new URL(explicit) : undefined; } catch { return explicit; }
  const loopback = (host: string) => ["localhost","127.0.0.1","[::1]"].includes(host);
  const localConfiguration = !explicit || !!configuredUrl && local(configuredUrl.hostname);
  // A phone's localhost is the phone, including when using a production build.
  const replaceLoopback = !!configuredUrl && loopback(configuredUrl.hostname) && local(hostname) && !loopback(hostname);
  if (local(hostname) && (development && localConfiguration || replaceLoopback || !explicit)) {
    const port = configuredUrl?.port ? `:${configuredUrl.port}` : "";
    const path = configuredUrl?.pathname && configuredUrl.pathname !== "/" ? configuredUrl.pathname.replace(/\/+$/, "") : "/medidispense/backend/public";
    return `${protocol}//${hostname}${port}${path}`;
  }
  return explicit;
}
export const apiBaseUrl = resolveApiBase(
  import.meta.env.VITE_API_BASE_URL ?? "",
  import.meta.env.DEV,
  typeof window === "undefined" ? "" : window.location.hostname,
  typeof window === "undefined" ? "http:" : window.location.protocol,
);
export const kioskDemo =
  import.meta.env.DEV && import.meta.env.VITE_KIOSK_DEMO === "true";
