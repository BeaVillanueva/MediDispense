# Controller replacement: MD-001

## Investigation, 13 November 2026

The registry was actually persisted diagnostic records in `system_settings`, keyed `coin_diag:1:<device-id>`, not a separate device table. Expiration counted every record regardless of age or retirement. Consequently two historical identities always caused `MULTIPLE_CONTROLLER_REPORTS`.

- Old `20799D470968`: last bound purchase #165; stale empty queue with healthy storage, no reconciliation flags. #165 is paid PHP20 and dispensed, with two recorded PHP10 events and a successful one-unit dispensing request. No unresolved old-device payment-event purchases were found.
- New `2C8C6AF3AF48`: bound to #166, initially authenticated diagnostics about four seconds old, empty queue, verified session, healthy storage, no faults. #166 remains pending/unpaid PHP0; it was not modified.
- No queued/sent/dispensing MySQL request was found. Read-only Firebase command inspection returned `idle`.
- Apache received diagnostics HTTP200 from `192.168.1.33` approximately every 11–14 seconds, last observed at **22:47:19 Manila time**. Later diagnostics were over five minutes old. Reconnect messages alone are not proof of a failed backend configuration: earlier reports were accepted. The exact cause of the subsequent telemetry interruption needs board/network observation; it was not established remotely.

Diagnostics are authenticated by the existing shared hardware credential. A MAC-like device ID is not independent physical identity attestation. Physical board identity and old-board disconnection require operator confirmation. No live registration was retired during implementation because the new report became stale.

Physical operator confirmation was subsequently received for both identities, old-board disconnection, and an empty old persistent journal. Retirement remains blocked by the new board's stale report; no registration was changed. Use Admin **Machine Monitoring → Replace machine controller**, enter both IDs and repeat the three physical confirmations. The button calls the authenticated workflow below and displays any backend blocker.

## Authenticated replacement workflow

1. Physically identify the new board as `2C8C6AF3AF48`. Disconnect the old board, inspect its coin path/journal, and verify no accepted coins are unrecorded. Do not clear NVS or transfer events. Keep coins out during replacement.
2. Restore the new board's existing network/backend connection. Check its serial IP, XAMPP host reachability and stable power. Verify authenticated `GET /api/payments/diagnostics` shows a report less than 30 seconds old, verified session, empty complete/durable queues and no binding, overflow, reconciliation or storage faults. Do not create or cancel a purchase for this check.
3. As an authenticated administrator, POST `/medidispense/backend/public/api/payments/controllers/retire` with the application's existing `Authorization: Bearer <Firebase ID token>` header and JSON below. Use the existing admin API session; never paste the token into chat. This endpoint requires administrator permission, not the hardware API key. Set the confirmations true only after inspection:

```json
{
  "old_device_id": "20799D470968",
  "new_device_id": "2C8C6AF3AF48",
  "old_disconnected": true,
  "no_unrecorded_coins": true,
  "new_physically_verified": true
}
```

4. The endpoint rechecks reports under database locks, old purchase/ledger finality, machine commands and read-only Firebase state. It records `coin_retired:1:20799D470968` and an admin audit entry. Errors explain the current blocker. Duplicate requests do not duplicate the audit. No transaction or inventory field changes.
5. GET diagnostics again: old registration must be `retired`; new registration remains active/unretired and fresh. Expiration and admin recovery now select unretired reports. Existing supervised-demo, bound-session and coin-safety checks still apply. Do not call GET purchase/session as a supposedly read-only verification: the existing lifecycle may expire a due purchase.

A new report from a retired board restores ambiguity; retirement cannot hide a returning controller. Staleness alone never retires a board. Shared hardware credentials cannot remotely disable the old board: keep it physically disconnected. The ALLAN coin acceptor still has no verified inhibit input, so production automatic handoff remains unverified.

## Modified files

- `backend/src/CoinPaymentDiagnostics.php`: preserved retirement metadata, authenticated replacement service and active-report selection.
- `backend/src/KioskService.php`: expiration uses reviewed active registrations.
- `backend/src/DispenseIssueRecovery.php`: same registration selection for recovery.
- `backend/src/FirebaseRealtimeDatabase.php`: read-only machine command assessment.
- `backend/public/index.php`: authenticated retirement endpoint.
- `server/routers.ts`, `client/src/components/ControllerReplacement.tsx`, `client/src/components/MachineMonitoring.tsx`: authenticated admin replacement controls with current registration status and explicit physical confirmations.
- `client/src/lib/controllerReplacement.test.tsx`: registration visibility and confirmation safeguards.
- `backend/tests/controller-replacement.php`: isolated replacement/expiration regressions.
- `backend/tests/firebase-recovery-read.php`: read-only command-state regressions.

No schema migration, firmware/NVS update, payment-event transfer, inventory modification, or demo configuration change is required.

## Validation

Thirteen PHP suite executions passed (374 PASS assertions including the 27 reused expiration fixture assertions in the replacement suite). Dedicated replacement coverage includes stale registration ambiguity, missing physical confirmation, role denial, queued MySQL commands, active/unavailable Firebase commands, stale replacement diagnostics, retirement, duplicate submission, and reappearance of a retired board. Firebase command checks use read-only mock transports. Existing expiration, payment, recovery, reference and alert regressions passed.

Frontend/server tests: 159 passed across 24 files. TypeScript and production build passed; Vite retains its bundle-size advisory. No physical retirement, payment expiration or dispensing was triggered by the tests. Restart the production Node process and reload the admin page to load the new tRPC routes and replacement control.
