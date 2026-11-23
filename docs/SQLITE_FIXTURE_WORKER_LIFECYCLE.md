# SQLite fixture worker lifecycle

The Python/SQLite fixture in `state-update-prewarm-current-investigation.test.ts`
must finish its child process before resetting the test singleton, removing its
temporary directory, or opening the next fixture on the same database file.
This is a test-only correction, independent of the C-06 application lifecycle.

`ChildProcess.kill()` sends a signal; it does not await termination. The Node
`exit` event also does not establish that stdio has closed. The fixture registers
its `close` listener immediately after spawning and shares one stop promise
between `closeAsync`, teardown, and reopen. It keeps the existing SIGTERM
behavior, waits for `close`, and then reports any worker error or abnormal exit.
No sleep, retry loop, or test timeout increase is used.

Teardown and reopen await that promise before resetting the singleton or touching
the temporary database directory. A failed stop prevents those later steps;
the existing test deadline exposes a worker that cannot terminate. This helper
does not change application SQLite, the coordinator, transactions, or outbox.

Regression coverage includes a real worker and persisted value across reopen,
single-flight stop, the distinction between `exit` and `close`, immediate close,
listener cleanup, and an error that must not let cleanup advance before close.

The comparison plan applies the identical fixture change to published base
`62280d6be0f98a50331c884a02795cc9617d16bf` and preserved C-06 tree
`a614fef56f9289cfd9956203f5a834a54a7a84c9`. It uses one complete suite per
version with the same file order, one worker (the repository default), 5-second
test deadline, 10-second hook deadline, and no retries. A separate negative
control retains the old cleanup and checks the new real-worker regression.

The original five-second timeouts did not capture the outstanding await or
scheduler/disk conditions at failure. Correcting the demonstrated cleanup race
does not establish that it caused those historical failures. Passing executions
must not be presented as that causal evidence.

Node reference: [ChildProcess close, exit and killed](https://nodejs.org/download/release/v20.19.5/docs/api/child_process.html#event-close).
