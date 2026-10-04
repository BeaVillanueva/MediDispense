// Public URL only. No database/hardware/Firebase private credentials belong here.
export const apiBaseUrl = (
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? ""
).replace(/\/$/, "");
export const kioskDemo =
  import.meta.env.DEV && import.meta.env.VITE_KIOSK_DEMO === "true";
