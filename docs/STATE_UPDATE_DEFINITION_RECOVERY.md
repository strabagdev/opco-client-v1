# Operational definition recovery before STATE_UPDATE

An operational-day command retains its original DATE, eventOccurredAt, calendar key,
identity and clientRequestId. Missing workflow metadata is not evidence of a changed
calendar. This correction is separate from the Attendance UI generation/action guard.

The existing sync engine first reads the owner/contract/AppView definition. Matching
metadata can follow the existing validation/write path. If metadata is absent, belongs
to a different scope, is unusable, or its calendar does not match the retained command,
the engine reuses loadAppViewsWithCache and the authenticated assigned-AppViews API.
Only a fresh remote result can authorize recovery: its offline/cache fallback cannot.
No business POST occurs until the matching assigned workflow config is available.

The recovery uses the original owner's token and C-08 generation, checks it after
awaits and before the write, and keys the existing read by generation. Work is shared
only within the run and exact contract/AppView/target scope. A retired response leaves
the intent retryable for its owner; it cannot send using another user's credentials.
The normal scoped navigation cache may be populated by the existing loader. This
config-only recovery does not fabricate a prepared workflow definition, receipt,
complete record coverage or offline-ready marker. Ordinary preparation owns those.

Unavailable transport, API failure, absent assignment or unavailable recovery
capability produces STATE_UPDATE_DEFINITION_UNAVAILABLE (existing retry transition).
It preserves the original command fields and does not introduce automatic retry loops.
The existing generic error writer may append lastErrorDetails/lastErrorHttpStatus
diagnostics to its JSON envelope; the outgoing command, DATE, eventOccurredAt,
identity and clientRequestId remain unchanged. AUTH_SESSION_CHANGED retains its
existing byte-preserving path. No serializer or storage engine is changed here. A verified
removed calendar still produces OPERATIONAL_CALENDAR_CHANGED; a verified changed
key keeps OPERATIONAL_DAY_REVIEW_REQUIRED. A stale cached mismatch is revalidated
before concluding a remote change. Core continues to check versioned writes atomically.
Other workflows/legacy intentions retain their existing behavior.

Previously failed operations are not selected automatically and are not reset or
reclassified by this fix. Their owner must review the specific operation and use the
existing individual retry action/manualRetryToken when appropriate. That action
retains the same local identity, original command fields, DATE, capture and request
ID; the normal recovery/compatibility checks run again. It removes only existing
error diagnostics as implemented by the retry action. A genuinely changed calendar
continues to require review; this fix never rewrites an old intention to a new day
or policy. No mass retry, SQL repair, deletion, migration or reset is part of this lot.
