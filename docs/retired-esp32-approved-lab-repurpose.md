> **19 November 2026 — SUPERSEDED: board returned to vending service.** On owner
> instruction, `20799D470968` (ROM MAC `68:09:47:9D:79:20`) was fully erased
> (`esptool erase-flash`) and flashed with the production
> `CAPSTONE_MEDICINE_VENDO` firmware. It is now the active vending controller;
> owner confirmed `2C8C6AF3AF48` is removed/powered off. The lab repurpose plan
> below no longer applies to this board. Original flash contents survive only in
> the two private backups (SHA-256 `6f581a55...`).

# Retired ESP32 permanent lab repurposing — review only

17 November 2026. **Eligible for a later separately authorized lab upload, NOT
authorized for hardware execution now.** Owner acceptance of destructive reuse
is recorded; no physical board, private backup, production service or record was
accessed/changed. No upload, erase, reset, first boot or physical test was performed.

## Exact target and byte order

- Only proposed lab board: ESP32-D0WD-V3 revision 3.1, 4 MiB flash.
- Physically verified ROM MAC supplied by owner: `68:09:47:9D:79:20`.
- Its historical firmware ID is `20799D470968`.
- Production controller `2C8C6AF3AF48` is always denied, including under lab opt-in.
- Retired board is permanently removed from vending service. No production registry
  change or transfer of the production controller's unresolved event is proposed.

Arduino ESP32 core 3.2.1 `Esp.cpp` initializes a zero uint64 and calls
`esp_efuse_mac_get_default((uint8_t*)&value)`. On this little-endian ESP32 the ROM
bytes `68 09 47 9D 79 20` pack to numeric `0x20799D470968`. There is no identity
conflict. Simply deleting colons produces `6809479D7920`, which is NOT this
firmware's ID. The earlier colon-form assumption must not be used for targeting.
`LabIdentity.h` now proves the conversion with constexpr/static assertions. The
sketch reads ROM bytes directly and checks its packed value against Arduino's
`ESP.getEfuseMac()` before admitting a test case. This is source-level verification
of the owner's supplied identity, not a new hardware attestation.

## Lab guard and configuration

Generic defaults remain no board configured, retired opt-in OFF, storage OFF.
Installed production ID is unconditionally denied for both actual/configured IDs.
Matching the retired ID additionally requires
`MEDIDISPENSE_LAB_RETIRED_REPURPOSE_APPROVED == 1`. Wrong/malformed IDs fail closed.

`LabRetiredReviewConfig.h` configures ONLY `20799D470968`, explicit retired opt-in
1, and `MEDIDISPENSE_LAB_STORAGE_APPROVED 0`. Preparation can copy it as temporary
`LabBuildConfig.h` using `prepare-lab.mjs TARGET --retired-review`. It does not
execute hardware tools. Storage OFF is mandatory for the first-boot review image.
A separately authorized later storage-enabled test build requires changing only
the copied LAB config to 1 and rebuilding/reviewing its hashes. Do not edit the
production sketch, relax the production deny check or treat a compile flag as
physical authorization. Sketch checks cannot undo flashing the wrong board.

## Isolation and implementation boundaries

Candidate contains Arduino, Preferences, partition/eFuse APIs and two unchanged
portable safety cores. No Wi-Fi/Bluetooth startup, HTTP/Firebase client, production
URL, password/key, real payment endpoint, motor GPIO, coin GPIO or live dispensing
code is included. Serial ADD/RETAIN, receiver credit, review/ack and interrupted
dispense markers are explicitly synthetic. No production journals are loaded.

It opens only explicit `labstore` and case namespaces. New cases never replace a
known case. Corruption blocks without a reset/migration/erase API. Production-
equivalent readback/archive ordering uses real Preferences but lab-specific
adapters; local receipt/proof fixtures are not production HMAC/MySQL integration.
The simulated dispense marker tests refusal to replay, not real motors/sensors.

Physical isolation cannot be established by an ARM command. A technician must
disconnect every vending harness, driver, sensor/acceptor and external supply;
isolate from all saved production networks BEFORE powering old firmware; keep
installed controller disconnected. USB power is not itself RF isolation. Do not
unretire the old registration or allow old firmware to reconnect to production.

## Preserved evidence and proposed destructive regions

Owner reports two independent matching complete 4 MiB backups. They were not
opened/copied here. Owner-supplied SHA-256:
`6f581a554f9c441017a11de23dcf9a043030fa80c20b52767aca87adcf525602`.
Original table at 0x8000 has verified MD5 per the offline report. Exclusive ends:

| Original | Start | Size | End |
|---|---:|---:|---:|
| nvs | 0x9000 | 0x5000 | 0xE000 |
| otadata | 0xE000 | 0x2000 | 0x10000 |
| app0 | 0x10000 | 0x140000 | 0x150000 |
| app1 | 0x150000 | 0x140000 | 0x290000 |
| spiffs | 0x290000 | 0x160000 | 0x3F0000 |
| coredump | 0x3F0000 | 0x10000 | 0x400000 |

For later explicit approval, the recommended **lab provisioning plan** is a full
retired-chip erase `[0,0x400000)` followed by the reviewed standalone lab images.
This intentionally removes old code/credentials, app1, journals, OTA/SPIFFS/dumps
from the physical LAB board; original evidence survives only in the private
backups. It avoids booting old apps and does not pretend to be non-destructive.
Erase is a proposed separately authorized operation, NOT performed or authorized
for execution here. No eFuse writes are allowed. If backup retention/identity or
destructive-range consent cannot be reconfirmed by the operator, STOP.

Proposed upload files from one immutable reviewed build:

| Address | File | Write/erase scope |
|---|---|---|
| 0x1000 | `MediDispenseDurabilityLab.ino.bootloader.bin` | Actual file length, rounded to 4 KiB sectors |
| 0x8000 | `MediDispenseDurabilityLab.ino.partitions.bin` | 3,072-byte table, one 4 KiB sector |
| 0xE000 | reviewed Arduino 3.2.1 `boot_app0.bin`, copied as `boot_app0.bin` | 8,192 bytes, original OTA region |
| 0x10000 | `MediDispenseDurabilityLab.ino.bin` | Actual file length, rounded to 4 KiB sectors |

`boot_app0` is the Arduino recipe's auxiliary image, not production OTA data; the
factory lab application does not rely on OTA. Do not mix artifacts or use the
4 MiB merged binary. Future file lengths/hashes and sector ends must be recalculated
and approved, never inferred from old compile results. Even after full erase,
write-flash performs sector erasure as part of writing. No `--force`, encryption,
secure-boot bypass, production restore or eFuse commands are permitted.

New table contains only `labapp` factory at 0x10000 size 0x1F0000, and `labstore`
NVS at 0x3E0000 size 0x20000. It has no default `nvs`. These regions deliberately
replace the old map. Test NVS may later write/erase pages within all of labstore.

### Concrete review build (not approved for execution)

Prepared source: `tmp/lab-retired-repurpose-review-v4/MediDispenseDurabilityLab`.
Four separate review images and a hash/range/source manifest are in
`tmp/lab-retired-repurpose-review-v4/review-images/review-manifest.json`.
No private backup or original firmware configuration was copied into this package.

| File | Bytes | Actual end (exclusive) | Erase-sector end (exclusive) | SHA-256 |
|---|---:|---:|---:|---|
| bootloader.bin (full filename above) | 24928 | 0x7160 | 0x8000 | a284abdd0e4339f9ae18030953606a21d9d2f86d41d78ac46d606226f03ba939 |
| partitions.bin (full filename above) | 3072 | 0x8C00 | 0x9000 | 71be7f8bb937e18dbb1f5d1b25015229e9bc76b8c8b59562f1329057b3396a6a |
| boot_app0.bin | 8192 | 0x10000 | 0x10000 | f94c5d786a7a8fab06ac5d10e33bf37711a6697636dc037559ea19cc410a17f0 |
| application .ino.bin | 302352 | 0x59D10 | 0x5A000 | 8a3307e07a5f89ba2871481f6a7f13f318e778b570d073670b3d023fcefe40a4 |

Rows begin at 0x1000, 0x8000, 0xE000, 0x10000 respectively. The prior full-range
erase plan would affect ALL 4 MiB, regardless of these narrower write ranges.
Any rebuild invalidates the image-specific approval/hash assessment until reviewed.

Compile-only PASS on core 3.2.1: 302,210 bytes code and 20,784 bytes globals. Twelve
identity/byte-order static assertions passed. Fifteen synthetic/source/CI-driver
tests and ten existing pure PHP/Node signature/API/UI mocks passed (25 tests).
Source manifests and generated partition binary were checked against the reviewed
sources/exact map. No new native/sanitizer run or physical durability run occurred.
The four prior native/sanitizer passes are owner-reported for their reviewed code.

## Framework and first boot

Core 3.2.1 initializes default NVS before setup. Its NO_FREE_PAGES/NEW_VERSION path
can erase the first NVS partition. With the exact proposed table, missing default
`nvs` should return NOT_FOUND without entering that branch; this expectation still
needs bench verification. A wrong table/core invalidates this reasoning. Startup
before identity checks is why verified pre-flash targeting matters.

The proposed full erase makes labstore blank. Storage-OFF setup never opens or
seeds it, and never connects radios. The expected default-NVS NOT_FOUND log is not
permission to initialize/repair storage. First-boot PASS requires exact identity,
layout=true, writes_compiled=0, open=0 and no production/network/motor behavior.
Do not repeatedly reset a failing build to get a pass. In a later approved enabled
build, explicit INIT ISOLATED creates only a synthetic case. NVS initialization,
garbage collection and writes are destructive to the LAB region by design.

## Windows sequence — DO NOT EXECUTE before separate hardware authorization

1. Review source and evidence-retention records. Keep both backups private/offline;
   do not send them, copy them into this repo or read them for this procedure.
2. Compile using approved Arduino CLI/core 3.2.1 in a new temporary source directory.
   Review `source-manifest.json`; only explicit lab files and the two portable
   cores may be copied. Record tool versions and use an approved esptool v5.x for
   the hyphenated commands below. Do not upgrade/bypass Windows security silently.
3. After compile, freeze the four separate images, their lengths, hashes and rounded
   write ranges. Confirm the generated table matches exactly and no private config
   or production dependencies appear. Full erase + those four ranges require
   explicit retired-board-only upload authorization, identifying COM and build SHA.
4. After that authorization, technician establishes RF isolation, verifies no
   vending wires/power are connected and enters ROM download mode from unpowered
   state. Keep BOOT held during ROM operations to avoid old app startup. Do not
   select a port by guessing or use Arduino's generic Upload button.
5. With verified esptool/COM variables, read ONLY identity/flash/security information
   first. MAC must be 68:09:47:9D:79:20, chip D0WD-V3 revision 3.1, capacity 4 MiB.
   Any mismatch/uncertain isolation/security restriction means STOP. Do not use
   force options or change eFuses. Classic ESP32 ROM does not implement the newer
   get-security-info command. An approved technician must establish flash encryption,
   secure-boot and download restrictions by a reviewed read-only security-field
   procedure for this exact chip/tool version, without dumping keys. That procedure
   is a remaining pre-upload gate; do not infer unencrypted from backup readability
   or treat an unsupported command as a disabled security feature.
6. ONLY under the separate destructive authorization, perform planned erase and
   write of the four images. Check each exit code, compare readback verification
   against the immutable images and keep the board in ROM (`--after no-reset`).
   This preparation has not run those operations.
7. Disconnect USB while BOOT is held. A separate controlled first-boot approval
   permits reconnecting only the LAB board in isolated normal boot; record STATUS.
   No coin/motor harness, production network or backend is ever attached.
8. After first-boot review, obtain approval for a reviewed storage-enabled LAB build
   and test writes. Preserve that build's manifest/hashes. Reflashing its application
   must not automatically erase the whole chip again or destroy prior test-case
   evidence. Approve its exact ranges separately; never reuse provisioning erase
   as a reset between cases.
9. Execute the matrix in the existing lab procedure with new synthetic cases and
   real measured supply loss, retaining all failures. Windows serial DTR/RTS/USB
   back-power must not invalidate a cut. No test implicitly unlocks production.

### Command templates for review (not executed)

Paths/COM below are placeholders that MUST be supplied from the approved run plan.
No commands below access the private backups or production services. Variables
are PowerShell syntax, suitable for a Windows PowerShell window, not raw CMD.

```powershell
$tool = 'C:\APPROVED_TOOLS\esptool.exe' # verified v5.x
$port = 'COM_REPLACE'                    # actual LAB port only
$images = 'C:\APPROVED_LAB_IMAGES'       # frozen, reviewed four-file package
$base = @('--chip','esp32','--port',$port,'--baud','115200',
          '--before','no-reset','--after','no-reset','--no-stub')

# After identity-only connection approval:
& $tool @base read-mac
if ($LASTEXITCODE -ne 0) { throw 'Identity read failed: STOP.' }
& $tool @base flash-id
if ($LASTEXITCODE -ne 0) { throw 'Flash identification failed: STOP.' }
# Classic ESP32: security flags must be checked separately by an approved read-only
# method. get-security-info is not a substitute on this chip. No key dump/burn.

# STOP HERE until exact output, targeting and destructive operations are approved.
# The following commands intentionally destroy ONLY the verified retired chip.
# ROM supports region erasure; erase-flash bulk command may require a RAM stub.
# Explicitly target the entire VERIFIED 4 MiB region, keeping --no-stub.
& $tool @base erase-region 0x0 0x400000
if ($LASTEXITCODE -ne 0) { throw 'Erase failed: STOP.' }
& $tool @base write-flash --flash-mode keep --flash-freq keep --flash-size 4MB `
  0x1000  (Join-Path $images 'MediDispenseDurabilityLab.ino.bootloader.bin') `
  0x8000  (Join-Path $images 'MediDispenseDurabilityLab.ino.partitions.bin') `
  0xE000  (Join-Path $images 'boot_app0.bin') `
  0x10000 (Join-Path $images 'MediDispenseDurabilityLab.ino.bin')
if ($LASTEXITCODE -ne 0) { throw 'Write failed: STOP, do not boot.' }
# Explicit readback verification, still in ROM:
& $tool @base verify-flash --flash-mode keep --flash-freq keep --flash-size 4MB `
  0x1000  (Join-Path $images 'MediDispenseDurabilityLab.ino.bootloader.bin') `
  0x8000  (Join-Path $images 'MediDispenseDurabilityLab.ino.partitions.bin') `
  0xE000  (Join-Path $images 'boot_app0.bin') `
  0x10000 (Join-Path $images 'MediDispenseDurabilityLab.ino.bin')
if ($LASTEXITCODE -ne 0) { throw 'Readback mismatch: STOP, do not boot.' }
```

These are NOT an automated script: identity outputs must be manually reviewed
before proceeding; a shell does not verify the operator's intended physical board.
Do not run the block wholesale. First review exact esptool version/help/ROM support.
If ROM-only verification/erase is unavailable, STOP for review; do not remove
`--no-stub`, change protections or improvise hardware operations. No execute
authorization is given by this document.

Official command references: [Espressif reset/ROM-only options](https://docs.espressif.com/projects/esptool/en/latest/esp32/esptool/advanced-options.html),
[flash sector erasure](https://docs.espressif.com/projects/esptool/en/latest/esp32/esptool/basic-commands.html)
and [matching verification options](https://docs.espressif.com/projects/esptool/en/latest/esp32/esptool/advanced-commands.html).

## Test PASS/FAIL gates

- Append/reboot: stable ID, quantity, queue ordering and binding survive; invalid
  journal blocks without initialization or legacy fallback.
- Receiver commit/lost receipt/duplicate ack: one synthetic credit per ID; no other
  FIFO head consumed. Archive must be durable before reviewed event advances.
- Archive/pointer/journal/ack power cuts: retain original event or authenticated
  evidence; unknown/torn state blocks. Archive remains after duplicate receipts.
- Interrupted dispense marker: stays pending; no automatic completion/retry or GPIO.
- Use at least ten repeats per deterministic boundary and twenty actual-write
  randomized cuts per applicable case, with measured supply collapse and logs.
  Reset is not a supply-loss test. Sample counts do not prove exhaustive safety.
- HMAC challenge expiry/replay, independent backend restarts, real pulse capture
  and production adapter equivalence need separate isolated tests. The local lab
  receiver/proof placeholders cannot claim these passes. The original unverified
  physical coin cause and production reconciliation latch remain unresolved.

## Approval decision and remaining blockers

**Retired hardware can be nominated for a subsequent separately authorized lab
upload. A new ESP32 is no longer required solely to preserve this retired chip's
original bytes, because destructive repurposing is now explicitly accepted.**
Do not claim every execution gate passed: exact finalized image/ranges and tool
capabilities must be verified, RF/power setup approved, COM/MAC/security freshly
checked before writing, hardware authorization issued, first boot validated and
physical fault matrix completed. Backups do not establish restorability or physical
durability. Production controller stays blocked throughout.

Production recovery still needs independently reviewed native/physical/protocol
evidence; separately approved installed-board firmware and backend provisioning;
audited exact-event reconciliation with no new payment; remaining generic fault
resolution; fresh diagnostics/Firebase retirement; and explicit Super Admin kiosk
reopening. No part of this lab repurposing grants any of those permissions.
