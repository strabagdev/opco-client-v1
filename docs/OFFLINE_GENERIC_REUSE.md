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

## Dynamic initial DATE filters — local option 2026-11-17

A PANEL DATE filter may declare `defaultValue: { type: "TODAY", timeZone: "America/Santiago" }`.
The zone is an explicit IANA setting, independent of the contract, field name and device zone.
The Client resolves it once when the panel/scope opens, using the device clock and Intl timezone
rules. It supplies the resulting `YYYY-MM-DD` to the existing shared dataset selection, so metrics,
detail, pagination, revisions and snapshot keys receive the same concrete date. `TODAY` is never
sent as a query date or used as a cache identity. Core does not fill omitted query parameters.

Manual dates, an explicitly cleared field and Lote selections remain unchanged on rerenders,
metadata refresh, reconnect or background/foreground. A new owner/contract/view/revision scope
initializes its own values without reading inputs from the preceding scope. A compatible adopted
definition retains the current values. Reopening calculates the current day again; keeping a view
open across midnight does not silently replace the user's selected day. Invalid/unsupported cached
zones leave manual selection available and never fall back to device time or another snapshot.

No storage migration, queue, clock synchronization or new offline acquisition is introduced. Offline,
a newly resolved day still requires its exact existing snapshot; yesterday's result is not a fallback
for today's query. Native/Safari Intl coverage remains a separate physical-device validation.

Deploy compatible Core before Client, then explicitly configure the relative default. Older Client
code ignores the new optional property and retains manual selection; absent defaults preserve the
legacy empty filter. Remove the descriptor through compatible Core before rolling Core back to a
version whose strict config parser does not recognize it. No production configuration is activated
by this local implementation.

## PANEL relation groups and historical inverse counts — local 2026-11-17

PANEL RECORDS datasets may opt into `groupBy` on a configured ONE relation. Core paginates whole
identity groups: `pagination.unit=GROUP`, `pagination.total` counts groups and `grouping.totalRecords`
counts all matching source records. `rows` contains every member of each returned group; a group
may therefore contain more records than pageSize. Primary/secondary headings use configured direct
related projections; identical labels never merge different relation IDs. The collapsed list exposes
identity labels and counts, and its detail reuses ReadFieldList with configured column labels/values.

The consultation response adapter validates this representation before accrediting an exact window:
group descriptors must match the saved dataset, each member is present exactly once, row relation IDs
match the group, counts agree and no page mixes group and record units. Existing record pagination
remains unchanged. No schema, SQLite/OPFS, outbox, pending-operation or synchronization logic changes.
The existing complete-collection inspector is deliberately conservative for grouped multi-row pages;
this lot accredits exact visited group windows, not unvisited groups or arbitrary offline queries.

`relationCounts` results are server-computed inverse counts over configured source entities and ONE
relations, including zero for master records without matching rows. Optional fixed conditions define
which existing rows count; interactive daily filters/search are never propagated to this historical
count. `difference` projects numeric initial value minus that count with a configured empty label.
Missing amounts remain null, negatives remain negative, and TEXT is never converted by the renderer.
Core includes these sources in existing manifest dependency traversal via `sourceEntityTypeId`; the
ordinary config revision, read binding and exact snapshot key continue to protect all results.

These tables explicitly describe server/last-saved-server coverage and exclude unresolved local
Attendance/STATE_UPDATE operations. They do not combine pending rows with ACK copies. After ACK,
only a fresh/revalidated server result can change the count; an offline cached result retains its
server calculation timestamp and does not claim current physical availability. No preparation is
added for unvisited queries, no gates are activated and no stock exhaustion control is introduced.

Publish compatible Core then Client before configuring these optional datasets. Core before this
extension rejects unknown dataset properties; older Client cannot present grouped pages correctly.
To roll back, remove the new descriptors/modules through compatible Core first, preserve all source
records/initial values, and retain the existing storage. Do not clear OPFS to downgrade presentation.

## PANEL consumer compatibility (local guard, 2026-11-18)

PANEL/catalog requests advertise the implemented `counts-v1`, `difference-v1`, `groups-v1`, `today-v1`
features in the standard Accept parameter contract. It stays within the CORS safelist and adds no
custom header/preflight requirement. Legacy Core can still serve compatible definitions unchanged.
For new descriptors, online data requires Core's complete panelCompatibility acknowledgement bound
to the response's configRevision; missing, partial, unknown or mismatched claims are rejected before
cache writes. An explicit HTTP426 is not a network failure and never silently falls back to cached
information as if the current read succeeded. Existing error text remains visible to old readers.

Core projects unsupported views into a legacy update shell rather than exposing a partially interpreted
new configuration; compatible views remain available. A new Client that cached such a projection asks
to connect and obtain its compatible definition. No identity, permission, session, cache, pending work,
conflict or outbox is removed. Known semantically supported pre-guard snapshots remain usable offline
without asserting they are fresh. Future/contradictory cached capability metadata is rejected in place.
Read-revision binding includes acknowledgement metadata only when present; legacy fingerprints remain
unchanged. Both direct and revision-bound PANEL readers use the same server admission.

A disconnected Client that predates the guard cannot be controlled by Core. If it already has an
incompatible snapshot, its old renderer can still interpret it offline; this patch does not claim to
fix that code remotely. Deploy the Core guard before distributing new definitions, then capable Client,
and verify already-open legacy tabs and old compatible offline copies. Do not use service-worker
activation as proof of updating a running tab. After new queries have been cached, rollback must retain
a feature-aware reader (the published 84ded489 already understands grouping); reverting to 80def725
or another reader lacking these semantics requires a separately verified compatible recovery path.
No automatic reload, storage reset, migration or Attendance change is introduced.

The same advertisement accompanies V1/V2 manifest requests. Core removes only feature-incompatible
PANEL views from the existing genericReuse offer, so a legacy running Client cannot bypass dataset
admission using a current receipt. Compatible PANELs, other workflows and Attendance policy/allowlists
keep their existing negotiation. The state/vector/epoch and writer protocol are unchanged; HTTP
manifest responses also vary by Accept. Local validation must enable generic reuse in both laboratory
artifacts to cover this path, while leaving production gates untouched.
