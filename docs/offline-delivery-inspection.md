# Saving an isolated delivery inspection

## Transaction 182 investigation — 16 November 2026, Philippine time

Read-only inspection confirmed an active `delivery_inspection:MD-001` pause for transaction 182, controller `2C8C6AF3AF48`, with the original isolation confirmations persisted. No live pause or transaction was changed.

A physical review already exists: revision 1, 16 November 2026 17:13:07, request 96, delivered 0, counted stock 1, no deduction/released reservation, command retired, no kiosk-return approval. It records finalized customer follow-up `refund_documented` / `refund01`. The investigation does not independently certify that refund; it preserves the existing record.

Apache access logs show `POST /medidispense/backend/public/api/transactions/182/delivery-check` returned 200 at 17:13:05, 409 at 17:20:06, then 200 at 17:20:31. The last success is an outside-observation note, not a second physical reconciliation. Historical response bodies and request payloads were not logged, so the exact original 409 code cannot be asserted from that log alone.

Code inspection and isolated reproduction establish:

- The isolated-save path does not require a fresh controller heartbeat after its pause is authorized.
- The displayed stale-report warning came from **return eligibility**, not necessarily from Save Check.
- A newly opened form defaults customer follow-up to pending. Submitting that against this finalized refund record deterministically returns HTTP 409 / `RECOVERY_FINALIZED`: “A finalized outcome cannot be changed by another recovery.” The old UI reduced that to a generic failure.

## Behavior now

- Starting a **new** pause requires a recent controller report plus existing independent command/identity/operation guards. Resuming an already authorized pause does not require the disconnected controller to come online.
- Saving an isolated check validates the exact active pause token, transaction, persisted isolation flags, fresh explicit physical confirmations, unchanged controller identity, and command/stock/payment guards **inside the locked transaction**. Controller-report freshness is not a save requirement.
- Missing, closed, mismatched, or explicitly expired save authorizations are rejected. An authorization expiry does not release an active machine pause. Existing persisted pauses without an expiry are not retroactively assigned an arbitrary expiration.
- Duplicate confirmed requests return their prior result without another inventory movement/audit, even if the authorization later expires. New or conflicting requests remain guarded.
- A finalized-result/follow-up conflict is explained before submission. The operator can explicitly load the saved check; the UI never guesses a fresh physical result or silently changes refund/replacement history.
- Save success closes the modal, shows “Delivery check saved successfully.”, and triggers the existing Admin query invalidation. Errors keep the entered form open.
- Future failed delivery-check requests log transaction ID, HTTP status and backend error code only. No tokens, notes, payment payloads or credentials are logged.

## Manual steps for the current case

The existing physical check is already saved; another Save Check is not needed just to reopen the machine. Reopening remains blocked by the retained coin event and stale controller evidence, and requires separate explicit approval after those are genuinely resolved.

If a new physical inspection note is required, refresh the Admin page, open Transaction #182, select **Load saved check**, and retain its recorded outcome and customer follow-up. Verify 0 delivered / 1 remaining and recheck the isolation and physical-inspection confirmations. The existing valid pause permits saving with the machine powered off. Do not reconnect power during hands-on inspection. Do not replace the prior documented refund with pending or fabricate new refund evidence.

If the pause token is missing, identity changed, command state is unsafe, or authorization explicitly expired, stop and have a supervisor review the paused operation. Do not clear the setting or power on an opened machine to bypass it.

## Verification

`backend/tests/offline-delivery-inspection.php` uses temporary tables and a fake hardware gateway. It covers pre-pause freshness, offline authorized save, exact-token validation, expired/closed/missing pauses, controller change, finalized follow-up conflict, duplicate saves, preserved payment/journal evidence, and blocked reopening. Frontend flow tests cover saved-result conflict guidance, explicit load/reconfirmation, success close, failure retention, and duplicate submissions.

No live inventory, payment, audit, coin journal, firmware or NVS modifications were performed.
