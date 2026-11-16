# Manual Ubuntu validation — prepared, not deployed

No workflow has been pushed or dispatched. The recovery feature remains disabled.
This package performs synthetic host tests only and does not change live records.

## Files to review and include after explicit approval

- `.github/workflows/coin-recovery-native.yml`
- `firmware/coin-review/validation/github-native-tests.mjs`
- `docs/coin-review-github-actions.md`
- `firmware/coin-review/CoinEventReviewCore.h`
- `firmware/coin-review/review-core.test.cpp`

These are the exact five files in the proposed commit. Include only these files,
not the entire firmware directory or all working-tree changes. Never use `git add .`
for this package. Review the staged diff for credentials and private data first.
The review fixture now uses synthetic transaction 7001 and device AABBCCDDEEFF;
it is not a copy of production NVS or a live payment journal.

## Dependency closure

Two additional runtime inputs are already tracked and unchanged from local HEAD:

- `esp32/CAPSTONE_MEDICINE_VENDO/CoinPaymentCore.h`
- `esp32/tests/coin-payment-core.c`

Do not add them to the five-file commit unless a later reviewed change requires it.
The workflow checks out these two inputs, the new review header/test, and the Node
driver. The payment test includes its existing sibling header by relative path;
the review test includes the new header, which includes `CoinPaymentCore.h` through
the driver's include path. All remaining C/C++ headers are standard library headers.
The driver imports only built-in Node modules. No npm install, backend files,
Arduino SDK, private header, generated manifest, local validation kit, or other
untracked source is needed. The local `github-native-tests.test.mjs` mock harness
is not invoked by this workflow and is outside the proposed commit.

## Security boundaries

- Manual `workflow_dispatch` only; no push, PR, schedule, or deployment triggers.
- GitHub-hosted `ubuntu-24.04`; never use the XAMPP laptop as a self-hosted runner.
- `contents: read` only; no repository writes, OIDC, secrets, environments, caches,
  services, artifacts, SSH, firmware tooling, or package-install scripts.
- Official checkout pinned to its v4.2.2 commit, credentials not persisted.
  Sparse checkout materializes the five runtime source files listed in the YAML.
  It is not a confidentiality boundary: Git metadata/object storage can contain
  other repository data. Do not commit secrets anywhere in the repository/history.
  Checkout has a short-lived read-only GitHub token; no production token is supplied.
- Uses runner-provided Node, gcc, g++ and sanitizer runtimes; no dependency downloads.
- Test process runs as the runner user inside a separate network namespace with
  a clean environment. If namespace creation fails, tests do not run. Checkout
  still needs GitHub access; native compilation/execution has no network access.
  This is network isolation of the child process, not the whole runner. It does
  not isolate the filesystem or defend against malicious reviewed code with access
  to runner sudo privileges. This workflow trusts the reviewed sources and action;
  it is not a sandbox for arbitrary untrusted submissions. No private networking,
  VPN, attached hardware or production integration is configured.
- Both core headers contain only portable computation/storage callback logic;
  no Arduino sketch, Firebase client, HTTP client, private config, or journal is loaded.
- Logs contain source hashes, compiler diagnostics, synthetic assertions and a
  four-case result list. They contain no production attestation or review key.
- A failed compilation blocks that executable; remaining cases still run. Any
  failed or blocked case fails the job. Unsupported sanitizers are never silently skipped.
- Review the exact commit before dispatch. Repository write access is trusted;
  a modified workflow is code execution and requires the same source review.

## Version pinning limits

The checkout action is pinned to a full immutable commit, not a movable tag.
`ubuntu-24.04` selects an OS family, not an immutable runner-image digest. Its
preinstalled Node, GCC/G++, libc and sanitizer runtimes may change as GitHub updates
the image. There is no downloaded package dependency or lockfile for these tools.
The source commit and printed input hashes identify the tested code, but do not
make the environment bit-for-bit reproducible. Preserve the GitHub runner image
metadata in the job logs. Exact toolchain pinning would require a separately
reviewed immutable build environment; do not claim it is implemented here.

Availability of `node`, gcc/g++, sudo and unshare on the restricted PATH, permission
to create a network namespace, and sanitizer support remain CI setup checks. A
missing tool, denied isolation or unsupported sanitizer fails the job; it must
not be interpreted as a pass or worked around by removing protections.

## Cases executed by CI

1. Payment core, C99 normal build/run.
2. Exact-event review core, C++17 normal build/run.
3. Payment core with combined AddressSanitizer and UndefinedBehaviorSanitizer.
4. Exact-event review core with both sanitizers.

Assertions stay enabled; sanitizer findings stop that executable. Coverage includes
durable queue handling, binding transitions, simulated write failures, archive-before-
advance ordering, simulated reboot, duplicate application, unrelated-event preservation,
overflow and binding guards. This is not a physical flash power-loss test or a full
backend/firmware/network integration test.

## Actual local results

- Four Node mock harness tests passed; no native binaries executed by those tests.
- Node syntax checks passed for driver and mock tests.
- Workflow YAML parsed with the installed Prettier YAML parser.
- Native normal and sanitizer runs: NOT EXECUTED, awaiting approved GitHub dispatch.
- Physical ESP32/NVS power-loss tests: BLOCKED, no approved spare controller.
- GitHub workflow validation, runner tools and namespace availability: not verified
  until the first approved run. Do not interpret local source checks as a CI pass.

## Run only after explicit approval

1. Review the listed files and the pinned checkout commit. Confirm repository
   Actions policy allows official checkout and GitHub-hosted Ubuntu runners.
   No repository secrets or production credentials are required.
2. With approval, commit only the reviewed source/doc files and push them through
   your normal reviewed branch/PR process. This task has not done either action.
3. Merge the workflow into the repository default branch so GitHub exposes the
   manual Run workflow button. Adding this workflow does not itself run it.
4. Open GitHub repository → Actions → **Coin recovery native safety tests**.
5. Click **Run workflow**, select the reviewed branch/commit, and dispatch only
   after execution approval. GitHub requires repository write access for dispatch.
6. Open the job's **Run synthetic fault tests without network access** log. Check
   all four results say PASS, and save the run URL, commit SHA, source hashes and
   logs as evidence. Failure at isolation/setup means no native test result exists.
7. If any case fails or is blocked, retain the logs and keep recovery disabled.
   Do not remove isolation or weaken security protections to obtain a green run.

## Gates still required after a green CI run

- Approved isolated spare-controller flash/power-loss validation under a separately
  approved lab procedure; no physical controller use is authorized by this package.
- Review of actual ESP32 archive, pending-ack persistence, and reboot behavior;
  host callbacks alone cannot establish physical NVS durability.
- Separate approval for migration, per-controller review-key provisioning, tested
  firmware deployment, and explicit Super Admin exact-event decision/acknowledgment.
- Preserve event history; never create an extra payment or erase NVS.
- Resolve remaining controller faults and obtain genuine fresh diagnostics;
  verify command retirement and physical inspection before separate kiosk reopening.
- No automatic physical coin-inhibit capability is established by these tests.

References: [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use)
and [manual workflow execution](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
