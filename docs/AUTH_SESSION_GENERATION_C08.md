# C-08 — authentication generation and durable intent

Base: Client 6bd07023218e9d0bfcb561618b2631cd3c40c4c3. Local change only.

## Runtime authentication boundary

The existing API instance owns a transient generation. A login, organization selection
completion, logout or confirmed invalidation retires the previous generation. A refresh
within the same login does not change it. No generation, token or draft is added to SQLite,
OPFS, outbox or a new persistent namespace. Returning to the same account cannot revive an
in-flight authentication response from its earlier login, even if token bytes match.

Each authenticated request captures its generation. A stale 401/403 cannot refresh,
replace or clear the current credentials. Auth recovery checks the captured generation
before requesting refresh, storing credentials, invoking callbacks and replaying a command.
Tokens known to a retired login cannot start requests in another login. Runtime bootstrap
continues restoring its previously stored token and offline context through existing logic.

Only login/refresh/logout requests are cancelled when their generation is retired. This
also prevents a buffered old authentication response from installing its refresh cookie
after another login. A cancelled refresh may already have rotated on Core; reauthentication
is then required. The client does not invent or restore a cookie it never received.

Credential mutations share one transient promise in the existing API so that an asynchronous
native storage write already started by A completes before B commits its credentials. The
promise holds no business operation, retry policy or durable queue. Stale auth writes/callbacks
are rejected; logout cache cleanup and new-login context commits are ordered on this boundary.
No business writes are automatically replayed by this mechanism.

## Auth responses versus accepted writes

`OpcoAuthSessionChangedError` / `AUTH_SESSION_CHANGED` means authentication belongs to a
retired login, not a permanent business rejection. RECORDS and STATE_UPDATE use their existing
retry transitions: leave the intent available to its owner, retain identity/clientRequestId
and the exact payload_json (including frozen PATCH commands), do not mark failed or synced.
Existing error columns carry the reason; this error does not rewrite diagnostic fields into
the command payload. Remaining unattempted operations stay durable. A later valid login of
the owner can use the same commands. Genuine current-session errors retain existing policy.

A valid business response/ACK is different: it is not discarded merely because another user
is now active. The original engine reconciles only the original owner/operation, using existing
identity/version/idempotency protections. It cannot authenticate a replay through the new user
or publish old user counters/diagnostics into the current UI. Pending work is removed only by
the normal valid-result completion path, never by an obsolete authentication response.

## Necessary coordination dependencies

The existing lifecycle scope guard also compares authentication generation. All initiating
scopes, readiness keys and reconnect context commits carry it; a stale token value matching
the new token is insufficient. Finished foreground/startup flights release their own slot
without clearing a newer flight. No second coordinator, timer policy or sync engine is added.

The existing module-level sync promise is reused. A call for another owner/token/generation
waits for that flight, then evaluates its own scope and work. It does not receive A's result
as B's own ACK. This is the bounded C-11 dependency needed for recovery after reauthentication;
it is not a general single-flight redesign. UI guards discard stale counts/refreshes while
per-owner acknowledgement history can still be persisted for its original owner.

## Compatibility and evidence boundaries

Schema, SQLite/OPFS name, commands, clientRequestId, permissions, operational day, capture,
policies, snapshots and Core contracts are unchanged. Login/logout still preserve business
rows and outbox; explicit logout requires online authentication before offline use again.
No account, pending operation or storage is reset to repair a session change.

Regressions cover late expired/invalid responses, refresh already in progress, asynchronous
credential writes, A/logout/A, valid late ACKs, RECORDS and STATE_UPDATE retention/recovery.
Controlled authentication tests and full Core/PostgreSQL authentication tests must be reported
separately. A passing fake-auth test cannot establish cookie rotation or real Core author/audit
behavior. Safari/native and real-device platform behavior require their own evidence.

The historical notice reported for the real account remains unexplained. This batch does not
attribute it to these races and does not implement the broader C-11/C-13 audit.

## Manual diagnostic actions (C08-R1)

The full diagnostic route and the shell diagnostic panel consume the same existing
SessionProvider manual action. The route no longer keeps a duplicate sync/retry publisher.
Each manual action captures the current authentication generation and owner and claims a
transient identity before its first read. Repeated presses for that live scope do not start
another action. A new login can claim its own action while an older one is still finishing.

Diagnostic data, errors, completed manual runs and the busy indicator are projected only
for their captured generation/owner; a previous login's completed result is not exposed
while the new login is loading its own diagnostics. Results and errors
are published only if both generation and action identity remain current, including after
initial/readback/telemetry waits. Finally releases only its own reference; an old action cannot
clear a newer action's indicator. Retired callbacks cannot start sync or publish retry errors.
No timer, persistent state, queue or business retry policy is added.

A valid ACK remains processed by the existing engine/store for the original owner. The UI
checks run after that processing and suppress only the obsolete publication. They do not abort,
roll back or discard the receipt. The same boundary applies to A/logout/A with a new generation.
Regression tests cover late ACK, late read/telemetry errors, overlapping B action, same-user
reauthentication, duplicate presses and a retired manual retry. This does not close all C-13
read-only diagnostics or other renderer lifecycle cases; the change is the manual sync entry.
