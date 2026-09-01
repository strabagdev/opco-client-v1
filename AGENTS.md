# Opco Client

## Project

- Opco Client is an Expo SDK 57 / React Native / Expo Web app.
- One generic client serves multiple organizations, contracts, and AppViews.
- Do not create a separate client or app path per entity.
- Opco is the source of truth when online.

## AppViews / Renderers

- `AppView.type` defines the renderer category: `RECORDS`, `WORKFLOW`, `REPORT`, `BOARD`, `DASHBOARD`.
- `WORKFLOW` selects concrete behavior with `config.workflowKey`.
- Do not add AppView types for specific workflows such as attendance or inspection.
- The renderer registry must resolve by `type` plus `workflowKey`.
- Unknown `workflowKey` values must fail with a controlled unsupported workflow UI.
- `REPORT` is supported as a read-only consultation/presentation AppView, with `TABLE` and `MATRIX` modes, `timeFilter` `RANGE`/`MONTH`, and `valueDisplay` `LABEL`/`INTERNAL_VALUE`.
- `BOARD` and `DASHBOARD` remain visible AppView types but currently resolve to controlled unsupported UI.

## RECORDS

- `RECORDS` is a generic renderer for dynamic entities.
- `RELATION` values show `displayName`, never technical IDs.
- `DATE` is date-only and timezone-safe. `TIME` is `HH:mm`.
- Respect backend display configuration such as `showInList`.

## Attendance

- Attendance is `WORKFLOW` with `workflowKey = "attendance"`.
- API/domain statuses are `PRESENTE` and `AUSENTE`.
- Attendance is an adapter/preset over the shared `STATE_UPDATE` runtime and uses configured `statusFieldId`, `personFieldId`, `dateFieldId`, optional `observationFieldId`, and optional `contextFieldIds`.
- UI/config identity for options is `optionId`; labels are display text and must not be used as identity.
- For SELECT context/state extra fields, the persistible value sent to Operational Core is `FieldOption.value`; do not send `optionId` where Core expects a field value.
- Attendance status semantics continue to resolve through configured field ids and option identity; do not hardcode visible labels such as "Estado".
- `observationFieldId` is optional. If it is absent, there is no implicit observation and the client must not infer one from arbitrary text `extraValues`.
- Conflicts come from the backend; existing status changes may require explicit overwrite.
- Offline workflow writes must reuse shared SQLite, `pending_operations`, sync, reconnect, recovery, and telemetry infrastructure.
- Do not create ad-hoc parallel offline queues for workflows.
- Offline state workflows must use the shared `STATE_UPDATE` outbox/runtime; workflow presets such as attendance may adapt labels and fields but must not create workflow-specific offline queues or sync engines.
- Workflow conflicts are explicit; never resolve remote/local status differences with silent overwrite.

## Offline / SQLite

- SQLite stores local cache plus unsynchronized work.
- `synced` records may be reconciled against a complete remote snapshot.
- Never delete `pending_create`, `pending_update`, `failed`, or `conflict` because they are absent remotely.
- Search, partial loads, and single pages must not trigger destructive cleanup.
- Destructive reconciliation only happens after a successful full refresh.
- Do not create ad-hoc parallel offline queues; reuse the existing sync engine.
- Open SQLite through the shared singleton only.
- Expo Web Fast Refresh must not open a second SQLite Access Handle.
- SQLite migrations must be single-flight.
- Never reset SQLite automatically; it may contain unsynchronized work.
- Assigned AppView definitions are precached online; records remain demand-cached unless explicitly designed otherwise.
- Do not assume multi-tab support with Expo Web / OPFS.

## Connectivity / Sync

- Reconnect means a real `offline -> online` transition.
- Automatic reconnect sync must be single-flight.
- Network failures must not delete pending work.
- Push pending operations before remote refresh/reconciliation.
- `RECORDS` sync telemetry is scoped by `ownerKey + contractId + entityTypeId`.
- Preserve `clientRequestId` and idempotency semantics.
- Conflicts must not create automatic retry loops.

## Auth

- Web refresh uses an HttpOnly cookie.
- Native refresh token storage uses SecureStore.
- Do not duplicate auth logic per renderer.

## UX

- Design mobile-first with compact layouts and adequate touch targets.
- Avoid vertical waste and rigid horizontal tables on mobile.
- Do not show icon keys as user-facing text.
- Keep `DATE` and `TIME` inputs timezone-safe.

## Expo

- Before changes that depend on Expo APIs, read the exact SDK 57 docs: https://docs.expo.dev/versions/v57.0.0/
- For `expo-sqlite`, read the SDK 57 SQLite docs.
- Do not assume APIs from newer Expo versions.

## Development

- Read `docs/STATE_UPDATE.md` before changing the `STATE_UPDATE` runtime, offline persistence, synchronization, reconciliation, conflicts, workflow adapters, or diagnostics.
- Do not use Playwright unless explicitly requested.
- Do not commit or push unless explicitly requested.
- Do not force push, rebase, or squash unless explicitly requested.
- Do not invent offline support unless it is truly persisted.
- Prefer unit/integration tests and manual verification when possible.

## Security

Never include:

- `.env`
- secrets
- tokens
- local DB files
- logs
- `dist`
- `.expo`
- `node_modules`
- real data exports
- temporary files

## Required Checks

Before finishing relevant changes, run:

```bash
npm run typecheck
npm test
npm run lint
npm run build
git diff --check
```
