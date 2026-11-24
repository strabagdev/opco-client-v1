# Attendance person presentation: one read resolver

Search, grouped detail and exact-record edit share the persisted subject presentation
hydrator through LocalDatabase.getSubjectPresentations. Core supplies optional verified
projections for items/latest/dailyRecords. A valid incoming projection is retained;
missing projections may be recovered only through the existing exact owner, contract,
AppView, source entity, configuration and fingerprint scope. Missing/incompatible
metadata keeps the identifier and the existing controlled presentation warning.
No projection is added to entity values, intention payloads or outbox. Record ID,
version, DATE, capture, context and clientRequestId do not depend on display data.

The existing Attendance presentation resolver delegates to this read-only facade and
batches duplicate people within a list read. Its earlier source-row fallback remains
for read-only adapters without the facade. The application singleton uses persisted
projection metadata and prepared source rows. This is display availability, never a
certificate of remote freshness, complete workflow coverage or additional permissions.

Exact-record editing resolves ID/alias/version before presentation. Every await and
error publication checks the original C-08 generation, scope and draft revision.
A later person/record/session retires the read. Group reads return null when retired
and carry their current guard through asynchronous row presentation. Existing list
subscriptions discard retired results/errors and may clear only their own loading
state. Search also scopes results/errors/finalization to its starting generation.
No silent fallback to another record, write retry or automatic save is introduced.

Core enrichment is additive; older Client works online with updated Core. Its old
offline edit limitation remains until Client is updated. New Client also works with
the published older Core, using already prepared compatible display data; if unavailable,
it keeps the identifier/warning. No migration, configuration change or policy activation
is required. Prefer Core first, then Client; either rollback preserves the storage format.
