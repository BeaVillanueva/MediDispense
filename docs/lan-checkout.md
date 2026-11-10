# LAN checkout and recovery

## Root cause

The checkout session generator called `crypto.randomUUID()`. Browsers expose that
API only in secure contexts; localhost is treated specially while HTTP private
IP addresses are not. On a phone opening `http://192.168.1.81:3000/kiosk`, the
call can throw before saving a session or sending checkout. The previous generic
catch incorrectly described this as an interrupted HTTP response. Reconnect then
found no local session and returned without feedback.

The generator now constructs a UUID v4 and an independent 256-bit token from
`crypto.getRandomValues`, which is supported on HTTP LAN origins. There is no
Math.random fallback. See the browser contracts:
[randomUUID](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID)
and [getRandomValues](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues).

## Setup and safe device verification

1. Run Apache and MySQL in XAMPP. For local development keep
   `VITE_API_BASE_URL=http://localhost/medidispense/backend/public` in `.env.local`.
   The browser follows the laptop's LAN hostname; the Node/PHP server bridge may
   continue to use localhost. Never place hardware keys or SMTP secrets in VITE
   configuration.
2. Restart the frontend server after environment changes. Open the printed port
   using `http://192.168.1.81:<port>/kiosk`, not localhost, on the phone. Its API
   requests should target `http://192.168.1.81/medidispense/backend/public/api/...`.
   Explicit API ports and relative paths are preserved. Firewall/private-network
   rules must allow Apache and the frontend port. Do not broaden CORS to `*`.
3. Development allows same-server ports 3000–3019 and 5173. Production requires
   the exact frontend origin in PHP `cors_origins` (in ignored `local.php` or the
   existing CORS configuration). A health GET succeeding alone does not test a
   JSON POST preflight with X-Kiosk-Token.
4. Force-refresh the phone/reopen the tab so the updated JS loads. Choose a
   medicine and proceed without inserting coins. Confirm the coin-payment screen
   shows the server's purchase reference. Back/cancel is allowed only by the
   existing unpaid-purchase rules. Do not test real payment or dispensing merely
   to verify network access.
5. With an unpaid purchase already created, briefly disconnect Wi-Fi and click
   Reconnect after reconnecting. Check that the original reference is restored.
   Keep the same browser and frontend origin; storage is isolated by host/port.
   Never clear storage while a purchase is unresolved. A different phone cannot
   recover another phone's private purchase credentials.

An HTTPS UI requires an HTTPS backend or same-origin proxy; mixed content now
has an explicit configuration error. PHP kiosk endpoints use the original private
X-Kiosk-Token, not an employee login cookie. No cookies, Firebase authentication,
coin verification or dispensing behavior were changed in this fix.

## Recovery and diagnostics

Credentials are validated and persisted before any checkout POST. Storage or
crypto failure has a distinct local error, not a fake network interruption.
Legacy configured-URL storage keys are checked when a LAN URL is corrected.
In-memory credentials survive transient storage-read errors in the same tab.

Reconnect displays loading, recovered status, missing-session feedback or a
specific failure. Recovery GET never silently creates a new checkout. Only an
explicit original-server 404 permits a separate user-triggered retry with the
same original key/token/item/quantity, and never when a known transaction already
exists in memory. The backend's unchanged unique checkout key and token checks
prevent duplicate transactions or reservations. Cancelled/finalized keys remain
finalized on replay. No recovery action sends coins or hardware commands.

The browser logs `[MediDispense kiosk]` with operation, sanitized request URL,
HTTP status (null when unknown), category and duration. Bodies, headers, tokens,
query strings and raw errors are excluded. API failures distinguish HTTP errors,
invalid responses, mixed content, network/CORS errors and timeouts. The existing
10-second deadline is unchanged, using AbortController for older browser support.
PHP's error log (normally `C:\xampp\apache\logs\error.log`, depending on PHP's
error_log setting) records sanitized endpoint path/status/category/duration.

## Tests and verification limits

- `npm test`: HTTP-LAN crypto capabilities without randomUUID; saved credentials
  and legacy keys; storage failure; LAN URLs in development/production; a lost
  checkout response followed by recovery; GET-only recovery; malformed responses;
  mixed content; the unchanged timeout without AbortSignal.timeout; log redaction.
- `php backend/tests/lan-checkout.php`: actual PHP/MySQL service on connection-local
  temporary fixtures, proving one transaction/payment/reservation after replay,
  token-protected recovery, no stock deduction or dispensing command, and no
  restart of a cancelled payment. No live records or hardware are touched.
- `php backend/tests/development-cors.php`: same-server LAN origins, fallback port
  range and foreign-origin rejection. Production still needs an explicit allowlist.
- Live LAN health and preflight were checked on 192.168.1.81: health 200; checkout
  OPTIONS 204 with the correct Allow-Origin and X-Kiosk-Token for ports 3000/3002.

Actual Android/iPhone touchscreen checkout still needs the device verification
above; a host-side request does not prove a physical browser has loaded the new
bundle or its storage/browser policy permits checkout.

## Exact files changed

- `client/src/lib/kioskSession.ts`: secure LAN-compatible UUID/token generation,
  validated persistence and recovery of credentials.
- `client/src/lib/kioskApi.ts`: safe request diagnostics, unchanged timeout with
  portable AbortController, mixed-content/response errors, legacy storage keys.
- `client/src/lib/apiConfig.ts`: browser-reachable LAN API URLs in dev/production.
- `client/src/lib/kioskDiagnostics.ts`: redacted URL/status/category/duration logs.
- `client/src/hooks/useKioskCheckout.ts`: persistent session handling, GET-only
  recovery, explicit same-key retry, and meaningful preparation/reconnect errors.
- `client/src/pages/Kiosk.tsx`: loading, success, failure, and explicit retry UI.
- `backend/src/Http/DevelopmentCors.php`: same-server development fallback ports.
- `backend/public/index.php`: sanitized checkout/recovery request logging only.
- `client/src/lib/apiConfig.test.ts`, `client/src/lib/kioskSession.test.ts`,
  `client/src/lib/kioskApi.test.ts`, `backend/tests/development-cors.php`,
  `backend/tests/lan-checkout.php`: regression coverage.
- `README.md` and this document: configuration, verification and recovery steps.

`client/src/lib/kioskPurchase.ts`, PHP checkout/recovery transaction processing,
inventory deduction, coin authentication and Firebase/ESP32 commands were
inspected and left unchanged by this fix.
