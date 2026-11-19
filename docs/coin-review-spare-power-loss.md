# Spare-controller power-loss test procedure

**Status: procedure prepared; every hardware case is NOT EXECUTED.** The owner has only production `2C8C6AF3AF48` and retired `20799D470968`; neither is authorized for this procedure.

**Current 17 November decision:** owner accepts permanent destructive repurposing
of retired 20799D470968 (ROM 68:09:47:9D:79:20) as the isolated LAB board. This
supersedes the earlier separate-new-board-only decision; it authorizes preparation,
NOT upload, erase, boot or tests. Production 2C8C6AF3AF48 remains always denied.
Use retired-esp32-approved-lab-repurpose.md for current targeting, Windows steps,
flash ranges and remaining approval gates. Earlier images are superseded.

## Entry gates

1. Complete the approved native tests first. Record package/core hashes, compiler versions and results. A compile alone is insufficient.
2. Use only the owner-verified retired LAB board or a separately approved spare and record its full ROM MAC, firmware-format ID and COM port. A technician verifies the physical label against the board being connected. A lab build must enforce that approved test ID and always reject the production and retired IDs. No port is selected by guessing the first connected ESP32.
3. Obtain explicit approval for the test firmware, **test-board-only** NVS initialization, test credentials, power interruption setup, and isolated fixture database. This document does not authorize any upload.
4. The existing `prepare-candidate.ps1` output is a **compile-only production-source copy**, not a sanitized lab image: it can contain copied production connection settings. **Do not flash it to a test board.** Prepare a separately reviewed lab-only build with synthetic fixtures, a test NVS namespace/partition, test keys, no production credentials/URLs, and test-board-ID enforcement. A separate offline candidate under firmware/lab-durability now provides synthetic cases and checkpoint commands, but is not cleared for hardware. Its fixture receiver/approval does not cover all signed/network cases below; additional isolated integration instrumentation is still required.
5. Use a separate offline lab access point/backend or stubbed transport, separate database and credentials, and a test Firebase project/mock. Block access to the production backend and Firebase both by configuration and network controls. No motor drivers, sensors that drive production logic, payment acceptor, relay/inhibit circuit, or machine harness is connected.
6. Use a current-limited bench supply and a technician-approved way to cut power only to the test board. Verify USB/UART/DTR/RTS cannot back-power it. An EN/reset pulse is a **reboot** test, not a real supply-loss test. Never manipulate mains power. Record actual loss of the test board's 3.3 V supply.
7. Preserve any pre-existing test-board evidence first. Do not erase a production namespace or reuse live journal contents. Use synthetic transaction **900182**, a fixture original-payment event for PHP 5, and a separate synthetic reviewed event with 5 pulses, ending `00000002`, using the **spare's** device ID. This is not transaction 182 and is not a real payment.
8. Before every case capture: journal/queue checksum, all event IDs and payloads, archive contents/hash, pending-ack pointer, fixture payment rows/count, fixture audit rows, fault flags, server decision ID/nonce, and supply/serial evidence. Test exports must be read-only and contain no secret keys.

## Checkpoints required in the lab build

Use debugger breakpoints or lab-only serial wait markers around the **actual adapter functions**, not a rewritten persistence model:

- Immediately before and after archive `putBytes`/readback in `reviewPersistArchive`.
- Immediately before and after pending-pointer persistence.
- Immediately before and after `persistCoreJournal` in `coinReviewApply`.
- Before ack POST, after server commit but before response delivery, and after response verification but before pointer reset in `serviceCoinReviewAck`.

Instrumentation must be test-only and absent from a proposed production build. Debugger timing tests do not replace random cuts during actual flash writes. Document precisely which boundary was reached; do not infer a phase from elapsed time alone.

## Per-case sequence

1. Start from a recorded, known lab fixture. Seed or restore **only test NVS** under the approved test plan. Queue one reviewed synthetic event, keep the reconciliation latch set, and keep all delivery/payment operations disabled.
2. Obtain fresh signed fixture evidence and explicitly authorize its exact ID with a fixture Super Admin. Record the immutable decision and original fixture payment.
3. Send `APPLY COIN REVIEW <fixture decision ID>` only to the verified spare. Reach the selected checkpoint, cut its supply, then restore power. Capture the first boot before retrying anything.
4. Compare raw/read-only evidence against the expected invariant below. Never repair a failed case by deleting the journal, changing its checksum, advancing a pointer manually, or inserting a payment row.
5. Retry only the original matching fixture decision/acknowledgment as applicable. Verify one decision/ack audit, original payment unchanged, unrelated entries preserved, and machine still blocked.
6. Repeat deterministic boundary cases at least 10 times and asynchronous cut-during-write cases at least 20 times across a recorded randomized delay schedule. These sample counts are a minimum lab plan, not proof of exhaustive safety. Log every failure/ambiguous outcome; stop on invariant violation.

## Power-loss and recovery matrix

| Case | Interrupt/fault | Required outcome after reboot/retry |
|---|---|---|
| H01 | Reboot before authorization | Original event unchanged; no decision or acknowledgment invented |
| H02 | Supply cut before archive write | Original reviewed event still queued; no acknowledgment |
| H03 | Supply cut during archive flash write | Original event remains, or corrupt/incomplete archive causes a safe block; no queue advance without valid read-back evidence |
| H04 | Valid archive written, pointer not persisted | Original event still queued; identical retry reuses the archive without overwriting it |
| H05 | Pointer persisted, journal not advanced | Event still queued; background acknowledgment must not falsely claim completion |
| H06 | Supply cut during journal persistence | Either valid old queue or valid new queue with authenticated archive; ambiguous/corrupt storage blocks. No lost evidence |
| H07 | Journal advanced, before ack POST | Exact event archived and absent from active queue; unrelated events unchanged; reboot retries acknowledgment only |
| H08 | Server commits ack, response dropped | Same receipt retried; one fixture ack/audit; no payment/stock update |
| H09 | Response verified, before pointer reset | Replay safe; archive retained permanently; no second queue entry consumed |
| H10 | Power cut during/after pointer reset | Ack history and archive remain; no re-credit, re-dispense or automatic machine release |
| H11 | Duplicate APPLY / different full event ID | Repeated approved operation cannot consume another event; mismatched ID/transaction/amount rejected |
| H12 | Two unrelated entries or an in-flight pulse sequence | Existing other entries/captured pulses preserved; unsafe authorization/application rejected; no reassignment to another purchase |
| H13 | Bad signature, wrong controller key, expired authorization | No queue advance; no substitute credit; precise block retained |
| H14 | NVS full, archive collision, failed write/readback | Event/evidence retained; no forced overwrite, pruning or namespace clear |
| H15 | Overflow, storage fault, interrupted binding or unrelated review flag | Exact-event handling must not clear these faults; machine remains blocked |
| H16 | Reboot repeatedly after successful ack | Original fixture payment remains one PHP 5 payment; archive stable; no motor request or new session |

For H06, a torn write must never result in an apparently healthy empty journal without the original authenticated archive. If the storage layer cannot establish valid evidence, failure is the correct result and assistance remains required.

## Evidence sheet

For each attempt record: case ID, repetition, operator/reviewer, spare MAC/COM, firmware/source hashes, lab backend identifier, fixture decision/event IDs, checkpoint, power trace, before/after journal and archive hashes, queue contents, pending pointer, ack count, payment count/amount, fault flags, observed result, pass/fail/block and log paths. Empty cells are **NOT EXECUTED**, never PASS.

Release requires all invariants passing and an independent reviewer signing the evidence. Acknowledged event archival alone does not prove motors, acceptor, physical coin inhibition or kiosk readiness.

## Retired board repurposing decision

Original physical-flash preservation has been superseded by the owner's explicit
acceptance of destructive lab reuse, with matching complete backups retained
privately. No backup has been opened/copied for this update. The board is never
returned to production. It must not reconnect to production services or inherit
production credentials in the lab build. No live controller registration is changed.

Destructive range consent is NOT a hardware execution authorization. Exact reviewed
binaries/COM, fresh ROM identity and security checks, electrical/RF isolation,
Windows tool review and separate upload/erase/test approval are required. The
production controller remains off limits; its unresolved event is not transferred.
