# Admin dispensing issue recovery

## Operator workflow

1. Sign in as Administrator or Super Administrator. Open **Transactions → Resolve Dispensing Issue**
   on a paid failed or unresolved dispensing record. Completed historical purchases without a
   recovery review cannot be rewritten through this action.
2. Inspect the physical machine and medicine. Confirm **all motors stopped** and **ESP32 powered
   off/disconnected**; keep it disconnected during recovery. These are authenticated admin physical
   attestations, not fabricated motor telemetry or proof of coin-acceptor inhibition.
3. Select one physical outcome: delivered but missed by IR, not delivered, or partial/further
   inspection. Enter the **cumulative total actually delivered**, including already sensor-confirmed
   units. The service never permits reducing sensor evidence or earlier physical totals.
4. Enter the actual remaining slot count. A count is mandatory before reopening the slot or
   returning the kiosk. Unexpected differences are rejected; investigate inventory discrepancies
   through the existing authorized inventory workflow rather than entering an invented count.
5. For missing units, explicitly record an outstanding customer obligation. It may stay pending,
   or an admin may document a refund/replacement already handled externally with a reference.
   This endpoint never issues a refund or replacement. Any external replacement stock movement
   must be accounted for separately. Original verified payment amounts and event records remain
   unchanged. A partial inspection stays flagged until the remaining outcome is physically known.
6. Enter notes and all three physical confirmations. **Save Review** may preserve an incomplete
   physical case, leaving the slot and machine blocked. Customer follow-up alone is recorded
   separately and does not lock a physically safe machine. Reopen later for a new explicit review.
7. Save Review keeps the dialog open and refreshes backend eligibility. Review any reason shown
   beside the disabled primary action. Changing saved facts requires saving again; existing
   review values load only through **Use saved review values**, followed by fresh confirmations.
   **Resolve & Return to Kiosk** is permitted only with complete inspection, a matching stock
   count, retired Firebase command, current clean controller diagnostics, and no other active
   purchase, dispensing command/request or unresolved physical safety review. A pending refund or
   replacement stays visible without being mistaken for a motor lock. The original
   connected kiosk receives the persisted return request on its normal polling/recovery flow,
   clears only its own finalized purchase session and returns to Choose Medicine. The admin page
   itself does not become the customer kiosk. No new checkout is created.

The redesigned modal has a 920px desktop maximum, two columns, mobile stacking and one scrolling
body with a fixed visible footer. Physical outcome and actual delivered quantity are never filled
automatically. See [modal investigation and changes](dispensing-recovery-modal.md).
8. Keep notification acknowledgement/resolution separate in the Notification Center. Recovery
   does not resolve an incident or cancel email jobs. Even the background full-confirmation rule
   excludes admin physical reviews, so an admin explicitly handles that notification afterward.
9. Reconnect the controller only after recovery/command checks succeed. Existing startup, coin
   queue, production or supervised-demo binding checks still apply; this does not override them.

Return eligibility now distinguishes [machine blockers from historical failures and customer
follow-up](kiosk-return-blockers.md). A stale report is not current proof of an empty coin journal;
obtain genuine current diagnostics with motors stopped/isolated and re-confirm the physical checks.

## Backend contract and safety

Existing authenticated admin permissions protect both routes:

- `GET /api/transactions/{id}/dispensing-issue`: current transaction, recorded stock and admin audit history.
- `POST /api/transactions/{id}/dispensing-issue`: explicit physical review and optional return request.

The frontend uses the existing authenticated tRPC → PHP bridge. PHP independently checks the
admin role; unauthenticated requests are rejected before any case is accessed. The admin history
contains notes and external obligation references; customer snapshots expose only a limited
outcome/readiness summary, never those notes or financial references.

A transaction lock, machine lock, request/stock/slot locks, a stable 32-hex request key and an
expected review revision serialize competing operations. Exact retries return the authoritative
snapshot. A changed payload under an old key conflicts; stale revisions require reloading. The
existing sensor callback and dispatch guards cannot resume a reviewed dispense or deduct again.

Only newly physically verified units beyond prior sensor/review evidence are deducted. The
existing `stock_movements` adjustment type records the admin, request and before/after counts.
Reservations must match active purchases and are released once. Unexplained counts, inconsistent
mapping, excess/mismatched payment, or another open purchase block safe return. Known payments
are never reset or silently converted into refunds. Existing completed transactions are untouched.

Legacy stopped-dispense recoveries remain supported. If a prior physical recount already corrected
stock, the new review requires a current matching count and references that recount without a
second deduction, including later review revisions. Once the new workflow owns a case, the old
recount endpoint cannot bypass it. Sensor logs and `dispensing_requests.dispensed_quantity` retain
the original IR-confirmed quantity; customer/admin transaction snapshots separately report the
admin-verified physical total and `sensorConfirmedQuantity`.

The service calls only the existing Firebase **retirement** method, using its ETag checks and
refusal to overwrite another active command. It never sends a pending dispense or drives a motor.
Retirement failure rolls back database changes. If a response/commit is interrupted after an
external retirement, retirement is safe to retry; no inventory effect can be duplicated.

## Audit and database migration

**No database migration or production schema modification is required.** The implementation reuses
`activity_logs.metadata` with action `admin_dispense_issue_reviewed`, and existing inventory and
request/status columns. Each explicit review revision appends an audit containing admin ID,
timestamp, original and previous statuses, physical outcome, cumulative/sensor quantities,
inspection attestations, notes, customer obligation/reference, counted stock, stock/reservation
before/after, incremental deduction and any prior recount reference. Earlier audit entries are
preserved. No existing failed cases are automatically reviewed, reconciled, cleared or resolved.

## Files modified

- `backend/src/DispenseIssueRecovery.php` — physical outcome review, audit, idempotency and return checks.
- `backend/src/KioskService.php` — snapshot metadata, late callback protection and unresolved-review gates.
- `backend/src/AlertService.php` — keep admin physical recovery separate from alert resolution.
- `backend/public/index.php` — authenticated GET/POST routes.
- `server/routers.ts` — validated authenticated tRPC bridge.
- `shared/medidispense.ts` — typed review summary/details.
- `client/src/components/DispensingIssueDialog.tsx` — physical review form and audit history.
- `client/src/components/dispensing-issue.css` — scoped blue-and-white dialog styles.
- `client/src/lib/dispenseIssue.ts` — action availability, request key and quantity validation.
- `client/src/pages/Home.tsx` — transaction action.
- `client/src/pages/Kiosk.tsx` — backend-confirmed return flow.
- `client/src/hooks/useKioskCheckout.ts` — retain incomplete cases and poll completed reviews awaiting return.
- `client/src/components/kiosk/CheckoutPanel.tsx` — guard return controls and show review state.
- `client/src/lib/medicineInformation.ts` and `client/src/lib/dispensingTimeout.ts` — explicit reviewed return checks.
- `backend/tests/dispense-issue-recovery.php` — isolated physical recovery fixtures.
- `client/src/lib/dispenseIssue.test.tsx` and `client/src/lib/paymentExpirationRecovery.test.ts` — UI/return tests.
- `vitest.config.ts` — include TSX UI tests.
- `docs/admin-dispensing-recovery.md` — this guide.

## Validation scope

Tests use connection-local temporary tables (including settings, alert jobs and notifications)
and recording/failing Firebase test gateways. They never operate the real machine, submit live
recoveries, deliver email or alter real inventory. Physical motor stop, disconnected controller,
actual delivered/remaining counts and external customer resolution remain admin responsibilities.
No Arduino, motor pins, coin logic, binding configuration, Firebase configuration or SMTP
configuration is modified. No firmware compile/upload or NVS erase is required for this feature.

Final verification (2026-11-13): **257 PHP checks passed**, including 44 new physical-recovery
checks; **133 frontend tests passed** across 21 files. TypeScript, PHP syntax checks and production
build passed (existing bundle-size warning). An unauthenticated POST to the new route returned
HTTP 401. A final read-only live database inspection found zero `admin_dispense_issue_reviewed`
records: no existing failed transaction was reconciled during implementation. Transaction 162
remains cancelled. Physical machine operation and a live-case recovery still require explicit
admin action and the operator checks above.
