# Generic verified coverage reuse — local, 15-11-2026

Independent build gate: `EXPO_PUBLIC_OFFLINE_GENERIC_REUSE_POLICY=verified-coverage-runtime-v1`, absent/malformed off.
The API option `genericReuse` is for isolated validation. Negotiation stays on authenticated manifest V2, with storage policy 3.
V1 and policies 1/2 remain compatible. Explicit unsupported policy 3 downgrades only to the existing policy path;
it does not withdraw the Attendance pilot. Malformed responses, nonce/scope errors and 401/403 do not authorize omission.

Use the existing receipt ledger, singleton and transaction inspections. A receipt must match its offered family,
scope, authorization, epoch/vector/metadata, exact selection and current content hash. It must have a marker from
the same handle/runtime/session. Close/restore/token changes require normal verification/download again.
Receipt flags remain shadow/false; only a negotiated local consume decision can omit a download.
The base receipt observer now reads its real nested `context`; specialized receipt signatures remain unchanged.

No new preparation, query, cache engine, outbox, namespace, migration or sync behavior. Unprepared/partial queries
remain outside omission. Preserve the existing “No lista para ser vista offline” availability indicator.
New consumers are adopted in subsequent independent lots; this negotiation lot alone skips no new downloads.

## Metadata and direct catalogs

The ordinary preparer consumes existing metadata-only receipts for RECORDS/PANEL/REPORT and direct catalog receipts.
Catalog consumption runs inside its existing inspection transaction; definitions/options and all catalog pages must
match the local hash and negotiated remote vector. A direct catalog never certifies transitive collections or business
records for every context. Shared in-flight loads keep their existing coverage/scope boundaries.
Reused proofs retain snapshotId/verifiedAt. Initial and final remote checks remain. A withdrawal returns the affected
views for one ordinary fallback with both reuse gates disabled; it cannot recurse or erase local work.
No change to automatic preparation triggers or offline availability messages.

## STATE_UPDATE and demand-prepared RECORDS

Ordinary snapshot/current/context-required coverage is requested from the configured prepared definition and exact
local date, not a visible label. Current includes explicit event/null per subject and does not certify full history.
Incomplete latest/source pages still reject receipts and use the normal path. Context-required never claims target data.

RECORDS can consume only an already verified unfiltered collection, with no explicit sort/search/filter and page 1.
The existing local query was extracted unchanged so inspection and the exact returned rows share one transaction.
No SQL/filter/sort/projection, writes, schema, queue, namespace or sync behavior changed. The renderer returns that
verified copy before the full refresh instead of replaying writes. A final manifest and inspection guard the decision.
Empty verified collections are eligible; missing/partial receipts, other queries or new runtime handles download normally.
No new RECORDS preparation from Home and no automatic acquisition of unvisited data.

## Exact PANEL / REPORT TABLE / MATRIX

Consumption uses the existing consultation receipt inspector transaction and returns the exact verified response.
PANEL requires `windowPrepared`/`completeWindow` for its dataset/filter/search/page/size/definition; a partial dataset
can contain a complete requested page. This never marks the dataset or whole experience complete. Unvisited pages,
discovery aliases, filters and periods are distinct. TABLE/MATRIX use the same exact-period consumer without changes
to queries, sorting, grouping or calculations. Initial/final manifests, current-generation checks and local hashes remain.
The ordinary loaders return reused snapshots without rewriting them or renewing receipt identities/timestamps.
Known offline still reads only the existing local store; no manifest or business API call is added offline.

## Selected contexts, dependencies and conservative invalidation

The existing explicit selected-context preparation can emit/consume `state-update-current` with its exact identity,
date, source/target/configuration and optional schedule binding. It uses the same revision run, sealed source/pages,
workflow materialization, markers, ledger and inspector. An anchor binds the configured definition and bounded latest
when actual context preparation is needed. Ordinary context-required metadata remains separate from business coverage.
Context receipts have a selection suffix under the existing preparation prefix; they do not overwrite the ordinary
receipt or another identity. There is no new coverage state, queue, trigger or background query for unselected contexts.
Generation slots share the existing guard and coordinator. Unavailable capture uses legacy preparation; withdrawn
consumption performs one ordinary pass without another negotiation/reuse decision.

Remote invalidation remains deliberately conservative: the existing contract-wide vector includes relations/options,
deletions, metadata and authorization. A changed vector never permits selective omission by guessing which entity changed.
No per-entity narrowing is claimed by this lot. Complete dependency recipes and local hashes remain required; direct
catalog receipts cannot become transitive coverage. Restores/new handles/session changes need normal downloads.
Pending/conflict overlays are retained and prevent incompatible certification; reconnect/ACK stay in the existing engine.

## PANEL cache source and connectivity — local correction 2026-11-17

`fromCache` describes where the response was read; it does not mean the device or query is offline.
A consultation accepted by the existing V2 receipt consumer returns `fromCache=true, offline=false`.
PANEL retains both flags and uses `offline` (or known disconnected connectivity) for its Offline
heading, module badges and saved-data caption. Online verified reuse keeps its local telemetry source
without being presented as an offline fallback. A network fallback or known offline read still shows
Offline and preserves the exact saved response. No receipt, gate, storage or synchronization contract changes.

The dataset effect revalidates its loaded exact query on an actual known-offline to online transition,
including a query originally loaded from the server. It follows the ordinary loader and existing reuse
negotiation; it need not download business data if the proof is still valid. An interrupted refresh is
not treated as a completed result. Scope/revision/query guards remain effective, and an unrelated rerender
or unchanged successful retry does not request another completed query.
