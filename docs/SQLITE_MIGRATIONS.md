# Local SQLite migrations (C-12)

## Opening contract

The singleton opens `opco-client-v10-epoch2.db`; schema version remains 10. The
existing single-flight initialization runs the schema DDL, conditional column
conversion/backfill, both legacy cache conversions, and `schema_version` write in
one `withTransactionAsync` on the same raw connection. No coordinated facade or
ready state is returned until COMMIT succeeds. Other consumers await that same
opening promise. Helpers do not start nested transactions. Existing record/outbox
transactions and synchronization are unchanged.

`PRAGMA journal_mode = WAL` is requested **before** BEGIN, because journal mode
cannot be changed inside a transaction. It is a request, not an assumption that
OPFS provides WAL: the isolated Chromium adapter reported `delete`. No new PRAGMA,
namespace, migration engine, queue, or transfer from `opco-client.db` is added.
Expo SDK 57 supports `withTransactionAsync` on Web; its non-exclusive nature is
safe here only because initialization holds the raw connection until completion.
See [Expo SQLite SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/#withtransactionasynctask)
and [SQLite journal_mode](https://www.sqlite.org/pragma.html#pragma_journal_mode).

A failed migration rolls back and keeps initialization unavailable. Retry uses
the existing opener; it does not reset the database or replay business writes.
An error after COMMIT can leave a valid converted database while the opener still
reports failure: the following explicit retry verifies it through normal opening.
Never advertise preparation success merely because the version row exists.

## Partial legacy conversions

Opening inspects both `app_views`/`app_views_legacy` and
`sync_telemetry`/`sync_telemetry_legacy`, even when the destination already exists
and `schema_version` is 10. These are the two existing conversions, not a generic
migration registry. The original mappings are unchanged: navigation without an
owner maps to `legacy`; contract telemetry without an entity maps to
`__contract_legacy__`. Neither mapping authorizes another user to consume it.

Automatic completion requires the known column types, nullability, defaults,
primary-key order and binary identity index; no extra indexes, hidden columns,
triggers, views, or foreign-key dependencies may make copying/dropping unsafe.
The source must contain the expected TEXT/NULL storage classes. Unknown shapes
are deliberately blocked rather than guessed.

- Old-shaped table only: validate, rename, create, copy and verify in one transaction.
- Known `_legacy` plus an absent or empty destination: copy missing mapped identities.
- Known partial/complete destination: existing mapped rows must match **every**
  source value with binary, NULL-safe equality. Insert only missing identities.
- Other owner/entity identities already in the destination are retained.
- Drop `_legacy` only after every source row has an identical mapped destination.
- Two possible old sources, conflicting values, unknown schema or dependencies:
  preserve both tables and roll back the whole migration, including earlier helpers.

Ambiguity is `MIGRATION_FAILED` with the static diagnostic prefix
`SQLITE_MIGRATION_AMBIGUOUS`. It exposes no row values, payload or SQL. The existing
single recovery communication explains that data and pending work were retained,
offers non-destructive Retry, and does not offer local reset for this condition.
Retrying an unresolved ambiguity reports the same recoverable failure; there is
no automatic loop, merge, overwrite, queue reset, or inferred ownership.

The old `updated_at_remote` backfill runs only for a non-NULL source and NULL
destination. Reopening therefore does not repeatedly write NULL into NULL. This
preserves values, including original DATE/capture/payload/clientRequestId.

## Tests and limits

The bounded C-12 lab uses synthetic owners, relations, RECORDS CREATE/UPDATE and
STATE_UPDATE create/update intentions with actual Expo SQLite/OPFS in isolated
Chromium profiles. Its only source hook observes the raw opener and holds declared
migration boundaries. SIGKILL interrupts a real process; injected JavaScript errors
and native SQL errors are separately labeled. Neither establishes a power-loss
guarantee or an observed production incident.

Schema 10 in this namespace is verified against published history. Older columns
and pre-owner/pre-entity cache shapes are **synthetic conditional fixtures**; do
not describe them as confirmed published epoch2 databases. C-02 namespace history
and C-09 catalogue completeness remain separate. No real profile is inspected.

Python SQLite fixtures use the native `complete_statement` API and `execute` each
complete statement on their persistent connection. `executescript` would implicitly
commit the caller's transaction and falsely model Expo's `execAsync`; this test-only
fix is kept separate from functional C-12. Tests for business transaction counters
first finish opening before installing their mock/fault, so they still test the
business operation rather than accidentally intercepting initialization.

Safari, native, real power failure, arbitrary unknown/custom database shapes, and
historical timeout causes are not accredited by these tests. Ambiguous local
states require diagnosis before any manual intervention. Rollback to the previous
app version keeps the same schema-10 namespace and pending work but reintroduces
non-atomic migrations and unchecked legacy leftovers; it cannot safely repair them.
