# SQLite lifecycle — C-06

Local implementation, 2026-11-22. Based on published Client
`e0ece91636a3a142292ccfed063b67aa997a0769`. No schema or namespace change:
`opco-client-v10-epoch2.db`, schema 10.

## Exit, suspension and explicit close

- `beforeunload` never closes SQLite. The event can be canceled while a save is
  still running. The native confirmation dialog used by the regression harness
  is a test condition, not an existing normal application dialog.
- `pagehide.persisted=true` suspends the document for BFCache. Keep the singleton,
  connection and coordinator. Restoration of that document continues with those
  objects; no extra `pageshow` reopening is needed.
- `pagehide.persisted=false` requests a best-effort, non-destructive close. The
  browser is not expected to await the promise, and may terminate without events.
- `closeLocalDatabase()` is an explicit, awaitable, non-destructive close. Concurrent
  requests share the same promise. It also waits for any initialization/migration
  already opening the connection.

The close uses `exec:close` on the existing SQLite coordinator, after SQL work
already admitted. It cannot close the handle in the middle of a transaction. A
single transient `closePromise` on the existing singleton fences new access while
closing; no second queue, persistence mechanism or global data cache is introduced.
Only after `closeAsync` succeeds are the database/migration references cleared.
The coordinator clears its own tail normally; lifecycle never discards that tail.

Later calls wait for close before using the normal single-flight opener. A caller
may retain the coordinated facade between SQL statements (including RECORDS reads
after COMMIT). Such a facade reacquires the current connection **before admitting
its next SQL call**. It does not replay a statement or transaction already executed.
Raw transaction callbacks finish on their original physical connection before close.

An explicit close is a barrier for admitted SQL, not a promise that every asynchronous
application task has finished. A later SQL step of an existing logical save may
reopen through the singleton. It cannot open during the physical close. The UI's
save confirmation remains after the real store resolves; unconfirmed work must not
be advertised as durable merely because an exit event ran.

## Errors and recovery

An explicit close failure rejects its caller and remains an error in the existing
coordinator. A rejection cannot prove whether the physical connection is open,
closed or no longer addressable by the SDK. Retain its references in quarantine,
mark the existing storage state `unavailable/CLOSE_FAILED` and never return that
handle or admit further SQL, including through a retained facade. Diagnostics expose
only `SQLITE_CLOSE_OUTCOME_UNCONFIRMED`, not the original exception text.

On `CLOSE_FAILED`, SessionProvider keeps its existing child subtree mounted but
hidden from interaction behind the same global recovery screen. Form values remain
in React memory; no draft is persisted and no SQL is admitted through quarantine.
The recovery screen remains the only communication sector for this failure.

The existing explicit **Reintentar** flow first presents a confirmation in that
same screen: reloading the whole page loses unsaved form changes, while committed
records and outbox entries remain. **Cancelar** dismisses only that confirmation;
it does not unmount the form, reload, write or recover the uncertain connection.
Only **Recargar página** invokes the existing reload callback. It reloads once
after explicit confirmation; no automatic close
retry, SQLite probe or SQL replay runs in the uncertain worker. A new document
releases the old worker/handles and opens the **same namespace** using the normal
single-flight initializer. There is no deletion, outbox reset or operation restart.
If reopening fails, the existing explicit initialization retry remains available;
there is no infinite loop. A refused reload permits a later explicit click.

Repeated close, read, retry, diagnostic and destructive-reset requests in a quarantined
runtime cannot open a competing connection or discard data. A non-web runtime without
a reload API asks the user to close/reopen the application without clearing storage;
that physical native lifecycle is not accredited by the web tests. The terminal
pagehide caller consumes a rejection to avoid an unhandled exit promise. The initial
OPFS availability-probe flow remains specific to ACCESS_HANDLE_BUSY and is not
started automatically for a close failure.

Read-only recovery summary and initialization retry also wait for an ongoing close.
The existing **explicitly confirmed destructive recovery**, not invoked automatically,
uses the same close fence through its existing database deletion. No reader can
reopen between close and that confirmed deletion. Its confirmation requirement is
unchanged; C-06 does not add a new reset path or use it on user data.

Initialization failure and the recovery summary's private fallback handle retain
their existing disposal ownership: these are not active shared coordinator handles.

## Invariants and validation

RECORDS and STATE_UPDATE keep their existing atomic row/outbox transactions,
identities, owner scope, commands and clientRequestId. C-01 syncing recovery, C-04
statement error preservation and C-05 progress/read consolidation are retained.

Regression coverage includes:

- canceled native exit during a transaction or queued preparation;
- close/reload before and after COMMIT, abrupt termination and reopen;
- explicit close behind active/waiting SQL, retained-facade continuation and no
  additional opener during a delayed close;
- opening/migration, transaction failure, close failure and confirmed recovery fence;
- rejected close before/after its physical effect, quarantine, concurrent callers,
  explicit document reload, failed reopen and later successful retry;
- interrupted preparation, owner isolation and integrity of committed row/outbox pairs;
- persisted pagehide without disposal, followed by continued access.

The browser harness uses synthetic data and the real SDK 57 worker/WASM/OPFS. Its
confirmation observer runs after the real store resolves; it does not substitute
for a full renderer UI test or real Core idempotency evidence. The canceled-exit
guard is added by the harness only. Do not infer historical data loss from it.

The isolated Chromium run demonstrated 12 real BFCache restorations (same
`performance.timeOrigin`, trusted `pageshow.persisted=true` and the original
connection), including open transactions and preparation with waiting saves. The
server used cacheable resources and cross-site navigation to obtain that coverage.
This does not prove BFCache eligibility of the deployed application on every
browser. Safari/native and host power-loss remain unverified. A simulated persisted
event alone is not evidence of real document retention/restoration.

SDK reference: [Expo SQLite SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/).
Event references: [pagehide](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event)
and [pageshow](https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event).

## Integration review on published 62280d6 — 2026-11-23

The local C-06 candidate is composed on 62280d6be0f98a50331c884a02795cc9617d16bf,
including mandatory operational-day Attendance creation and C-01/C-04/C-05.
The nine C-06 source/test files retain the exact content accredited on 556aebf;
this review adds no functional behavior. Existing stored intents, DATE, capture,
identities and clientRequestId are not reinterpreted. C-02 remains separate.

The two original 5-second timeouts (home-preparation-reuse and
state-update-current-batch) and the subsequent partial-prewarm timeout have no
demonstrated cause. Prior passing runs do not resolve or classify them. A bounded
new-base comparison is defined before execution: one full suite per tree, same
observer, historical leading file order, dependencies, single worker and unchanged
limits. No browser/build runs concurrently with those suites. Observations capture
worker replies, opening/closing/coordinator waits and late worker exits without
SQL arguments or sensitive values; they do not prove an unavailable historical await.
The non-awaited fixture-worker termination remains a demonstrated harness issue,
not a demonstrated cause of those timeouts. It is not patched into this candidate.
Publication remains NO-GO while that uncertainty is open. Safari/native, power-loss
and production BFCache eligibility remain unverified.
