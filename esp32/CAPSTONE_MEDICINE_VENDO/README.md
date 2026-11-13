# Final payment firmware safety review

2026-11-13 update: [automatic demonstration firmware guide](../../docs/automatic-demo-firmware.md)
adds explicitly opted-in supervised automatic binding and post-deadline pulse-drain reporting.
The manual-only rules below remain the production default; the linked guide documents the demo exception.

Status: source reviewed and prepared for CONTROLLED STAFF-SUPERVISED BENCH TESTING ONLY.
No firmware upload, board reset, physical coin test, or on-device NVS access was performed.
Compilation and simulated tests do not prove physical payment safety.

## Confirmed issues fixed

1. Quiet queues still permitted automatic binding. Every proposed customer transaction now
   requires explicit staff Serial approval for that exact, freshly reported numeric transaction.
   The two-second interval is only a software-observation guard, never physical inhibition.
2. NVS binding could lead capture state. Binding is now a frozen, persisted prepared/activation/
   stable protocol. Pulses arriving while frozen are retained as ambiguous/orphan events, never
   credited to a newly proposed customer. A pulse fence is checked at each boundary.
   Interruptions restore the previous capture owner, latch reconciliation and withhold authorization.
   Prepared NVS bindings recover the previous owner; no automatic roll-forward is performed.
   Stable records retain previous and target IDs for investigation. EVERY boot requires fresh
   review and staff binding approval, including a reset immediately after the final write.
3. NVS write length was accepted without reading back. Every write now verifies length, reads
   back the bytes, validates the record and compares them before a FIFO advances.
4. Journal validation now checks checksum, format version, record count, boolean representation,
   event IDs/uniqueness, amount-to-pulse consistency and binding fields. Boot counters cannot wrap.
5. Legacy version-1 records are read without rewriting their original `journal` key. A valid
   unresolved event retains its ID, transaction, pulses and amount in a separate `journal-v2`
   record. Unsupported/corrupt data fails closed; a corrupt v2 record NEVER falls back to an older
   v1 snapshot. Unknown legacy pulse counts remain review-required. Nothing erases NVS keys.
6. Overflow totals are restored across boot rather than replaced by a fresh RAM total. FIFO
   capacity refusal never overwrites earlier events. Overflow/noise/unknown counts latch review.
7. Persistent journal rollback copies the full binary representation, preserving checksum padding.
   Repeated HTTP rejection does not repeatedly write an unchanged reconciliation flag.
8. Oversized/invalid maintenance commands are rejected; target IDs are range checked. Temporary
   binding approval is single-use, expires, and is invalidated by disconnection/proposal changes.

## Architecture and unchanged behavior

ReliableCoinPayment.h handles FreeRTOS locking, GPIO4 polling, Preferences, HTTP and Serial.
CoinPaymentCore.h is the actual portable journal/FIFO/binding safety core used by that adapter
and the native fault-injection test source. No separate test-only payment algorithm is used.

The existing GPIOs, maximum quantity 3, all motor/IR/Firebase functions and PHP sensor callbacks
are unchanged. Motor pins: 14/27/26, 25/33/32, 13/18/19. IR: 23/22/21. COIN: GPIO4 via PC817.
Wi-Fi retries remain nonblocking so the main loop can persist captured events while offline.
No expiry/receipt/idempotency/dispensing logic is bypassed; diagnostics never authorize money,
expiration, hardware inhibition or new customer handoff.

PHP `/api/payments/verify` acknowledges exactly:
`data.paymentEvent = {recorded: true, transactionId: integer, eventId: string, amount: number}`.
The firmware checks every field before a journal removal. Invalid/missing responses and failed
requests retain the event and stable ID; duplicate submissions are deduplicated in MySQL.
Accepted events already in the ledger can still be acknowledged on retry without duplicate credit.
New events against a cancelled transaction are rejected and retained locally for reconciliation.
An elapsed advisory deadline is not itself a confirmed cancelled/expired transaction.

`GET /api/payments/session?bound_transaction_id=N` reports prior lifecycle closure; this is not
an inhibit acknowledgement. Closed/unknown/partially paid/dispensing states are not silently
rebound. Payment event IDs, numeric transaction IDs and dispense request IDs remain separate.

`GET /api/payments/diagnostics` is an authenticated staff read-only view; the hardware uploads
its snapshot through POST using the existing hardware key. New optional fields expose binding
phase, previous ID, proposed ID and review requirement. Missing/stale reports are unknown.
No credentials are printed; private Wi-Fi and secrets.h are preserved by the apply script.

## Exact upload and Serial Monitor instructions

1. Take the machine out of customer service. Physically secure coin entry and have staff check
   accepted/unrecorded coins, pending payments, and all dispensing incidents. Motors must be
   stopped. Do not upload/reboot during an unresolved live payment or dispensing cycle.
2. Preserve the existing backups. The apply script backs up the sketch and headers again; it
   does NOT erase/format NVS. Do not run erase-flash or an NVS-clear utility.
3. Open the actual Arduino sketch:
   `C:\Users\Cla\OneDrive\Documents\Arduino\CAPSTONE_MEDICINE_VENDO\CAPSTONE_MEDICINE_VENDO.ino`.
   Required local headers: ReliableCoinPayment.h, CoinPaymentCore.h and existing secrets.h.
   The repository sketch contains placeholder Wi-Fi strings; do not upload a dummy-config build.
4. In Arduino IDE select ESP32 Dev Module (`esp32:esp32:esp32`), installed core 3.2.1, and the
   actual connected ESP32 COM port. Keep the existing flash/partition settings. If shown, set
   Erase All Flash Before Sketch Upload to Disabled. Verify/compile first, then Upload manually
   only after the bench conditions in step 1 are met. The agent does not perform this upload.
5. Open Serial Monitor at 115200 baud, Newline line ending. Opening it may reset the board;
   remain out of customer service. Send `PAYMENT STATUS`.
6. If storage is healthy, binding phase is stable, both queues are empty, no incomplete pulse/
   overflow/reconciliation flag exists, and staff have physically verified/reconciled the coin
   path, send exactly `REVIEWED EMPTY COIN PATH`. This only acknowledges boot review.
7. Read `PAYMENT STATUS` again after PHP provides an unpaid purchase. Use its exact
   `proposed_transaction_id`. Confirm through the authenticated Admin/PHP transaction mapping
   that this ID belongs to the intended kiosk TXN reference, not an older abandoned purchase.
   If it does not match, stop and reconcile the earlier purchase. Send `BIND PAYMENT <that numeric ID>` (replace the placeholder;
   do not use the TXN reference or a dispense request ID). Approval is consumed only after a
   fresh backend recheck and consistent persistence; inspect the subsequent status/log.
8. Expected successful status: bound ID equals the intended purchase, no pending/review fault,
   storage healthy, binding phase 0. `automatic_handoff_safe` and `inhibit_supported` MUST stay
   false. Each subsequent customer transaction requires its own staff-reviewed BIND command.
9. If review/binding is refused, do not clear buffers, regenerate IDs, erase NVS or edit recorded
   money to force progress. Retain events and diagnostics for authorized reconciliation. There
   is intentionally no clear-queue or generic financial-resolution command.

Use an isolated, operator-reviewed bench setup for the tests below. Do not feed real customer
payments into a prototype test, issue fake payment success, or bypass IR/motor safety callbacks.

## Remaining physical and power-loss limits

The acceptor exposes DC12V/COIN/GND/COUNTER with no verified INHIBIT/ENABLE input. Software cannot
physically stop acceptance or know whether an accepted coin has yet to emit its first pulse.
Staff review is not an electrical inhibit. Fully automatic customer handoff/reset remains unsafe;
the existing five-minute assistance fallback and guarded three-second return remain unchanged.

Only completed events successfully persisted to NVS are durable. A sudden outage can lose RAM
pulse fragments or capture FIFO entries not yet journaled. Mandatory boot review covers that
uncertainty; software does not invent missing amounts. Finite buffers (64 raw, 16 durable) cannot
hold unlimited offline input. Overflow is explicit and blocks further authorization, but exact
per-coin detail beyond capacity cannot be guaranteed. Stop customer insertion physically on faults.

Preferences/flash operations can stall CPU execution; 1ms polling, optocoupler pulse widths,
debounce timing, NVS wear, supply stability and brownout behavior still require real bench tests.
The protocol never holds its FreeRTOS spinlock during HTTP, JSON or flash operations.

## Validation and outstanding checks

Native test source: esp32/tests/coin-payment-core.c. It exercises the actual safety core for P5,
P10, consecutive events, immutable retry IDs, missing/wrong/lost receipts, restart restoration,
write failure/uncertain commit, queue capacity/FIFO, unknown pulses, orphan capture, interrupted
binding at each write boundary, pulse arrival during binding, v1 compatibility, invalid counts,
corruption and boot-counter exhaustion. It compiles with a portable C compiler.
Windows Application Control blocks execution of the generated test executable even outside the
sandbox. Those native assertions are NOT reported as passed. Run them on an approved development
machine before production use; do not bypass Windows policy to execute them.

PHP tests cover committed receipts, P5/P10 idempotent retries, session ownership, pending diagnostics,
expired/cancelled payments, partial/full payment protection, pending pulses, expiration races and
repeated cancellation. Frontend regression tests, TypeScript check and production build are run.
ESP32 compilation uses the installed target; the physical module was not independently inspected.

Real hardware tests still outstanding: multiple trains while HTTP is slow, Wi-Fi/backend loss,
response loss after commit, power interruption with pending NVS, each binding persistence boundary,
coin input during expiration/transition, storage fault, overflow and unknown pulse counts. No
physical test has been performed or claimed. This is a controlled-bench candidate, NOT a claim
of production readiness or safe unattended reset.

## Modified files in this review

- esp32/CAPSTONE_MEDICINE_VENDO/ReliableCoinPayment.h
- esp32/CAPSTONE_MEDICINE_VENDO/CoinPaymentCore.h (new)
- esp32/CAPSTONE_MEDICINE_VENDO/README.md
- esp32/CAPSTONE_MEDICINE_VENDO/source-baseline.sha256
- esp32/apply-coin-reliability.ps1
- esp32/tests/coin-payment-core.c (new)
- esp32/tests/README.md (new)
- backend/src/CoinPaymentDiagnostics.php
- backend/tests/coin-reliability.php

The actual Arduino folder's headers are updated to match. Its .ino is checked identical after
private configuration is restored; no dispensing code changes are made. Old backups remain,
and new .bak copies preserve the pre-review headers. secrets.h is neither edited nor exposed.

Regression result: 116 frontend tests; 117 relevant PHP fixture checks; TypeScript, PHP lint and
production build pass. Native C test compilation passes, but runtime assertions are unexecuted
because Windows Application Control rejects the generated executable. No physical tests or NVS
operations were performed. ESP32 compile result is recorded in the final task response.

Backups preserve source history; they are not permission to downgrade a live controller. An old
v1 firmware may ignore pending journal-v2 events. Do not roll back firmware, erase NVS, or reuse
a stale legacy journal without an authorized reconciliation/migration review.
