# Coin-event review validation — 16 November 2026

**Current planning update, 17 November:** this file records historical results.
The owner subsequently reported all four GitHub native configurations passing and
matching full-flash backups of the retired board. After evidence overlap review,
the owner now accepts destructive retired-board repurposing for an isolated lab,
but NO hardware write/boot/test is authorized yet. Production remains protected.
See `retired-esp32-approved-lab-repurpose.md` for the exact target, explicit opt-in,
current Windows preparation and remaining gates. Historical proposals below are
not current hardware instructions.

## Decision

**Not cleared for live deployment.** The recovery feature remains disabled. No runtime was installed, no board was opened/reset/uploaded, and no production NVS, database, payment, inventory, or journal record was changed during this validation turn.

The operator confirms there is no approved unsigned-native test runtime and no dedicated spare ESP32. Both native test suites and all physical power-loss cases therefore remain **BLOCKED / NOT EXECUTED**. Existing Node/PHP mock tests are reported separately, never substituted for those tests.

## Why Windows blocked the test

Read-only Code Integrity inspection found enforced event **3077**, accompanying **3033**, for `tmp/native-coin-tests/coin-review.exe`:

- Policy name: `VerifiedAndReputableDesktop`
- Policy GUID: `{0283ac0f-fff1-49ae-ada1-8a933130cad6}`
- Requested signing level: **2**; validated signing level: **1**
- Status: `0xc0e90002`
- Authenticode result: **NotSigned**
- Flat SHA-256: `B5B572654CE6360241E771A6C218B6665B584792032ACCDE12FCDBD7F3C89A2B`

This is an enforced trust/signing rejection before the test program runs. It is not an assertion failure. These logs do not establish a malware verdict. Elevation does not make an unsigned file satisfy the policy. Do not disable Smart App Control/App Control, add exclusions, rename/sign with an untrusted self-issued certificate, use an interpreter/in-memory loader, or alter execution policy to evade this decision.

Microsoft references: [App Control event IDs](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/operations/event-id-explanations), [troubleshooting and signature correlation](https://learn.microsoft.com/en-us/windows/security/application-security/application-control/app-control-for-business/operations/appcontrol-debugging-and-troubleshooting).

## Available environment

Read-only checks confirmed WSL is not installed, Docker is unavailable, Windows Sandbox is absent, and no serial COM device was returned. The operator separately confirmed no approved Linux VM/CI or administrator-signed Windows build and no dedicated spare board. Installing a runtime or using either board is **not authorized**.

### Simplest option to request approval for

Ask the machine/security administrator to approve **WSL2 with Ubuntu specifically for local unsigned development tests**. This is a proposed supported development environment, not an already-approved one. If that cannot be approved, use an existing approved Linux lab computer/VM or have the security administrator provide a trusted signed Windows test build. Do not upload project sources to a public online compiler or CI service without separate authorization.

Beginner steps — **instructions only; do not execute before approval**:

1. Show the administrator this report and the source-only package. Obtain approval for installing WSL/Ubuntu, installing its compiler packages, and compiling/executing these exact sources. VM/WSL availability alone is not approval to run them.
2. After approval, the administrator can use Microsoft's [WSL installation instructions](https://learn.microsoft.com/en-us/windows/wsl/install). A typical supported command in Administrator PowerShell is `wsl --install -d Ubuntu`; a restart may be required. No Windows security protection needs to be disabled. If device policy rejects installation, stop and ask the administrator rather than bypass it.
3. After the approved Ubuntu setup, install the approved GCC/G++ toolchain: `sudo apt update`, then `sudo apt install --no-install-recommends build-essential`. Compiler installation needs network access; these tests themselves do not. Use an offline/egress-restricted approved lab environment after installation where possible. Do not attach USB boards or copy production configuration into it.
4. Copy only `tmp/coin-review-validation-kit-20261116-portable.zip` into a new Linux test directory and extract it. It contains no Wi-Fi credentials, hardware keys, database configuration, Firebase URLs, production journal export, or compiled Windows executable. `source-origins.json` records source/package hashes; line endings and one include path are normalized for portability.
5. In that directory, verify `sha256sum --check manifest.sha256`. Review the two test sources and headers. Then, **only with execution approval**, run `bash run-native-tests.sh --approved-environment "your approved environment identifier"`.
6. The runner executes both available suites: `coin-payment-core.c` and `review-core.test.cpp`, then both again under AddressSanitizer/UndefinedBehaviorSanitizer. Any compile/assertion/sanitizer failure stops the run. Preserve the generated `results-*` directory, compiler/environment versions, logs and `results.tsv`. Do not label a blocked, skipped, or sanitizer-unavailable run PASS.
7. Return the results and source hashes for review. Passing host simulations still does not authorize live deployment or replace physical NVS tests.

The source-only runner has **not** been executed here. Its approval argument documents the operator's existing approval; it does not itself grant permission or override security policy.

## Actual results in this turn

| Check | Actual result | Limitation |
|---|---|---|
| Code Integrity and Authenticode investigation | Completed | Signing/trust rejection established |
| Approved native-runtime availability | None verified | WSL/Docker/Sandbox unavailable; installation not approved |
| Serial inventory | No COM device returned | Not proof of board identity; no port opened |
| Safety core consistency | Matching SHA-256 in repo, previous compile candidate and original local Arduino header | No installed firmware attestation |
| PHP/Node canonical wire and HMAC interoperability | **3 tests passed** | Pure test vectors; no PDO, configuration, network or real keys |
| Super Admin API and UI mock regressions | **7 tests passed** | Mocked transport; no live decision or real NVS |
| Native payment safety-core assertions | **BLOCKED, not executed** | Requires approved native environment |
| Native event-review fault assertions | **BLOCKED, not executed** | Binary compiled previously; execution blocked |
| Sanitized native runs | **NOT EXECUTED** | Same environment blocker |
| Spare-board power-loss matrix | **BLOCKED, not executed** | No spare or approved repurposed board |

The previous turn's ESP32 compilation and full software regressions remain historical results, not new physical-validation passes. This turn adds no claim of a durable controller acknowledgment.

Core source SHA-256: `CCD9ABF523D43126BEC4243A3A312C19B9E37956F90E6276D09554B63BC0D00C`.

## Remaining release gates

1. Approved native execution environment, both suites passing, including sanitizers and fault/reboot simulations.
2. Separately authorized dedicated spare or safely repurposed retired board; sanitized lab firmware and isolated fixture backend ready.
3. Complete and reviewed [spare-controller power-loss procedure](coin-review-spare-power-loss.md), including actual repeated physical cuts and recovery evidence.
4. Review the unresolved generic reconciliation latch separately. Exact-event archival deliberately does not clear unrelated or unattributed faults.
5. Independent approval for production migration, dedicated key provisioning and firmware upload. No live event decision or reopening follows automatically from tests.

**Next manual step:** obtain administrator approval for the native test environment. Do not install it yet, connect either ESP32, apply the migration, enable recovery, or retry the production event.
