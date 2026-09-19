# Current Status

## Review Candidate: SQLite Coordination

This branch contains only the shared SQLite connection coordinator from stabilization commit
`831a9ba`, based on `origin/main`. It serializes connection access across RECORDS, workflows,
cache, sync and diagnostics; nested transaction helpers receive an explicit transaction context.
Rollback propagates, queued work continues after failure, and no retry policy was added.

The regression harness uses a deterministic SQLite API mock. It does not validate Expo Web's real
OPFS/WASM driver, multi-tab behavior, or browser rendering.

Publication is not authorized. Do not push, merge, or deploy this branch without explicit approval.
While extracting the candidate, its focused regression exposed that snapshot reconciliation had
changed the pre-existing date predicate to `date IS NOT NULL` while still binding the selected date.
The candidate restores the exact selected-date predicate, preventing a complete snapshot for one
day from deleting synced rows from other days.

Validated with 89 local-database tests, TypeScript, lint and a web build. The complete Client suite
was run on the stacked diagnostics candidate. Browser OPFS remains unverified for this isolated
branch; the user previously confirmed the full stabilization branch manually.
