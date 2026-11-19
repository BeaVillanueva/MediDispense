# Reference-sync cooperative shutdown — prepared, NOT activated

The legacy `backend/bin/sync-transaction-references.php` is held open by the running
Windows process and could not be replaced. It remains byte-equivalent to its prior
Git content. No running process, task or connection was signaled. Do not try to
rename/delete around the open-file lock or launch another worker.

## Files and activation boundary

`ReferenceWorkerControl.php` implements a file-only protocol; `ReferenceWorkerRunner.php`
orchestrates cleanup with injected dependencies. `TransactionReferenceSync::run()` and
`initialize()` accept an optional stop predicate; existing callers without it keep
their behavior. Checks occur before initialization units, kinds and individual items.
An item includes Firebase identity synchronization and its normal completion/error
marker; it is not abandoned merely because stop was requested. No payment, inventory,
dispensing state or transaction mutation is introduced.

`sync-transaction-references.cooperative-candidate.php` is a staging entrypoint. Direct
execution deliberately exits before control registration/config loading. Separately
reviewed activation must replace the canonical worker ONLY after legacy process exit,
and remove only that staging-only direct-execution guard. Do not include this candidate
from the old worker or invoke it as a second worker. No activation was performed.

## Private control directory

Future production location: `C:\MediDispensePrivateWorkerControl\reference-sync`.
It is not created by this work. A separately authorized operator must create it outside
the web root, with protected (non-inherited) Windows ACLs allowing only the exact
worker/operator identity, SYSTEM and Administrators. Windows ACL/reparse-point
verification fails closed. Tests inject a directory verifier only for unique synthetic
temporary paths; production entrypoint uses the Windows verifier.

Worker startup records actual Windows process-start UTC time, PID, canonical worker
path and random 128-bit instance ID. Local flock lease prevents another cooperative
instance before database access; existing named DB lock remains authoritative for
legacy/cooperative coexistence. Do not intentionally run both versions together.

Inspect the private `<instance>.instance.json` and match PID/start/path to the actual
process before requesting stop. Once activated, the syntax is:

`php backend/bin/sync-transaction-references.php --request-stop <exact-instance-id>`

This only publishes `maintenance.json`; it is NOT a signal or a guarantee of exit.
Requests are serialized; existing records are not replaced. Wrong/conflicting or
malformed identity evidence fails closed. Requests for a known instance whose death
was not recorded may establish a conservative maintenance hold; they never stop an
unrelated worker. Process liveness must be independently verified by the operator.

The worker finishes its current item, performs finally cleanup, writes/readbacks an
immutable `<instance>.exit.json`, then exits. File publication uses a same-directory
temporary file, flush/fsync where available, rename and readback. Power-loss/Windows
directory-entry durability is not proven by this protocol or synthetic tests. Partial
files are retained as evidence; uncertain publication is not called success.

The maintenance request persists across relaunch. This implementation intentionally
has NO automatic clear/resume command. A later separately authorized maintenance
procedure must preserve request/receipt evidence and review removal/archival of the
hold before approved restart. Scheduled tasks must not be re-enabled prematurely.

## Cleanup and limitations

Named-lock release is attempted through finally, including stop/exception/initialize
paths. Release confirmation and connection disposal are differentiated in receipts;
cleanup errors exit nonzero. Unexpected active transactions are not committed or
rolled back by this wrapper. PDO references/static connection are disposed. The receipt
is local evidence, not a database audit mutation or proof of completed synchronization.
No DB stop flag is used; no extra DB access is required to honor stop-before-start.

Normal watch errors retain retry behavior; earlier metadata writes may have completed.
One item can have multiple timed HTTP calls; DB waits still have no demonstrated total
deadline. A pending stop therefore has no guaranteed maximum latency. Do not force-kill
on timeout or call an unacknowledged stop successful. Filesystem/ACL failures block.

## Tests and legacy process

Run only `php backend/tests/reference-worker-shutdown.php` and the existing
`php backend/tests/transaction-references.php` for fake-only tests. Neither loads
application config nor connects to MySQL/Firebase. Do not run database-backed reference
flow tests or the real entrypoint during this preparation.

Actual Windows private-directory provisioning, ACL execution, real-process lifecycle,
Task Scheduler behavior and full power-loss durability are untested integration steps.
The current legacy worker cannot read new requests or hot-load this logic. Its safe
transition remains unresolved: require separate authorization for process identity,
quiescence/controlled-stop assessment and any task changes. Then review canonical
entrypoint replacement and future activation. Do not use the installer to activate:
it initializes baselines, registers a task and starts it.
