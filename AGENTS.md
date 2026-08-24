# Opco Client

## Project

- Opco Client is an Expo SDK 57 / React Native / Expo Web app.
- One generic client serves multiple organizations, contracts, and AppViews.
- Do not create a separate client or app path per entity.
- Opco is the source of truth when online.

## AppViews / Renderers

- `AppView.type` defines the renderer category: `RECORDS`, `WORKFLOW`, `BOARD`, `DASHBOARD`.
- `WORKFLOW` selects concrete behavior with `config.workflowKey`.
- Do not add AppView types for specific workflows such as attendance or inspection.
- The renderer registry must resolve by `type` plus `workflowKey`.
- Unknown `workflowKey` values must fail with a controlled unsupported workflow UI.

## RECORDS

- `RECORDS` is a generic renderer for dynamic entities.
- `RELATION` values show `displayName`, never technical IDs.
- `DATE` is date-only and timezone-safe. `TIME` is `HH:mm`.
- Respect backend display configuration such as `showInList`.

## Attendance

- Attendance is `WORKFLOW` with `workflowKey = "attendance"`.
- API/domain statuses are `PRESENTE` and `AUSENTE`.
- The client must not know or persist internal `FieldOption.value` values for attendance.
- Conflicts come from the backend; existing status changes may require explicit overwrite.
- Attendance v1 is online-only. Do not claim offline support until the workflow has real SQLite persistence.

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
