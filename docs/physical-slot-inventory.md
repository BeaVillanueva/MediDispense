# Physical slot inventory management

## Existing structure and inspection

The installed database has three `machine_slots` rows (1–3), with unchanged MOTOR-1/IR-1 through MOTOR-3/IR-3 mappings. Medicines, recorded stock/reservations, transaction item snapshots, stock movements, and activity logs are already separate. There is no expiry-batch table. The old creation endpoint allowed unassigned medicines; Edit could move slots; Delete archived without a required stock-removal attestation or movement.

No migration is required. `machine_slots` remains the assignment source of truth. An `inventory_maintenance:<machine-code>` JSON record in existing `system_settings` persists the current/last operation. Full operation history remains in `activity_logs`. An active operation blocks new customer checkouts and marks the selected slot blocked. Closing a dialog, refreshing, or a failed completion does not unlock it. Any authorized Admin/Super Admin can resume it after inspecting the physical state; Staff can view but cannot modify it.

## Operating instructions

1. Open Medicine Inventory. Review the three physical slot cards, recorded quantities, and assignment/stock statuses. Zero stock remains **Occupied**.
2. Use Add Medicine only on an Available slot; use Replace or Remove on an Occupied slot. Keep the controller online and do not move tablets yet. Click **Check safety & start**.
3. The backend checks purchases, reservations, dispensing requests, recovery evidence, controller journals, telemetry freshness, motor reports, and read-only Firebase command state. If blocked, resolve the stated condition using the corresponding existing recovery workflow. No purchase is cancelled by inventory maintenance.
4. After maintenance starts, power off the **entire machine**, including the coin acceptor and motors. Remove and count the old stock; enter the physically removed count (including zero). It must match recorded inventory, otherwise the operation remains blocked for investigation. For Add/Replace, load the selected new medicine, physically count it, and enter its actual approved details. No clinical directions are generated or approved automatically.
5. Enter a reason and confirm every physical check. Save the change. The backend repeats its safety checks, verifies the same controller, records stock changes, archives the old medicine, creates a new ID for the replacement, and updates the assignment atomically. The saved initial controller evidence may be stale after intentional power-off; unresolved/new coin evidence or controller changes still block completion. This is an explicit operator attestation workflow, not a fabricated hardware inhibit acknowledgement.
6. Reconnect power and verify Machine Monitoring before admitting customers. Confirm the kiosk refreshes its catalog (existing 5-second polling). No maintenance action sends a motor command, accepts a coin, or dispenses a tablet.

An unfinished operation has **Resume stock change**. There is deliberately no automatic abort/unlock: closing is not proof that old stock is back in place. Complete it with verified actual stock. If recorded stock, controller identity, or recovery state no longer matches, authorized maintenance must investigate; do not alter settings manually to bypass the lock.

Add Stock first runs the online safety check and opens the same durable maintenance pause. Power off the whole machine before loading. It then requires a positive whole addition, maximum recorded capacity 10, physical loading/power-off/no-unrecorded-coins confirmations, same-expiry confirmation, and a reason. It repeats safety checks before committing and uses a stable request key for retry protection. Resume an interrupted restock from the physical slot overview. Different expiry batches cannot be mixed: remove the old stock first. Editing cannot move slots, activate/archive medicine, or change quantities. Changing expiry while tablets remain is blocked. Name/generic corrections require an explicit same-product/strength/formulation confirmation; a different product must use Replace. Existing pharmacist guidance identity checks still withhold mismatched approvals.

Archival is permanent for the old vending identity through these screens. Reintroducing a previously removed product creates a separate new ID and assignment through Add/Replace; old records are never silently reactivated or renamed into another product. There is no permanent delete action. Historical customer obligations and receipts remain attached to their original IDs and snapshots.

## API and permissions

- `GET /api/inventory/slots`: authorized staff overview.
- `POST /api/inventory/maintenance/start`: Admin/Super Admin, action add/remove/replace/restock, slot 1–3 and request key.
- `POST /api/inventory/maintenance/complete`: Admin/Super Admin, same request key, required physical confirmations, reason, and new medicine data for Add/Replace.
- `PATCH /api/inventory/adjust`: inspected restock only; physical/same-expiry confirmations and request key required. General unaudited quantity changes are rejected.
- `PATCH /api/medicines/:id`: same-product metadata edits. Historical transaction item rows are never rewritten.
- Legacy direct medicine `POST` and `DELETE` refuse assignment/archive bypasses and direct the caller to maintenance.

The same configured-machine row is locked by checkout and inventory operations. Slots and stock are rechecked while that lock is held. Only one maintenance operation can own the machine. Duplicate completion/restock requests cannot repeat stock movements; reused keys with different decisions are rejected. No motor/sensor identifiers or controller registrations are written.

## Validation and limits

`backend/tests/slot-inventory.php` and `medicine-inventory.php` use connection-local temporary tables that shadow live tables. Tests cover occupied/full slots, slot 4 rejection, metadata-only editing, confirmations, additions, zero/remaining-stock removals, active/partial payments, dispensing/coin/controller faults, resumable failure, atomic rollback, duplicate/reused requests, conflicting assignments, competing administrator requests, archived catalog exclusion, historical receipts/payments/sales snapshots, and unchanged motor mappings. Frontend tests cover blank/unconfirmed forms, safety-before-mutation, resume behavior, and staff restrictions.

Run `npm test`, `npm run check`, `npm run build`, PHP lint on modified PHP files, and the temporary-table PHP tests. The older `kiosk-integration.php` separately needs its isolated MariaDB test server on port 33317; do not redirect it to production port 3306. Simultaneous browser load/lock contention and actual physical loading, coin path, power-off, restart, sensors, and motor behavior still require supervised manual verification. Automated tests use synthetic telemetry and a read-only command-state stub; they do not prove physical hardware safety.

## Files

Backend: `SlotInventoryService.php`, `MedicineInventory.php`, `KioskService.php`, `backend/public/index.php`. Frontend: `InventorySlots.tsx`, `inventory-slots.css`, `MedicineDetailsDialog.tsx`, `RestockDialog.tsx`, inventory section of `Home.tsx`. Contracts/router: `shared/slotInventory.ts`, `server/routers.ts`. Tests: `backend/tests/slot-inventory.php`, updated `medicine-inventory.php`, `client/src/lib/inventorySlots.test.tsx`, `server/slotInventory.test.ts`, updated `server/phpApi.test.ts`.

Final automated validation: 225 Vitest tests passed; 354 checks across 10 PHP fixture suites passed (including 65 slot-management and 19 metadata tests); TypeScript and PHP lint passed. Production build passed. The standalone isolated integration script could not connect because its separate test server on port 33317 was offline. Live quantities and mappings were read back unchanged after fixture tests. No production maintenance operation was started or completed during implementation.
