# Recovery modal usability and return eligibility fix

Later blocking-policy correction: [active machine blockers versus historical/customer follow-up](kiosk-return-blockers.md).
Customer obligations described in the earlier investigation below are now warnings when physical
safety is verified; historical failed status alone no longer blocks Return.

## Actual causes found

- The dialog used both the narrow `restock-modal` class and recovery-specific width styling.
  Restock width rules could override the recovery width; the layout was a long single column.
- Return depended on many hidden client conditions: outcome/quantity, notes, physical inspection,
  stopped motors, disconnected controller, stock count, completed partial inspection and customer
  obligation evidence. No explanation identified the unmet condition.
- Save Review's success handler closed the modal. It did not leave a refreshed eligibility result
  visible, and reopening reset input/confirmation state.
- The backend exposed readiness primarily as a boolean. Other active requests, unpaid purchases,
  incomplete stock reconciliation or another failed case could block return without a specific
  eligibility explanation.
- Firebase retirement RuntimeExceptions were converted to a generic HTTP 500 by the global handler.
  Known operational conflicts now return sanitized, specific recovery errors.
- Selecting a physical outcome filled in the delivered quantity. This is removed: actual result
  and quantity require explicit input, or an explicit load of a previously saved review.

A read-only live inspection during implementation found zero active/pending dispensing requests
and zero saved physical-outcome reviews. Therefore no saved review was available to approve a
return at that time. No existing case was saved, reconciled or returned as part of implementation.

## New flow

1. Open Admin → Transactions → Resolve Dispensing Issue. The 920px dialog uses compact Requested,
   Sensor-confirmed and Recorded Stock cards. The desktop form has two columns; tablets/phones
   stack them. Only the body scrolls; header/footer remain visible.
2. Select the actual physical outcome and enter Actual tablets delivered. This remains the total
   for the purchase, including sensor-confirmed units. Remaining stock, notes and physical checks
   remain required where appropriate. No quantity or physical result is assumed.
3. Click Save Review. It stays open, retains entered values, refreshes the record and shows backend
   return eligibility. A different result/count/note or obligation must be saved before Return.
4. Resolve blockers shown beside the primary action. Refresh status rechecks database readiness and
   reads current Firebase retirement state. Missing/unverified data never becomes a ready result.
   Use saved review values only after confirming that they still match the physical inspection.
5. Click Resolve & Return to Kiosk when eligible. The existing authenticated mutation rechecks
   physical confirmations, stock/payment consistency, command retirement and blocking purchases.
   Success is shown only after PHP confirms the recovery and return request. The connected original
   kiosk uses its existing guarded polling/reset flow; no new purchase is created.

Save Review may preserve a partial/incomplete case; it does not claim that the case is resolved.
Refunds/replacements remain external and explicitly documented. Notifications remain separate.
The controller must remain stopped/disconnected during recovery as confirmed by the admin.
This UI is not proof of physical motor state, hardware coin inhibition or an automatic refund.

## Backend diagnostics

The existing authenticated details GET adds `returnEligibility: { ready, blockers }`. Each blocker
has a stable code and plain-language message: unsaved/incomplete review, inventory count missing,
customer obligation pending, controller/motor confirmation missing, unretired/unverified Firebase
command, active dispensing request, another unpaid purchase, another failed case or payment mismatch.

The new optional read gateway performs GETs only against existing `/dispense` and the selected
`/dispense_results/{id}`. It requires a terminal admin-retirement receipt and rejects any active
global command. These admin-only reads do not run on every customer poll, write Firebase data,
alter configuration or simulate hardware acknowledgements. Actual Return still invokes the existing
ETag-protected retirement workflow; its failures preserve records and never reset the kiosk.

The existing request-key/revision guards remain authoritative. Unchanged retries preserve their
submitted payload/key. Duplicate button clicks are locked locally; duplicate backend submissions
cannot repeat inventory deductions. Changing an already committed decision remains subject to the
existing cumulative quantity and finalized-outcome rules.

## Files changed

- `client/src/components/DispensingIssueDialog.tsx`
- `client/src/components/dispensing-issue.css`
- `client/src/lib/dispenseIssue.ts`
- `shared/medidispense.ts`
- `backend/src/DispenseIssueRecovery.php`
- `backend/src/FirebaseRealtimeDatabase.php`
- `client/src/lib/dispenseIssue.test.tsx`
- `client/src/lib/dispenseIssueFlow.test.tsx`
- `backend/tests/dispense-issue-recovery.php`
- `backend/tests/firebase-recovery-read.php`
- `docs/admin-dispensing-recovery.md`
- `docs/dispensing-recovery-modal.md`

No migration, firmware/NVS change, coin-payment change or new recovery of existing data is required.
Physical machine testing and a real admin case still require the operator's explicit action.

Final verification (2026-11-13): 280 PHP checks passed, including 57 physical-recovery/eligibility
checks and 10 read-only Firebase-state cases. All 143 frontend tests passed in 22 files; TypeScript,
PHP syntax checks and the production build passed. The existing large-bundle warning remains.
The interaction tests cover explicit inputs, Save remaining open, eligibility refresh, blocked
returns, duplicate clicks, API failures, changed facts, saved-value loading and fresh confirmations.
No live physical recovery was submitted or hardware operated during these checks.
