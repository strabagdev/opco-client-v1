# Current Status

## Selective Stabilization Candidate

This local release candidate is based on `origin/main` and contains only the reviewed functional
changes selected from `local/opco-stabilization-2026-09-19`:

- Shared SQLite connection coordination from `831a9ba`, plus the selected-date snapshot
  reconciliation correction extracted as `aafd629`.
- AppView loading, stable diagnostics persistence, bounded SQLite diagnostics, runtime activity
  feedback, and interrupted offline-preparation presentation from `ce47349`.
- Attendance recent records and count scoped to the selected logical date, with stale-response
  protection, from `40e32d3` and its isolated extraction follow-up `a296690`.

Diagnostics depends functionally on the SQLite coordinator because it consumes the coordinator's
typed in-memory snapshot. Attendance is functionally independent; its local-database changes merge
with the coordinator without changing transaction ownership, outbox behavior, or rollback.

The candidate excludes ENV-024, local API destinations, development-only guards, seeds, local
database tooling, credentials, data, and production configuration. Existing manual confirmation of
Attendance loading/date behavior and the offline banner was performed on the complete local
stabilization branch and is not repeated here.

Automated validation and remaining limitations are recorded in the final integration commit. Tests
using deterministic SQLite mocks do not validate the browser OPFS/WASM driver.

Publication is not authorized. Do not push, merge, or deploy this branch without explicit approval.
