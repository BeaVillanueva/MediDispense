# Check Medicine Delivery

The dialog separates recording findings, reconciling physical stock, and reopening the kiosk. No schema migration is required; inspection pauses use existing system settings and findings use the existing audit log.

- **Observed from outside:** records an authenticated, idempotent audit note only. It does not change payment, inventory, delivery status, or machine readiness. Leave remaining stock blank if it cannot be seen safely; recorded stock is not a physical count.
- **Hands-on stock inspection:** isolate machine power, stop motors, and disconnect the controller before confirming preparation. The backend independently checks commands and competing operations and persists a purchase/dispatch pause. An active dispensing command must first be handled through the existing stopped-dispensing recovery workflow. Closing the dialog does not remove the pause.
- **Save Check:** None sets delivered quantity to 0; All sets it to the ordered quantity; Some requires an explicit intermediate count. Physical reconciliation requires the actual remaining stock and preserves the existing inventory, audit, payment, and duplicate-submission guards.
- **Reopen Kiosk:** appears only after a saved physical reconciliation and backend eligibility confirmation. It requires fresh, separate isolation confirmations. Pending coins, controller faults, active commands, and other genuine machine blockers still prevent reopening. Saving an outside observation cannot authorize reopening.

Customer follow-up remains pending unless an actual documented refund/replacement reference is provided. No money is automatically refunded and no additional medicine is dispensed.

Software cannot electrically verify isolation or prevent physical coin insertion on this hardware. Operator isolation remains necessary. Existing unresolved coin journals require their own authorized resolution; this feature does not clear them.

## Verification

Run `npm.cmd test`, `npm.cmd run check`, `npm.cmd run build`, and `C:\xampp\php\php.exe backend/tests/delivery-check-workflow.php`. The PHP fixtures use temporary tables and fake hardware gateways. No live transaction is reconciled by these tests.

Implementation: `DispensingIssueDialog.tsx`, `dispensing-issue.css`, `dispenseIssue.ts`, `recoveryPresentation.ts`, shared types, tRPC routes, and PHP `DeliveryCheckWorkflow.php` integrated with the existing recovery and Firebase services.
