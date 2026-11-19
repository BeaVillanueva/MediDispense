# Controller fault resolution — Milestone 1 contract v1

Status: portable candidate only; disabled by default. No Arduino/backend integration,
keys, migrations, live decisions or reopening permission. Synthetic identifiers only
in tests. Existing journals and event archives retain their layouts and semantics.

## Eligibility and evidence

The only eligible condition is an explicitly reviewed **residual legacy journal
reconciliation latch after exact-event archival**. This is an administrative
disposition of an unattributed legacy latch, NOT proof of the original pulse cause.
Never clear reader faults, boot review, storage faults, overflow or binding faults.

Required evidence: authenticated controller and machine identity; positive transaction
owner; full archived event ID; immutable archive SHA-256; confirmed backend archive
acknowledgment; completed physical/payment accounting review; current valid journal;
empty durable and RAM queues; no incomplete pulses, reader/storage/boot/overflow/
binding fault; isolated payment hardware and stopped motors; stable capture fence;
fresh signed authorization tied to this boot, journal SHA-256 and fault generation.
An adapter must compute SHA-256 from specified journal serialization (not raw ABI
bytes), validate archived event ownership and backend facts, and independently verify
signatures. These adapter obligations are NOT implemented by this pure core.

Always reject wrong/missing evidence, additional events, expiry, noncanonical strings,
new activity/fault generations, corrupt/missing persistent records, unexpected journal
state and unsupported versions. Unknown is unsafe. A missing sidecar after an earlier
recovery cannot mean idle: the adapter must persist/verify a recovery-required marker.
If the marker/records disagree, block; never initialize/repair automatically.

## Canonical signing contract

ASCII, `|` delimiter, no whitespace/newline, decimal unsigned integers with no leading
zeros. IDs use bounded ASCII letters/digits/hyphen/underscore only. Digests/nonces are
lowercase hex. Device identity is 12 uppercase hex characters. HMAC-SHA256 uses a
separate per-controller recovery key and domain separation; signatures are not stored
in this core and must be verified before setting proof flags. No production key here.

Authorization bytes (exact field order):
`cfr-auth-v1|decision|device|machine|transaction|event|archive_sha256|before_sha256|after_sha256|nonce|boot|generation|fence|expires|residual-legacy-latch|keep-held`

Acknowledgment bytes:
`cfr-ack-v1|decision|device|machine|transaction|event|archive_sha256|before_sha256|after_sha256|nonce|boot|generation|fence|expires|applied|keep-held`

before/after SHA-256 differ ONLY by the authorized journal latch transition plus its
checksum. The adapter verifies the complete before/after journal comparison; all
event entries, counters, ownership, receipts and other fields must remain identical.
Per-boot authorization expires on reboot. Existing APPLIED evidence may be acknowledged
after reboot/expiry with fresh authenticated receipt verification; no reapplication.
PREPARED after reboot requires investigation/new scoped recovery design, not auto-resume.

## Durable records and transitions

Record v1 contains phase, full immutable authorization, checksum. This implementation
uses an in-memory C++ structure with deterministic field checksum; **do not write raw
struct bytes as a portable NVS format**. Milestone 2 needs an explicit bounded codec,
immutable phase evidence, authenticated validation and collision-safe record IDs.
Checksums detect accidental corruption, not malicious tampering.

No record -> PREPARED -> APPLIED -> ACKNOWLEDGED. No backwards transitions or deletion.
Persist PREPARED + durable recovery-required marker and verify readback BEFORE journal
transition. Persist and verify exact after-journal, then persist APPLIED. After signed
backend acknowledgment, persist ACKNOWLEDGED and verify readback. Each store callback
must enforce immutable decision identity, monotonic phase and complete readback.
There is no reopening/release operation in this core. `hold()` is always true,
including disabled/default/ACKNOWLEDGED states. Monitoring pulse evidence continues;
payment admission/binding remain disabled. This is intentionally not a normal-vending
admission policy and must not be globally wired into production unchanged.

## Failure matrix

| Boundary/failure | Required result |
|---|---|
| Disabled, invalid proof/evidence/expiry | No callback/write; held |
| Before PREPARED write | Original journal; held |
| PREPARED write failed/torn/readback failed | No journal write; held; inspect disk |
| PREPARED committed, response lost | Same decision may retry in same boot; no new decision |
| New event/fault/fence/boot after PREPARED | Reject; preserve prepared evidence |
| Journal write fails before commit | PREPARED retained; held |
| Journal committed, response/readback lost | PREPARED + exact after-image can complete APPLIED, same boot only |
| Unexpected/partial journal image | Reject, retain evidence; no automatic repair |
| APPLIED write fails/torn | Held; inspect persisted state; no assumed success |
| Reboot with PREPARED | Held, no automatic application |
| Reboot with valid APPLIED | No journal write; signed ack permitted after validation |
| Backend acknowledgment lost/unavailable | APPLIED retained; retry same receipt |
| ACKNOWLEDGED write failed/torn | Held; inspect/retry from valid persisted evidence |
| Duplicate matching acknowledgment | No write; same result, held |
| Conflicting/replayed different decision | Reject; no overwrite |
| Any corrupt/missing required record | Held; no creation/repair/clear |
| New fault after APPLIED/ACKNOWLEDGED | Held; cannot be cleared by old decision |

## Validation and integration boundary

Native C++ tests use a memory-only disk/journal model and synthetic decision/event IDs.
They model before-commit and committed-but-unconfirmed failures at each transition.
They do not prove physical flash atomicity, NVS garbage collection, signature security,
controller wiring, or backend readiness. Native execution must use approved isolated
Linux with no network, serial devices, credentials or production files mounted.
Node source-boundary checks are packaging checks, not execution of the C++ algorithm.

Milestone 2 must implement cryptography, bounded codec, independent accounting/archive
evidence checks, immutable audit storage, durable marker, all startup/binding gates,
fresh fault/fence snapshots around every write, backend receipt handling and separate
reopening approval. Time/fence inputs must be genuine, never supplied by an admin UI.
It must verify behavior if the adapter commits but cannot confirm, and ensure no
normal payment journal writer races with recovery. No mutex held across network/NVS.

Milestone 1 cannot authorize hardware upload, live recovery or kiosk reopening.
