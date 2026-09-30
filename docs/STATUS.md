# Current Status

## Offline Preparation Terminal Progress 2026-09-29

### Defect Reproduced And Corrected

- Demonstrated cause: a failed AppView normally became a terminal per-AppView result, but if the
  subsequent SQLite operation that preserved or marked that failure also threw,
  `prewarmOneAppView` rejected into the fail-fast worker pool. The global run published `failed`,
  released its owner+contract single-flight key, and rethrew while sibling workers were still alive.
  Those siblings could then publish `running` after the terminal state, and a later
  Home/session/reconnect trigger could begin a second global run. This explains both a retained
  `Preparando` state and apparent automatic restarts without attributing the issue to PANEL or to
  the request timeout.
- Correction: failure preservation is best-effort and cannot escape the AppView boundary; a
  defensive worker guard converts any other unexpected AppView exception into a completed failed
  result. The run waits for every worker, emits one terminal state, and global setup failure resolves
  after recording that terminal instead of creating an unhandled background rejection. Previous
  ready definitions remain untouched when failure marking cannot be written. Dedupe and all caches
  remain scoped by owner+contract; outbox, write synchronization, SQLite schema, timeouts and
  one-tab policy are unchanged.
- Correlation and header: each run now records a safe `runId` plus its real trigger (`home`, contract
  selection or lifecycle trigger), while diagnostics retain the per-AppView fingerprint, stage,
  duration and result. The sole global header displays a compact real `processed/total` progress
  bar; processed includes successes, skipped AppViews and failures, and does not claim offline
  availability. A failed terminal says `Preparación incompleta · N fallos`, keeps `N/total
  procesadas`, and uses a static warning icon with no spinner, animated bar or working pulse. Existing send errors, conflicts, write
  confirmations and other active operations retain their previous priority; Diagnóstico and normal
  later retry triggers remain available.
- Regression evidence: the focused prewarm test forces one definition failure plus a second failure
  while writing its local marker, leaves another AppView pending, verifies concurrent trigger dedupe,
  a single `2/2` failed terminal with no later `running`, preservation of the previous `ready`
  definition, and a later successful `2/2` retry with a different run id. Header tests cover active
  to completed, active to incomplete, persisted interruption and a later active retry. The focused
  run passed 62 tests; typecheck passed; lint passed with only the two pre-existing
  `no-require-imports` warnings.
- Technical close: the complete suite passed 825 tests across 69 files with at most two workers;
  typecheck and the web build passed; lint completed with zero errors and the same two pre-existing
  warnings; `git diff --check` passed. The generated `dist` remained an ignored local artifact and
  was not published.
- Real local evidence used Core at `localhost:3000`, Expo Web at `localhost:3003`, and only the
  explicit `.env.local` PostgreSQL destination `opco_dev@127.0.0.1:5432/opco_development`. Chrome
  153 for Windows used CDP port 9336 and the exclusive
  `C:\Temp\opco-cdp-offline-progress-20260929` profile. With network latency applied only in that
  profile, the real header showed `1/2 procesadas`: the progress region measured 220x16 px at
  1280x900 and at 390x844, with no page-level horizontal overflow or overlap. Blocking only the
  local RECORDS definition request produced static `Preparación incompleta · 1 fallo`, `2/2
  procesadas`, a static warning icon, opacity 1 and no CSS animation. PWA diagnostics correlated
  `trigger=home`, one run id, `failed`, 2/2 and one failed
  AppView. Removing the block and performing the existing later Home trigger produced a different
  run id and `completed`, 2/2, failed 0. These are browser/Core observations, distinct from the
  controlled API and store regression.

### Reported Panel Incident Not Confirmed

- The exact reported `Panel Protocolos - Piloto` is absent from local PostgreSQL (zero matching
  AppViews), so its assigned AppView ids, workflow configuration and incident diagnostic copy remain
  unavailable locally and production was not accessed. The equivalent local contract had one
  RECORDS AppView and one PANEL; PANEL completed as the existing unsupported/skipped prewarm
  definition and did not execute PANEL datasets. No local fixture or database row was created or
  modified.

### Visual Observation Limit

- The local browser observation without restarts lasted five seconds: during that interval the
  terminal label and request count remained unchanged. This short observation supports the visual
  state check only; it is not evidence of indefinite stability. The no-late-`running` and later-retry
  guarantees come from the controlled regression, not from the five-second browser window.

## PANEL TABLE Configured Height 2026-09-29

- Trace and cause: Core persists TABLE `layout.h` and PANEL `layout.rowHeight` unchanged. Client receives
  `rowHeight` in the assigned AppView config, while the PANEL execution API returns the same module coordinates.
  Client then derives one effective pixel row height before applying
  absolute desktop `top`/`height`. The TABLE-specific 300 px minimum was divided by each TABLE's own `h`,
  so a TABLE-only panel always resolved to `h * (300 / h) = 300 px`; `h=4`, `h=8`, and `h=12` therefore
  produced the same module height. No `maxHeight` caused the clipping: the module and content are flex
  containers, while the row body is the bounded vertical ScrollView around the existing horizontal one.
- Correction: the 300 px TABLE minimum is calibrated to the editor's default TABLE height of six layout
  units, giving a 50 px effective Client unit. A TABLE below six units still raises the shared unit enough
  to keep its own 300 px floor and prevent overlap; heights above six units use that 50 px unit unless some
  other module requires a larger shared unit. Saved `x/y/w/h`, Core's `rowHeight`, KPI rules, and both scroll
  directions remain unchanged. Thus `h=4` is floored at 300 px, `h=8` is 400 px, and `h=12` is 600 px.
- Regression coverage now asserts the TABLE-only `h=4/8/12` sequence, including container height and the
  resolved shared row height. Existing cases continue covering TABLE+KPI distribution, multiple TABLEs,
  narrow stacking, configured coordinates, search/pagination placement, and nested vertical/horizontal
  scrolling. The affected test passed 48/48, typecheck passed, and lint passed with zero errors and the two
  existing `no-require-imports` warnings in the RECORDS local-DB regression.
- Local HTTP evidence used only Core at `localhost:3000` with the explicit `.env.local` PostgreSQL destination
  `opco_dev@127.0.0.1:5432/opco_development`. The synthetic PANEL response was HTTP 200 with six rows, zero
  metrics, four persisted columns, and the requested module `h`; the assigned config retained `rowHeight: 8`,
  and the two-module API response returned TABLEs at `h=12,y=0` and `h=6,y=12`. No API or Core file changed.
- Windows Chrome 153 ran through CDP port 9335 with the exclusive
  `C:\\Temp\\opco-cdp-table-units-20260929` profile. At desktop width, measured module/body heights were
  `300/148 px` for `h=4`, `400/248 px` for `h=8`, and `600/448 px` for `h=12`; search and pagination remained
  outside the body and visible in the captured desktop viewport. With a second TABLE, the first ended and
  the second began at the same pixel boundary (`684 px`) without overlap. At `390x844`, modules stacked at
  the same boundary, the page scrolled vertically, and the table retained a 318 px horizontal viewport over
  635 px of content without page-level horizontal overflow.
- Only the disposable AppView `cmun3d6gy0001vqmugg7k3n62` and its access row were used; deletion was verified
  at zero remaining rows for both. Screenshots and CDP harnesses were temporary local artifacts and were not
  tracked. No production panel or record, migration, dependency, offline snapshot, commit, push, or deploy
  was involved.

## PANEL/TABLE Validation Closure 2026-09-29

- Accumulated Client scope was reviewed on `main`. The functional diff contains only the TABLE-specific
  300 px visual minimum and bounded nested vertical/horizontal scrolling needed for rows and controls to be
  usable without a KPI. Saved layout coordinates and KPI behavior remain intact; all other changes are PANEL
  regressions and documentation. The Core counterpart is limited to initial TABLE columns, repairable opening
  of `columns: []`, and its tests/docs.
- Procedure for an older TABLE with no columns is performed in Core: open the PANEL, open `Módulos`, choose
  `Editar módulo`, select at least one column under `Columnas y diseño`, press the module's `Guardar`, and then
  press `Guardar experiencia`. Reopen the PANEL to confirm the selection persisted before using it in Client.
- Final Client verification passed: `npm test -- --maxWorkers=2` ran 69 files and 822 tests, `npm run build`
  completed the Expo web export and local service-worker generation, and `git diff --check` passed. The build
  output remains local under ignored `dist/` and is not a production publication. Typecheck, lint, and the
  completed Windows Chrome/CDP desktop/narrow-screen verification are reused because Client implementation
  has not changed since those checks.
- The two repository diffs contain no secret, `.env`, local configuration, database, log, generated bundle,
  or other tracked artifact. No production data, migration, dependency, commit, push, deploy, or publication
  was performed. Earlier notes that call `columns: []` repair pending describe the intermediate stage and are
  superseded by the completed Core editor repair documented above.

## PANEL TABLE Standalone Height 2026-09-29

- Cause: PANEL layout used a generic 180 px minimum for every non-KPI module. A TABLE with the editor
  defaults (`layout.rowHeight: 8`, module `h: 6`) therefore received exactly 180 px; its title, search,
  header and pagination consumed the available height and the horizontal ScrollView clipped rows
  vertically. A KPI changed the global effective row height through its 240 px minimum, indirectly making
  the TABLE taller and creating the observed dependency.
- Correction: TABLE now has a type-specific 300 px minimum. The existing layout planner still preserves
  saved `x/y/w/h` coordinates and configured row height; it raises the shared effective row height only
  enough for each module to satisfy its own visual minimum. The table body is a bounded nested vertical
  ScrollView containing the existing horizontal ScrollView, while module title, search and pagination stay
  outside it. No global overflow rule was removed and KPI minimum behavior is unchanged.
- Regression coverage reproduces the old TABLE-only result (`rowHeight: 30`, height 180) and now expects
  `rowHeight: 50`, height 300. It also covers two TABLE modules without overlap, TABLE+KPI retaining the
  prior 120 px effective row height/distribution, mobile stacking without desktop positioning, and the
  bounded vertical/horizontal viewport structure. The affected test file passes 47 tests; typecheck passes;
  lint passes with zero errors and the two existing `no-require-imports` warnings in the RECORDS local-DB
  regression. `git diff --check` is recorded after this documentation update.
- Chrome 153 for Windows ran headless through CDP on port 9333 with the exclusive disposable
  `C:\\Temp\\opco-cdp-table-height-20260929` profile. Core used only the explicit `.env.local`
  `opco_dev@127.0.0.1:5432/opco_development` database and a process-only CORS allowance for Client at
  `localhost:3003`. Pixel captures, not DOM presence alone, confirmed: TABLE-only rows on pages 1 and 2;
  Estado filter and the empty state; search result `María González`; unchanged TABLE+KPI distribution;
  two 300 px TABLE modules meeting exactly without overlap; and a 390 px viewport with no page-level
  horizontal overflow. With six rows, the TABLE body had a 148 px client height and 295 px scroll height;
  scrolling made the final row fully visible while search and pagination remained fixed.
- Only two disposable local AppViews and their access rows were used for TABLE-only and multi-TABLE
  evidence; the existing TABLE+KPI AppView and entity records were read without modification. Legacy TABLE
  configs with `columns: []` remain the separate editor-hydration pending item and were not addressed here.
  No API, offline snapshot, schema, dependency, production, migration, commit, push, or deploy changed.

## Idempotent PATCH Client Technical Closure 2026-09-28

- The reviewed base is `a0d24a6dfc362004fad102bc586c564ef4471601` on `main`; all idempotent
  PATCH Client work remains uncommitted in this worktree. The final inventory is 11 modified files.
- The diff is limited to durable PATCH command recovery in the existing SQLite v10 payload, guarded
  remote reconciliation, affected API/sync tests, the stateful local-database regression, and
  architecture/audit/status documentation. There are no migrations, dependency, configuration,
  credential, local-environment, or generated-artifact changes in the publishable diff.
- Final checks passed with the API destination fixed to `http://localhost:3000`: typecheck, ESLint
  (zero errors and two existing `no-require-imports` warnings in the module-reload regression), 69 test
  files/817 tests with at most two workers, Web export/service-worker generation with SQLite WASM,
  and `git diff --check`. The generated `dist` remains ignored, local-only, and is not a production
  or commit artifact; its bundle contained localhost and not `https://web.opco.cl`.
- The previously approved three Chrome/CDP scenarios remain applicable because functional content did
  not change after them and were not repeated. Evidence remains local Web plus PostgreSQL: OPFS file
  persistence and replay behavior were observed, but raw `sentCommand` was not decoded from OPFS. The
  CREATE-to-UPDATE trace is still not one uninterrupted CDP trace, and the Access Handle/HMR observation
  remains a harness limitation rather than a completed multi-tab validation.
- Core implementing the optional idempotent PATCH pair must be published before this Client. Older
  operations without a durable command retain conservative conflict handling and gain no retroactive
  idempotency. No browser, production, commit, push, deploy, migration, or data write ran in this closure.

## RECORDS Remote Read Replay Guard 2026-09-28

- Cause demonstrated: after Core had accepted an idempotent PATCH whose response was lost, a detail/list
  read reached the shared `upsertRemoteRecords()`. The newer remote version was treated as an external
  conflict even though the UPDATE outbox still held the exact unresolved `sentCommand`; conflict status
  then excluded the operation from replay.
- Correction in the current worktree: the scoped remote upsert and sent-command check run in one SQLite
  transaction. While a valid unresolved `sentCommand` exists, reads preserve local values, its immutable
  values/key/`expectedUpdatedAt`, and `pending_update`. Commands without that descriptor retain the old
  conservative version-conflict behavior; Core-confirmed conflicts and definitive failures remain blocked.
- Stateful SQLite-harness evidence covers repeated remote reads, module restart, exact replay with one
  effective mutation, B preserved while A is recovered, later B synchronization with a distinct key, a real
  later remote-version conflict, legacy UPDATE, and refresh to a newer remote value after A resolves. The
  complete regression file passed 16 tests; the final combined affected run passed 5 files and 176 tests.
  Typecheck and `git diff --check` passed; lint passed with zero errors and two pre-existing
  `no-require-imports` warnings in the source-inspection regression.
- Real validation after the correction used Chrome 153 through CDP with exclusive disposable profiles, the
  actual Expo SQLite Web worker and six OPFS files. The database file persisted across full Chrome restarts
  and grew from 126976 to 131072/135168 bytes. The local export contained SQLite WASM and pointed to the
  process-only same-origin proxy at `localhost:3000`, which forwarded only `/api/v1` to Core local on
  port 3001; PostgreSQL was explicitly `opco_dev@127.0.0.1:5432/opco_development`.
- Lost A (`CDP_SENTCOMMAND_S1_20260928_1700`) was applied once, its HTTP 200 was discarded at
  response stage, and subsequent detail GETs kept A visible/pending without conflict. After restart, Client
  resent the exact key, `expectedUpdatedAt`, and values. PostgreSQL had one `RECORD_UPDATED`, one
  completed PATCH key, and final A; no third PATCH occurred and the final restart had no pending/conflict.
- B during uncertainty (`CDP_SENTCOMMAND_S2_FINAL2_20260928`) survived an offline close/restart.
  The trace was GET, exact replay A, GET preflight, PATCH B with a different key and A's confirmed version,
  then final GET. PostgreSQL ended at B with two mutations, two audits, two completed PATCH keys, and Client
  had no pending/conflict.
- Real later change (`CDP_SENTCOMMAND_S3_FINAL_20260928`) replayed A exactly, then B performed
  remote reads/preflight and became a visible conflict with zero PATCH B attempts. Client retained B while
  PostgreSQL retained the external value; Core recorded A plus the external mutation and only A's keyed PATCH.
- CDP observed behavior, requests, UI and OPFS file persistence, but did not decode `sentCommand` directly
  from OPFS. Preparatory full-document navigation reproduced the known Access Handle/HMR-style limitation;
  valid traces used one SPA instance and proxy gating before restart. Only the indispensable local Web export
  ran; no suite, migration, production, commit, push, or deploy action was performed. SQLite remains v10.

## RECORDS Lost PATCH Response Browser Blocker (Historical) 2026-09-28

- Real Client + Core validation stopped in scenario 1 after demonstrating a product defect. Chrome 153
  used CDP with an exclusive profile; Client was served at `http://localhost:3000`, Core at local port
  3001 through a process-only localhost proxy, and Core used the explicitly validated
  `opco_dev@127.0.0.1:5432/opco_development` database. The runtime loaded the Expo SQLite Web worker and
  its OPFS database file grew while the isolated profile was active.
- Synthetic record `CDP_PATCH_LOST_S1_20260928` started at Cargo=`Base`. Client sent A=`Taller-S1` with
  `clientRequestId=local_c9f8dfbd-433b-4aa1-9acb-be77bf45e5ed` and
  `expectedUpdatedAt=2026-09-28T18:38:05.672Z`. CDP observed the PATCH response-stage HTTP 200 and then
  aborted delivery, so this was a discarded response after Core, not a held response later released.
- PostgreSQL contained Cargo=`Taller-S1`, one `RECORD_UPDATED` audit event (`Base` -> `Taller-S1`), and
  one completed PATCH idempotency row for that exact key. Client retained the local value, but the
  mounted detail persisted `REMOTE_VERSION_CHANGED`/`conflict`; after a full Chrome restart with the
  same profile it still showed Cargo=`Taller-S1`, `Conflicto`, and global `Requiere atencion`.
- Cause: the detail load performs a remote GET after the failed delivery. `upsertRemoteRecords()` treats
  any version change on `pending_update` as an external conflict without checking whether the outbox has
  a recoverable `sentCommand`. `listPendingOperations()` then excludes the resulting `conflict` record,
  so startup cannot replay the completed idempotent command. The outbox descriptor was not extracted
  from the raw OPFS database; its runtime persistence is therefore not claimed independently here.
- Scenarios B-during-uncertainty and real other-user change were not run after this blocker. Two unused
  synthetic bases, `CDP_PATCH_LOST_S2_20260928` and `CDP_PATCH_LOST_S3_20260928`, were also created in
  local PostgreSQL. After evidence capture, all three synthetic records plus their four audits and four
  idempotency rows were removed; zero matching records remain. No functional code, schema, migration, dependency,
  configuration, production data, commit, push, or deploy changed; no suite or build was run.

## RECORDS Idempotent PATCH Integration 2026-09-28

- Client now derives PATCH `clientRequestId` from each UPDATE `intentId` and sends it with the durable
  `expectedUpdatedAt`. The exact command is persisted atomically as `sentCommand` inside the existing
  `pending_operations.payload_json`; SQLite remains schema v10.
- A later B keeps its own visible values/intent in the same row while unresolved A remains immutable in
  `sentCommand`. Recovery resends A directly without GET, consumes Core replay, advances B's remote base,
  then gives B a different key and the normal preflight. No value-equality inference or fallback to an
  unprotected PATCH was added.
- Network/5xx failures retain the exact command and perform one PATCH per sync invocation. Known success,
  conflict, or definitive failure removes only the matching descriptor. A result for superseded A leaves
  B `pending_update`; Core `REMOTE_VERSION_CHANGED` remains a visible durable conflict.
- Compatibility coverage keeps CREATE->UPDATE behavior and handles old UPDATE rows without `intentId` or
  `sentCommand`: they use existing `client_request_id` only for a new protected attempt after preflight.
  A version advanced by a possibly accepted legacy PATCH remains a conflict; no retroactive idempotency is
  claimed. Internal `intentId` is absent from the API body.
- Focused automated evidence uses controlled API behavior plus the stateful SQLite-shaped harness, not a
  real Core, network, browser, or Expo OPFS/WASM runtime. It covers accepted A with lost response and one
  effect, B during uncertainty, module restart, different A/B keys, real remote conflict, repeated network
  failures, legacy rows, and CREATE->UPDATE. Browser validation was intentionally not run in this stage.
- Validation on the final functional content: five affected test files passed with 192 tests and
  `npm run typecheck`, `npm run lint`, and `git diff --check` passed. No
  schema, migration, dependency, configuration, Core, production, commit, push, deploy, full suite, or
  build action was performed.

## RECORDS Lost UPDATE Response Characterization 2026-09-28

- Historical characterization before the idempotent PATCH integration showed that an accepted PATCH
  with a lost response became indistinguishable from another user's edit: the next GET saw a changed
  version, Client preserved local intent, skipped a second PATCH, and reported conflict.
- The integration above supersedes that runtime behavior for commands carrying durable `sentCommand`:
  Client now replays the exact keyed PATCH before evaluating the old base. The real remote-change control
  remains and still produces `REMOTE_VERSION_CHANGED`. Values are never compared to infer authorship.
- Legacy rows without a durable sent command retain conservative behavior and receive no retroactive
  idempotency claim. The original evidence used controlled API behavior and a SQLite-shaped harness, not
  Core, browser, OPFS/WASM, production, or real data.

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
