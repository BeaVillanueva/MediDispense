# Controlled demonstration payment expiration

Updated firmware option: see [automatic demonstration firmware](automatic-demo-firmware.md).
It adds dual-opt-in automatic binding, post-deadline drain confirmation and the explicit hold on
existing transaction 162. Manual binding below describes the earlier/default firmware mode.

Automatic unpaid closure is an opt-in supervised demonstration policy, not hardware isolation.
The default and APP_ENV=production retain the existing hardware-isolation requirement.
No live transactions, stock quantities, firmware or NVS were changed during implementation.

## Enable for a controlled demonstration

1. Keep the machine supervised. Prevent anyone inserting coins after the deadline. The ALLAN
   acceptor has no verified inhibit; this assumption cannot be established by software.
2. Copy `backend/config/payment-demo.example.php` to `backend/config/payment-demo.local.php`.
   Set both `controlled_expiration` and `no_late_coins_assumption_acknowledged` to `true`.
   This local file is ignored by Git and blocked by the existing config-directory Apache rule.
3. Use a non-production APP_ENV. Production explicitly ignores the setting. Refresh the kiosk.
   A visible “Controlled demonstration” notice confirms the backend setting. No Vite flag is needed.
4. Use the existing supervised firmware session-binding procedure. This feature does not remove
   boot review or Serial BIND requirements or authorize automatic firmware handoff.
5. Start a new unpaid purchase. Its existing server creation time defines the five-minute deadline;
   refresh does not restart it. Keep the ESP32 connected and bound to this exact purchase.
6. With zero payment and healthy empty diagnostics, the expiry POST or normal transaction polling
   atomically cancels the purchase and releases its reservation. The existing confirmed-expiry
   screen displays “Payment Time Expired” and returns to selection after three seconds.
7. The next checkout uses a new request and transaction ID. Review the MySQL transaction,
   payments and `payment_session_expired` activity record. The activity explicitly records
   `controlled_demonstration=true` and `hardware_isolation_verified=false`.
8. Disable both local settings after testing. Do not use this mode for unattended customers.

## Checks and limits

Closure requires pending payment/dispensing, zero transaction and payment-ledger amounts, no payment
events or dispensing requests, and a valid stock reservation. Existing transaction/ledger/inventory
locks serialize payment recording and expiry. A payment committed first prevents expiry; a coin
request after cancellation receives PAYMENT_CLOSED and is retained by firmware for reconciliation.
No event is assigned to a different transaction and no refund is invented.

Exactly one controller diagnostic report is required, no older than 30 seconds, bound to this
transaction, backend-session verified, with healthy storage, zero queued/durable/overflow events,
no incomplete pulse train and no boot, binding or reconciliation review. Missing/stale/offline or
uncertain diagnostics keep the purchase open. Multiple controller records require staff review.
These are snapshots: they cannot prove that a physical coin is not entering between reports.
The demonstration's no-late-coins assumption is essential and explicitly audited.

No worker is required while the kiosk polls. If the kiosk is closed or offline, expiration is
rechecked on reconnect when diagnostics are again fresh; elapsed time alone never proves no coins.
The three-second return can clear only a backend-confirmed cancellation, not an assistance state.
The existing manual firmware binding remains necessary before the next customer can pay.

## Files changed for this feature

- `.gitignore`
- `backend/config/payment-demo.example.php`
- `backend/public/index.php`
- `backend/src/KioskService.php`
- `backend/tests/payment-demo-expiration.php`
- `shared/medidispense.ts`
- `client/src/components/kiosk/CheckoutPanel.tsx`
- `client/src/lib/paymentWindow.test.ts`
- `docs/controlled-payment-expiration.md`

Tests use temporary database tables and never operate physical hardware. Run:

```powershell
& C:\xampp\php\php.exe backend/tests/payment-demo-expiration.php
& C:\xampp\php\php.exe backend/tests/payment-expiration.php
& C:\xampp\php\php.exe backend/tests/payment-window.php
npm.cmd test
npm.cmd run check
npm.cmd run build
```

Firmware is unchanged; no compile/upload or NVS erase is needed for this feature.

Verification on 2026-11-13: 122 frontend tests passed; TypeScript and production build passed
(existing large-bundle warning). PHP checks passed: 19 controlled-demo, 20 expiration,
11 payment-window and 23 coin-reliability checks (73 total). Changed PHP files passed syntax
checks. Database checks used isolated temporary tables; live five-minute machine testing and
physical three-second handoff testing were not performed. The existing frontend confirmed-expiry
screen/countdown is retained and covered by its rendering/recovery tests.
