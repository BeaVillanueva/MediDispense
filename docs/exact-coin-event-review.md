# Exact coin-event reconciliation candidate

Prepared for the retained event on controller `2C8C6AF3AF48`. **Not deployed or executed against the live controller/database.** The backend remains disabled without `backend/config/coin-review.local.php`. The migration is not automatically applied.

## Scope and safety boundary

This workflow records the operator-verified finding **no additional physical payment**, with the electrical/pulse cause explicitly **unconfirmed**. It never posts `/payments/verify`, adds money, changes the original payment, deducts stock, issues a refund, resolves delivery, or reopens the kiosk.

For transaction 182 the already-recorded event is:

`coin-2C8C6AF3AF48-0000000E-2202FD51F9C2DB7E-00000001`

The retained event is:

`coin-2C8C6AF3AF48-0000000E-2202FD51F9C2DB7E-00000002`

The reported interpretation is 5 pulses / PHP 5. The operator confirms only PHP 5 was physically accepted in total. Do not characterize the second event as proven duplicate electrical pulses without additional evidence. Exact IDs remain stored; no original audit is overwritten.

## Protocol

1. **Signed fresh evidence:** a manually issued `REVIEW COIN STATUS` obtains a 30-second server challenge. The controller authenticates the challenge and signs its exact retained head, transaction/binding, pulse/amount, queue count, quiet-capture, storage, binding and overflow evidence. PHP saves one append-only attestation per challenge. Replay never refreshes the original timestamp.
2. **Super Admin decision:** `/maintenance/coin-events` requires Super Admin both in React/tRPC and PHP. The reviewer types the full retained and original payment IDs, physically verified total, evidence notes, installed-board confirmation, power isolation and stopped-motor confirmations. Authorization requires fresh signed evidence, one installed controller, a matching persisted inspection pause, no active database/Firebase dispensing, and the sole original payment matching the verified total and purchase amount. Unknown or unsafe states reject. There is one immutable decision per device/event; retries reuse the same request key/payload.
3. **Explicit device application:** the Super Admin receives a 32-character decision ID. An operator explicitly sends `APPLY COIN REVIEW <decision ID>` to the isolated board. The firmware requests that decision with a fresh random challenge and dedicated-key proof. PHP signs the exact event, decision nonce, no-additional-payment classification, and mandatory keep-blocked instruction. An expired decision is not applied.
4. **Archive first:** firmware verifies the decision and exact current head. It writes and reads back an authenticated `CoinReviewArchive` under a new per-decision NVS key, then persists a pending-ack pointer. A key collision, full storage, wrong event, unrelated pending acknowledgment, corrupt archive or failed readback prevents queue advance. Existing archives are never overwritten or pruned.
5. **Advance exactly one entry:** only after durable evidence exists does the firmware persist removal of that reviewed head from the *active queue*. Other entries and fault flags are preserved. `reconcile` remains **true**. Boot review is not cleared. No motor command or new payment session is started.
6. **Durable acknowledgment:** the board signs the archive hash, review/device IDs, queue count and keep-blocked receipt. PHP appends the acknowledgment and audit exactly once. Network failure/reboot retries that same receipt. A reboot before queue advance leaves the original event present and cannot acknowledge completion; an interrupted retry reuses the original archive. Acknowledgment remains possible after decision expiry if application was already durable.

The original event is retained in its append-only archive and backend decision evidence, rather than silently discarded. The original journal namespace and legacy keys are not erased. Only the acknowledged pending-pointer metadata is reset after a matching server receipt; event archives remain.

## Authentication

Use a **separate, random 32-byte per-controller review key** (64 hex characters), not the shared hardware key. It belongs only in `backend/config/coin-review.local.php` and the installed board's private `CoinReview.local.h`, both ignored by Git. Do not paste it into chat or expose it in web content. The old board must never receive this key. Keep it available until all outstanding archive receipts are acknowledged.

The existing hardware API key is still required, but is insufficient to attest, fetch an actionable decision, or acknowledge an archive. HMAC-SHA256 domains separate challenges, attestations, decisions and acknowledgments. Decisions bind exact event payload and a fresh device challenge. The old registry retirement alone is not credential revocation; keep the old board disconnected.

## No automatic machine release

**A durable archive acknowledgment is not machine readiness.** The generic reconciliation latch remains set because the old journal does not prove that it arose only from this event. Clearing it here could clear unrelated evidence. This implementation deliberately provides no generic fault reset or automatic reopening.

After acknowledgment, verify the exact event is absent from the active queue, its archive/receipt exists, and no other coin events were lost. Then review remaining controller faults through a separately authorized maintenance procedure. No new purchase or motor/coin test is cleared merely by this review. If the generic latch cannot be attributed/resolved safely, it remains an explicit blocker requiring further scoped work; do not use NVS reset as a workaround.

## Manual deployment/recovery sequence — not executed

1. Keep the machine isolated, original kiosk session open, and old controller disconnected. **Do not upload the compile-only test-key build.**
2. Run the native fault tests on an approved/trusted test environment before any live upload. Windows Application Control on this machine blocked the compiled test executable; no bypass was attempted. Verify archive-write failure, journal-write failure, lost acknowledgments, both reboot boundaries, wrong event/transaction, duplicate apply, pending pulses, unrelated entries, overflow and interrupted binding. Physical power-loss tests on a spare controller are also required before using the candidate on the retained live event.
3. Back up the original firmware source and read-only journal/flash evidence with an approved tool. Preserve partition layout and existing `md-coins` data. Review the candidate diff; no motor pins, sensor logic or Firebase configuration is changed.
4. **Separate explicit upload approval is required.** `firmware/coin-review/prepare-candidate.ps1` creates an ignored private candidate under `tmp/coin-review-build`, copies the current local firmware, injects only the review include/maintenance hooks, and uses a public compile-only test key. It does not edit the installed sketch or upload anything. For a real approved build, provision a fresh unique private key instead, rebuild, keep erase-all-flash disabled and retain the same NVS/partition layout. Never flash the dummy-key artifact.
5. Super Admin reviews and manually applies `database/migrations/2026_11_16_coin_event_reviews.sql` once (three additive evidence tables only). Copy `backend/config/coin-review.example.php` to the ignored local file, provision the same per-device key and explicitly enable it. No transaction/inventory migration is included.
6. Power **only the controller** by USB for maintenance, with motor and coin-acceptor supplies electrically isolated and verified. If this wiring cannot safely isolate those supplies, **stop**: no safe application/acknowledgment can be obtained with the whole controller unpowered. Software does not inhibit physical coins. Never insert coins during this procedure.
7. Connect to the actual installed controller and issue `REVIEW COIN STATUS`. Sign in as Super Admin and open `/maintenance/coin-events`. Refresh evidence, compare the complete ID/payload against the preserved evidence, enter the original event ID above and physical total **5**, add truthful notes, and explicitly authorize. If evidence expires, obtain a fresh signed report; do not fake diagnostic timestamps.
8. Within 15 minutes, explicitly issue `APPLY COIN REVIEW <the actual authorized ID>`. Wait for “Durable event archive acknowledged” and verify the server history shows acknowledgment. On an interrupted response, refresh review history and reuse the original decision—never create another payment. Expired unapplied decisions must stop for a new scoped authorization/renewal design; do not edit the decision row to extend it.
9. Obtain fresh normal diagnostics and inspect the durable archive/receipt. The kiosk remains paused. Address remaining faults separately before any hardware purchase test or explicit kiosk reopening.

## Files and tests

- `backend/src/CoinEventReview.php`: isolated exact-event service and dedicated-key proof validation.
- `backend/public/index.php`, `server/routers.ts`: authenticated maintenance and hardware protocol routes.
- `client/src/pages/CoinEventReviewMaintenance.tsx`, `client/src/App.tsx`, `shared/coinReview.ts`: direct Super Admin maintenance entry; no regular Admin dashboard button.
- `firmware/coin-review/`: portable archive core, ESP32 protocol consumer, private-key example, preparation script and native fault tests. The original Arduino sketch/headers are unchanged.
- `backend/tests/coin-event-review.php`: connection-local temporary tables/fake Firebase, forged/stale proof, permission checks, exact-event mismatch, payment mismatch, duplicate decisions/acks, expired decision and unchanged transaction/payment/inventory/journal evidence.
- `server/coinReview.test.ts`, `client/src/lib/coinReviewMaintenance.test.tsx`: role denial, no automatic actions, explicit request forwarding, disabled-by-default UI.

Firmware compilation target: `esp32:esp32:esp32`, ESP32 core 3.2.1, ArduinoJson 7.4.3. Compilation is not a substitute for native fault execution or a supervised spare-board power-loss test. No migration, key provisioning, live decision, firmware upload or NVS action is performed by these tests.
