# Transaction 182: blocked dispensing recovery

Investigation on 16 November 2026 (Philippine time). Live inspection uses a read-only MySQL transaction and Firebase GETs only. No recovery action has been performed.

## Confirmed evidence

- Transaction **182**, request **96**, medicine 1 / Slot 1, Paracetamol 500mg, ordered 1. The actual stored reference is `TXN-5B20601A7D8FFE7E97CF7116` (digits `11`, not letter `I`).
- Transaction/payment both show successful payment of PHP 5. Request 96 is failed with sensor quantity 0. No queued/sent/dispensing request or pending unpaid purchase was found during inspection.
- Recorded quantity is 1, reservation 0. Last counted timestamp is 14 November 2026 10:51:43 in stored database time.
- Audit records **1289** and **1290** are `admin_dispense_delivery_noted`, revisions 1/2, with outside-observation quantity 9, delivered 0, `inventoryApplied:false`. They are not physical reconciliation records. No `admin_dispense_issue_reviewed` record exists for this transaction. The conflicting notes did **not** set inventory to 9.
- The operator now confirms delivered **0**, physical remaining **1**, total accepted money **PHP 5 only**, motors stopped, whole machine powered off/isolated. This statement is not silently converted into a saved recovery, refund, or journal disposition.
- Original recorded event: `coin-2C8C6AF3AF48-0000000E-2202FD51F9C2DB7E-00000001`, PHP 5, recorded 15 November 2026 17:25:12 in stored database time.
- Retained event: `coin-2C8C6AF3AF48-0000000E-2202FD51F9C2DB7E-00000002`, transaction 182, 5 pulses / PHP 5 interpretation, `requiresReview:true`. It is **not** an additional recorded payment and must not be submitted as one.
- Latest available controller report is stale and retains pending=1, durable=1, reconciliation=true, incomplete pulses=false, healthy storage. It cannot prove current conditions. Installed controller is operator-confirmed as **2C8C6AF3AF48**. Old **20799D470968** is retired in the registry, stale, and operator-confirmed disconnected.
- Firebase operation state and retirement receipt are separate checks: an idle `/dispense` does not prove a matching admin-retirement receipt exists for request 96. Both must be verified by the recovery service.

## What is and is not known about the second event

The reviewed local firmware generates the full ID once from device, boot counter, boot nonce and captured-sequence number. `sendCoinPayment()` retries that same ID and removes only the matching explicitly acknowledged event. `coinCoreAppend()` flags an event for review if capture was outside an eligible payment session, its owner is invalid, or its pulse denomination is unknown. Positive amount/owner plus `requiresReview:true` is consistent with capture while payment acceptance was not authorized in that source version.

The IDs have the same device/boot/nonce but different sequences. This is not how a normal HTTP retry of event 1 is represented. Event 2 is deliberately held before normal payment submission while its review flag remains set. Its retention is protective, not proof of a second physical coin.

The journal stores no capture timestamp, pulse waveform, installed-build attestation, or per-attempt HTTP history. MySQL stores no pulse count/ack receipt for event 1, only its durable payment entry. Thus duplicate physical pulse interpretation, electrical noise, a delayed capture, or stale/migrated evidence cannot be conclusively distinguished from the available records. Obtain a read-only journal export and contemporaneous serial trace; inspect the coin signal with dispensing power isolated. Do not insert another coin just to test this unresolved purchase.

## Exact authorized recovery sequence

1. Keep the machine isolated, old controller disconnected, and this kiosk session open. Do not clear browser storage, erase NVS, issue another dispense, or add another payment event.
2. Admin → Transactions → **Transaction #182** → **Check Medicine Delivery**. Select **Hands-on stock inspection**. Independently confirm whole-machine isolation, stopped motors, and no accepted unrecorded physical coins; use **Pause for physical inspection**. This requires the backend's independent idle-command check.
3. Select **No tablets came out**, delivered **0**, remaining **1**. Add a truthful correction note identifying outside-observation audits 1289/1290 as erroneous stock observations. Preserve those original notes. Leave customer follow-up **pending**, unless an actual refund/replacement is separately verified and documented; do not reuse the old free-text refund assertion as proof.
4. **Save Check** only with explicit administrator authorization. It applies the existing idempotent reconciliation and command-retirement workflow. A count of 1 matches recorded inventory, so no tablet deduction is justified. This is not permission to reopen.
5. Separately resolve the reviewed coin event through an authenticated, audited, exact-event workflow. **The current firmware has no such review-disposition consumer.** Neither `BOOT REVIEW CLEAR`, manual session binding, nor reposting payment verification can legitimately resolve this non-additional-payment event. Stop here until the feature below is separately approved and implemented.
6. After authorized event disposition, obtain fresh genuine diagnostics: pending/durable=0, incomplete pulses=false, healthy storage, no review/overflow/binding faults, correct controller identity. Keep motor/coin-acceptor power safely isolated while obtaining controller-only diagnostics if the wiring permits this safely. Do not fake a heartbeat or diagnostics record.
7. Admin refreshes the delivery case, verifies no active commands or conflicting purchase, and explicitly selects **Reopen Kiosk** with fresh confirmations. The backend must approve it. Customer refund/replacement obligations remain separately tracked.
8. In the original kiosk browser press **Check Status**, then **Return to Choose Medicine** when offered. Return performs another authorized backend status read. It never retries dispensing or records payment. Start a new purchase only after safe return is confirmed.

## Missing coin-review feature: proposal, not an executed change

Implement append-only Super Admin event reviews uniquely keyed by controller ID + full event ID. Capture the event payload/hash, transaction binding, pulse count, original recorded event, physically verified total, evidence, reviewer/time, and decision. For this operator account, a decision would describe **no additional accepted payment; pulse cause unconfirmed**, not invent a proven duplicate cause. Lock the transaction and event; require fresh exact-controller evidence and physical isolation; record no additional credit and preserve the existing PHP 5 ledger. Duplicate decisions must be idempotent and conflicting decisions rejected.

A separately authorized firmware update must consume an authenticated exact-event disposition, durably archive the original event/decision before advancing its queue, retain evidence across retries/reboots, and acknowledge application back to PHP. It must never erase the journal, discard unmatched events, or clear unrelated faults. Failed persistence/response must retain the pause. Reopening stays blocked until fresh diagnostics and the applied-decision audit agree. Test on isolated fixtures before any upload; no firmware/NVS/schema changes are made by this investigation.

## Controller retirement limit

The old registration is excluded while it remains retired. A new report from it reactivates the ambiguity guard. This is not cryptographic revocation: the existing hardware endpoints use a shared hardware key and Firebase access, rather than per-board credentials. Keep the retired board physically disconnected. Strong per-controller revocation requires separately coordinated backend/firmware credentials and Firebase authorization; it cannot be truthfully claimed from a registry retirement alone.

## Implemented screen fix

Failed dispensing now always has **Check Status**, visible progress/error feedback, and a short blocker explanation. PHP exposes all current recovery blockers even before a physical review exists. A safe-return button requires explicit persisted return approval and a fresh backend assessment, including command and coin/controller checks. The final return checks the same purchase again before clearing only its normal completed kiosk session state.

No existing live case is automatically reconciled or reopened. The machine is **not cleared for another coin/motor test** while this reviewed event and physical recovery remain outstanding.
