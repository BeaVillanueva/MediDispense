# Isolated ESP32 durability lab — current repurposing decision

**17 November 2026 update:** the owner now accepts destructive repurposing of retired
`20799D470968` / ROM MAC `68:09:47:9D:79:20` as a permanent isolated lab board.
This supersedes the earlier requirement to buy a different spare. It authorizes
preparation ONLY: no upload, erase, boot, test writes or physical tests have been
authorized/executed. Installed `2C8C6AF3AF48` remains unconditionally blocked.

The current authoritative procedure, byte-order proof, reviewed image manifests,
erase/write ranges and remaining gates are in
[retired-esp32-approved-lab-repurpose.md](retired-esp32-approved-lab-repurpose.md).
The lab guard now has a separate exact-retired-board opt-in, default OFF; its
prepared review configuration has storage OFF. Old temporary images are obsolete.
No private backup was accessed for this update.

---

# Archived dedicated-new-board-only plan — superseded target decision

Everything below records the previous protection decision and software evidence.
Its prohibition on retired-board repurposing is historical; it must not be used
as a current upload recipe. Its preservation, isolation and physical-evidence
limitations still apply. Use the authoritative current procedure linked above.

Prepared 17 November 2026. **NOT CLEARED FOR HARDWARE EXECUTION.** No board was
connected, powered, read, reset, uploaded or erased. No live database/Firebase
connection, event review, stock change or kiosk reopening was performed.

**PROTECTED: installed `2C8C6AF3AF48` AND retired evidence board `20799D470968`.**
Neither board may receive firmware uploads, erases, NVS writes, test initialization
or power-loss experiments under this plan. Keep both disconnected. The proposed
physical tests require a separate dedicated test ESP32. Backup preservation does
not authorize overwriting the retired board. Older candidate binaries targeting
the retired board are superseded and must not be uploaded.

Operator reports two independent matching SHA-256 full 4 MiB backups of the retired
controller. The private images have not been requested or inspected here. Hashes
confirm repeatable reads, not partition correctness, decryption or restorability.

## Findings and preservation gates

- Both existing boards remain off limits; retirement is not credential revocation
  or permission to flash. No dedicated test-board identity has been verified yet.
- `esp32/CAPSTONE_MEDICINE_VENDO/ReliableCoinPayment.h` opens `md-coins`, validates
  `journal-v2`, and only considers legacy `journal` when v2 is absent. It preserves
  corrupt records rather than resetting/falling back. Boot-counter persistence
  changes flash even without a coin. Never boot that application for inspection.
- `CoinPaymentCore.h` implements actual FIFO, stable event IDs, durable-append/ack
  callbacks, boot/checksum validation and interrupted session binding. Lab builds
  copy it unchanged, along with `firmware/coin-review/CoinEventReviewCore.h`.
- The production adapter uses Preferences write + exact length/readback + validity
  and byte comparison. The review adapter persists immutable archive then pending
  pointer before advancing the reviewed queue head. Acknowledgment cannot invent a
  payment, trigger dispensing or clear the generic reconciliation latch.
- `firmware/coin-review/CoinEventReview.h` includes production HTTP/Wi-Fi/HMAC
  integration. It is deliberately NOT copied into this offline lab. The existing
  `prepare-candidate.ps1` copies private production settings and makes a dummy-key
  build: **do not use or flash that output for this lab.**
- Original partition geometry is now supplied by the owner's successful offline
  inspector run, recorded below. Encryption/eFuse security settings, actual
  journal/SPIFFS/coredump contents and restorability remain unverified here.
- Controller IDs are formatted by the firmware from `ESP.getEfuseMac()`, not by
  simply deleting colons from esptool's MAC output. Verify the identity mapping
  using that same representation; do not assume the earlier colon-form example
  established it. This candidate uses the exact existing firmware representation.

### Important Arduino pre-sketch behavior

The installed Arduino ESP32 core 3.2.1 `cores/esp32/esp32-hal-misc.c` initializes
default NVS **before setup()**. On NO_FREE_PAGES or NEW_VERSION errors it can erase
the first NVS partition. A sketch-level board check cannot prevent that startup
path if the wrong partition table/old firmware is booted. Preferences also calls
`nvs_flash_init_partition()` before opening a named partition, even in read-only
mode; NVS's own recovery may update test flash. A read-only handle does not prove
bitwise non-modification during initialization. Preserve raw evidence before boot.

The proposed lab table contains ONLY `labapp` and `labstore`, with no label `nvs`.
For this reviewed core, default NVS init should return NOT_FOUND without the
erase branch. Exact table verification and framework review remain required
before first boot; this has not been physically demonstrated. No lab code calls
an erase, remove, clear, default-NVS or legacy-migration API.

## Verified original geometry and confirmed evidence overlaps

Source: operator-supplied offline inspector result; no private backup was accessed
or copied for this review. Image size 4,194,304 bytes, table at `0x8000`, table MD5
verified by that run. Reported image SHA-256:
`6f581a554f9c441017a11de23dcf9a043030fa80c20b52767aca87adcf525602`.
Ranges below use exclusive ends.

| Original partition | Offset | Size | End |
|---|---:|---:|---:|
| nvs | 0x9000 | 0x5000 | 0xE000 |
| otadata | 0xE000 | 0x2000 | 0x10000 |
| app0 | 0x10000 | 0x140000 | 0x150000 |
| app1 | 0x150000 | 0x140000 | 0x290000 |
| spiffs | 0x290000 | 0x160000 | 0x3F0000 |
| coredump | 0x3F0000 | 0x10000 | 0x400000 |

Original partitions cover `0x9000` through end of flash. No verified free partition
exists. Unused-looking application/filesystem bytes may contain evidence.

## Proposed layout: dedicated test board only

`firmware/lab-durability/MediDispenseDurabilityLab/partitions.csv`:

| Region | Proposed offset | Size | Meaning/risk |
|---|---:|---:|---|
| Bootloader | 0x1000 in reviewed Arduino recipe | actual compiled image + sector rounding | Would overwrite old loader |
| Partition-table sector | 0x8000 | 0x1000 sector | Would replace original map |
| Arduino auxiliary boot image | 0xE000 in reviewed recipe | 0x2000 for reviewed artifact | Would overwrite all original otadata |
| labapp | 0x10000 | 0x1F0000 reserved | Reserved range overlaps app0 and app1 |
| labstore | 0x3E0000 | 0x20000 | Overlaps last 64 KiB of spiffs and ALL coredump |

These are compile-review choices for a 4 MiB chip, **not verified free space**.
Unallocated bytes may still contain evidence. A separate namespace alone does not
protect other data in the same physical partition. This candidate requires a
separate partition and exact table; it is not designed to run on the original map.

Historical storage-enabled artifact reviewed on 17 November: bootloader 24,928
bytes, table 3,072 bytes, auxiliary image 8,192 bytes, application 317,760 bytes.
Standard upload would affect erase sectors `0x1000–0x8000`, `0x8000–0x9000`,
`0xE000–0x10000`, and `0x10000–0x5E000` respectively. That application artifact
only physically writes a prefix of app0, despite the reserved labapp range also
overlapping app1. Actual test NVS writes can affect the labstore range over time.
These are historical sizes, NOT an upload manifest for a rebuilt candidate.
Recalculate affected ranges for every later reviewed artifact.

Original nvs is outside those standard upload ranges, but this does not make the
operation non-destructive: other evidence is overwritten, mappings change and
framework/old-application boot can write NVS. Restore-from-backup is another write,
not proof that the board remained unchanged. No destructive repurposing of the
retired board is proposed or authorized now.

Compile output may include a 4 MiB `*.merged.bin`. **Do not upload that file**:
it could replace evidence across the entire flash. No upload command is supplied.
Erasure occurs at sector granularity during flashing; not selecting erase-all
does not prevent overwriting original data. Any repartitioning, application,
bootloader or auxiliary writes require explicit byte-range approval. Flash eFuses
are not in the backup; security restrictions must never be bypassed.

### Offline metadata assessment, without sharing the backup

The operator already ran the local reader and supplied metadata. No repeat access
to the private backups is needed for this task. For reference only:

```
node firmware/lab-durability/inspect-partitions.mjs PRIVATE_FULL_BACKUP.bin
```

It opens no serial/network connection and writes no files. It checks full 4 MiB
length, scans sector-aligned candidate tables, verifies the partition-table MD5,
validates ranges/overlap and prints partition metadata, image hash and proposed
overlaps only. It does not dump keys, NVS or firmware contents. Missing/ambiguous
checksum-valid maps and legacy/no-MD5 maps fail closed. It is NOT an encryption or
eFuse inspector and does not prove the bootloader's active table. The metadata is
still private.
This reader is a review aid, not an authoritative flashing plan. A technician
must corroborate the table using the original build/bootloader and inspect the
actual proposed upload file/offset list. Do not provide the private backup here.

**Retired-board partition gate: BLOCKED by CONFIRMED overlap.** Metadata review is
complete for the supplied geometry; the block is no longer an unknown-offset
question. A genuinely unchanged-retired-flash NVS write/power-loss test is not
supported. Keep the matching private backups/offline copy, protect the board and
use a separate test board.

## Candidate implementation and commands

`firmware/lab-durability/MediDispenseDurabilityLab/` is a standalone sketch. It
never initializes Wi-Fi/Bluetooth and has no network client, GPIO writes, motors,
coin input, Firebase, API URL, password or review key. It accepts synthetic inputs
over Serial only. Software cannot detect physical wiring/RF isolation; operator
confirmation and independent isolation checks are required, not simulated.

`prepare-lab.mjs` copies only the sketch, table and two portable cores into a new
workspace `tmp/` folder, recording source SHA-256. It never reads production
configuration or private backups, invokes a compiler or uploads anything.

`MEDIDISPENSE_LAB_STORAGE_APPROVED` defaults to **0**. The review build refuses all
case opening/seeding. A later separately approved lab build can set it to 1. That
compile option does not grant hardware authorization. `LabIdentity.h` defaults
`MEDIDISPENSE_LAB_BOARD_ID` to an empty value, so NO board is allowed. It explicitly
rejects both protected IDs even if one is configured. Only one separately verified
dedicated ID, 4 MiB flash and the exact two-entry layout can permit a case to open.
No fault allows falling back to another partition or initializing a corrupt case.

### Dedicated-test-board plan and future identity adaptation

1. Obtain a dedicated classic ESP32 development board compatible with target
   `esp32:esp32:esp32`, 4 MiB SPI NOR flash, and USB/UART access. ESP32-S2/S3/C3 are
   not interchangeable with this compiled classic ESP32 image. Record chip/module
   revision and flash part; unexplained differences require review of test coverage.
2. Verify ownership and that it holds no production/customer evidence or credentials.
   An independently erased spare is safer for preservation than either existing
   board. No erase is authorized by this plan, including on a newly obtained board.
3. Obtain separate approval for identity-only connection in ROM mode, under network
   isolation with no machine harness attached. Record actual COM port, chip type,
   flash capacity and firmware-format device ID. Never guess the first serial port.
4. After identity verification and review, configure exactly that canonical 12-digit
   uppercase ID in the lab build via `MEDIDISPENSE_LAB_BOARD_ID`. Do not spoof the
   installed or retired ID, remove the protected-ID deny checks, add a wildcard,
   or allow all boards. The current build has no configured test ID.
5. Rebuild from the reviewed sources with storage still disabled, record manifest
   and image hashes, review startup and actual upload ranges, then seek explicit
   test-board-only upload/initialization approval. Pre-flash identity verification
   is mandatory: software cannot undo flashing the wrong physical board.
6. Before later enabled-build tests, establish physical isolation, no radio/network
   credentials or backend route, safe current-limited power cuts and protection
   against USB back-power/DTR resets. Keep both protected boards disconnected.
7. First verify the locked image refuses case operations; only a separately approved
   enabled lab build and exact verified ID/layout may initialize synthetic cases.
   All physical results remain unexecuted until performed and independently reviewed.

In a separately approved enabled build, commands are:

| Command | Synthetic operation |
|---|---|
| STATUS | RAM status, IDs, queue, receiver count and fault summary |
| INIT ISOLATED c01 | Creates a new `lab-c01` case only; cannot reseed existing known records |
| RESUME ISOLATED c01 | Loads existing validated case; no initialization on missing/corrupt record; boot counter persists |
| INSPECT ISOLATED c01 | Before opening a case, prints test blobs as hex; NVS initialization caveat above applies |
| ADD / RETAIN | Append one synthetic 5-pulse event, respectively normal/review-required |
| CREDIT HEAD | Simulated receiver durable ledger, idempotent by event ID; no actual money |
| ACK HEAD | Matching persisted receipt can advance only the actual FIFO head |
| REPLAY RECEIPT | Replays saved receipt; must not consume a different/new head |
| REVIEW HEAD | Applies synthetic local approval through actual review core; immutable archive first; stays blocked |
| ACK REVIEW | Synthetic durable receipt then pending-pointer reset; original archive retained |
| MARK DISPENSE PENDING | Persistent simulated interrupted operation; further coin operations blocked; no motor command exists |
| CORRUPT LAB JOURNAL | Explicit fault injection in this test case only; next resume must refuse; no repair command |
| POINT checkpoint / CONTINUE | Pause at a specific boundary; cut supply under the approved procedure or continue |

Checkpoints: `receiver:before/after`, `journal-v2:before/after`,
`archive:before/after`, `pointer:before/after`, `receipt:committed`,
`ack:committed`, `pointer-reset:before/after`. Selecting a point is RAM-only; after
power loss select it again if needed. During a real flash write, use instrumented
timing/randomized cuts, not a claim that a paused-before/after cut interrupted NVS.

No software reboot command is supplied. Each case needs a new board power session
to change case; there is no namespace-clearing shortcut. Bounded ledger supports
eight unique synthetic credits and queue sixteen events; capacity refusal is a
safe block. One reviewed event per case keeps archived evidence immutable.

### Limits of the test model

The real core algorithms run unchanged and real Preferences storage is exercised,
with production-equivalent readback and archive/pointer order. Adapter code is
lab-specific, not the complete production firmware. The fixture receiver is on
the board, not MySQL; it tests ordering/idempotency, not independent server crash
recovery. Proof bytes are public synthetic placeholders, not a live HMAC decision.
Signed HTTP, expiration, Super Admin permissions and network retry behavior still
require isolated backend integration tests. The dispense-pending marker verifies
only refusal to replay a synthetic interrupted operation, not real motor/IR logic.
Physical GPIO4 pulse timing and FreeRTOS capture are not tested by Serial ADD.
Passing this candidate therefore cannot alone clear production deployment.

## Hardware execution procedure — instructions only, gated

1. Preserve both existing matching backups and original geometry privately. Do not
   reopen/copy backups or touch the protected boards for these tests. Verify the
   separate test-board identity using the actual firmware representation.
2. Approve ONLY the dedicated test board, exact upload ranges, laboratory build/hash,
   test-only initialization, power setup and operator. This does not authorize
   repurposing the retired board. No board is currently approved for upload.
3. Technician establishes RF isolation BEFORE power, disconnects the entire
   machine harness and verifies no motor/acceptor/production USB board is attached.
   Use only the verified dedicated board. No VPN, lab production route or shared
   credentials. Both existing controllers stay disconnected and untouched.
4. Review the sanitized build and dedicated-board flash map. If the selected board
   contains unverified evidence or has a protected ID, STOP. After separate upload
   approval, use ROM download mode; preserve eFuses, no erase-all and no merged
   image. This document does not give permission or an executable upload recipe.
5. First lab boot: PASS only if board/layout match, no application network activity
   exists, and storage-disabled build cannot initialize cases. Empty or wrong ID/layout
   must block; software checks cannot undo a wrong-board flash, so physical identity
   verification remains mandatory BEFORE upload.
6. With enabled-build approval, use new synthetic cases, no live data. Capture
   status, raw fixture blobs, queue IDs, checksums, receiver counts and selected
   checkpoint before/after each interruption. Preserve immutable logs privately.
7. Technician uses current-limited safe low-voltage supply; UART/USB must not
   back-power the board or reset via DTR/RTS unexpectedly. Verify actual 3.3 V
   supply collapse with appropriate measurement. Reset/EN is not a power-cut test.
8. Complete the matrix below and the full H01–H16 procedure in the existing local
   `coin-review-spare-power-loss.md` review document. Repeat deterministic cuts
   at least ten times and actual-write randomized cuts at least twenty times per
   applicable case, preserving every failure. Counts do not prove exhaustive safety.
9. STOP on corruption/ambiguity, missing evidence or duplicate credit. Do not clear
   a case to turn failure into PASS. Independent reviewer signs results; leave
   board isolated afterward. No production recovery follows automatically.

| Case | Sequence | PASS criterion |
|---|---|---|
| Durable event | INIT new case; ADD; STATUS; power loss; RESUME same case | Same full ID/amount/owner survives |
| Before receipt | ADD; CREDIT HEAD paused at receipt:committed; cut; RESUME; retry CREDIT HEAD | One credit; queue retains event until matching ack |
| During append | Cut at/between journal persistence boundaries, including actual write | Old valid queue or new valid queue; invalid record blocks, never healthy empty repair |
| Pending boot | Cut with one/multiple events; repeatedly resume | Same ordering/IDs; boot counter changes without reassigning events |
| Duplicate receipt | CREDIT HEAD; ACK HEAD; ADD next; REPLAY RECEIPT | No extra credit; new event not popped |
| Repeated recovery | Repeat boot/retry across receiver/journal boundaries | Stable evidence, bounded one credit per ID |
| Corrupt journal | CORRUPT LAB JOURNAL; cut; RESUME | Refuses corrupted case; no initialization, legacy fallback or automatic repair |
| Exact-event review | RETAIN; REVIEW HEAD with cuts at archive/pointer/journal; resume/retry | Archive before advance; original evidence survives; unrelated events stay |
| Lost review receipt | Cut at ack:committed/pointer-reset; resume; ACK REVIEW twice | Same durable receipt; archive remains; zero payment credit; latch remains set |
| Interrupted dispense | MARK DISPENSE PENDING; cut; RESUME; try ADD/CREDIT/REVIEW | Marker survives; operations blocked; no simulated completion or motor actuation |

If a cut occurs before an ADD becomes durable, the earlier queue may legitimately
remain. Serial input is not an accepted physical coin. This does not prove that
the real acceptor's in-flight pulses survive a sudden total supply loss; that is
a separate capture/hardware limitation and must never be called zero coin loss.

## Validation evidence and live recovery gates

Historical software-only results from the initial candidate (before the
dedicated-board guard update; current results are recorded further below):

| Check | Actual result |
|---|---|
| Previous retired-target default-locked sketch, core 3.2.1 | Historical compile PASS; 301,874 bytes code; SUPERSEDED, DO NOT UPLOAD |
| Previous retired-target enabled paths, compile-only | Historical compile PASS; 317,622 bytes code; SUPERSEDED, DO NOT UPLOAD |
| Offline partition reader/geometry/isolation guards | 8 tests PASS, synthetic images only |
| Existing CI driver mocks | 4 tests PASS; not native execution |
| Existing API/UI mocks and PHP signature interoperability | 10 tests PASS, no live configuration/DB/keys |
| Generated partition binary and copied-source verification | PASS; exact two-entry proposed table and unchanged core source copies |
| Node syntax / PHP vector-file lint | PASS |
| New local native or sanitizer execution | NOT EXECUTED; Windows security restriction unchanged |
| GitHub four native configurations | Operator reports PASS for earlier reviewed cores; not new lab-adapter hardware evidence |
| DB-backed recovery fixtures | NOT RUN; isolated test database not verified for this preparation |
| Original partition metadata | Operator supplied successful offline inspection; overlap confirmed; private backup not accessed here |
| Physical NVS/power-loss | NOT EXECUTED / BLOCKED; separate board and execution approval required |

Historical build files are ignored under `tmp/lab-durability-review-v2/`. No compile artifact
is approved for upload. Neither compile command included a port or upload action.
Initial sandbox compiler-helper extraction and Vitest spawning were denied; the
same compile-only/mock commands succeeded with scoped execution approval. No
Windows security policy or native executable trust protection was disabled.

Software results are recorded separately from hardware. Native/sanitizer passes
reported from GitHub apply only to their exact tested commit/cores, not this new
Arduino adapter or the physical flash. Local native execution remains restricted
by Windows Application Control; no bypass attempted.

Pure PHP/Node wire-signature and API/UI mocks can run without any production
connection. DB-backed recovery fixtures currently connect through application
configuration before creating temporary tables: do NOT run them against production
for this task. A separately verified isolated database is required first.

No new production query or recovery action was performed for this preparation.
Last known blockers remain retained event `...00000002`, controller fault/stale
diagnostics, unverified Firebase retirement and pending reopening approval.
Transaction #182/request #96, its failed/not-dispensed outcome, recorded payment,
confirmed refund and stock must remain untouched. The exact-event candidate is
still disabled; this lab does not install its migration or keys.

**First next step:** obtain/identify a separate compatible test board and review
the dedicated-board plan. Keep both existing controllers disconnected. Do not
send private images/credentials or access the preserved backups again for this
task. Identity connection, allowlist configuration, upload and test writes each
need their stated approval/verification gates.

Software-only validation scope: identity compile-time assertions, synthetic
partition/source guards, existing CI-driver mocks and pure PHP/Node signature/API
mocks; compile locked and enabled test paths without any port/upload operation.
Native/sanitizer suites can be rerun only in an approved environment for the exact
reviewed sources. Full signed backend integration requires a verified isolated
fixture server/database; no production config is suitable. Adapter fault tests
for partial NVS reads/writes, pointer corruption, independent receiver restart,
expiry/replayed signatures and failed acknowledgments remain additional coverage,
not passes inferred from this on-board synthetic receiver.

### Dedicated-board update validation, 17 November

- Ten synthetic partition/source/identity tests passed, including a generated
  six-partition image reproducing the reported app0/app1/SPIFFS/coredump overlaps.
  No preserved flash image was accessed.
- Four existing CI-driver mock tests and ten existing API/UI/protocol mock tests
  passed: **24 executed software tests total**. Native binaries were not executed.
- The dedicated default-locked candidate compiled under Arduino ESP32 core 3.2.1:
  302,058 bytes code, 20,784 bytes globals. Eight identity static assertions passed
  during compilation, including matching synthetic ID and protected-ID rejection.
- Copied-source manifests and generated two-entry partition binary matched the
  reviewed sources/layout. Node syntax checks passed. No dedicated ID is configured.
- Storage-enabled-path compile also passed: 317,806 bytes code, 23,160 bytes globals.
  No board ID is configured in either build. Compilation is not evidence of safe
  boot, physical write durability or permission to upload. Old retired-target
  artifacts are not current release candidates.
- All physical cases remain NOT EXECUTED. New native/sanitizer runs remain blocked
  locally; previous GitHub passes apply to their own reviewed code. DB-backed
  fixture execution remains blocked until an isolated database is verified.

### Remaining gates (all required; no automatic release)

1. Separate compatible board obtained and identified; neither protected controller
   may be substituted. Ownership/history, chip/flash type and isolation verified.
2. Separately approved identity connection and canonical ID mapping, then reviewed
   single-ID configuration; no wildcard or protected-ID override.
3. Actual dedicated-board flash/security assessment, reviewed image and affected
   ranges, pre-boot framework behavior, no production credentials/route, and explicit
   board-only upload/test-write authorization. No erase authorization is implied.
4. Real power-cut equipment/back-power protection, protocol fixture/instrumentation
   gaps resolved, H01–H16 evidence and independent review completed. Lab-only adapter
   passes must not substitute for real signed protocol and actual persistence tests.
5. Only afterward: separately approved production recovery implementation/deployment,
   exact-event evidence/ack, generic fault resolution, fresh controller diagnostics,
   Firebase retirement verification and explicit Super Admin reopening approval.

Before production recovery: pass reviewed native, physical durability AND signed
backend integration tests; resolve any discrepancy between lab and real adapter;
review the generic fault-resolution workflow (review ack intentionally leaves the
reconciliation latch set); separately approve evidence-preserving installed-board
firmware deployment and additive backend migration/key provisioning; obtain fresh
authenticated diagnostics and verify Firebase command retirement; perform explicit
Super Admin exact-event reconciliation with durable ack and unchanged payment;
resolve remaining genuine faults; separately authorize reopening and one supervised
end-to-end purchase. Neither flash backup nor any lab PASS grants these approvals.

References: [Espressif NVS initialization](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/storage/nvs_flash.html)
and [ROM boot mode](https://docs.espressif.com/projects/esptool/en/latest/esp32/advanced-topics/boot-mode-selection.html).
