# Machine Monitoring offline investigation — 14 November 2026

## Confirmed cause

The ESP32 was successfully POSTing authenticated reports to `/api/payments/diagnostics`. Apache recorded HTTP200 from `192.168.1.33` approximately every 11 seconds. MySQL `coin_diag:1:2C8C6AF3AF48` contained a report about three seconds old, bound to #166, with zero queued/durable events and healthy journal/session flags.

Admin Machine Monitoring instead queried `/api/machine/status`, which read `machine_status.last_communication_at`. That row was last updated **2026-10-05 18:50:46** and contained an old test payload. The firmware has no call to `/api/machine/heartbeat`; its Firebase `/dispense/status` writes are dispensing results, not a controller heartbeat. Consequently successful payment diagnostics did not refresh the unrelated legacy monitoring source.

There was no old-device-ID filter in the dashboard. The old `20799D470968` diagnostics were stale and preserved; the new reports were correctly stored separately. Both registrations remain unretired. Registration ambiguity in payment expiration is separate from monitoring connectivity and remains protected by the existing guards.

## Fix

`MachineMonitoring::project` is a read-only projection of authenticated saved diagnostics. One fresh, unretired report with a verified backend session establishes controller connectivity. Diagnostic freshness remains the existing 30-second server check; no timeout was increased. Stale diagnostics remain offline. Two fresh controllers produce a verification warning. Legacy heartbeat behavior is preserved only for machines with no diagnostic records.

Motor, sensor and coin-acceptor readiness are **Unknown** when not explicitly verified. Old test heartbeat component values are not reused as current evidence. The controller is displayed as **Connected**, not Ready. Technical Details identify the reporting device and status source.

Live read-only projection verified: Online, `2C8C6AF3AF48`, diagnostic age about five seconds, controller Connected, motor/coin readiness Unknown. No database row was edited to obtain Online. Transaction #166 remained pending with PHP0 recorded; no expiration/session mutation endpoint was invoked.

## Firmware logging

Only `reportCoinDiagnostics()` changed in `ReliableCoinPayment.h`. Local JSON is still printed. Each attempted POST now reports HTTP code, duration and whether the response contains `data.saved=true`. Examples:

```text
[Diagnostics] POST /api/payments/diagnostics HTTP=200 duration=35 ms result=saved
[Diagnostics] POST /api/payments/diagnostics HTTP=-1 duration=3000 ms result=transport_error
[Diagnostics] POST /api/payments/diagnostics HTTP=401 duration=20 ms result=authentication_failed
```

An offline Wi-Fi skip, HTTP initialization failure, invalid acknowledgement or server rejection is logged separately. No URL credentials, API keys, response bodies or payment tokens are printed by the new logging.

The actual Arduino header was updated with a source-change guard and backup. No firmware was uploaded. **Re-upload is required only to see the new serial HTTP logs; the corrected dashboard status works with the currently running diagnostics firmware.** Restart the production Node process for the updated mapping/UI, reload Admin, and use Check Connection. A fresh report should show Online; if reports stop for over 30 seconds it must return Offline.

## Changed files and checks

- `backend/src/MachineMonitoring.php`, `backend/public/index.php`: read-only diagnostic status projection.
- `server/phpApi.ts`, `shared/medidispense.ts`: monitoring source/controller identity mapping.
- `client/src/lib/machineMonitoring.ts`, `client/src/components/MachineMonitoring.tsx`: Connected/Unknown states, live-controller ambiguity and technical source display.
- `esp32/CAPSTONE_MEDICINE_VENDO/ReliableCoinPayment.h` and the actual Arduino copy: HTTP logging only.
- `backend/tests/machine-monitoring.php`, `server/machineMonitoring.test.ts`, `client/src/lib/machineMonitoring.test.ts`: fresh/stale, old/new identity, ambiguity, unverified session, component evidence and history preservation coverage.

Passed 14 PHP suite executions, including 11 new pure monitoring assertions; 161 frontend/server tests across 24 files; TypeScript; PHP syntax checks; production build (existing bundle-size advisory). Firmware compile results are recorded in the task completion report. No transaction, inventory, journal, NVS, registration, payment-safety or dispensing-safety changes were made.
