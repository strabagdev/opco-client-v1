# Current Status

## PANEL Release Gate 2026-09-22

- This Client candidate is not published and has no release SHA. Typecheck, lint, full Vitest suite
  (789 passed), web export, and service-worker generation pass. Core's habitual build remains
  blocked by Turbopack's internal port bind, so the Core-first publication gate is not met.
- Manual verification of the Core editor's newest save feedback remains pending. Once release checks
  pass, publish Core before Client; roll back Client before Core if the pair must be reverted. An
  older Client shows composed KPI as unavailable rather than calculating it locally.

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
