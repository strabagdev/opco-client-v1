# Offline revision HTTP test harness — 15-11-2026

This test-only correction follows the general reuse candidate. It changes neither application code nor
Core/API, SQLite schema, namespace, outbox, synchronization, permissions or the Attendance policy.
New generic gates remain off by default. No production operations are part of these tests.

## Timing and fixture lifetime

Vitest's test deadline does not cancel an async test body. Closing/resetting the SQLite fixture while
that body still runs can leave work targeting an ended Python SQLite transport or a later mocked handle.
The HTTP tests now register their complete body promises. Teardown drains these promises before closing
the database, resetting the singleton mock and restoring spies. Rejections still propagate to Vitest;
there is no retry or replacement of a failed assertion. A deadline still fails the test, and the existing
hook deadline remains effective if cleanup cannot finish.

The large-day fixture previously compiled/loaded Core domain modules in two synchronous child processes
inside the same 5000 ms test budget, to insert and remove ten synthetic events. Measured controls took
about one second each. In the base control all HTTP responses and preparation had completed, but the
fixture cleanup pushed the test past its budget. In another control SQLite work was still pending when
teardown requested closure. Neither observation establishes a hanging Core HTTP response.

Only synthetic setup/authentication/row creation and deletion move to fixture hooks for that case.
The actual workflow read, full ordinary preparation and assertions remain inside the test body. The
same eight AppViews, 201 subjects, monthly pages and contextual data are prepared; the harness does not
narrow `prepareAppViewIds` or reduce coverage to obtain PASS. No timeout values change: the ordinary
5000 ms test and 10000 ms hook defaults are preserved.

## Revision assertions

A retained receipt inspected without a remote manifest is provenance, `remote_unchecked`, not freshness.
A failed refresh must preserve an intact compatible copy. Tests no longer demand unconditional retirement
merely because a refresh was interrupted:

- A real 409 between source/catalog pages preserves the previous rows. A fresh manifest must differ
  from the retained vector; inspecting with that manifest must reject the old proof.
- Interruption without a remote change preserves the catalog receipt's snapshot ID/hash across SQLite
  reopen. The same remote vector can yield `match_shadow`, while `reuseAllowed` remains false. A later
  successful download must commit a new receipt.
- When data changes during preparation, V2 can reject the expected vector during final negotiation,
  before the older per-read comparison. The test verifies the vector actually changed, all independent
  Attendance days completed and no mixed receipt was certified, then expects
  `REVISION_NEGOTIATION_REJECTED` at this demonstrated boundary. Production error mapping is unchanged.

The first two checks implement the existing PREPARATION_RECEIPT_LIFECYCLE contract; they do not create
new reuse permissions or accept unprepared data.

## Validation and limits

The affected HTTP groups are opt-in through `REVISION_PREPARATION_HTTP=1` and `CATALOG_HTTP=1`.
They require a full isolated Core at the guarded loopback endpoint, an owned synthetic PostgreSQL
fixture and the private fixture/control paths expected by the tests. Never point them at production,
reuse production credentials or relax destination guards. Reopen tests continue to use real SQLite files.

Passive diagnosis used disposable test copies, recording endpoint templates, response completion,
phase durations and SQLite counts/timing only. No records, SQL parameters, credentials or response
payloads were retained in the deliverable. That observer is not part of the candidate or web bundle.

Four of the six previously reported timeouts did not recur individually in either base or candidate;
two exposed historical assertion failures in both. This does not prove the exact historical timing cause
of every initial failure. The concrete fixture-budget/lifetime defects and stale assertions are corrected;
no general offline reliability or historical incident resolution is claimed.
