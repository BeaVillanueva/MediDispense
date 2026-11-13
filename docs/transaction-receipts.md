# Admin transaction receipts

The Transactions action is **View E-Receipt** only when backend evidence confirms finalized coin payment, a completed dispensing request, and the entire requested quantity delivered. Payment status alone is insufficient. Amounts must agree with the verified payment ledger and item totals.

Authenticated physical recovery additionally requires a finalized inspection, verified stock reconciliation, verified full delivery, and no outstanding delivery obligation. A legacy recovery marker without physical-delivery evidence remains **View Details**. Historical records without verified delivery allocation also remain details; no history is removed or rewritten.

The shared record dialog reuses the existing receipt markup and print classes. It displays MediDispense, Triple J Grocery Store and Pharmacy, actual reference/date, medicine, delivered quantity, unit price, paid amount, and verified payment/dispensing statuses. Printing rechecks the latest backend evidence. Saving PDF depends on the browser print dialog; there is no separate receipt-download service.

Cancelled, failed, pending, and incomplete purchases show actual payment and dispensing details, recorded cancellation/failure reasons, available recovery information, and audit history. Private recovery notes remain admin-only. Existing Resolve Dispensing Issue actions are preserved.

## Files changed

- `backend/src/TransactionReceipt.php`: read-only receipt eligibility policy.
- `backend/src/KioskService.php`: receipt evidence in snapshots and authenticated record details.
- `backend/public/index.php`: authenticated GET transaction details route.
- `shared/medidispense.ts`: receipt evidence and record-detail types.
- `server/routers.ts`: transaction-details query using existing view permission.
- `client/src/lib/transactionReceipt.ts`: frontend eligibility and explanations.
- `client/src/components/TransactionRecordDialog.tsx`: shared details/e-receipt dialog and print action.
- `client/src/components/transaction-record.css`: responsive and print styling.
- `client/src/pages/Home.tsx`: conditional transaction actions and shared dialog.
- `backend/tests/transaction-receipt.php`: eligibility scenarios.
- `backend/tests/dispense-issue-recovery.php`: recovered/cancelled snapshot and authorization coverage.
- `client/src/lib/transactionReceipt.test.tsx`: action eligibility and rendered receipt/details coverage.

## Validation

Passed 324 checks across 12 PHP suites, 157 frontend/server tests across 23 files, TypeScript checking, and production build. The build retains a large-bundle advisory. Tests use isolated database fixtures and mocked dispensing gateways; no real dispensing is triggered.

No database migration, inventory adjustment, payment mutation, transaction-status change, firmware update, or Firebase configuration change is required. Restart the existing Node application if it serves the production build, then reload the admin page. Physical printing should be checked in the deployment browser.
