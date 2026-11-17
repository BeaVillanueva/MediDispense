# Phase 3 synthetic native lab validation

This branch is for software validation only. It does not approve any firmware
upload, NVS/storage operation, production recovery or kiosk reopening.

## Run manually without merging

1. Open GitHub Actions → **Coin recovery native safety tests** → **Run workflow**.
2. Select branch **ci/lab-durability-phase3-validation**, not main.
3. Start the run. No inputs, secrets, controllers or service URLs are needed.
4. Open job **native-fault-tests**. Review both isolated test steps:
   * Existing payment/review cores: normal and ASan/UBSan (four configurations).
   * Phase 2 lab engine: normal and ASan/UBSan, seven named cases each (14 case runs).
5. Retain the run URL, exact commit SHA, summary and complete failed-case output.
   Do not publish private backups or live journal data in the logs.

The seven case groups cover payment receipts/FIFO, review acknowledgment replay,
initialization interruptions, operation interruptions, failed confirmations,
corrupt records and repeated reboot recovery. Every group is a separate process:
one failing assertion/sanitizer does not skip the remaining groups. Successful
groups print actual assertion counts. Compile failures block all seven groups for
that configuration; they are not passes. Any failure makes the workflow fail.
The old core tests remain mandatory and unchanged.

## Isolation

Manual `workflow_dispatch` only; `contents: read`; checkout pinned to the reviewed
immutable v4.2.2 commit; credentials not persisted. Sparse checkout retrieves only
the two portable headers, old test suites/driver and three Phase 2 native sources.
No application firmware, board configuration, private backups, settings, tokens,
production databases, Firebase SDK, peripherals or serial tools are checked out.

Both test steps run in a new network namespace, without root privileges, with a
fresh HOME and an explicit clean environment. A missing network namespace fails
the step instead of falling back to network-enabled execution. Node is resolved
to an absolute path before sanitizing PATH. No artifacts, caches, package installs,
deployments or hardware operations are configured.

Checkout itself requires GitHub network access. Namespace isolation applies to the
test/compiler processes, not the entire hosted runner or Actions infrastructure.
Ubuntu 24.04 is a moving hosted image; preinstalled Node/GCC and OS versions are
not immutable. The checkout action alone is commit-pinned. This is not an offline
or reproducible proof of the complete runner supply chain.

## Evidence and release gate

Local source/packaging checks and a cross-compiler syntax check are not native
runtime validation. Native results remain **pending** until this exact branch/SHA
has run. Previously passing core-only runs do not validate the new lab engine.

The mock storage adapter tests before-write, truncated-record and
committed-write/lost-response outcomes. It does not model NVS page programming,
garbage collection, flash wear, brownouts or physical interruption timing.
Passing all cases is a software gate only. A separate review and explicit
authorization remain required for a retired-board application-only upload;
physical durability, storage initialization and production recovery remain blocked.
