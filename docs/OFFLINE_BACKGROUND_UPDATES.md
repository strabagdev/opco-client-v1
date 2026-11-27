# Background preparation and experience continuity — C-09 separate follow-up

This local follow-up is based on the intact C-09 candidate `7f133f6f` (commit
`7c1b7a46`). It does not publish that candidate, alter its commit, or change the
preparation scope, SQLite format/namespace, outbox, commands or sync engines.

## Relevant invalidations through the existing channel

The existing local-database cache notification carries a change kind and, where
applicable, its owner and contract. Existing unfiltered subscribers remain valid.
A scoped subscriber receives its matching committed changes and a global navigation
reset. No second bus, coordinator, cache, persistent state or timer is introduced.
Notifications occur after the same successful writes as before; progress and every
coverage checkpoint remain durable. A failed list write cannot announce a new list.

Navigation invalidates for `navigation` commits to its assigned AppView list, not
for snapshots, monthly hydration markers, unrelated definitions or another owner/
contract. List writes now explicitly invalidate that reader. Publication retains
the existing catalog object when its complete content, scope and session generation
are identical. A changed assignment/definition is published normally. Old queued
reads cannot replace a newer publication, scope or authentication generation.

Sync-attention readers consume `records`, `sync` and `definition` changes, since
these can change actual pending problems or their interpretation. They do not reread
on coverage-only progress. Home still receives its coverage changes using its
existing coalescing reader, filtered to its active owner/contract. A notification
is an invalidation, never a certificate of completeness or permission to write.

## Compatible revalidation versus a different operation

The existing AppView hook retains any already resolved assigned renderer within
its original owner/contract/view/auth-generation scope during compatible renewal.
RECORDS and STATE_UPDATE therefore keep their unsaved form too, without a parallel
draft store. Explicit authorization denial/unassignment still retires the view;
changed configurations publish their actual new definition, never an old substitute.


A day refresh updates the day snapshot and total; it does not own or empty an
already compatible person-search result list. Explicit search/person/date changes
continue using their existing handlers. A real owner, contract, configuration,
consultation scope or authentication-generation change retires old search results
and request identity through the existing scope guard. Credentials renewing within
one generation do not create another owner or definition.

An initial local metadata read superseded by a search finishes its own loading
indicator before returning. The existing request-ID guard prevents it finishing a
newer loading operation; a retired effect/session cannot publish that completion.
This corrects a reproduced stuck visual read after completed preparation, not a
proved cause of the historical productive 6/7 interruption.

A temporary HTTP 5xx when reading the assignment list uses its existing validated,
owner/contract-scoped cache fallback. It remains `fromCache/offline`, does not
advance the last successful timestamp or certify freshness, and the failed request
remains in diagnostics. Authentication, permission, missing-view and compatibility
rejections (including 401/403/404/409/426) never use this fallback.

RECORDS rechecks its entity metadata during compatible renewal. If the exact form
scope and canonical definition are unchanged, it does not reinitialize values,
initial values, record/version or submission state. It does not refetch the record
merely for credential renewal. A new record/owner/session or explicit retry uses a
new load scope; a real schema change follows normal initialization and asks the
user to review the updated fields. No write command or synchronization logic changes.

No unconfirmed draft is persisted by this change. Inputs, selection, dialog and
focus live in the existing mounted form. The original C-09 guards remain responsible
for exact-person reads, calendar checks at definitive confirmation and compatible
form retention. Reopening after closing a browser does not promise recovery of an
unsaved in-memory draft. Existing durable records/intentions are unchanged.

## Preparation facts versus an actionable communication

The relation resolver continues reading and certifying local catalog facts without
altering their completeness, revision, authorization or content checks. While online,
local preparation completeness alone is not an inline reason to stop an independently
resolved valid selection. That advisory stays available through existing diagnostic/
availability readers. Actual selected-ID resolution errors remain visible and prevent
invalid selections from becoming valid. Offline partial, empty, unavailable and
unprepared catalogs retain their truthful warnings. Mandatory contexts remain
mandatory before searching/scanning or confirming.

Preparation status, its errors and the repeated-read diagnostics stay in the existing
shell/diagnostic sector. This does not turn `completed` into a coverage certificate,
or `Sin pendientes` into offline readiness. A failed or incompatible dependency is
not relabeled complete to preserve visual stability.

## Validation boundaries

Compare the original candidate and this follow-up with the same synthetic Core,
authentication and PostgreSQL and distinct owned Chromium/OPFS profiles. Count local
reads, notifications, GETs, mounts and interaction identity/cursor/scroll/dialog,
not renders alone. Distinguish deterministic hook tests from real browser evidence.
Keep failed harness preconditions and incomplete tests explicit.

The reported productive `6/7 interrumpida` remains unassigned: its run ID, missing
dependency and interruption cause were not in the supplied later active-run block.
Isolated interruption/failure/cancellation checks cannot identify that older case.
No productive result is closed until separately authorized publication and observation
on the affected device. Historical timeouts and Safari/native limits remain open.

## Terminal diagnostics across credential renewal

A preparation can finish using the credential captured by its existing flight after
its observer has received a compatible refreshed token. The coordinator intentionally
filters live diagnostics by that token. The existing recovery hook now reconciles
once on the observed active-to-idle edge when the current observer has no diagnostic.
It reads the existing owner/contract-scoped receipt/diagnostic; it does not adopt an
unscoped callback, download another preparation or turn that terminal into a coverage
certificate. A terminal already visible to the token does not trigger another read.

All callbacks and reconciliation guards also require the C-08 authentication
generation. Logout/new login, including the same owner, invalidates the previous
observer immediately; an obsolete completion cannot publish into the new scope.
Mounted forms and outbox processing are unchanged. No timer, persistent state or
second reconciliation mechanism is introduced.

The four prior full-suite test expirations remain recorded separately. Directed
assertions can substantiate a functional guarantee without resolving their cause.
The reported 6/7 interruption and newly supplied visual observations have no matched
run/bundle/time evidence; do not infer that they are this terminal-observer defect.
