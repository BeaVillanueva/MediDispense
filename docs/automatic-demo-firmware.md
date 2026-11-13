# Automatic payment firmware — supervised demonstration

## Implemented scope

The actual Arduino sketch folder is
`C:\Users\Cla\OneDrive\Documents\Arduino\CAPSTONE_MEDICINE_VENDO`.
Its main sketch matched the reviewed project copy after private Wi-Fi lines were excluded from
comparison. The private `secrets.h` was inspected without printing values. There is intentionally
no committed secrets.h in the project copy. The installed board target is ESP32 Dev Module,
`esp32:esp32:esp32`, ESP32 core 3.2.1. No pin, wiring, motor timing, IR confirmation, Wi-Fi
connection, Firebase command implementation or maximum quantity changed.

Automatic binding is now implemented for the explicitly supervised demonstration. It requires:

- Firmware `PaymentDemo.local.h`: `MEDIDISPENSE_CONTROLLED_DEMO_AUTOBIND 1`.
- Backend non-production APP_ENV, both existing expiration/assumption settings true, and the new
  `automatic_session_binding=true` in `backend/config/payment-demo.local.php`.
- A fresh valid authenticated session response echoing this request's random `session_check`.
  A mismatched response or request lasting over eight seconds is rejected.
- Valid healthy journal, no raw or durable events, incomplete pulses, overflow, interrupted
  binding or reconciliation latch, and a quiet GPIO/input path for at least two seconds.
- A backend-confirmed previous transaction closure before changing owners. A newly proposed
  transaction must have zero recorded payment before first binding; an existing journal owner
  may resume its own partial payment. Unknown ownership requires recovery.

Both local demonstration settings are enabled in the implementation delivered here. Missing local
header defaults to firmware mode 0; missing backend permission or production environment retains
the supervised/manual workflow. No physical coin-inhibit support is claimed by either policy.

## Important existing-transaction exception

Per the explicit instruction not to alter transaction 162 or its reservation, the local backend
configuration includes `protected_transaction_ids => [162]`. The backend does not propose it for
automatic binding and does not automatically expire it. Its status and reservation were not
changed. Its blocker is `TRANSACTION_REQUIRES_EXPLICIT_STAFF_APPROVAL`. This is a one-off existing
purchase hold, not a requirement for normal new demo purchases. That pending transaction can
block a new purchase on the same machine until the owner explicitly authorizes its disposition.
Do not remove the hold or use the upload to authorize processing it without that approval.

## Automatic protocol

The existing `/api/payments/session` endpoint now returns additive fields
`controlled_demo_autobind` and `session_check`. Optional `binding_blocker` explains an explicit
hold. Firmware supplies its durable old owner and random request challenge. The existing
`active`, `transaction_id`, `payment_status`, `amount_paid` and `previous_session_closed` fields
continue to describe the authoritative MySQL session.

On a valid clean demonstration startup the firmware clears only its RAM boot-review gate. It
does not erase NVS, payment events, overflow evidence or reconciliation flags. New owners use
the existing three-stage durable prepared/activated/stable journal commit and capture fence.
Any pulse or uncertain persistence during that transition aborts, preserves the old owner and
requires recovery. Maintenance commands remain available for actual exceptional recovery.

Coin events still capture their owner on the first pulse, use the unchanged pulse-to-peso mapping,
persist stable event IDs before submission and require the exact PHP event receipt before dequeue.
Failed submissions retain their event for idempotent retry. No payment event is moved to the next
transaction. Coins captured outside an authorized session require reconciliation.

Diagnostics use the existing authenticated POST `/api/payments/diagnostics` every ten seconds when
the main loop can run. All existing queue/journal/binding fields are preserved. Additional fields
`controlled_demo_autobind` and `automatic_binding_blocker` describe the negotiated demo policy.
Read them in Serial `PAYMENT STATUS` or authenticated GET diagnostics. Reports still say
`inhibit_supported=false` and `automatic_handoff_safe=false`; telemetry is not physical isolation.

Full payment uses the existing dispensing request and Firebase/HTTP dispatch. Only the existing
confirmed sensor callback deducts stock. The kiosk continues polling after a completed demo
dispense until a fresh matching clean report received at/after completion allows return. Its
`customerHandoffMode` explicitly says `controlled_demo_assumption`; production never derives safe
handoff from demo telemetry. Normal success retains the existing success/collection delay; unpaid
confirmed expiration retains its separate three-second return.

Five-minute expiry reuses the existing transaction/ledger/inventory locks, cancelled status,
reservation release and audit. Partial, full, dispensing, pending-event, stale/offline and protected
transactions cannot be forced closed. Cancelled purchases remain in history and out of completed
sales. No additional inventory sensors or hardware are required for this controlled demonstration.

For automatic-binding mode the session API also supplies `server_now_ms` and `payment_deadline_ms`.
The firmware derives a monotonic deadline, stops logically authorizing new coin sequences after it,
drains existing events and incomplete trains, then reports `expiration_check_ready=true` only with
fresh backend verification and an empty quiet healthy queue. PHP requires this post-deadline drain
confirmation; a fresh-looking report from before the deadline cannot expire the purchase. This is
software pulse isolation under the supervised no-late-coins assumption, not physical rejection.

## Arduino IDE upload procedure (operator action only)

1. Resolve the protected old purchase separately with explicit owner authorization before testing
   new purchases on this machine. Preserve unresolved coins and payment evidence.
2. Keep the demonstration supervised, motors stopped and no purchase/coin insertion in progress.
   Keep users away from the acceptor during startup, between transactions and after the deadline.
3. Open the actual `CAPSTONE_MEDICINE_VENDO.ino` from the Arduino folder above. Headers
   `CoinPaymentCore.h`, `ReliableCoinPayment.h` and `PaymentDemo.local.h` are already updated there
   with backups beside them. Private secrets and main .ino are unchanged.
4. Verify the local demo macro is 1 and backend three flags are true in development. Keep the
   existing private backend URL, hardware key, Wi-Fi and Firebase values. Do not paste keys in chat.
5. Select ESP32 Dev Module / the existing ESP32 board settings and the connected board's actual
   port. Do not guess a COM port or change partition settings to clear storage.
6. Keep **Erase All Flash Before Sketch Upload disabled**. Do not run erase-flash, clear Preferences,
   or change NVS partitions. Use Verify, then Upload only when the operator is ready. This task
   compiles but never uploads, restarts the board or erases NVS automatically.
7. Open Serial Monitor at the existing sketch baud rate (115200). Expect the controlled-demo startup
   message. Existing invalid/pending journals must remain blocked; do not clear them to force startup.

## Controlled physical verification still required

1. With a fresh eligible purchase, observe `CONTROLLED DEMO AUTO-BOUND SESSION: <numeric ID>`
   without issuing BIND PAYMENT or REVIEWED EMPTY COIN PATH. Compare the ID with admin records.
2. Use `PAYMENT STATUS`. Check fresh same-ID backend diagnostics, healthy storage, stable binding,
   no queue/review fault and `automatic_binding_blocker=NONE`. HTTP failures are printed without keys.
3. Insert the supported coin denominations. Check retained event ownership, exact receipt, one
   payment ledger increment and kiosk updates. Interrupt Wi-Fi to confirm queued events survive
   and retries do not duplicate amounts; do not insert coins outside the supervised active session.
4. Verify the correct existing motor and IR sensor for one unit, then supported multiple units up
   to three. Compare confirmed quantity, inventory movement count, transaction reference and sales.
   A missing/failed IR confirmation must never be declared successful.
5. After collection, allow fresh clean diagnostics and the existing success delay. Start another
   eligible purchase: confirm a fresh transaction ID auto-binds without Serial commands.
6. In a separate zero-payment purchase wait five minutes, insert no late coins, verify MySQL
   cancellation and one reservation release, three-second timeout return and next automatic binding.
7. Verify partial payment, offline backend, pending/incomplete events, journal corruption/uncertain
   binding and injected faults only on an isolated bench setup; preserve all evidence. Do not use
   real customer payments or erase the real journal to run a fault test.

No physical machine tests were performed by this task. Software cannot prove that no coin is
physically entering before a pulse. Raw RAM pulse capture also has a power-loss window before
durable append; finite queues can overflow and latch recovery. Production remains supervised.

## Exact files changed for this update

Actual Arduino folder: `CoinPaymentCore.h`, `ReliableCoinPayment.h`, `PaymentDemo.local.h`.
The main `.ino` and `secrets.h` remain unchanged. Source backups were created.

Project files:

- `.gitignore`
- `esp32/CAPSTONE_MEDICINE_VENDO/CoinPaymentCore.h`
- `esp32/CAPSTONE_MEDICINE_VENDO/ReliableCoinPayment.h`
- `esp32/CAPSTONE_MEDICINE_VENDO/PaymentDemo.example.h`
- `esp32/CAPSTONE_MEDICINE_VENDO/PaymentDemo.local.h` (ignored local config)
- `esp32/tests/coin-payment-core.c`
- `esp32/apply-coin-reliability.ps1`
- `esp32/CAPSTONE_MEDICINE_VENDO/README.md`
- `backend/config/payment-demo.example.php`
- `backend/config/payment-demo.local.php` (ignored local config)
- `backend/src/KioskService.php`
- `backend/src/CoinPaymentDiagnostics.php`
- `backend/public/index.php`
- `backend/tests/automatic-demo-flow.php`
- `shared/medidispense.ts`
- `client/src/hooks/useKioskCheckout.ts`
- `client/src/components/kiosk/CheckoutPanel.tsx`
- `client/src/lib/paymentWindow.ts`
- `client/src/lib/paymentWindow.test.ts`
- `docs/automatic-demo-firmware.md`
- `docs/controlled-payment-expiration.md`

Earlier expiration/investigation documents describe the previous manual-only firmware state;
this document supersedes that restriction for explicitly opted-in supervised demo mode only.

## Final verification — 2026-11-13

- Actual Arduino sketch compiled successfully after final header synchronization for
  `esp32:esp32:esp32`: 1,070,958 bytes flash (81%); 52,664 bytes static RAM (16%).
- All three actual payment headers/config files match their reviewed project copies. The main
  sketch hash remains the original baseline. Backups are beside replaced headers.
- 169 PHP checks passed: automatic-demo 24, demo-expiration 27, coin-reliability 24,
  production-expiration 20, payment-window 11, dispense-recovery 47, transaction-reference-flow 9,
  Firebase recovery 7. These use temporary tables/test gateways, never the physical machine.
- 126 frontend tests passed in 20 files. TypeScript and changed PHP syntax checks passed.
- Production build passed; the existing large-bundle warning remains.
- The expanded portable C firmware-core test suite compiled with tcc. Its assertions were not
  executed: native fault-test execution remains unverified following the previously observed
  Windows Application Control block. It is not counted among passed runtime tests.
- Physical pulse/coin/motor/IR tests, on-device NVS recovery and fresh running-board diagnostics
  remain operator tests after upload. No upload, board reset or NVS erase was performed.
- Live transaction 162 was read-only inspected and remains pending, zero recorded payment.
  Its reservation and all live inventory/payment records were left untouched. Local configuration
  now explicitly protects it against automatic binding and expiration.
