# Current Status

This is the short handoff for the current repository state. Verify the code and Git diff before acting; use Git history for exact commits.

## Current State

- Latest task: `OPCL-STATUS-023`.
- The app shell centralizes visible experience activity, pending work, synchronization, and scoped write confirmations in one non-interactive header indicator.
- Local persistence and Opco-confirmed writes remain distinct. Errors and conflicts keep priority.
- Generic RECORDS cache/save banners and general workflow local-save notices were removed only where the header provides equivalent feedback. Contextual validation, conflicts, offline coverage, pending badges, retries, and recovery remain local.
- The wide header uses equal left/center/right zones. Compact layouts move status to a centered second row.

Detailed behavior and priority rules: [CLIENT_ARCHITECTURE.md](CLIENT_ARCHITECTURE.md#app-shell-status).

## Key Files

- `app/(app)/_layout.tsx`: header layout, presentation timeout, shared status rendering, and diagnostics integration.
- `src/lib/app-shell-feedback.ts`: canonical status priority and label resolver.
- `src/lib/write-feedback.ts`: scoped transient write result with monotonic ids and stale-clear protection.
- `src/state/use-write-feedback.ts`: React subscription to write feedback.
- `src/lib/sync-status-diagnostics.ts`: existing checklist/history/copy integration; no parallel write history.
- `src/renderers/records/RecordFormScreen.tsx`: emits local confirmation after the atomic RECORDS save.
- `src/renderers/workflows/attendance/AttendanceWorkflow.tsx` and `state-update/StateUpdateWorkflow.tsx`: emit local or server-confirmed results from existing write paths.
- `README.md`: project orientation and links; this file is not the detailed behavior specification.

## Validation

- `npm run typecheck`: passed.
- `npm test`: 67 test files and 765 tests passed.
- `npm run lint`: passed without warnings.
- `npm run build`: passed.
- `git diff --check`: passed before publication preparation.
- Chromium and Playwright were not used. Structural/unit coverage does not replace visual review.

## Pending

- User visual review of true header centering, long labels, and second-row behavior on desktop, tablet, and mobile.
- User visual review that save confirmation remains visible during a concurrent refresh and that contextual workflow feedback remains sufficient.
- Confirm the exact production deployment and active public bundle after publication; HTTP availability alone is insufficient.

For offline/outbox behavior, read [STATE_UPDATE.md](STATE_UPDATE.md). For architecture beyond app-shell status, read only the relevant section of [CLIENT_ARCHITECTURE.md](CLIENT_ARCHITECTURE.md).
