# C-01 — interrupted RECORDS sends

Local correction, 2026-11-22; no publication or production data changes.

## Verified defect

The audited commit `fe376189da510ea4886bdb24e72c85e40bbee7e5` and published
`fbbc8481da81d7b1eadb483a4d3f2f665fdc7495` have identical RECORDS selection,
counting, mark-syncing and command-preparation functions. A CREATE or UPDATE can
remain durable in `pending_operations` with its `entity_records` row in `syncing`
after process termination. Previously both RECORDS selection and the startup
pending-work counter excluded it. The row and outbox were present, not lost.

## Minimal correction

`listPendingOperations(ownerKey)` now includes `syncing` for its existing
CREATE/UPDATE selection. `countPendingOperations(ownerKey)` also counts RECORDS
`syncing`, while retaining its existing behavior for STATE_UPDATE pending rows;
it does not newly count STATE_UPDATE syncing. No initialization reset, migration,
timer, lease, alternate queue or sync-engine change is introduced.

Opening SQLite alone does not send anything. The existing authenticated startup,
reconnect and retry orchestration detects the durable work through the counter
and calls the existing RECORDS engine. Offline work remains local until an
authorized online run. Failed and conflict rows remain excluded from automatic
RECORDS selection. Both queries retain their owner predicate and original order.

Selection does not change an active operation back to pending. The existing
`syncPendingRecordsOnce` single-flight promise prevents concurrent triggers in
the same runtime from dispatching it twice. On actual process termination that
promise disappears, while the durable command remains eligible for the next
runtime. This does not add multi-tab support or solve cross-owner lifecycle
findings; C-08/C-11/C-13 remain outside this change.

## Identity and replay

Recovery uses the same outbox row, local/server identity, intent and persisted
`clientRequestId`. CREATE replays the original values/key. UPDATE reuses its
persisted `sentCommand`, including original `expectedUpdatedAt`, values and key;
it does not rebase a command after an uncertain response. If termination precedes
PATCH preparation, the existing preparation and version checks still apply.

Exactly-once remote effects depend on Core's existing idempotency contract:
repeating an accepted command must return its stored result rather than apply
it again. Selection recovery neither rotates the key nor infers acceptance from
equal field values. Existing conflict handling and acknowledgement reconciliation
are unchanged. STATE_UPDATE selection, storage and engine are unchanged.

## Regression evidence

`src/sync/records-sync.recovery.sqlite.test.ts` launches the actual local store
and RECORDS engine in a separate process, adapts only the Expo platform binding
to a real file-backed SQLite connection, and kills that process group with
SIGKILL during HTTP delivery. A new process opens the same SQLite file.

The eight cases cover CREATE/UPDATE before remote acceptance, accepted commands
with lost responses, active sends with concurrent triggers, owner isolation,
failed/conflict exclusion, unchanged STATE_UPDATE selection/counting, and the
window between marking syncing and preparing PATCH. The synthetic HTTP server
models Core idempotency; it is not production or a complete Core integration.

The unchanged base fails the recovery assertions. The local candidate passes
all eight: durable snapshots/commands survive, replay sends the same command,
one remote mutation results, and successful acknowledgement retains one local
row with its original identity and clears only its completed outbox entry.

An isolated Expo probe also executes the unchanged production store/API/engine
with real Chromium and Expo SQLite WASM/OPFS. Four base controls reproduce the
exclusion after SIGKILL, and four candidate controls recover CREATE/UPDATE both
before remote acceptance and after a lost accepted response. Chromium is killed
without pagehide/close cleanup, then restarted with the same owned profile and
OPFS files. Local identity/values survive; UPDATE's stored command is unchanged;
replay produces one remote mutation and one reconciled local row. The backend
in this probe is synthetic localhost HTTP, not a real Core/PostgreSQL instance.
This is a store/engine integration probe, not a complete authenticated UI test.

Additional runtime evidence, exact checks, reproduction artifacts and limitations
are recorded in the separate C-01 report. Desktop process/SQLite tests do not
certify Safari, physical iOS/Android, browser eviction or multi-tab behavior.
