# Current Status

## RECORDS A-to-B Technical Closure 2026-09-28

- Final automated checks on `main` at `487c970c7238a50d84446481a3ff101092222728` passed: typecheck, lint, 69 test files with 811 tests at two workers, Web build/export with Expo SQLite WASM and service-worker generation, and `git diff --check`.
- The final diff is limited to the SQLite v10 RECORDS intent-preservation correction, scoped `local_id`/`server_id` resolution, mounted-detail refresh after direct sync, and their tests/documentation. There are no schema-version, migration, API/Core, dependency, or configuration changes, and no credentials or generated artifacts are included.
- Automated evidence uses the real persistence and sync functions with controlled APIs and a stateful SQLite-shaped harness. It is distinct from the earlier Chrome/CDP evidence with Expo SQLite OPFS/WASM summarized below; no browser scenario was repeated for this closure.
- The UPDATE A-to-B browser scenario has an uninterrupted retained-response trace and passed without reload after the mounted-detail correction. The CREATE-to-UPDATE final-delivery evidence remains limited: Core/PostgreSQL proved one final remote record with `Bodega`, but the CDP harness did not retain one uninterrupted trace of that final transition, so it is not treated as a complete browser verification.
- During an earlier development/HMR setup, Expo Web emitted a transient `Database not found - nativeDatabaseId[0]` message and remounted. The subsequent clean controlled scenario passed, but the HMR observation was not independently reproduced or investigated and is not considered verified by this closure.

## RECORDS Mounted Conflict Refresh 2026-09-28

- The stale conflict was a mounted-view refresh defect, not a durable conflict left after A completed. While A was in flight, the detail GET observed remote A against B's older base and correctly persisted a transient `conflict`; superseded completion of A then transactionally cleared the conflict fields and restored B as `pending_update`.
- Direct/manual `syncPendingRecords()` completion now publishes the existing RECORDS refresh key for the current session scope, and `RecordDetailScreen` consumes that key. A real conflict remains visible because reload reads the still-persisted `conflict`; only the already-cleared transient conflict disappears.
- Focused evidence passed: the stateful SQLite regression observes persisted conflict B/A before confirmation and pending B with null conflict fields afterward; mounted-detail refresh coverage plus lifecycle, reconnect, and RECORDS sync tests passed (4 files, 53 tests). Typecheck, lint, and `git diff --check` passed.
- Chrome/CDP with an exclusive profile and real Expo SQLite OPFS/WASM reproduced the transient banner. Releasing A's retained HTTP 200 kept the same mounted URL and changed the detail to `Bodega` + `Pendiente` with no conflict, without reload. Six OPFS files remained and the Expo SQLite worker bundle was loaded.
- The independent stale-conflict item is resolved. No schema, migration, API/Core, dependency, configuration, production, or real-data change was made.

## RECORDS Pending CREATE Edit 2026-09-28

- Cause: the detail and edit routes retain `local_id`, but `loadRecordWithOfflineCache()` previously sent that identifier to Core before resolving the scoped SQLite row. Once CREATE assigned `server_id` and the row became synced, Core returned 404 for the local identifier and the fallback deliberately rejected a synced cache row.
- Minimal correction: individual RECORDS loading first resolves by `owner_key + contract_id + entity_type_id + (local_id or server_id)`. A row without `server_id` opens directly from local storage; a row that already has `server_id` refreshes from Core using that remote identity while the original local route remains valid. No schema, API, Core, dependency, or configuration changed.
- Focused automated evidence passed: `offline-records.test.ts`, the stateful SQLite A-to-B regression, and RECORDS sync tests (3 files, 65 tests). The new coverage rejects a Core request using a pending local id and verifies that the same local-id route resolves through `server_id` after CREATE confirmation. Typecheck and lint passed.
- Browser evidence with Chrome/CDP and Expo SQLite OPFS/WASM: Core processed CREATE A=`Taller` while its response was retained; `/record/local_.../edit` opened successfully instead of showing `Registro no encontrado`; saving B=`Bodega` succeeded locally. After release, Core still had exactly one synthetic remote record with A while Client showed durable B pending, and B remained after a full Chrome restart with the same exclusive profile. The runtime loaded the Expo SQLite Web worker.
- Browser completion evidence: Core logged the final PATCH 200 and PostgreSQL contained exactly one matching synthetic record with Cargo=`Bodega`. The CDP harness did not preserve one uninterrupted trace of that final delivery: an aborted Fetch interception contaminated the first disposable profile, and the final clean attempt timed out waiting for a local-id URL after the route had already advanced to `server_id`. The database result proves completion and uniqueness, but the exact final response-release transition remains a harness limitation. No additional product change was made; the separate stale-conflict presentation issue was subsequently resolved and validated as documented above.

## RECORDS A-to-B Browser Validation 2026-09-28

- Environment evidence: Chrome 153 for Windows ran headless through CDP with a dedicated disposable profile, while Expo started with automatic browser opening disabled. Core was guarded against `opco_dev@127.0.0.1:5432/opco_development`; Client used `http://localhost:3000` and the verified private `client-review@operational-core.local` credentials. No habitual browser profile or production destination was used.
- SQLite Web evidence: the runtime loaded the Expo SQLite worker, created six files under the `expo-sqlite` OPFS directory including a 131072-byte database file, and later grew that file to 135168 bytes. After a real page reload while B's PATCH was intercepted before Core, the same OPFS files remained and the detail rendered durable local value `Bodega` with status `Pendiente`.
- UPDATE A-to-B passed for durable data. CDP retained A's HTTP 200 response after Core had applied `Taller`; B was then saved as `Bodega`. B stayed visible and durable, survived reload while its PATCH was held before Core, and synchronized after release. Core ended with exactly one matching remote record and `Bodega`.
- UPDATE presentation observation: before A's retained response was released, detail's remote read saw A and displayed a conflict for local B. Completing A corrected SQLite to pending, but the mounted detail kept the stale conflict label until reload. No B data or outbox intent was lost; this presentation-only issue is resolved by the mounted conflict refresh validation above.
- The original CREATE-to-UPDATE browser blocker is resolved by the scoped local-first identity lookup documented above. The prior run retained CREATE A after Core created one `Taller` record and reproduced `Registro no encontrado` at `/record/local_.../edit`; the current run opened that same route shape and saved B locally. No v11, schema, migration, or Core change was needed.
- Compatibility and automated evidence remain valid: legacy operations without `intentId` fall back to `client_request_id`; API bodies exclude `intentId`; the final complete suite passed with 69 files and 811 tests at two workers, and Web export/service-worker generation passed with Expo SQLite WASM included.

## RECORDS Consecutive Edit Preservation 2026-09-26

- SQLite v10 RECORDS outbox payloads now carry a local intent identity. Completion, retry, definitive failure, and conflict handling only mutate the intent they actually sent, so a later edit remains locally visible and durable.
- When CREATE is confirmed after a later local edit, the existing outbox intent is converted transactionally to UPDATE with the confirmed server id and remote version. UPDATE confirmation refreshes that same remote base without replacing the later local values; the next preflight still detects genuine remote changes as conflicts.
- Focused coverage uses the real local persistence and RECORDS sync functions with a controlled API and a stateful SQLite-shaped harness. It covers A-to-B preservation and resend, module reload, remote conflict, network failure, late A failure/conflict, and CREATE-to-UPDATE without duplicate creation. It does not exercise Expo Web's real OPFS/WASM SQLite engine or production data.

## Recovered Client Improvements 2026-09-24

- The validated candidate restores four independent changes on base
  `84c6d21a2692b3d26cd3072e01aa0d7303520686`: KPI module titles without a duplicate metric label,
  RECORDS read/send error wording, the unified header with scoped offline-preparation status, and
  per-run entity-definition request deduplication.
- The complete pre-consolidation tree, including the incomplete SQLite v11/outbox experiment and its
  tests, is preserved at
  `/home/dannysilver/dev2026/backups/opco-client/2026-09-24-pre-consolidation-v11-full-84c6d21`.
- At that recovered candidate SHA, consecutive RECORDS edits during synchronization remained unresolved
  and no v10 reconstruction or v11 migration was active. The current v10 correction is documented above.
- The 13 recovered implementation/test files are byte-identical to the validated candidate at
  `/home/dannysilver/dev2026/backups/opco-client/2026-09-24-four-patches-validation-84c6d21`.
  The persistence and sync files remain identical to base `84c6d21a2692b3d26cd3072e01aa0d7303520686`,
  and SQLite remains at schema v10. The matching candidate passed typecheck, lint, 799 tests, and
  the production Web build.
- Local visual review confirmed the RECORDS experience, the PANEL table, and a KPI that shows only
  its module title with value `1`. Failed and interrupted offline-preparation transitions were not
  manually verified and remain an explicit visual follow-up.

## PANEL Related Fields Release 2026-09-22

- Client moved by fast-forward from `8805de170aff78ae191e71e6f94a970c67fc3f89` to functional SHA `fff8aaf9125d8f30a16906feb11606a796d7d1d9` after Core `90dd4b909a7a0d83553cf518ec7488d121d00a1b` was active and ready. Railway reported `success` for that exact Client SHA. The public HTML serves `entry-81e6d5a243671168fa2d1a0581e6d736.js`, matching the validated local Web export; the bundle contains `relatedFields` and `related:` markers.
- Client resolves filter metadata through the selected direct source relation and cached target definition, and formats MANY target values in one TABLE row. Existing PANEL configs remain compatible. Typecheck, lint, full Vitest (790 passed), and Web build passed. No production AppView, entity, record, environment, or storage change was made for this release.
- Compatible rollback: revert Client to the prior SHA above, then Core to `8882cd4d9eabcc7d47c9aeb02c2c53583d2f8c1b` with forward commits/redeploys. If related fields are configured later, remove them while new Core is active before its rollback. The local screenshot confirms related Categoria selection only; production columns, filters, and offline behavior remain manually unverified.

## PANEL Release 2026-09-22

- Client moved by fast-forward from `d6142589656d5282be0c6f62f36019d0da5aafe0` to
  `4e401a017f82dee46d50b17b1c6a34070d55538c`, after Core
  `a8e08724d62792e29397ca2d0356070167290abe` was active and ready. Railway reported
  `success` for the Client service on that exact commit. The public site serves
  `entry-609278ef5c01c25ef0698d10c18f7ca2.js`, matching the validated local web export;
  that bundle contains typed-filter and `moduleResults` markers.
- The same Client tree passed typecheck, lint, full Vitest (789 passed), web export, and service
  worker generation. No AppViews, records, local storage, or environment configuration changed.
- Compatible rollback order: revert Client code to the prior SHA above, then Core to
  `aae812b97907f5b8e8b9754dcfa16b892404d0ab` if needed, using forward commits/redeploys
  rather than force push. Older Client shows composed KPI as unavailable (`-`), not recalculated.
- Manual verification of Core save feedback, Client filter controls, offline selections, and KPI
  presentation is still pending; no manual validation is claimed.

## PANEL Metric Composition 2026-09-21

- Client renders Core's `moduleResults` for composed KPI modules; it formats the received value
  and reason without recalculating A/B. Existing KPI and TABLE modules retain their paths.
- Results come from one matching PANEL response or snapshot. Filter query keys and request sequence
  guards prevent showing a prior selection during a new load or accepting a late response.
- Publish Core first, Client second, and only then configure composed KPI modules. An older Client
  displays a composed KPI as unavailable (`-`); it does not calculate A/B. Existing KPI and TABLE
  modules remain compatible.
- Validation: typecheck, lint, full suite (788 tests), and web export with service-worker generation
  passed. Manual review remains for the editor flow, offline selection changes, and responsive
  presentation; no manual validation is claimed here.

## PANEL Filters And Grouping Review 2026-09-21

- PANEL sends normalized filter values to Core and keys offline snapshots by filter values,
  dataset, pagination/search, scope, and config revision. Clearing a text input removes its
  filter key from subsequent queries.
- Client now reads bound entity definitions through the existing definition cache and renders typed
  filter controls. Required selections block only bound dataset requests; independent datasets
  continue. Options send internal values, relations send record ids, and empty optional controls
  are absent from requests and snapshot keys. This does not change metric conditions or KPI
  composition calculations. Typecheck, lint, full suite (789 tests), and web build passed; manual
  checks of controls and offline behavior remain pending.
- Dynamic metric breakdown by a dataset field is not yet a Client response or visualization type.

## Visibility Investigation 2026-09-21

- Case remains open: `showInClient` stays checked after saving, and the field is reportedly absent
  from full record detail. The earlier `showInClient=false` explanation does not cover this case.
- Full detail fetches the entity definition and record independently when opened. Network definitions
  replace the in-memory definition and are written to SQLite cache; cache is used when the request
  fails. RECORDS detail may use a locally pending or cached record value. Detail includes active
  fields only when their formatted record value is nonempty; it does not use `showInClient`, an
  AppView field selection, or a field-count limit.
- The unresolved case needs the field's presence/type/key in the definition and that key's presence
  and emptiness in the individual record response, then comparison with the displayed detail.
- In a clean worktree based on `origin/main`, generic RECORDS rendering was traced without touching
  local storage or production data. RECORDS Client summaries use `showInClient` when it is explicitly
  present, otherwise they fall back to `showInList`.
- Therefore `showInList=true` with `showInClient=false` is expected to show the field in the Web
  record list but hide it from compact Client record cards. Full Client record detail remains
  unfiltered by `showInClient`.
- The definition cache replaces cached definitions with the fresh API definition, including explicit
  `showInClient=false`, so the normal network reload path updates cached visibility without special
  invalidation code in Client.
- No name-based special case was found for Personas, Estatus, Estado, or internal record status.
  Dynamic status-like fields are rendered according to their field metadata and option definitions.

## Stabilization Closed

Selective stabilization was published to production at
`2833b7becb922d6c0476d8841958b81e3c6d5c0c`. The user confirmed that RECORDS loads and supports
search, and that Attendance shows the list and counter for the selected date. The local environment
remains separated; ENV-024, local destinations, development tooling, seeds, credentials, and guards
were not published.

The responsive header follow-up was published at
`351005db9ee8e3b7fb31011a12f3e986d58b5e24`.

The absence of an automated test against Expo Web's real OPFS/WASM engine remains a coverage
limitation, not an open incident.

## Header And Save Feedback Closed

- Visual review at 390 px with "Daniel Esteban Silva Cruz" demonstrated that placing the user and
  Diagnostics in the same compact actions zone allowed Diagnostics to overlap the brand. Compact now
  uses three explicit rows: brand/navigation with Diagnostics, avatar with the wrapping full name,
  and the centered status indicator. The user confirmed the correction at 390 px: brand and
  Diagnostics remain separate, the complete user name is visible, and status is centered.
- Widths 1024 and 1280 retain three equal flexible desktop zones, which centers status against the
  complete header. The status indicator remains informational and separate from the Diagnostics
  button. The user confirmed the desktop header at 1024 px.
- RECORDS reports local success only after its atomic SQLite record/outbox save resolves. Attendance
  and STATE_UPDATE do the same for offline saves and report remote success only after a successful
  write response.
- Write confirmation outranks concurrent read activity, while durable errors and conflicts retain
  priority. Feedback is scoped by user, contract, and AppView; expiration requires the matching
  monotonic presentation id, so an older timer cannot clear a newer result. Once cleared, the resolver
  presents the current connectivity, sync, pending-work, or read state.

No synchronization, outbox, configuration, or data behavior changed in this review. The requested
compact and 1024 px visual checks are complete.

Validation passed: complete suite (68 files and 784 tests), TypeScript, lint, `git diff --check`, and
web export plus service-worker generation. The habitual export first inherited a Metro cache entry
from another worktree; rebuilding with an empty bundler cache passed.

Offline/outbox behavior remains documented in [`STATE_UPDATE.md`](STATE_UPDATE.md); broader client
architecture and future scope remain in [`CLIENT_ARCHITECTURE.md`](CLIENT_ARCHITECTURE.md).
