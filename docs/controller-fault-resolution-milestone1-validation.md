# Milestone 1 validation record

Local software preparation only. No hardware, serial, backend, Firebase, credentials,
private backups or production data accessed. No existing files modified by this work.

## Actual results

- Node source-boundary validator: 8 passed, 0 failed. These are static packaging checks,
  NOT execution of the C++ state machine or cryptographic tests.
- Standalone C++ suite: syntax/type/format validation passed with the existing
  `xtensa-esp32-elf-g++` compiler, C++17, `-Wall -Wextra -Wpedantic -Werror -fsyntax-only`.
  No binary, firmware image or Arduino integration created.
- Initial format check identified platform-dependent uint32_t printf specifiers;
  changed to PRIu32 and repeated the check successfully.
- Native runtime and ASan/UBSan: BLOCKED / NOT EXECUTED. No approved connected Linux
  runner is available; Windows unsigned native-test execution was previously blocked.
  No Windows security controls were changed or bypassed.
- Physical persistence/power-loss tests: NOT EXECUTED, outside Milestone 1.

## Prepared runtime suite

11 scenario groups: disabled policy; canonical bounds/domains; 19 invalid evidence
cases; new activity after preparation; six phase-write interruption variants; two
journal-write interruption variants; reboot while prepared; new fault during write;
lost ack/reboot/expiry/replay; conflicting/corrupt/missing records; unexpected journal.
Run counts above are preparation inventory, not passed native results.

The test callbacks are memory-only. There are no service/hardware libraries or real
controller IDs. The Linux script compiles only these two adjacent source files and
executes synthetic tests with a clean child environment. It cannot independently
establish network/device isolation: the approved caller must supply an isolated
environment without production mounts, credentials or serial-device access first.
The explicit environment confirmation is a procedural gate, not a security sandbox.
No workflow was changed, pushed or dispatched.

## Decision

NO-GO for Milestone 2 deployment or live recovery. Portable candidate is ready for
review and approved isolated Linux runtime/sanitizer validation. A passed syntax check
does not prove algorithm behavior. See the contract for unimplemented adapter duties.
