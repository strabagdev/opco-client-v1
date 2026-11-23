# C-07: storage errors and explicit browser persistence diagnostics

This local batch extends published `2d1325ae37ef17ba67048a2180bc1fbbd8cf2c45`.
It changes neither schema/namespace nor RECORDS/STATE_UPDATE commands, identities,
outbox, synchronization, operational dates, or the C-06 lifecycle protections.

## Primary error and rollback

The C-04 error proxy also observes the installed SDK 57 asynchronous transaction
method. The SDK retains ownership of BEGIN, the callback, COMMIT and ROLLBACK.
An invocation-local dispatch proxy observes its execAsync failures and forwards
physical methods to the original connection. It never mutates SDK methods, opens
a connection, adds a queue, retries the callback or changes the atomic boundary.

If the callback, BEGIN or COMMIT rejects, that exact rejection remains primary
even when SDK rollback also rejects. Existing statement execution/read/finalize
details remain attached. A rollback failure is a secondary diagnostic. A rejection
not observed in those boundaries is still propagated, never treated as success.

Raw exceptions remain transient in the existing weak map. The coordinator and
diagnostic receive only phase, allowlisted code and reported numeric SQLite code;
no SQL, binds, message, stack, token or personal values. Primitive rejections retain
their value; as in C-04, they cannot carry weak-map diagnostics.

## Diagnostic → PWA → Protección del almacenamiento

The existing PWA tab includes persistence status (Concedida / No concedida /
No disponible / Desconocida), estimated usage and quota when available, a read-only
refresh and an explicit request action. No other operational indicator is added.

Mount and refresh call only persisted() and estimate(), never persist(). The request
starts only after its button is pressed, within that action's gesture. Double clicks
are blocked synchronously; one request is permitted per mounted diagnostic section.
Refresh does not re-enable it. Reopening the section permits another deliberate
action, never an automatic retry or recurring permission prompt.

No flag is persisted to certify protection. Each query observes the browser again;
unavailable APIs and exceptions do not block the application or business saves.
The functions do not read or write SQLite, records, cache, outbox or session data.
Native/server contexts without StorageManager report unavailable.

Estimates are not guaranteed space. Granted persistence is not a backup and does
not prevent explicit deletion. It does not prove integrity, completeness or server
synchronization. A denied request is shown without stopping work. Unknown is not
silently interpreted as denial or permission granted.

## Verification boundaries

Unit tests cover SDK failure phases/secondary rollback, unchanged physical methods,
next transaction, safe diagnostics and the four StorageManager states. Chromium
verification uses only isolated synthetic data, actual Expo SQLite/OPFS and the real
RECORDS form. SQLite max_page_count produces a real SQLITE_FULL from an artificial
small database limit; injected exceptions at outbox/commit boundaries are identified
separately. StorageManager outcome controls are not natural browser permission grants.

The earlier quota experiments remain inconclusive for failure during the target
save; the two large-input CDP timeouts remain failed harness runs before saving.
This batch does not repeat them until green or claim physical disk exhaustion,
automatic eviction, Safari/native, or mobile-device behavior was tested. No new
backup, data recovery, cleanup or automatic reset mechanism is introduced.
