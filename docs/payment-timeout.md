# Payment countdown and hardware safety boundary

Implemented 2026-11-11. Current mode: **advisory countdown only**.

## Why automatic expiration is not enabled

The installed Arduino sketch (`CAPSTONE_MEDICINE_VENDO.ino`, outside this repository)
reads GPIO 4 in a background task. It waits two seconds after pulses before completing
a coin, stores one pending pulse batch in RAM, and uses activePaymentTransactionId
when forwarding it. No acceptor-inhibit output, acknowledged pause, buffered-event drain,
persistent event outbox or session-generation handoff was found. Wi-Fi/heartbeat alone
cannot prove that zero coins are pending. Existing hardware session polling is not an
acknowledgement that coin acceptance can safely stop.

Therefore a zero MySQL balance is not evidence that no physical coin was inserted.
No code claims that a physical pause or refund has happened. No firmware was changed.
The countdown is a customer assistance window, not a hardware-enforced expiry.

## Behavior

- The backend publishes `paymentWindow.serverNowMs` and `deadlineMs` as numeric UTC epoch
  milliseconds, computed together in MySQL. The deadline is persisted transaction
  `created_at + 5 minutes`, not a fresh browser timer. Confirmed checkout is the logical
  payment-session start; hardware readiness cannot be certified by current firmware.
- The Coin Payment screen shows MM:SS; at one minute it shows the requested warning.
  It also clearly states that automatic cancellation is unavailable on this machine.
- A refresh/reconnect obtains the same deadline. Browser monotonic elapsed time plus a
  wall-clock sleep fallback updates the display between normal status polls; no clock
  value authorizes a financial action. Fresh server snapshots re-anchor display time.
- Without server timing, no timer is invented. Network errors instruct the customer not
  to insert coins and to recover the saved purchase. Offline ESP32 is never treated as
  evidence of zero payment.
- At zero: assistance message, no cancellation/reset/checkout/dispatch request, no stock
  release, no auto-return, no refund claim. Recorded amounts remain visible and the
  reference/recovery credentials remain intact. The Back button is hidden at zero.
- Partial payment is preserved. UI asks customers to stop inserting coins and contact
  staff. It does NOT say 'Payment paused' because the acceptor cannot be remotely paused.
- Late hardware payment events are recorded against the existing transaction through the
  normal authenticated, row-locked, deduplicated coin endpoint. They are not discarded by
  the advisory timer. A genuine completed payment still follows the existing dispensing
  queue; the timer itself never initiates dispensing.
- Paid, dispensing, failed/reconciliation, cancelled and completed transactions have no
  payment countdown action. Existing dispensing timeout/recovery remains separate.

## Existing unsafe 10-minute expiry removed

Previously `expireUnpaid()` automatically cancelled zero-balance purchases based solely on
`expires_at`, while hardware pulses could still be buffered. To avoid silently retaining
that unsafe behavior behind the new five-minute advisory timer:

- `expireUnpaid()` is now an inert compatibility entry point.
- New checkout rows have `expires_at=NULL`; existing timestamps are left untouched but
  no longer authorize automatic cancellation, hardware-session exclusion or dropping coins.
- Existing customer cancellation remains authenticated and row-locked; partial payment
  cannot be cancelled. No new cancellation endpoint or bypass has been added.
- Expired advisory windows retain reservations until the existing cancellation/staff
  reconciliation workflow resolves them. They do not become new customer sessions.

No schema migration or live data rewrite is needed. Refresh the built kiosk and ensure PHP
loads the updated service. No SMTP or scheduled worker changes are needed for this feature.

## Required before future automatic expiration / true pause

Have the hardware supplier/technician confirm and implement coin reject/inhibit support.
The protocol must explicitly bind detected events to a durable session ID, inhibit acceptance,
acknowledge and drain buffered/in-flight events, persist uncertain sends with stable event IDs,
and prove reconciliation complete. Backend cancellation must atomically verify zero recorded
payment, no pending/reconciling events, pending dispensing state and acknowledged quiescence
before calling its inventory cancellation rules. A new customer session must wait for safe
handoff. Partial/uncertain money requires staff assistance; resumption needs a separate
acknowledged hardware handshake. Do not add an environment flag to enable unsupported hardware.

Until then, staff must physically control coin acceptance and reconcile the original purchase
before opening the machine for another customer. A UI message cannot physically reject a coin.

## Tests

- `npm.cmd test`: countdown formatting, one-minute warning, refresh/reconnect deadline,
  zero/partial assistance UI, network error messaging, terminal state protection, plus
  existing checkout idempotency, navigation, recovery and coin tests.
- `C:\xampp\php\php.exe backend/tests/payment-window.php`: temporary tables only;
  deadline and disabled capabilities, repeated timeout sweeps, old expiry timestamp,
  hardware-session continuity, late coin, partial cancellation denial, coin deduplication,
  full payment queue and inventory unchanged; no hardware commands.
- `backend/tests/lan-checkout.php` and `backend/tests/activity-events.php`: recovery,
  original-key replay and lifecycle regressions using temporary tables.
- TypeScript check, PHP syntax checks and production build.

Actual coin reject/pause and physical Wi-Fi interruption were not tested or simulated.
The requested 'no coins -> automatic expire and return' and 'hardware-enforced partial pause'
are deliberately NOT enabled. The legacy isolated-port `kiosk-integration.php` expectations
were updated but that older harness is not used for this validation.

## Guarded expiration workflow (follow-up)

`POST /api/transactions/{id}/expire` now exists and requires the original X-Kiosk-Token.
It locks the transaction, checks the server deadline, zero transaction/payment amounts,
absence of payment events and dispensing requests, and a valid locked reservation. It
then requires a server-owned `PaymentIsolationGateway` proof for that exact machine and
transaction. No proof can be supplied by the browser or generic heartbeat.

Production constructs KioskService without this gateway. Consequently capability remains
false and expiration requests return HARDWARE_ISOLATION_REQUIRED without modifying records.
There is no environment switch and no fabricated hardware adapter. Implementing the
physical inhibit/drain/handoff protocol described above is still required.

Only after valid proof can the method call existing cancelLocked reservation rules and
persist `payment_session_expired` audit metadata. Repeated requests return the same outcome.
Snapshot includes paymentExpiry only for that persisted event on a cancelled transaction.
Its returnAtMs is the audit time plus three seconds; refresh/recovery cannot restart it.
The UI shows Payment Time Expired, the no-payment cancellation confirmation, reference,
and countdown only with that explicit server confirmation. It then uses the existing
safe reset to return to medicine selection. Ordinary cancellation is never inferred as expiry.

The kiosk requests authoritative expiry verification once per mounted zero-payment transaction at the deadline, even when hardware capability is unavailable;
errors preserve credentials and recheck the original transaction. Paid/partial/dispensing
states defeat expiry. With unsupported hardware the existing assistance fallback remains.
Test-only isolation adapters are used exclusively in temporary table fixtures, not production.

Additional checks: `backend/tests/payment-expiration.php` covers guarded zero-payment expiry,
missing/offline proof, early requests, idempotent audit/reservation release, original return
deadline, rejection of old transaction coin IDs, a new checkout after confirmed test isolation,
coin-first deadline ordering, partial/full protection and exactly one dispensing queue item.
These tests do not certify real hardware isolation or simultaneous physical coin delivery.


## Software-only expiry verification audit (2026-11-13)

The existing expiry endpoint remains the only cancellation path; no new workflow was added.
Previously the UI skipped even the verification request when automaticExpirationEnabled=false.
Now it sends the existing guarded /expire request once after the server deadline for a pending,
zero-recorded-payment purchase. The capability flag is never treated as payment evidence.
PHP still requires verified isolation and reconciled pulses before any cancellation.

If an expiry response is interrupted, the checkout hook re-reads the original transaction.
A persisted confirmed expiry displays the three-second return screen; a genuine full payment
continues its existing dispensing flow without a stale cancellation error. A failed re-read keeps
credentials, transaction and amounts. Partial payments are not automatic expiry candidates.

The installed Arduino functions were read, without reading secrets.h or changing/reflashing firmware:
- coinReaderTask() completes a pulse batch only after a two-second quiet interval, and writes a
  single completedCoinPulses/coinReady RAM mailbox. The batch has no captured transaction ID.
- processDetectedCoin() clears the mailbox before verifying the active session or PHP acceptance.
  It uses the current activePaymentTransactionId at processing time, not at pulse detection.
  Failed network submission/no active session can leave a physical coin unrecorded.
- checkPaymentSession() can replace that current ID while a pulse batch is being assembled.
- There is no acknowledged input inhibit, durable coin-event outbox, or verified handoff generation.

Clearing buffers, ignoring GPIO input or switching transaction IDs is not a physical coin reject.
Even an empty buffer at one instant cannot exclude a coin already accepted mechanically whose
pulse has not arrived. With the DC12V/COIN/GND/COUNTER terminals and no confirmed INHIBIT,
a quiet software window cannot certify zero accepted/pending physical coins. Consequently the
production hardware gate remains unavailable, and assistance is required rather than reset.

A firmware improvement could capture the session ID at pulse start, use a protected queue and
persist retries with stable event IDs. Those changes could reduce existing accounting risk but
would not prove physically safe automatic customer handoff on their own. No unverified firmware
change or fake acknowledgement is deployed here. The existing source's coin-loss/reassignment
risks remain a limitation requiring a separate reviewed firmware/hardware change; this expiry
feature must not enable a new session while relying on that behavior.

Tests added: paymentExpirationRecovery.test.ts (hardware-unavailable verification, lost response,
full-payment race, disconnected backend and partial-payment guard); paymentWindow.test.ts
(verification eligibility). The PHP fixture now explicitly withholds expiry for pending pulses.
Physical accepted-coin timing and firmware power-loss durability have not been validated.
