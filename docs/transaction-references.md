# Shared transaction reference tracking

Implemented 2026-11-13. No historical backfill or replacement of identifiers.

## Existing authoritative mapping

- MySQL transactions.id: internal numeric payment/transaction ID.
- MySQL transactions.transaction_code: existing unique TXN reference generated once in checkout.
- transaction_items.transaction_id and payments.transaction_id preserve their existing relationships.
- dispensing_requests.id: numeric motor request ID; dispensing_requests.transaction_id points to purchase.
- API snapshots: databaseId is numeric; id is the existing TXN reference already used by admin and receipts.
- ESP32 gets payment sessions through PHP /api/payments/session, not a Firebase payment listener.
  Existing transaction_id and transaction_code remain; transaction_reference is an additive alias.
- Firmware reads /dispense, using request_id, slot, quantity, dispensed and status. Extra JSON fields are ignored.

A read-only live example at inspection: transaction 161 / request 85 /
TXN-E7B913ADEC4FB32E84104A16, payment successful and dispensing dispensed.
Transaction 159 / request 83 retains successful payment and failed dispensing.
No example record was modified.

## Firebase paths and added fields

- Existing /dispense: future command publishes transaction_id and transaction_reference alongside
  unchanged required command fields and request_id. MySQL validates request/transaction mapping first.
- /transaction_tracking/payments/{transaction_id}: transaction_id, transaction_reference.
- /transaction_tracking/dispensing/{request_id}: request_id, transaction_id, transaction_reference.

These new tracking records contain ID metadata ONLY. They are not payment confirmations or motor
commands. No artificial Firebase payment amounts/statuses/timestamps were introduced. Numeric-ID
keys avoid duplicates. There was no existing Firebase payment-record path to migrate.

No listeners, security rules, authentication mechanisms or credentials were changed. New paths
must be allowed by the project's existing appropriate server-side rules; denial is reported as a
sync failure rather than weakening rules. Existing PHP REST connection configuration is reused.
No client tokens or hardware keys are sent as metadata.

## Retry and conflict behavior

Metadata uses GET with ETag, exact matching of existing identity values, and conditional PUT.
All existing non-identity fields are retained. HTTP 412 triggers a bounded re-read/retry. Matching
records need no write. Conflicting/malformed references or IDs are never overwritten silently.

Referenced command writes also use ETags. A same-request retry returns the existing command
without resetting status, count or result. A conflicting identity or another active request blocks
the write. This is not an automatic motor retry, and a public TXN reference is never authorization.
A same-request legacy command without reference fields is left untouched rather than backfilled.

Legacy DispenseCommandGateway signatures are unchanged. The production gateway additionally
implements TransactionReferenceGateway. Test/legacy gateway adapters continue to work.
New queued command_payload includes the stored reference; old payloads are not rewritten.

## Background synchronization

Run the reviewed installer from PowerShell:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File backend/bin/install-reference-sync.ps1

It creates the hidden interactive-logon task 'MediDispense Reference Sync' using XAMPP PHP.
It initializes explicit current-ID baselines with --initialize (no Firebase writes), then starts
`backend/bin/sync-transaction-references.php --watch`. No changes to the email worker/task are needed.
No operational database schema changes are required.

Baseline settings: txn_ref_baseline_payments and txn_ref_baseline_dispensing.
Only higher IDs are eligible. Per-record success markers in system_settings avoid reprocessing;
using per-ID markers rather than advancing cursors also catches out-of-order SQL commits.
Never lower these baselines or delete success markers as an unreviewed historical backfill.

Monitor system_settings:
- txn_ref_worker_last_seen: worker heartbeat.
- txn_ref_done_payments:{id} / txn_ref_done_dispensing:{id}: successfully synchronized stored TXN.
- txn_ref_error_payments:{id} / txn_ref_error_dispensing:{id}: safe error classification.
  REFERENCE_IDENTITY_CONFLICT needs investigation; source credentials and raw responses are not logged.

Failures remain eligible for safe retry, without changing transactions or payment state. Background
work never calls dispatch, coin verification, sensor, recovery, refund or inventory methods. It is
separate from ESP32's timing-sensitive payment/session requests and the Gmail alert worker.
A missing/invalid identity is reported, never generated. Sources always come from MySQL joins.

## Files

- backend/src/FirebaseRealtimeDatabase.php: optional reference gateway, CAS metadata and referenced commands.
- backend/src/KioskService.php: PHP payment alias, queued reference, validated referenced dispatch.
- backend/src/TransactionReferenceSync.php: new-record-only background metadata synchronizer.
- backend/bin/sync-transaction-references.php: retrying CLI worker with singleton lease.
- backend/bin/install-reference-sync.ps1: initialization and scheduled-task installer.
- backend/tests/transaction-references.php: isolated transport, conflicts, ETags and command invariants.
- backend/tests/transaction-reference-flow.php: temporary-table end-to-end identity mapping and status separation.
- docs/transaction-references.md: mapping, setup and compatibility notes.

## Validation boundaries

PHP tests use recording/fake transports and connection-local temporary tables. They do not send
real commands, insert real payments or modify live stock/history. Frontend regression suite,
TypeScript check and production build remain relevant because API shapes retain existing fields.
Physical ESP32 execution and future production Firebase permission checks require the next legitimate
purchase; do not create a paid/dispensing test incident in production just to test reference metadata.
No firmware reflash is required for the installed ArduinoJson reader, which uses numeric IDs and
ignores unknown fields. No historical Firebase records or /dispense_results paths are backfilled.
