# Customer kiosk: one medicine, coin payment, no change

The existing `/kiosk` and `/kiosk/` customer routes retain their layout, medicine
cards, stored information, disclaimer and touchscreen controls. No admin links,
new dependencies, database schema changes or Firebase/ESP32 commands were added.

## Purchase flow

Browse → details → quantity → Buy Now → review purchase → coin payment →
one confirmation per unit → success → Done / automatic return after 20 seconds.

There is one selected medicine, not a multi-product cart. Both the tRPC checkout
validator and preview store require exactly one line. `quantityLimit` respects
stock and an optional `MAX_PURCHASE_QUANTITY` in `client/src/lib/kioskPurchase.ts`.
It has no arbitrary cap by default. `purchaseTotal` calculates unit price ×
quantity using integer centavos. Stock/price changes require another review.
The backend rechecks availability when creating the payment-pending transaction.

## Coin state and no-change policy

`useKioskCheckout.ts` owns the transaction, inserted amount and mutation lock.
`kioskPurchase.ts` defines IDLE, WAITING_FOR_COINS, PARTIAL, PAID, OVERPAYMENT,
DISPENSING, SUCCESS and DISPENSE_FAILED, plus remaining balance and cancellation
rules. Selected medicine, quantity, unit price and total are captured in Purchase.

The exact-amount/no-change notice appears in review before coins can be accepted,
and remains visible during payment. Simulation adds each coin's full amount;
overpayment is never clipped. The current isolated preview policy accepts enough
money, records any excess, starts dispensing, and retains an OVERPAYMENT notice.
It never promises change or a refund. `transaction.change` is zero for new
payments; historical ledger entries are not rewritten.

Before the first coin, Back returns to review, where the customer can change the
medicine/quantity or cancel. After the first coin there is no normal cancel,
clear-balance or refund action. At the payment threshold, further coin controls
lock and the adapter verifies payment, then creates the dispense request. A
free/zero-price purchase follows the same verification path without coin input.
No inventory is deducted at checkout, payment or request creation.

## Development simulation

`DevelopmentControls.tsx` contains the explicitly labeled DEVELOPMENT / PAYMENT
SIMULATION and DEVELOPMENT / DISPENSING SIMULATION controls. Rendering and action
handlers require `import.meta.env.DEV`; `VITE_KIOSK_SIMULATION=false` disables them
in development as well. A production build cannot enable them with this flag.
Until a physical payment adapter exists, production builds show the catalog and
review, but disable Proceed to payment and tell users not to insert coins.

All medicine, transaction and stock data still uses `server/medidispenseStore.ts`
in memory. Images are existing sample images. Coin balance is local preview state.
Backing out before coins clears the local session; the current service retains
the unpaid pending ledger entry (there is no persistent cancellation API yet).
Failure/uncertain responses require assistance and do not auto-reset. Reloading
loses local preview state; an active purchase has an unload warning. This is not
a production transaction-recovery mechanism.

## Unit-level dispensing boundary

Transactions carry `requestedQuantity` and `dispensedQuantity` (optional only for
legacy ledger compatibility). The existing tRPC `verifyDispense` contract adds
an optional `unitNumber`. Multi-unit transactions require explicit sequential
unit numbers. A success confirms and deducts exactly one unit. The next unit
becomes available only after that confirmation. Explicit duplicate successful
unit events do not deduct again; out-of-order events are rejected. Failure stops
the purchase and preserves confirmed units. Repeating `requestDispense` cannot
restart a completed or failed purchase. No timed continuous motor action exists.

Example: requested 3, confirmed 2, unit 3 fails → requestedQuantity=3,
dispensedQuantity=2, dispensingStatus=failed, two inventory units deducted.
The customer screen shows an issue and the reference, never success or a refund.
Success requires all units confirmed and clears the local selection, payment and
reference on Done or `SUCCESS_RESET_SECONDS` timeout.

## Future physical integration (not implemented)

- Replace the preview adapter in `useKioskCheckout.ts` with a backend-verified
  payment session, cumulative coin balance and status subscription. Physical
  input must not be treated as a customer-authorized payment mutation.
- `applyCoinEvent` illustrates deduplication by stable event ID and untruncated
  amounts. Durable event deduplication, late coins, acceptor inhibit, exact coin
  denomination policy and overpayment decisions belong in the backend/device.
- Map PHP/MySQL catalog and checkout fields to the existing frontend types,
  enforce one medicine and active slot eligibility server-side, and persist
  inserted amounts, payment state, unpaid cancellation and recovery identifiers.
- Put future Firebase/ESP32 commands behind backend dispense-request processing.
  Use one cycle ID per unit, wait for trusted sensor confirmation, then schedule
  the next cycle. Do not call motors from React or run quantity × motor duration.
- Upgrade PHP's current whole-quantity sensor callback to atomic, idempotent
  per-unit confirmations, persistent partial progress and stock reconciliation.
  The PHP code was intentionally not changed or connected in this UI task.
- Existing preview mutation endpoints are not production payment verification.
  Production must authenticate coin/sensor events, reconcile status after lost
  responses, prevent duplicate checkout/payment/cycles across reloads, and provide
  an assistance workflow. No refund hardware or refund promise is introduced.

## Acceptance checks

At 768×1024 and 1024×768: select one medicine, adjust 1 to stock limit, review,
go back/change/cancel before coins; insert partial coins and verify navigation
locks; reach the exact total; overpay and verify the full amount/no-change notice;
confirm units 1, 2, 3 independently; fail after two confirmations; verify no final
success on failure; verify Done and timed reset remove prior customer details.
Check stock/price changes, network errors, rapid taps, missing images and empty
catalogs. In a production build, verify no simulation controls or payable purchase
are exposed before the physical adapter is connected.
