# Form continuity and catalog coverage during offline preparation

Local C-09 follow-up on Client `09378ad3`, 2026-11-26. No change to preparation
scope, sync engines, SQLite namespace/schema, permissions or durable checkpoints.
The navigation-read optimization is outside this change.

## Compatible credential renewal

The existing AppView hook keeps its assigned Attendance view during revalidation
for the same owner, contract, AppView and authentication generation. Identical
remote definitions retain object identity. This avoids an initial-loading branch
unmounting the form during a refresh-token exchange. It does not grant writes:
existing workflow authorization, command and snapshot checks still apply.
Logout, a new generation (including the same user logging in again), another
owner/contract, an unassigned view or an explicit authorization denial retires the
old view. A response from a retired hook/generation cannot publish its catalog.

A resolved required RELATION catalog remains usable during compatible credential
refresh only for the same criteria, field/record scope and generation. A selected
ID still must be present and valid; unknown, unresolved or denied selections do
not become valid merely because a request is refreshing. Restored simple-relation
metadata explicitly matches Core's `multiple: false`; field-key comparison is
canonical so property ordering alone does not retire that compatible catalog.

## Stable definitions versus query provenance

All prepared workflow definitions pass through the existing normalizer. A valid
search-comparison contract keeps its version, source, fields, policies and verified
fingerprint; its persisted `applied` mode describes the definition. The actual
response retains its query provenance (`global`, `field`, or `record`). Offline
matching continues to use the configured comparison policy. Corrupt/legacy metadata
that cannot be verified is retained unchanged for the existing fail-closed readers
and diagnostics, never canonicalized into a valid comparison or certificate.

A query alone therefore does not change the catalog receipt hash. Real metadata,
configuration, scope, permission, revision and epoch differences still fail the
existing receipt checks. This neither relaxes the content hash nor retroactively
certifies a partial/invalid old snapshot. Old incompatible receipts require the
ordinary download and verified sealing path.

## Visible coverage after sealing

The selector reuses the existing assigned-preparation execution subscription. It
reads catalog facts once when observed work becomes idle, after `finish()` and
its seals, not on the earlier `completed` telemetry or every progress update.
This is a read-only projection of existing receipts/checkpoints. No new persisted
availability state, cache, coordinator, timer or polling is introduced.

Facts are updated independently from relation options: sealing does not restart a
page query, reset the form, or reload every catalog. Read sequence, request and
session guards prevent an old fact read overwriting a newer scope/read. A failed
preparation does not turn partial coverage into complete coverage. The global
`completed` telemetry retains its existing coarse meaning; it is not itself a
coverage certificate. Real missing dependencies/receipt failures remain visible.

## Person reads and draft edits

The current exact-person read has an opaque in-memory operation identity. Editing
observation/context values does not retire that identity read. Another person,
search, record edit, scope, session or unmount does. A late read/finally cannot
complete a newer read's indicator. Existing values edited during a pending read
are not overwritten by returned defaults. The same person-read ticket records whether
observation input was explicitly edited; returning to the original text or clearing
it is still an edit. Only an untouched observation can receive a remote default.
Context-only edits do not mark the observation. The marker is in memory, belongs
to that one read, and retires with it on another person/record/session. It neither
cancels the identity/DATE read nor persists a draft or changes a write command.

The existing communications sector explains the read, and only confirmation is
blocked until required identity/date information is available. An unavailable date
proof is distinct from a demonstrated operational-day change: the former retains
the draft and requests a successful read; the latter preserves the existing
reselection protection. DATE and capture still derive from the same definitive
confirmation instant. Pending intents, repetition policy, manual status choice,
context requirements, command identity and synchronization are unchanged.

## Validation boundaries

Unit/handler tests are distinct from real Core/authentication/PostgreSQL and
Chromium/OPFS evidence. Review the accompanying C-09 report for exact versions,
controls, zero-intent scenarios and the explicitly permitted synthetic write.
Safari/native, historical timeouts and C-13/C-14/C-15 remain separate. No production
profile, data, configuration or pending queue is used by the isolated fixtures.
