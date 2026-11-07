# Automated stock and dispensing alerts

## Setup

1. `cd backend && composer install` installs PHPMailer through the lockfile.
2. `php backend/bin/setup-alerts.php --seed-admin-recipients` applies only additive
   tables and subscribes existing active, email-verified `admin`/`super_admin`
   accounts. It never creates users or changes inventory, payments or purchases.
   Run setup without the seed flag to preserve an intentionally empty recipient set.
3. Recipient settings and delivery logs remain available through the existing
   Super Admin-only `/api/notifications/recipients` and
   `/api/notifications/email-jobs` endpoints. The simplified bell dropdown no
   longer contains Email settings or category filters.
   Registered addresses are read from `users`; inactive, unverified, or unsubscribed
   users are checked again before each delivery. No addresses or credentials are in
   frontend configuration. Staff can read/acknowledge/resolve; Super Admin alone
   can change recipients or release a held delivery.
4. Start `php backend/bin/alert-worker.php --watch` in a supervised process. On this
   Windows XAMPP checkout, `backend/bin/install-alert-worker.ps1` registers and starts
   a limited current-user Task Scheduler task at login, with restart-on-failure.
   The user must stay logged in; a server operating unattended requires a suitable
   service account/process supervisor. Do not run overlapping supervisors.
5. Edit **`backend/config/smtp.local.php`** on the XAMPP server. If it is absent,
   copy `backend/config/smtp.local.example.php` to that filename. It is excluded
   from Git; the configuration directory is denied by Apache. Add your own sender
   address and App Password locally, never in chat or frontend code:

   ```php
   return [
       'enabled' => true,
       'username' => 'your-sending-address@gmail.com',
       'password' => 'YOUR_GMAIL_APP_PASSWORD',
   ];
   ```

   The shared `backend/config/smtp.php` fixes Gmail host `smtp.gmail.com`, port
   587, STARTTLS (`tls` in PHPMailer) and uses the username as the From address.
   PHPMailer enables SMTP authentication. Both alert categories, Apache status,
   the worker, and the test script load this via `backend/config/config.php`.
   Windows `SMTP_*` variables are no longer read. Existing PHP SMTP credentials
   in `local.php` are a compatibility fallback; `smtp.local.php` takes precedence.
   Blank credentials keep delivery unconfigured. Keep mail disabled until ready.
   Stop the worker before entering credentials or setting enabled=true, so queued
   production alerts cannot be sent before the explicit test. Restart the worker
   after changes; no Windows environment-variable setup is necessary.
   Google Workspace policy may require OAuth or administrator-approved relay
   rather than an app password. See [Google SMTP guidance](https://support.google.com/mail/answer/7104828).
   TLS verification is enabled; insecure SMTP is not supported.
6. `php backend/bin/alert-worker.php --status` reports configuration, recipients,
   and queue states without printing credentials. A configured transport is not
   proof of delivery. Explicitly run
   `php backend/bin/test-alert-email.php --user-id=<verified staff ID> --send`,
   then check the actual inbox/spam folder and provider logs. The TEST message
   triggers no stock, payment, dispensing, or motor action and is audit-logged.

### Exact XAMPP testing steps

From a PowerShell terminal at `C:\xampp\htdocs\medidispense`:

1. Stop the scheduled worker: `Stop-ScheduledTask -TaskName 'MediDispense Alert Monitor'`.
2. Start Apache and MySQL in XAMPP. Edit only `backend/config/smtp.local.php`,
   fill in username/password, and set enabled to true. Keep any PHP guard in place.
3. Check syntax: `C:\xampp\php\php.exe -l backend/config/smtp.local.php`.
4. Inspect status without revealing credentials:
   `C:\xampp\php\php.exe backend/bin/alert-worker.php --status`.
5. Send one clearly labeled TEST message to the registered Super Admin (ID 1):
   `C:\xampp\php\php.exe backend/bin/test-alert-email.php --user-id=1 --send`.
   Sender and recipient need not be the same account. Verify the actual inbox and
   spam folder. SMTP acceptance alone is not proof of inbox delivery.
6. Only after a successful test, restart automatic delivery:
   `Start-ScheduledTask -TaskName 'MediDispense Alert Monitor'`.
   Pending incidents that are still active may now be emailed. Verify delivery
   status using `php backend/bin/alert-worker.php --status` and the authorized
   email-jobs endpoint. Leave enabled=false if setup or
   testing fails; dashboard detection and queued incidents remain independent.

## Detection and lifecycle

- Every five seconds the worker reads real available stock (`quantity` minus
  `reserved_quantity`, clamped at zero) against each medicine's configured minimum.
  Assigned, enabled medicines produce one incident per medicine/slot low-stock
  cycle. Recovery above the threshold closes the cycle and cancels unsent mail.
  The default and all current per-medicine thresholds are 3 (migration
  `2026_11_08_low_stock_threshold_3.sql`). Available 4+ is normal, 1–3 is low,
  and zero is displayed as Out of Stock. A continuing incident can change its
  dashboard label between Low Stock and Out of Stock without creating another
  email job. Pending email content uses the updated threshold; already-sent emails
  remain historical and are never resent just because the threshold changed.
  A later drop creates a new incident/email. Detection details record stock at
  detection time; use inventory for the latest live quantity.
- Dispensing failure/timeout status and explicit failure/error logs are inspected.
  Active paid requests lacking final confirmation beyond the configured deadline
  alert even when no kiosk browser is polling. New completed failures since
  activation are included; old terminal failures are not bulk-emailed on rollout.
  A sent command alone proves neither success nor failure.
- One request has one incident, including if a timeout later becomes a reported
  failure. Full confirmed dispensing can resolve the incident automatically.
  Staff resolution requires a note, terminal dispensing state, and a ready/low
  slot; it never unlocks hardware or edits the purchase. Existing recovery and
  physical reconciliation must be performed through their existing workflow.
- Dashboard polling also scans as a fallback, but autonomous email and detection
  require the worker. Use the status endpoint or CLI command to inspect heartbeat
  and SMTP state without cluttering the customer-facing staff dropdown.
- Read status is persisted per staff account. Reading/acknowledging does not
  resolve an incident. Delivery attempts and outcomes remain in the email-jobs
  endpoint and database. Clear All requires confirmation and inserts per-user
  `notification_dismissals` rows through a bounded notification ID; it never
  deletes incidents, resolves issues, or alters email delivery. New arrivals after
  the confirmation boundary stay visible. Repeated scans of the same incident
  keep the same notification ID and therefore stay dismissed.
- The production list and unread count exclude structured and legacy `[TEST]`
  notifications, and resolved low-stock incidents superseded by a changed
  threshold. Audit records are retained (`notifications($user, true)` is used by
  the CLI audit runner). Stock threshold remains 3; no design or stock changes
  are part of the notification-list refinement.

## Queue reliability

SMTP is called only by the separate worker, never in a customer checkout, coin,
or sensor callback. Advisory locking serializes scans; unique active incident
keys and incident/recipient pairs prevent duplicate dashboard/email jobs.
Urgent dispensing mail is prioritized. Definite non-acceptance retries with
exponential backoff (up to five automatic attempts). A disconnect after SMTP DATA
or an interrupted sender is held as `uncertain`; it is **not** auto-retried.
Super Admin must verify provider non-acceptance and record a reason before retry.
The stable Message-ID aids tracing but does not guarantee provider deduplication.
Exactly-once delivery cannot be guaranteed by SMTP; `sent` means SMTP accepted,
not confirmed inbox receipt. Failure details are sanitized so credentials do not
appear in the dashboard. Resolve/retry changes are audit-logged.

## Hardware limits and verification

No new firmware events or hardware commands were introduced. A motor jam can be
detected specifically only if authenticated existing firmware feedback records
an error in `dispensing_logs` or a fresh `machine_status` heartbeat after dispatch;
stale heartbeat errors are ignored. Otherwise the monitor can detect only missing
confirmation after the timeout. A command completing is never treated as a sensor
confirmation. Firmware must still supply genuine sensor success/failure callbacks.
The existing kiosk timeout remains 120 seconds; keep alert configuration aligned
unless deliberately changing only the monitoring deadline.

`php backend/tests/alert-delivery.php` uses connection-local temporary tables and
a fake mail transport. It cannot contact SMTP or hardware or alter live records.
Also run the existing recovery/inventory tests, `npm test`, `npm run check`, and
`npm run build`. Composer audit currently reports a pre-existing low-severity
advisory for firebase/php-jwt <7; upgrading authentication is outside this feature.

## Isolated end-to-end delivery test

With SMTP already tested, registered recipients subscribed, and the scheduled
worker running, explicitly run:

```text
php backend/bin/verify-alerts.php --create --user-id=1
```

This uses a separate PDO connection with temporary medicine, inventory,
transaction and request fixtures. Real detection runs twice against those
fixtures. Only two clearly labeled `[TEST]` incidents and their dashboard/email
records are then persisted in the application. There are no real test purchases,
inventory adjustments, sensor callbacks, Firebase requests, or motor commands.
The synthetic reference starts `MDTEST-`; the report identifies the exact values.
The existing scheduled worker, not the test runner, delivers the messages.
All configured eligible category recipients may receive these explicit TEST emails.
The watch process holds a database singleton lease. The Windows installer also
terminates only this checkout's existing alert-worker PHP children before restart,
because stopping a PowerShell scheduled task can otherwise leave a child alive.

The command prints a run ID. Save it and inspect delivery:

```text
php backend/bin/verify-alerts.php --run=MDTEST-XXXXXXXXXX --user-id=1
```

Verify both TEST notification IDs through the audit listing (they are intentionally
hidden from the normal production bell), expected details, one email job
per incident/recipient, exactly one accepted attempt, and fresh worker heartbeat.
Check the actual inbox for both `[TEST]` messages; SMTP acceptance does not prove
inbox receipt. Re-run status after additional worker cycles to check no resend.
The report compares hashes of nine operational tables with the pre-test baseline.
If other live activity occurs concurrently, investigate any changed hash rather
than assuming the test changed it.

After all test jobs are `sent`, finish:

```text
php backend/bin/verify-alerts.php --run=MDTEST-XXXXXXXXXX --user-id=1 --finish
```

Only the test notifications are read, acknowledged, and resolved. Their records
and delivery logs are retained. Synthetic incidents are excluded from real-stock
auto-resolution; staff resolution of a test never queries or changes physical
stock/hardware. Production resolution safety checks remain unchanged. Do not
repeat `--create` just to poll, as each creation intentionally starts a new run.
