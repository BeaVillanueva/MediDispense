# Restoring self-service: verified acceptance control is the blocker

2026-11-13 review. THIS CHANGE DOES NOT ENABLE FULLY AUTOMATIC SELF-SERVICE.

## Confirmed hardware and result

Owner confirmed ALLAN brand, model unidentified, no verified manufacturer manual, terminals
DC12V / COIN / GND / COUNTER and no identified INHIBIT/ENABLE connection. No matching official
ALLAN manual was verified. Terminal similarity or a reseller's generic product name is not a
model identification. COUNTER must not be treated or driven as an inhibit input.

With this information, safe unattended acceptance/handoff cannot be certified or enabled.
The current per-transaction Serial approval is a supervised-bench fallback, not the desired
customer product. It is not removed by pretending empty software queues establish physical safety.

Indistinguishable histories demonstrate the gap:
- A: no prior customer coin is present; GPIO is HIGH and software queues are empty.
- B: the prior customer's coin has been accepted mechanically but its first pulse has not arrived;
  the same GPIO level and empty software queues are visible.
A software-only switch cannot distinguish A from B. A delay, database lock, event ID or NVS write
cannot determine that unseen coin's owner. The reliable queue preserves ownership once detection
starts, but does not prove the mechanical path was clear before that point.

## Changes made now

1. Existing authenticated GET /api/payments/diagnostics retains its default array response and
   adds per-device automatic_handoff_blockers. Optional `?summary=1` provides a read-only
   automatic_self_service_available=false assessment, explicit unverified acceptance-control
   blocker, and any pending/incomplete/storage/binding/stale-report blockers. No report can
   turn this assessment on. POST cannot claim unsupported inhibit/handoff capability.
2. Completed-payment UI previously reset after 20 seconds on successful dispensing alone.
   It now retains the original session unless the backend explicitly confirms customerHandoffSafe.
   Actual MySQL snapshots currently report false with COIN_ACCEPTANCE_CONTROL_UNVERIFIED.
   Payment remains successful and dispensing remains dispensed; the customer is told to collect
   the medicine, while staff assistance is required before the next purchase.
3. The checkout reset guard rejects clearing an unverified successful handoff or unrecovered
   dispensing failure. Existing explicitly confirmed safe expiry still uses its three-second
   return. Existing staff recovery workflow remains separate. Development simulation is explicitly
   separate from physical mode; no production payment/dispensing success is simulated.
4. Tests cover empty healthy queues not authorizing consecutive customers, late/incomplete coins,
   restart/network uncertainty, successful-payment collection with retained reference, and future
   explicit backend confirmation. A test fixture with `customerHandoffSafe=true` is not a production
   adapter and is not evidence that the ALLAN device can isolate acceptance.

No GPIO, motor/IR/Firebase command, firmware session binding, ledger amount, inventory, or NVS
state was changed. Mandatory binding remains in the current prototype because the necessary
safety conditions are not automatically verifiable. This is intentionally NOT a claim that the
main fully automatic customer-flow objective has been completed.

## Hardware options to have a supplier/engineer verify

These are proposed functional requirements, NOT a validated wiring plan for the unidentified ALLAN.
No exact switching-component ratings or GPIO assignments can be responsibly selected before the
model, load/inrush, signal polarities, fault behavior and available ESP32 pins are verified.

Preferred: a validator with manufacturer-supported global inhibit/disable and documented behavior
for coins already inside it, plus accepted-event/drain or escrow/path feedback. It must prevent
new irreversible acceptance during handoff and prove that previously accepted coins have either
completed durable credit reporting or remain held for their original purchase.

Manufacturer references showing the kind of documented interface required (NOT ALLAN compatibility):
- [CPI v2 Falcon operating/service manual](https://www.cranepi.com/en/system/files/Support/OM_v2falcon_-_EN_1-4.pdf)
  describes inhibit controls and fault reporting, including acceptance faults. It does not certify
  the unidentified ALLAN mechanism or provide a pin mapping for it.
- [Alberici AL55/AL66 programming manual](https://www.alberici.it/wp-content/uploads/2022/01/Manual-ENG-Programming-AL55AL66AL66-FG.pdf)
  documents an explicit configurable inhibit input for those specific products. Its pinout and
  electrical levels must NOT be copied to ALLAN or connected directly to ESP32.

Alternative: an engineered, normally closed coin-entry barrier with verified position feedback,
coin-path/accepted-coin sensing, and a defined return/escrow behavior, potentially combined with
controlled acceptor power. It requires bench validation; adding a relay by itself is not sufficient.

Power control specifically must answer all of these before approval:
- Does the exact mechanism reject coins safely when unpowered, or can it retain/accept them?
- Can all accepted/in-flight credits finish before power is removed? How is that verified?
- What happens if power fails before the first output pulse or during a multi-pulse train?
- Does the controller/capture/event storage remain powered long enough to record acceptance,
  or does the mechanism provide independently durable accepted-event information/escrow?
- Is a closed gate verified mechanically, rather than inferred from relay command or rail voltage?
If these cannot be proven, a switched 12V supply is not a safe replacement for inhibit.

Logical control/feedback required (names only; no existing GPIO reassignment):
- ACCEPT_ENABLE_REQUEST: default-disabled output, through a correctly rated interface.
- ACCEPTANCE_DISABLED_FEEDBACK: independent gate/device confirmation, not loopback of the command.
- COIN_PATH_CLEAR / ACCEPTED_EVENTS_DRAINED: actual device/path feedback with documented timing.
- ACCEPTOR_FAULT or equivalent protocol fault indication; loss of feedback must fail closed.
A documented serial cash-device interface may carry these functions instead of discrete signals.
GPIO4 remains the PC817-protected COIN input. Preserve all current motor and IR pins.

Electrical engineering requirements: interface ESP32 3.3V logic using proper isolation/level
translation and protected drivers; never apply the 12V supply to a GPIO. Select fused switching,
reverse-polarity/transient protection, suitable inrush/current ratings and flyback suppression for
inductive actuators as the actual design requires. Establish grounding/isolation deliberately.
Use a physically fail-disabled gate/device during reset, high-impedance GPIO, watchdog, cable fault,
brownout and total power loss. Do not adopt an unverified COUNTER connection or an arbitrary spare pin.

## Automatic protocol after hardware is verified (not enabled now)

1. PHP owns one active transaction/session generation per machine and its existing deadline.
   Every command/ack is bound to machine, transaction ID and generation, not a public TXN as authority.
2. Acceptance starts disabled. Device confirmation plus coin-path/credit-drain evidence, a healthy
   journal and reconciled previous ledger must be established before a new binding is authorized.
3. Persist the prepared binding, confirm PHP's same pending purchase, durably activate that exact
   generation, and only then enable verified acceptance. A power/network/persistence fault keeps
   acceptance disabled and old events attached to their original owner. Replayed acks are idempotent.
4. At full payment, timeout or any session change, disable acceptance, verify it disabled, drain
   and journal all earlier accepted events, and wait for their exact backend receipts. Late events
   belong to the old generation. Do not discard or move them to make a new customer eligible.
5. PHP locks and rechecks state. Zero payment plus no pending/reconciling acceptance may use the
   existing expiration lifecycle and reservation release. Partial/uncertain payment requires recovery;
   full payment continues its original dispensing request. No second dispense/refund is invented.
6. IR-confirmed completion and verified physical handoff permit the backend safe-handoff result.
   React can then return automatically; safe expiry keeps its existing three-second screen.
   The five-minute deadline does not restart on refresh, disconnect, retry or binding.
7. Missing or contradictory physical feedback at any stage is an exceptional assistance condition.

This must be implemented against the actual selected device/protocol and tested before the
Serial approval can be replaced. Do not make customerHandoffSafe a configuration switch or a
client/diagnostic boolean that can bypass the physical evidence. Current production code cannot
supply true; only tests represent the future confirmed state.

## Controlled bench checklist

Keep customer access/coins out of the prototype, secure physical entry and ensure motors are
stopped with no live unresolved payment/dispense. Use an isolated test setup reviewed by its
operator. Do not upload automatically or erase NVS. Existing backup and firmware review instructions:
[firmware README](../esp32/CAPSTONE_MEDICINE_VENDO/README.md).

Verify consecutive sessions with a coin accepted just before the proposed boundary, incomplete
trains, slow/lost HTTP responses, duplicate receipts, stale generation, power failure before the
first pulse and at every journal write, failed/partial payment at five minutes, disabled-device
feedback failures, and restart while an event is pending. Physically demonstrate default rejection
and reconciliation before claiming unattended readiness. Software tests do not certify these.
The present Serial BIND path is for supervised testing, not a self-service deployment solution.

## Files modified

- backend/src/CoinPaymentDiagnostics.php
- backend/public/index.php
- backend/src/KioskService.php
- backend/tests/coin-reliability.php
- shared/medidispense.ts
- client/src/lib/medicineInformation.ts
- client/src/lib/medicineInformation.test.ts
- client/src/hooks/useKioskCheckout.ts
- client/src/components/kiosk/CheckoutPanel.tsx
- client/src/lib/paymentExpirationRecovery.test.ts
- client/src/lib/paymentWindow.test.ts
- docs/self-service-hardware-plan.md

Firmware source/Serial safeguards are unchanged in this task. The actual sketch is compiled against
the installed target; native C fault tests remain unexecuted because of the previously observed
Windows Application Control block. No hardware tests or live paid purchases are generated.

## Automated verification (2026-11-13)

- Frontend: 121 tests passed in 20 files; TypeScript check passed.
- Production build passed; existing bundle-size warning remains.
- PHP: 23 coin-reliability, 20 expiration, and 11 payment-window checks passed (54 total), using temporary tables. Three changed PHP files passed syntax checks.
- Native executable fault tests remain blocked by Windows Application Control; physical tests were not performed.

- Actual Arduino sketch compiled successfully for esp32:esp32:esp32 (ESP32 Dev Module): 1,067,858 bytes flash (81%), 52,664 bytes static RAM (16%). Compile only; no upload or NVS erase.
