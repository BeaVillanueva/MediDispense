# Compact review and customer e-receipt

Review Purchase no longer renders the Dosage & Usage Guidelines card. Stored medicine descriptions, approved guidance records and database fields are unchanged.

After successful, fully verified payment and delivery, the kiosk shows Okay. The customer selects Okay to open an accessible E-Receipt dialog using the same receipt summary and eligibility policy as Admin Transactions. It displays actual backend reference/date, medicine, delivered quantity, unit price, amount paid, coin payment and completion status. Simulations, failed/incomplete delivery, overpayments and purchases without finalized receipt evidence do not receive a successful receipt.

The old success usage guide and duplicate amount blocks are replaced by this receipt. The success confirmation remains short. The five-second timer starts only after Okay opens the receipt. There is no receipt timer or automatic return before that confirmation for an eligible receipt. An untouched receipt closes after five seconds; pointer, keyboard or wheel interaction stops the timer so the customer can read it and select Done. Clicking outside pauses the timer without dismissing the dialog. A View E-Receipt button can reopen it while the completed purchase remains visible.

Closing a receipt is only a UI action. Returning to Choose Medicine still requires the existing backend machine-reuse/handoff checks and checkout reset guard. A five-second idle expiration can return only when those checks pass. Otherwise the completed purchase and reference remain available for assistance. The existing payment expiration, event recovery, dispensing and reconciliation logic is untouched.

Completed-return diagnostics now expose `customerHandoffBlockers` and the first actual `customerHandoffBlocker`, rather than labeling every refusal as unverified physical coin isolation. In the reported transaction #181, successful ₱10 payment and one sensor-confirmed delivery were complete; a formerly retired controller had sent a newer report, restoring the `MULTIPLE_CONTROLLER_REPORTS` guard. A stale reactivated registration is deliberately not ignored. Only the existing authenticated Super Admin retirement workflow, with current physical verification and all backend checks, may retire it again. No live retirement was performed by the diagnostic/code update.

The success screen displays the relevant reason and a Check Status action that recovers the same purchase. The receipt hook remembers Done as well as idle expiry, so a receipt closed while handoff was blocked can finish returning once backend approval arrives. It still requires Okay before opening the receipt, and never clears a completed purchase merely because delivery succeeded. Check Status does not cancel, pay, or dispense.

## Update (19 Nov 2026): Done returns to Choose Medicine

Operator decision: when the customer explicitly selects **Done** on a verified e-receipt, the kiosk returns to Choose Medicine even if the backend handoff check is blocked (for example `CONTROLLER_DIAGNOSTICS_STALE`). This applies only to purchases where `canReturnAfterReceiptDone` (`client/src/lib/transactionReceipt.ts`) holds: e-receipt eligible, exact coin payment, sensor-confirmed delivery, no admin recovery, no dispensing issue, no unfinished dispensing recovery. The five-second idle expiry still returns only when the backend handoff check passes. Failed, partial, overpaid and recovery purchases are still kept for staff.

Trade-off accepted: the coin acceptor has no inhibit, so a coin inserted between customers is not blocked by the kiosk; it remains in the controller journal / reconciliation path for staff review. No backend, payment, dispensing or inventory logic changed.

## Files

- `client/src/pages/Kiosk.tsx`: remove review guidelines rendering.
- `client/src/components/kiosk/CheckoutPanel.tsx`: compact success view, receipt integration, guarded idle return.
- `client/src/hooks/useKioskReceipt.ts`: five-second UI inactivity timer with interaction hold and cleanup.
- `client/src/components/kiosk/KioskReceiptDialog.tsx`, `kiosk-receipt.css`: accessible customer dialog and tablet layout.
- `client/src/components/TransactionReceiptSummary.tsx`: shared receipt/detail fields.
- `client/src/components/TransactionRecordDialog.tsx`: reuse shared summary in existing Admin details/print workflow.
- `client/src/lib/kioskReceipt.test.tsx`, `kioskScreens.test.ts`, `paymentWindow.test.ts`: inactivity, eligibility, review and safety regressions.

No database, firmware, inventory, payment or transaction-record changes. Reload the kiosk after deploying the frontend build. Physical touchscreen behavior should also be checked on the tablet; automated tests do not substitute for that check.
