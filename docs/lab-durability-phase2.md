# Phase 2 isolated lab candidate — NOT approved for hardware use

This package is software preparation only. No device, COM5, private flash backup,
production backend, Firebase, or live records were accessed. Do not upload it yet.
The installed controller `2C8C6AF3AF48` is never authorized. The retired board is
`20799D470968`, ROM MAC `68:09:47:9D:79:20`, classic ESP32, 4 MiB flash.

## Baseline and candidate separation

The frozen baseline remains `tmp/lab-retired-repurpose-review-v4/review-images/`.
Its manifest, four binaries and copied source files are fingerprinted separately
in `tmp/lab-phase2-baseline-fingerprint.json`; none are overwritten by this package.
Candidate sources are only `firmware/lab-durability/phase2/`. The preparer refuses
an existing output directory. Candidate build and hashes are under
`tmp/lab-durability-phase2-v2/`. Local tmp artifacts are not a substitute for a
secure, externally retained evidence copy. Original private backups stay private.

Compared with v4, storage is compiled in, but setup still does not open storage.
`STATUS` reports RAM only. No automatic case creation, formatting, clearing,
migration, repair, fallback record selection or production recovery is present.
The exact existing identity guard is copied unchanged, plus an exact packed-MAC
check. Startup cannot authorize a different test board. UART uses GPIO1/3; there
is no vending GPIO actuation. The guard runs in the sketch, not before framework
startup, and cannot make an accidental upload to production safe.

The **same** partition table is retained:

| Partition | Type | Offset | Length | End, exclusive |
|---|---|---:|---:|---:|
| labapp | factory app | 0x10000 | 0x1F0000 | 0x200000 |
| labstore | NVS data | 0x3E0000 | 0x20000 | 0x400000 |

No default `nvs`, OTA or coredump partition is added. An application-only upload,
if later approved, must write only the reviewed application at 0x10000. Do not use
an erase-all, merged image, bootloader or partition-table upload. Generated helper
binaries are for comparison only. Actual image length and sector-rounded write
range are recorded in the candidate manifest. Arduino's generic size report uses
the board menu's 1,310,720-byte limit; the generated CSV/table is independently
checked, and this application fits both limits.

## Persistence and fail-closed behavior

New cases use schema 2 and a separate `p2-<case>` namespace (1–6 lowercase letters
or digits). `INIT ISOLATED <case>` explicitly initializes a **new** case;
`RESUME ISOLATED <case>` validates an existing case and explicitly persists a boot
counter. These commands require separate hardware authorization before use.
One case can be opened per boot. Namespace changes and silent replacement are
not supported. A partial initialization is retained and rejected, not repaired.

An init-intent record precedes receiver/journal records; the final header is last.
Headers bind the case, board, random 64-bit case nonce and serialized structure
sizes. Reserved sequences are committed before event creation: a cut may leave a
sequence gap, never reuse a committed event identity. Nonces reduce accidental
cross-case collisions but are not cryptographic authorization or a global
uniqueness guarantee. Raw structures are ABI-bound, not a portable migration format.

Each normal synthetic event is exactly 5 pulses / 5 synthetic currency units and
transaction 900182. This is not a real payment. Receiver credits store complete
events; the last receipt must exactly equal the latest credited event. Duplicate
credit does not write or add value. Only the current matching FIFO head may be
acknowledged. Replaying a receipt cannot remove the next event.

A review-required event cannot be credited. Review commits an immutable archive
and typed waiting pointer **before** journal advance. A simulated receiver review
receipt is committed **before** the pointer transitions to acknowledged. Neither
pointer nor archive is cleared; the generic reconciliation latch remains set.
Only one archived review event is supported per case. A replay cannot advance a
different head. Archive, context, pointer, receipt and queue relationships are
validated at load and before each mutation. Missing, short, inconsistent or
checksum-invalid records block further mutation. There is no repair command.
These checks detect corruption, not adversarial edits: FNV checksums and public
fixture proof bytes are not authentication. No production HMAC, API, controller
journal adapter or real receiver protocol is exercised here.

All review/ack/unknown commands return `OK`, `ALREADY_DONE`, `REJECTED` or `BLOCKED`
with a reason. A commit/readback failure latches the current instance unhealthy.
Reboot validation may recognize an intact committed record after a lost response;
it never silently replaces malformed evidence. `MARK DISPENSE PENDING` only sets
a synthetic flag and blocks mutation; it never operates hardware.

## Write instrumentation and NVS limitations

`POINT <key>:before`, `<key>:after-api`, or `<key>:after-readback` selects an
explicit RAM-only pause. `CONTINUE` resumes a selected pause. Pauses are outside
the NVS API interval; they prove ordering, not interruption during flash programming.
`WRITE_BEGIN` includes operation number, case, key, size, checksum and microsecond
timestamp. `WRITE_END` reports set/commit errors. `READBACK` reports byte equality
and checksum. `NVS_INIT_OPEN_BEGIN/END` separately brackets initialization/open.

Serial output and `Serial.flush()` affect timing. A power cut after a BEGIN line
can still occur before programming begins. Classify a test as **during-write
unproven** unless independently correlated flash activity and supply loss prove
overlap. No GPIO marker, power-cut automation or raw hardware corruption command
has been added. Reboot/reset is not equivalent to supply removal.

Reviewed local Arduino ESP32 core 3.2.1:

* `initArduino()` calls default `nvs_flash_init()` before setup. On NO_FREE_PAGES or
  NEW_VERSION it has an automatic partition-erase branch. The verified table has
  no partition named `nvs`, so the expected result is NOT_FOUND, not that erase
  branch. Revalidate this assumption if the table/core changes. Sketch identity
  checks cannot precede this framework code.
* `Preferences.begin(...,"labstore")` calls `nvs_flash_init_partition`, even for
  read-only opens. NVS recovery metadata/page initialization may write. Consequently
  RESUME/open is **not** a physically read-only diagnostic operation.
* Explicit NVS writes and internal garbage collection can erase pages inside
  labstore. No app-level erase/format/clear/repair API is called. It would be false
  to promise that a storage-enabled NVS test never erases flash internally.
* The factory app/no OTA layout avoids normal pending-OTA confirmation. Missing
  coredump partition may emit an IDF startup error. No coredump partition is added.
* No Wi-Fi/BT initialization is called by this sketch. Framework/library inspection
  is not an RF measurement or proof of zero flash writes on every fault path.

## Automated validation and release gate

Run locally without hardware:

```text
node --test --experimental-test-isolation=none firmware/lab-durability/phase2/preparation.test.mjs firmware/lab-durability/inspect-partitions.test.mjs firmware/coin-review/validation/github-native-tests.test.mjs
```

These are real JavaScript source/partition/packaging/driver-contract tests, with
mocked compiler processes. Their passing status is **not** native runtime evidence.
`state.test.cpp` is separately syntax-checked with the installed Xtensa compiler.

In a separately approved network-isolated Linux test environment, the new driver
can compile and execute `state.test.cpp` normally and with ASan+UBSan:

```text
node firmware/lab-durability/phase2/native-tests.mjs REPOSITORY_ROOT NEW_SYNTHETIC_OUTPUT_DIRECTORY
```

The driver supplies a clean environment and has no network client, but does not
create a network namespace itself. Reuse the reviewed isolated CI wrapper only
after separate CI changes/authorization; no workflow has been edited or dispatched
for this task. Compiler/runner versions must be recorded. No production secrets,
artifacts, URLs or hardware should be supplied. Dependency closure: this directory,
unchanged CoinPaymentCore.h, CoinEventReviewCore.h and LabIdentity.h/partitions.csv
from the baseline source tree. No private files are required.

Native scenarios include initialization cuts, before/after-commit lost responses,
torn-record simulation at each storage call, duplicate credit, FIFO preservation,
acknowledgment replay, archive/pointer transitions, last-receipt mismatch, invalid
boolean representations, short records, corrupt checksums and repeated reboot.
The simulator replaces a blob atomically or with a truncated blob; it does **not**
model ESP-IDF NVS page algorithms, flash wear, actual brownouts or USB power.

Windows Application Control previously blocked unsigned native test execution.
Do not bypass it. The new native suite and its sanitizers remain **unexecuted**
until they run in an approved environment. Prior passing CI tests cover the old
portable cores, not this new engine. This is a **NO-GO for upload** until those new
tests pass and their results plus this candidate are reviewed. Compilation alone
does not establish physical durability or production readiness.

## Later physical plan — not authorized or executed

1. Reconfirm retired MAC, 4 MiB/table, private matching original backups, USB-only
   wiring, production controller/router off and no machine peripherals. FAIL if
   identity, isolation or baseline evidence differs. No production board writes.
2. After the release gate and **separate app-only upload approval**, verify image
   hash/range, upload only the candidate app and verify it. First boot must report
   `identity=1 layout=1 writes_compiled=1 open=0 healthy=0 schema=2`; no init markers
   may appear automatically. STOP on any mismatch or unexpected action.
3. Obtain **separate storage/test authorization**. Explicitly INIT a fresh case;
   require commit/readback success for intent, receiver, journal, final header.
   Partial init must refuse RESUME and preserve bytes, never format/repair.
4. ADD synthetic event, record its full ID, interrupt only at approved checkpoints,
   power back up and explicitly RESUME. PASS: committed event ID/owner/value intact,
   boot increases, receiver total stays zero. Uncommitted append may be absent;
   a corrupt record must instead block. Never call an absent uncommitted event lost
   accepted payment: there is no physical acceptor in this lab.
5. CREDIT HEAD twice, reboot, retry; PASS: exactly one credit and same last receipt.
   ACK HEAD then replay with a second queued event; PASS: second ID remains intact.
6. In a new case RETAIN twice; CREDIT must reject. REVIEW HEAD, reboot at each
   archive/pointer/journal boundary and RESUME. PASS: original archive retained,
   no synthetic payment credited, at most one original removed, second head intact.
   ACK REVIEW twice with cuts at receiver/pointer boundaries; PASS: one matching
   durable receipt, acknowledged pointer retained, no second-event removal.
7. Physical during-write interruption and corrupt-record testing require an
   independently reviewed measurement/injection fixture or additional lab-only
   instrumentation. Current Serial checkpoints do not prove this. Do not improvise
   shorts, supply glitches, raw flash writes or new corruption commands.
8. Repeat only a preapproved finite cycle budget. Preserve complete synthetic logs,
   case IDs, image/tool hashes, power evidence, observed cut timing and every failure.
   STOP for brownouts/unstable USB, heat, missing committed events, changed IDs,
   double credit, unexplained initialization/erase, NVS errors or abnormal activity.

Flash wear, garbage collection and physical supply behavior remain hardware gates.
The **next safest action** is review/authorize running the new native suite in the
approved isolated Linux CI environment. It requires no board connection. Passing
that gate still does not authorize an upload, storage commands or production recovery.
