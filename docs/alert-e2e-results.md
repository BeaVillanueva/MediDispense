# Alert end-to-end verification — 8 November 2026

Run: `MDTEST-62B801D5B2`. Recipient: existing verified Super Admin, user ID 1.
The user confirmed that both test messages reached the inbox, exactly one each.

| Check | Low Stock | Dispensing Issue |
| --- | --- | --- |
| Isolated detection | Passed: temporary available stock 4 against threshold 5 | Passed: temporary paid request without final confirmation beyond deadline |
| Medicine / slot | `[TEST] Paracetamol 500mg`, slot 1 | `[TEST] Paracetamol 500mg`, slot 1 |
| Transaction reference | Not applicable | Synthetic `MDTEST-62B801D5B2`; not a production transaction |
| Dashboard notification | #21, incident #3; returned by admin notification listing | #22, incident #4; returned by admin notification listing |
| Email job | #220, sent, one attempt, no error | #221, sent, one attempt, no error |
| SMTP acceptance (database time) | 01:06:40 | 01:04:04 |
| Inbox receipt | Confirmed by user, one message | Confirmed by user, one message |
| Duplicate prevention | One job per subscribed recipient after repeated queue/scans; no resend across worker cycles | Same |
| Final notification state | Read, acknowledged, resolved through management service | Read, acknowledged, resolved through management service |
| Audit/history | Preserved, including test-mode repair | Preserved |

Exactly one PHP alert daemon remained after the final scheduler check. Its task
was Running and the heartbeat advanced. Test delivery was performed by this
scheduled pipeline, not by calling the mail transport from the test script.

## Issues found and corrected

1. MariaDB JSON boolean comparison initially allowed a synthetic stock incident
   into real-stock auto-resolution. It was cancelled before any send attempt.
   The test flag comparison now uses JSON_UNQUOTE and a string comparison, covered
   by a regression test. Only that never-attempted test job was requeued.
2. Stopping a PowerShell scheduled task left PHP child processes behind. The
   installer now terminates only this exact checkout's alert daemon children
   before restart. A database singleton lease prevents overlapping watch workers.

The stock test's active status was reopened without altering its already-sent
email job to verify acknowledgement and explicit resolution after the old worker
was removed. This did not send another message.

## Operational safety and remaining limits

Before/after hashes matched for inventory, transactions, transaction_items,
payments, dispensing_requests, dispensing_logs, stock_movements, machine_slots,
and machine_status. No real stock adjustment, transaction, Firebase command,
sensor callback, or motor operation was performed. Only clearly labeled test
notifications/incidents, email jobs, reads, and audit records were persisted.

All 34 alert regression checks and the PHP SMTP configuration checks passed.
Changed PHP files passed syntax checks. No customer UI or frontend build was
needed for these backend-only testing additions.

Physical ESP32 sensor and motor fault behavior was deliberately not exercised.
The test confirms the stored-event/timeout detection and notification/email path,
not the firmware's ability to report every physical failure. SMTP acceptance
alone generally does not guarantee receipt; inbox delivery for this run was
separately confirmed by the user.

Repeatable commands and safeguards are in `docs/alert-notifications.md`.
Machine-readable evidence is retained locally in
`tmp/alert-e2e-MDTEST-62B801D5B2-final.json` (Git-ignored).
