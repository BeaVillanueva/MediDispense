# Payment expiration investigation — 2026-11-13

## Observed live failure

The browser sent `POST /api/transactions/162/expire` and Apache returned HTTP 409.
The request was not lost or blocked by CORS (preflight returned 204). Both local demo settings
are true and APP_ENV is development; the visible demo notice correctly reflects configuration.

Transaction 162 (`TXN-34BD47A5114FCE1FD11752FF`) was older than five minutes, total PHP 5,
payment pending, recorded amount zero, payment ledger pending with zero inserted, no payment
events, and no dispensing request. Its medicine had recorded quantity 7 and reserved quantity 1.
There were no active InnoDB transactions/lock waits at inspection. No live payment or inventory
record was changed to force a result.

The sole diagnostics entry was NOT genuine controller evidence. It exactly matched the
`coin-reliability.php` fixture: device AABBCCDDEEFF, event `stable-review-event`, timestamp zero,
two pending events, one durable event, incomplete pulses, interrupted binding and review flags.
That test shadowed transaction/machine tables but omitted `system_settings`, allowing fixture
telemetry to leak into persistent settings. Its prior claim of complete test isolation was incorrect.
The foreign-looking transaction IDs in this report are fixture IDs, not proof of real coin events.

## Fix and preservation

The reliability test now shadows system_settings and asserts its fixture key does not leak after
the temporary table is dropped. The exact known contaminated entry was preserved by renaming
its settings key to `fixture_archive:20261113023049:coin_diag:1:AABBCCDDEEFF`; its original JSON
was retained intact. No broad clearing, counterfeit healthy telemetry or deletion of payment
history was performed.

After quarantine, the actual remaining blocker is `CONTROLLER_DIAGNOSTICS_MISSING`.
No genuine controller report is currently available to prove an empty, healthy session queue.
This cannot safely be converted to a zero-payment confirmation. Transaction 162 remains pending,
with its reservation retained. The demo policy assumes no late physical coins; it still requires
fresh real telemetry and all other existing checks.

## Specific diagnostics and recovery

Transaction GET/poll responses now include `paymentWindow.expirationBlockers`. An expiry 409
also includes `error.details.expirationBlockers`, with specific reason codes in its message.
At timeout the kiosk shows actionable messages for missing/stale reports, wrong session, unverified
backend session, pending events, incomplete trains, unhealthy storage, overflow and review flags.
Normal polling continues, so an eligible transaction expires automatically when genuine fresh
evidence becomes available; no new purchase or timer restart is necessary.

1. Keep this demonstration supervised and do not insert coins after its deadline.
2. Reconnect the existing ESP32 to Wi-Fi/backend. Check its existing serial/log diagnostics and
   backend URL, hardware authentication and diagnostic POST response. Do not publish the key.
3. On firmware that supports the existing commands, inspect `PAYMENT STATUS`. Follow the
   documented physical review procedure only after genuinely verifying the empty coin path.
   Do not clear NVS, fabricate a report, or reassign unresolved coins. The binding must match
   numeric transaction ID 162, not a different purchase or the public TXN string.
4. Check authenticated `GET /api/payments/diagnostics` for a real device report, at most 30 seconds
   old, same transaction binding, verified backend session, healthy journal, empty queues and
   no review/overflow/incomplete flags. Resolve actual events using existing staff reconciliation.
5. Keep the kiosk connected. Once eligible, the existing locked expiration workflow cancels it,
   releases its reservation once, records the audit, and confirms the three-second return.
6. If installed firmware never sends `/api/payments/diagnostics`, this requirement cannot be
   satisfied by a PHP/UI-only change. No firmware update/upload was performed in this task.

Production hardware-isolation checks remain unchanged. Controller boot/binding review is still
required by the existing firmware. The ALLAN acceptor has no verified physical inhibit input.

## Files modified for this fix

- backend/tests/coin-reliability.php
- backend/tests/payment-demo-expiration.php
- backend/src/KioskService.php
- backend/public/index.php
- shared/medidispense.ts
- client/src/lib/paymentWindow.ts
- client/src/components/kiosk/CheckoutPanel.tsx
- client/src/lib/paymentWindow.test.ts
- client/src/lib/paymentExpirationRecovery.test.ts
- docs/payment-expiration-investigation.md

## Validation scope

PHP tests use connection-local temporary tables, including diagnostics/settings. They verify
eligible MySQL cancellation, idempotency, single reservation release, explicit blockers, partial
and full payments, boundary events, late-event rejection, no expiry-created dispensing, and a
fresh checkout ID. Frontend tests cover blocker rendering, confirmed expiry, three-second
server-based return timing without refresh restart, and local-state clearing only after confirmation.
Live hardware cancellation was not forced: real controller evidence is still absent.

Final results: 125 frontend tests passed; 82 PHP checks passed (27 demo expiration,
24 coin reliability, 20 production expiration, 11 payment window). TypeScript and PHP syntax
checks passed. Production build passed with the existing large-bundle warning. Firmware was
not changed, compiled, uploaded or erased. The quarantined settings fixture is the only live
database repair; transactions, payment events, inventory and reservations were not modified.
