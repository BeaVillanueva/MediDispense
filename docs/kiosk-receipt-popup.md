# Compact review and customer e-receipt

Review Purchase no longer renders the Dosage & Usage Guidelines card. Stored medicine descriptions, approved guidance records and database fields are unchanged.

After successful, fully verified payment and delivery, the kiosk opens an accessible E-Receipt dialog using the same receipt summary and eligibility policy as Admin Transactions. It displays actual backend reference/date, medicine, delivered quantity, unit price, amount paid, coin payment and completion status. Simulations, failed/incomplete delivery, overpayments and purchases without finalized receipt evidence do not receive a successful receipt.

The old success usage guide and duplicate amount blocks are replaced by this receipt. The success confirmation remains short. An untouched receipt closes after five seconds; pointer, keyboard or wheel interaction stops the timer so the customer can read it and select Done. Clicking outside pauses the timer without dismissing the dialog. A View E-Receipt button can reopen it while the completed purchase remains visible.

Closing a receipt is only a UI action. Returning to Choose Medicine still requires the existing backend machine-reuse/handoff checks and checkout reset guard. A five-second idle expiration can return only when those checks pass. Otherwise the completed purchase and reference remain available for assistance. The existing payment expiration, event recovery, dispensing and reconciliation logic is untouched.

## Files

- `client/src/pages/Kiosk.tsx`: remove review guidelines rendering.
- `client/src/components/kiosk/CheckoutPanel.tsx`: compact success view, receipt integration, guarded idle return.
- `client/src/hooks/useKioskReceipt.ts`: five-second UI inactivity timer with interaction hold and cleanup.
- `client/src/components/kiosk/KioskReceiptDialog.tsx`, `kiosk-receipt.css`: accessible customer dialog and tablet layout.
- `client/src/components/TransactionReceiptSummary.tsx`: shared receipt/detail fields.
- `client/src/components/TransactionRecordDialog.tsx`: reuse shared summary in existing Admin details/print workflow.
- `client/src/lib/kioskReceipt.test.tsx`, `kioskScreens.test.ts`, `paymentWindow.test.ts`: inactivity, eligibility, review and safety regressions.

No database, firmware, inventory, payment or transaction-record changes. Reload the kiosk after deploying the frontend build. Physical touchscreen behavior should also be checked on the tablet; automated tests do not substitute for that check.
