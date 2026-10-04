# PHP/MySQL-backed customer kiosk

## Current implementation

The existing `/kiosk` UI, one-medicine quantity selection, Buy Now review,
exact-coins/no-change notices, and per-unit dispensing states are preserved.
Production/default development data flow is:

`React → kioskApi.ts → PHP index.php → KioskService → MySQL`

The React app does not verify real payments, report sensor success or activate
motors. `useKioskCheckout` observes PHP transactions every 1.5 seconds. The server
is authoritative for amounts, states, slot mapping and inventory. Physical coin
acceptor, Firebase/ESP32 bridge and IR sensor integration are **not implemented**.
The payment screen warns not to insert coins until hardware is enabled by staff.

## Configuration and safe database upgrade

1. Ensure the existing MySQL service is healthy and back up the application DB.
2. Apply `database/migrations/2026_10_04_kiosk_transactions.sql` **once** to the
   existing database. Do not reimport `database/schema.sql`: it contains DROP
   statements and is a fresh-install bootstrap only.
3. PHP reads server environment variables in `backend/config/config.php`.
   Alternatively copy `backend/config/local.example.php` to ignored `local.php`.
   `DB_*`, hardware key and credentials stay server-side.
4. Frontend `.env.local`: set public `VITE_API_BASE_URL` to the PHP base URL, e.g.
   `http://localhost/medidispense/backend/public`. The Node admin bridge uses
   `MEDIDISPENSE_PHP_API_URL`, falling back to that same public URL.
5. Set `CORS_ORIGINS` to exact browser origins, including the actual Vite port.
   Set `KIOSK_MACHINE_CODE` to the database machine code. Restart services after
   changing their environment.
6. Keep `HARDWARE_API_KEY` empty until needed. Trusted endpoints fail closed when
   it is absent/short. Use a generated secret of at least 32 characters and HTTPS
   outside localhost. Never configure this key as a VITE variable.

The migration preserves existing records and adds `inventory.reserved_quantity`,
transaction idempotency/recovery hashes and unpaid expiry, request confirmed-unit
counts, per-unit log uniqueness, and a `payment_events` table for coin-event
deduplication. Historical successful request counts are backfilled. Legacy unpaid
transactions without a recovery key require staff reconciliation; they cannot be
used to send new hardware events.

## API contracts

All JSON uses `{data: ...}` or `{error: {code, message, details}}`.
No response exposes SQL errors, passwords, file paths or recovery-token hashes.

| Method/path | Caller | Behavior |
| --- | --- | --- |
| GET `/api/medicines?available=1` | Customer | Eligible catalog, net of reservations |
| POST `/api/transactions/checkout` | Customer | One `items` entry with `medicine_id`, integer `quantity`; stable `request_id`; `X-Kiosk-Token` containing a random 64-character hex token |
| GET `/api/transactions/recover?request_id=...` | Token holder | Recovers the same persisted purchase after lost checkout response/reload |
| GET `/api/transactions/{id}` | Token holder | Authoritative amount, payment, request and unit progress |
| POST `/api/transactions/{id}/cancel` | Token holder | Persists cancellation only while no coins have been recorded |
| POST `/api/payments/verify` | Trusted hardware/backend | `transaction_id`, stable `event_id`, `coin_amount` delta; requires `X-Hardware-Key` |
| POST `/api/dispense/{requestId}` | Trusted hardware/backend | Returns stored motor/sensor mapping and next unit number; records dispatch acknowledgement; does not itself send a motor command |
| POST `/api/dispense/{requestId}/sensor` | Trusted hardware/backend | `unit_number`, boolean `success`; idempotent per unit; requires hardware key |

The old browser-supplied `amount_inserted` verification contract is deliberately
not accepted. A coin event's full amount is recorded; excess is exposed as
`overpaymentAmount`/`coinStatus=OVERPAYMENT`, with no change/refund promise.
Current policy proceeds once the total is met; future policy can be changed in
the coin-event service. Free database-priced purchases queue without requiring a
coin. The frontend never submits prices or totals to checkout.

## Stock, payment and unit safety

- Checkout locks the medicine/inventory/slot records, validates the active
  category, medicine, machine and ready/low slot, expiry and available stock.
  It creates one transaction item with a price snapshot and a random server ID.
- A reservation reduces *available-to-purchase* stock, not physical inventory.
  Competing requests cannot both reserve the last unit. Admin adjustments cannot
  reduce physical quantity below existing reservations.
- Stable checkout keys prevent duplicate records. Deadlocked SQL transactions
  are rolled back and retried, with no hardware actions inside the transaction.
- Unpaid, zero-coin purchases expire after ten minutes; subsequent catalog/status
  requests release their reservations. A first coin disables unpaid expiry.
  Partial paid sessions remain for assistance rather than discarding money.
- Payment locks the purchase and records unique coin events. Duplicate events
  have no effect; conflicting duplicate amounts are rejected. Paid status queues
  one request with the stored slot/motor/sensor mapping; it never deducts stock.
- Sensor results require trusted authentication and the next sequential unit.
  Each confirmed unit deducts exactly one physical/reserved unit, records a stock
  movement, and advances `dispensedQuantity`. Duplicate results do not deduct again.
- Failure retains the confirmed count and releases the unconfirmed reservation.
  Requested 3 / confirmed 2 / third failed remains failed, with only 2 deducted.
  Success requires every requested unit confirmed.
- If slot mapping is disabled/changed after payment, the paid amount is preserved
  and the purchase requires assistance; its reservation is retained for safe
  reconciliation. A production staff reconciliation tool is still future work.

The browser stores only a random recovery token, request ID and selection in
localStorage. It never restores cached paid/success data. A lost response recovers
or retries the same idempotent request. Done/success timeout clears that token and
selection. Failed or uncertain transactions remain visible for assistance.

## Admin consistency

Existing admin tRPC procedures bridge to authenticated PHP catalog, stock,
transaction, summary, machine and notification endpoints. They do not update a
second in-memory stock. Medicine creation maps existing UI fields/category name
to PHP and optionally assigns an empty database slot. Existing PHP price edits
and stock adjustments appear in kiosk polling. Admin layout/authentication UI
is unchanged. The old “Ping ESP32” control refreshes persisted status; it cannot
invent a hardware heartbeat. Sales charts use actual database totals.

## Explicit demo mode

The Node preview store remains for tests/development. It is not a fallback on
PHP failure. To deliberately use it, set `VITE_KIOSK_DEMO=true` and
`MEDIDISPENSE_DEMO=true` in development and restart. Production builds/server mode
ignore those switches. The demo hook and controls are separate; all old Node
kiosk mutation endpoints reject requests when explicit demo mode is off.
The preview's medicine arrays, images, sample transactions and inventory remain
in `server/medidispenseStore.ts` only for that isolated mode.

## Validation and deployment status (2026-10-04)

`backend/tests/kiosk-integration.php` creates a uniquely named disposable DB on
an isolated local MySQL server (default test port 33317, refuses port 3306).
It bootstraps only that test DB, applies the additive migration, and checks real
SQL pricing, reservation, recovery, cancellation, coin and unit-confirmation logic.
`kiosk-http.mjs` starts a temporary PHP HTTP server with a generated test-only key
and checks CORS, token access and rejection of customer payment/sensor claims.
`kiosk-race.php` runs separate PHP processes against the last unit concurrently.
These are simulated hardware **test events**, not deployed production simulation.

Validation completed: 33 MySQL service assertions, 20 PHP HTTP assertions, a
two-process last-unit concurrency check, 20 Vitest tests, TypeScript checking,
production build, and syntax checks for the changed PHP files. The build reports
the existing large-bundle warning. The expiry checks use MySQL's clock so PHP and
database timezone differences cannot keep an expired unpaid reservation alive.

The existing XAMPP instance on 3306 reported InnoDB data/log corruption during
validation. It was not reset or repaired. A separate workspace test data directory
was used. The migration has not been applied to the real application database.
Restore/recover that database from a verified backup before applying the migration.
Real Firebase-authenticated employee UI acceptance testing and tablet visual
testing still require the user's working account/application database.

## Security audit

No private key/service-account or non-placeholder credential was identified in
the reviewed tracked configuration/prototype files. Firebase public web config
is not a service-account private key. Local environment files remain ignored;
do not commit their values. The former known hardware-key fallback was removed.
The archived `backend/public/index-before-rbac.php` is denied by Apache to prevent
access to obsolete endpoints. Root Apache rules deny direct access to environment,
Git, server source, database, temporary test data and private backend folders.
Ignored `local.php`, private key and service-account filename patterns were added.
This is a working-tree audit, not a certification of the full Git history.

## Next integration boundaries

1. **Coin acceptor:** build a trusted bridge that selects the persisted purchase,
   validates coin denominations, generates durable event IDs, and POSTs coin deltas
   with a server-only credential. Handle late coins/acceptor inhibit and restart
   recovery before enabling real money. Do not expose this credential to React.
2. **Firebase/ESP32:** build a backend bridge that reads queued requests, sends the
   stored motor mapping plus one transaction/request/unit cycle ID, and waits for
   a trusted drop confirmation before issuing the next unit. A motor acknowledgement
   is not a successful drop. Use the existing per-unit sensor endpoint and retain
   partial failure state; never use quantity × motor-running time.

Neither hardware bridge is implemented in this change.
