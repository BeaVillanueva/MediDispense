# Kiosk return: active safety dependencies versus historical failures

## Root cause fixed

`issueReturnBlockers()` previously selected every paid `failed` transaction and required its
`adminRecovered` marker, regardless of whether it owned an active command. It also treated
`reviewRequired` (which included a pending refund/replacement) as a global machine lock.
Thus reviewed Vitamins #164/request #87 was blocked by unrelated historical records.

The new logic never completes, cancels, reconciles or deletes those historical cases. Terminal
failed purchases remain in Transactions, notification incidents, payment records and audit history.
They are shown as customer-follow-up warnings, not automatic machine locks.

## Actual blockers

- The current review lacks completed physical inspection, verified remaining count, stopped-motor
  and disconnected-controller attestations, or confirmed retirement of its command.
- A database dispensing request is queued, sent or dispensing, even if its transaction says failed.
- Firebase has an active global command or the selected retirement receipt cannot be verified.
- Another recoverable kiosk checkout/payment session is still open. No automatic cancellation is
  introduced; existing safe cancellation/recovery workflows remain authoritative.
- Another explicitly recorded physical/inventory safety review is unresolved. Financial follow-up
  alone is excluded from this check.
- Genuine controller diagnostics are missing, ambiguous, stale, show queued/unconfirmed events,
  incomplete pulses, unhealthy storage, overflow, boot/binding/reconciliation faults or unverified
  backend session ownership. The current controller owner is checked against real stored purchases.
- Recent explicit motor-running monitoring evidence contradicts the admin inspection. Stale Idle
  monitoring is not converted into proof of readiness.

A clean controller bound to a terminal historical failure is not treated as an active payment
merely because that transaction lacks a new recovery marker. Actual dispatched requests and
coin/command faults still block. Financial records are never used as fake motor status.

## Separate physical and customer state

Existing audit `reviewRequired` retains its combined case-follow-up meaning. Added JSON/summary
fields `machineReviewRequired` and `customerObligationPending` distinguish physical safety from
customer follow-up, including when reading older audits without modifying them. Inventory readiness
and kiosk reset use physical readiness. A safe return does not settle or hide an owed refund or
replacement, mark a missing delivery successful, send another dispense, or rewrite payment totals.

The admin details response includes non-blocking `returnEligibility.warnings`, displayed separately
from exact blocker messages. Save Review refreshes eligibility; the guarded original kiosk polling
flow clears only its own reviewed session after an authenticated Return request succeeds.

## Transaction #164

Read-only inspection confirms actual delivery 1, recorded Vitamins stock 9, the saved physical
review complete, and request #87 terminal. Historical failures now produce only a follow-up warning.
No Return was submitted during implementation and no historical transaction was changed.

Final eligibility is reported from a fresh read below. Genuine verification gaps are not overridden
to force the button green. If controller diagnostics are stale, keep motors stopped/isolated,
restore controller communication to obtain a genuine report, then re-confirm the required physical
checks and use Refresh status. Never fabricate freshness, clear NVS, or discard pending coins.

## Files changed

- `backend/src/DispenseIssueRecovery.php` — classify physical/customer reviews, actual controller,
  request, ownership and motor checks; historical/customer warnings.
- `backend/src/KioskService.php` — physical readiness summary and inventory-readiness semantics.
- `shared/medidispense.ts` — explicit safety/follow-up fields and warning types.
- `client/src/components/DispensingIssueDialog.tsx` and `dispensing-issue.css` — separate follow-up panel.
- `client/src/lib/dispensingTimeout.ts` and `medicineInformation.ts` — safe physical return guards.
- `backend/tests/dispense-issue-recovery.php` — historical, active, coin/controller and financial cases.
- `client/src/lib/dispenseIssue.test.tsx` and `dispenseIssueFlow.test.tsx` — warning and reset semantics.
- `docs/admin-dispensing-recovery.md`, `docs/dispensing-recovery-modal.md` and `docs/kiosk-return-blockers.md`.

No migration, firmware/NVS edit, payment update or inventory correction is part of this fix.

## Final verification — 2026-11-13

- 294 PHP checks passed, including 71 recovery/blocker cases. Historical terminal failures,
  dispatched requests on failed purchases, current physical reviews, pending financial follow-up,
  duplicate recovery/return, coin queues, incomplete pulses, storage/binding faults, ownership,
  motor-running evidence and stale reports are covered with temporary tables/test gateways.
- 145 frontend tests passed; TypeScript, PHP syntax checks and production build passed.
  The existing large-bundle warning remains.
- A final read-only live check with real Firebase network access confirms #164 remains
  `dispensed`, physical total 1 and recorded Vitamins stock 9. Firebase `/dispense` is terminal
  failed for request 87, quantity 0; `/dispense_results/87` is the terminal admin-recovery receipt.
- 31 historical failed purchases are now non-blocking warnings. None was altered or reconciled.
- **Live #164 eligibility is currently false only because `CONTROLLER_DIAGNOSTICS_STALE`.**
  The last genuine report has empty queues and healthy storage but is no longer current.
  Freshness was not forged and this unknown state was not converted to proof of readiness.
- No authenticated Return, new purchase, inventory adjustment, payment change or firmware action
  was submitted. Restore genuine clean controller reporting under supervised maintenance,
  re-confirm the physical safety checks and refresh eligibility to enable the existing Return action.
