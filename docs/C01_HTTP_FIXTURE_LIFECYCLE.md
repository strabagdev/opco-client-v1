# C-01 HTTP fixture startup

This is a test-only change, independent of the Attendance band-notice candidate
`d92c0250fe36bfe153f22728472ca131e22b1228`. Application code, commands, owners,
SQLite/OPFS and sync are unchanged.

A paired full-suite investigation on published base `3f0cf5e` and that candidate
captured `EPERM` from `listen(127.0.0.1)`. The old startup promise waited only for
success and never rejected on the server's `error` event. Thus `beforeAll` reached
the unchanged 10-second hook deadline and all eight C-01 cases were skipped.
There were no requests, accepted sockets or child runtimes. `afterAll` and its
`server.close` callback completed immediately. The earlier report attributing
this run to an `afterAll` connection leak was incorrect. The older JSON-only
report does not establish its underlying errno; other historical timeouts remain
unexplained.

The existing fixture now rejects its startup promise with the original listen
error and removes only its own startup listeners on success or failure. It does
not change server shutdown, process termination, assertions, worker concurrency,
hook timeouts, or force pending operations to complete. A denied bind remains a
failed test run with an explicit error, not an approved or skipped integration.

`src/test/http-fixture-lifecycle.test.ts` extracts the real startup function and
checks asynchronous rejection within the same microtask turn, successful startup,
synchronous rejection, and listener cleanup. Its error observer models the test
runner observing an error; observing it must not be confused with settling the
fixture's promise. The async-rejection case fails against the previous startup
expression and passes after the fix, without a sleep or increased timeout.

The normal Vitest configuration uses `maxWorkers: 1` for both compared trees.
Real C-01 recovery still requires permission to open loopback HTTP. Persistent
HTTP opt-in suites are separately classified and are not credited by this fixture
regression. No real user queue, profile or production endpoint is involved.
