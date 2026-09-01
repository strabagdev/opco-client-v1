import {
  AppViewDefinitionCache,
  getWorkflowKey,
  PreparedAppViewDefinition,
  UpsertAppViewDefinitionInput,
} from "./app-view-definitions-cache";
import {
  AppView,
  AttendanceWorkflowConfig,
  EntityDefinition,
  OpcoApi,
  OpcoNetworkError,
  StateUpdateResponse,
} from "./opco-api";
import { OfflineRecordStore, refreshEntityRecordsCache } from "./offline-records";
import { SyncTelemetryStore } from "./sync-telemetry";
import { attendanceStateFields } from "./attendance-offline";
import { cacheAttendanceRemoteSnapshot, currentMonthDateKeys } from "./attendance-snapshot-cache";
import { isStateUpdateCompatibleWorkflow, StateUpdateOfflineStore } from "./state-update-offline";

export const PREWARM_CONCURRENCY = 4;
export const ATTENDANCE_MONTH_PREWARM_CONCURRENCY = 3;
export const OFFLINE_PREPARATION_SLOW_THRESHOLD_MS = 10_000;

const activePrewarms = new Map<string, Promise<void>>();

type PrewarmStageKey = "definitionLoad" | "sourceRecordsFetch" | "sqliteWrite" | "snapshot";

export type OfflinePreparationStageTelemetry = {
  completedAt: string | null;
  durationMs: number | null;
  result: "success" | "failed" | "skipped";
  sourceRecordsCount?: number;
  stage: "definition_load" | "source_records_fetch" | "sqlite_write" | "snapshot";
  startedAt: string | null;
};

export type OfflinePreparationAppViewTelemetry = {
  appViewCompletedAt: string | null;
  appViewStartedAt: string;
  appViewType: AppView["type"];
  durationMs: number | null;
  errorCode: string | null;
  fingerprint: string;
  result: "success" | "skipped" | "failed";
  slow: boolean;
  stage: OfflinePreparationStageTelemetry["stage"] | "idle";
  workflowKey: string | null;
  definitionLoad?: OfflinePreparationStageTelemetry;
  sourceRecordsFetch?: OfflinePreparationStageTelemetry;
  sqliteWrite?: OfflinePreparationStageTelemetry;
  snapshot?: OfflinePreparationStageTelemetry;
};

export type OfflinePreparationDiagnostics = {
  appViews: {
    completed: number;
    failed: number;
    running: number;
    total: number;
  };
  lastAppView: OfflinePreparationAppViewTelemetry | null;
  prewarmCompletedAt: string | null;
  prewarmDurationMs: number | null;
  prewarmStartedAt: string | null;
  slow: boolean;
  slowestStages: OfflinePreparationStageTelemetry[];
  status: "idle" | "running" | "completed" | "failed";
};

export type AppViewPrewarmStore = AppViewDefinitionCache & {
  getOfflinePreparationDiagnostics?(ownerKey: string): Promise<OfflinePreparationDiagnostics | null>;
  setOfflinePreparationDiagnostics?(ownerKey: string, diagnostics: OfflinePreparationDiagnostics): Promise<void>;
  getAppViewDefinition(ownerKey: string, contractId: string, appViewId: string): Promise<{
    definition: PreparedAppViewDefinition;
    status: string;
  } | null>;
  upsertEntityDefinition(contractId: string, entityTypeId: string, definition: EntityDefinition, syncedAt: string): Promise<void>;
} & Pick<OfflineRecordStore, "listCachedRecords" | "reconcileRemoteRecordsSnapshot"> &
  Pick<StateUpdateOfflineStore, "markAttendanceDaySnapshotHydrated" | "upsertStateUpdateSnapshot"> &
  Partial<Pick<SyncTelemetryStore, "markSyncError" | "markSyncPhase" | "markSyncPhaseCompleted">>;

export function prewarmAssignedAppViewsOnce(params: {
  api: Pick<OpcoApi, "getAttendanceWorkflow" | "getStateUpdateWorkflow" | "getEntityDefinition" | "getEntityRecords">;
  appViews: AppView[];
  contractId: string;
  onTelemetry?: (diagnostics: OfflinePreparationDiagnostics) => Promise<void> | void;
  ownerKey: string;
  store: AppViewPrewarmStore;
  token: string;
}) {
  const key = `${params.ownerKey}:${params.contractId}`;

  if (!activePrewarms.has(key)) {
    activePrewarms.set(key, prewarmAssignedAppViews(params).finally(() => activePrewarms.delete(key)));
  }

  return activePrewarms.get(key)!;
}

export async function prewarmAssignedAppViews({
  api,
  appViews,
  contractId,
  onTelemetry,
  ownerKey,
  store,
  token,
}: {
  api: Pick<OpcoApi, "getAttendanceWorkflow" | "getStateUpdateWorkflow" | "getEntityDefinition" | "getEntityRecords">;
  appViews: AppView[];
  contractId: string;
  onTelemetry?: (diagnostics: OfflinePreparationDiagnostics) => Promise<void> | void;
  ownerKey: string;
  store: AppViewPrewarmStore;
  token: string;
}) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const appViewTelemetry = new Map<string, OfflinePreparationAppViewTelemetry>();

  await recordOfflinePreparationTelemetry({
    diagnostics: buildOfflinePreparationDiagnostics({
      appViewTelemetry,
      startedAt,
      startedMs,
      status: "running",
      total: appViews.length,
    }),
    onTelemetry,
    ownerKey,
    store,
  });

  try {
    await store.reconcileAppViewDefinitions(ownerKey, contractId, appViews.map((view) => view.id));
    await runWithConcurrency(appViews, PREWARM_CONCURRENCY, async (appView) => {
      const initial = createAppViewTelemetry(appView);

      appViewTelemetry.set(appView.id, initial);
      await recordOfflinePreparationTelemetry({
        diagnostics: buildOfflinePreparationDiagnostics({
          appViewTelemetry,
          startedAt,
          startedMs,
          status: "running",
          total: appViews.length,
        }),
        onTelemetry,
        ownerKey,
        store,
      });

      const nextTelemetry = await prewarmOneAppView({ api, appView, contractId, ownerKey, store, token });

      appViewTelemetry.set(appView.id, nextTelemetry);
      await recordOfflinePreparationTelemetry({
        diagnostics: buildOfflinePreparationDiagnostics({
          appViewTelemetry,
          startedAt,
          startedMs,
          status: "running",
          total: appViews.length,
        }),
        onTelemetry,
        ownerKey,
        store,
      });
    });

    await recordOfflinePreparationTelemetry({
      diagnostics: buildOfflinePreparationDiagnostics({
        appViewTelemetry,
        completedAt: new Date().toISOString(),
        completedMs: Date.now(),
        startedAt,
        startedMs,
        status: hasFailedAppViews(appViewTelemetry) ? "failed" : "completed",
        total: appViews.length,
      }),
      onTelemetry,
      ownerKey,
      store,
    });
  } catch (error) {
    await recordOfflinePreparationTelemetry({
      diagnostics: buildOfflinePreparationDiagnostics({
        appViewTelemetry,
        completedAt: new Date().toISOString(),
        completedMs: Date.now(),
        startedAt,
        startedMs,
        status: "failed",
        total: appViews.length,
      }),
      onTelemetry,
      ownerKey,
      store,
    });
    throw error;
  }
}

async function prewarmOneAppView({
  api,
  appView,
  contractId,
  ownerKey,
  store,
  token,
}: {
  api: Pick<OpcoApi, "getAttendanceWorkflow" | "getStateUpdateWorkflow" | "getEntityDefinition" | "getEntityRecords">;
  appView: AppView;
  contractId: string;
  ownerKey: string;
  store: AppViewPrewarmStore;
  token: string;
}): Promise<OfflinePreparationAppViewTelemetry> {
  const lastPreparedAt = new Date().toISOString();
  const telemetry = createAppViewTelemetry(appView);
  const appStartedMs = Date.now();

  try {
    if (appView.type === "RECORDS") {
      const response = await measurePrewarmStage(telemetry, "definitionLoad", () =>
        api.getEntityDefinition(token, contractId, appView.config.entityTypeId),
      );

      await measurePrewarmStage(telemetry, "sqliteWrite", async () => {
        await store.upsertEntityDefinition(contractId, appView.config.entityTypeId, response.entity, lastPreparedAt);
        await store.upsertAppViewDefinition(baseDefinitionInput({
          appView,
          contractId,
          definition: {
            appView,
            entityDefinition: response.entity,
            kind: "records",
          },
          lastPreparedAt,
          ownerKey,
          status: "ready",
        }));
      });
      return completeAppViewTelemetry(telemetry, appStartedMs, "success");
    }

    if (
      appView.type === "WORKFLOW" &&
      isStateUpdateCompatibleWorkflow(appView.config.workflowKey) &&
      appView.config.workflowKey === "attendance"
    ) {
      const attendanceConfig = appView.config as AttendanceWorkflowConfig;
      const today = formatLocalDateInput(new Date());
      const monthDates = currentMonthDateKeys(new Date());
      const { response, sourceDefinition } = await measurePrewarmStage(telemetry, "definitionLoad", async () => {
        const workflow = await api.getAttendanceWorkflow(token, contractId, appView.id, {
          date: today,
        });
        const definition = await api.getEntityDefinition(token, contractId, workflow.sourceEntityType.id);

        return { response: workflow, sourceDefinition: definition };
      });

      await measurePrewarmStage(telemetry, "sqliteWrite", () =>
        store.upsertEntityDefinition(contractId, response.sourceEntityType.id, sourceDefinition.entity, lastPreparedAt),
      );
      const sourceRecords = await measurePrewarmStage(telemetry, "sourceRecordsFetch", () => refreshEntityRecordsCache({
        api,
        contractId,
        entityTypeId: response.sourceEntityType.id,
        ownerKey,
        store,
        token,
      }));
      telemetry.sourceRecordsFetch = {
        ...telemetry.sourceRecordsFetch!,
        sourceRecordsCount: sourceRecords.pagination.total,
      };
      telemetry.snapshot = {
        ...telemetry.sourceRecordsFetch,
        stage: "snapshot",
      };

      await measurePrewarmStage(telemetry, "sqliteWrite", () =>
        store.upsertAppViewDefinition(baseDefinitionInput({
          appView,
          contractId,
          definition: {
            appView,
            dateFieldId: attendanceConfig.dateFieldId,
            extraFields: (response.contextFields ?? []).map((field) => ({
              active: true,
              id: field.id,
              key: field.key ?? field.id,
              name: field.name,
              options: field.options.map((option) => ({
                active: true,
                id: option.optionId,
                label: option.label,
                order: option.order ?? 0,
                value: option.value ?? option.optionId,
              })),
              required: field.required,
              type: "SELECT" as const,
            })),
            historyMode: "update-current",
            kind: "state-update",
            sourceEntityTypeId: response.sourceEntityType.id,
            stateFields: attendanceStateFields(response.statuses, attendanceConfig, response.stateFields?.find((field) => field.fieldId === attendanceConfig.statusFieldId)),
            subjectFieldId: attendanceConfig.personFieldId,
            targetEntityTypeId: response.targetEntityType.id,
            uniqueness: "subject-date",
          },
          lastPreparedAt,
          ownerKey,
          status: "ready",
        })),
      );
      await measurePrewarmStage(telemetry, "snapshot", () =>
        cacheAttendanceMonthSnapshots({
          api,
          appView,
          attendanceConfig,
          contractId,
          monthDates,
          ownerKey,
          response,
          store,
          token,
        }),
      );
      return completeAppViewTelemetry(telemetry, appStartedMs, "success");
    }

    if (
      appView.type === "WORKFLOW" &&
      isStateUpdateCompatibleWorkflow(appView.config.workflowKey) &&
      appView.config.workflowKey === "state-update"
    ) {
      const { response, sourceDefinition } = await measurePrewarmStage(telemetry, "definitionLoad", async () => {
        const workflow = await api.getStateUpdateWorkflow(token, contractId, appView.id, {
          date: appView.config.dateFieldId ? formatLocalDateInput(new Date()) : undefined,
        });
        const definition = await api.getEntityDefinition(token, contractId, workflow.sourceEntityType.id);

        return { response: workflow, sourceDefinition: definition };
      });

      await measurePrewarmStage(telemetry, "sqliteWrite", () =>
        store.upsertEntityDefinition(contractId, response.sourceEntityType.id, sourceDefinition.entity, lastPreparedAt),
      );
      const sourceRecords = await measurePrewarmStage(telemetry, "sourceRecordsFetch", () => refreshEntityRecordsCache({
        api,
        contractId,
        entityTypeId: response.sourceEntityType.id,
        ownerKey,
        store,
        token,
      }));
      telemetry.sourceRecordsFetch = {
        ...telemetry.sourceRecordsFetch!,
        sourceRecordsCount: sourceRecords.pagination.total,
      };
      telemetry.snapshot = {
        ...telemetry.sourceRecordsFetch,
        stage: "snapshot",
      };

      await measurePrewarmStage(telemetry, "sqliteWrite", () =>
        store.upsertAppViewDefinition(baseDefinitionInput({
          appView,
          contractId,
          definition: stateUpdatePreparedDefinition(appView, response),
          lastPreparedAt,
          ownerKey,
          status: "ready",
        })),
      );
      return completeAppViewTelemetry(telemetry, appStartedMs, "success");
    }

    await measurePrewarmStage(telemetry, "sqliteWrite", () =>
      store.upsertAppViewDefinition(baseDefinitionInput({
        appView,
        contractId,
        definition: {
          appView,
          kind: "unsupported",
        },
        lastPreparedAt,
        ownerKey,
        status: "ready",
      })),
    );
    return completeAppViewTelemetry(telemetry, appStartedMs, "skipped");
  } catch (error) {
    await preserveOrMarkPrewarmFailure({
      appView,
      contractId,
      error,
      lastPreparedAt,
      ownerKey,
      store,
    });
    return completeAppViewTelemetry(telemetry, appStartedMs, "failed", error);
  }
}

async function preserveOrMarkPrewarmFailure({
  appView,
  contractId,
  error,
  lastPreparedAt,
  ownerKey,
  store,
}: {
  appView: AppView;
  contractId: string;
  error: unknown;
  lastPreparedAt: string;
  ownerKey: string;
  store: AppViewPrewarmStore;
}) {
  const existing = await store.getAppViewDefinition(ownerKey, contractId, appView.id);

  if (existing?.status === "ready" && error instanceof OpcoNetworkError) {
    return;
  }

  await store.upsertAppViewDefinition(baseDefinitionInput({
    appView,
    contractId,
    definition: {
      appView,
      errorCode: error instanceof Error ? error.name : "UNKNOWN",
      kind: "error",
    },
    lastPreparedAt,
    ownerKey,
    status: existing?.definition ? "partial" : "error",
  }));
}

function baseDefinitionInput({
  appView,
  contractId,
  definition,
  lastPreparedAt,
  ownerKey,
  status,
}: {
  appView: AppView;
  contractId: string;
  definition: PreparedAppViewDefinition;
  lastPreparedAt: string;
  ownerKey: string;
  status: UpsertAppViewDefinitionInput["status"];
}): UpsertAppViewDefinitionInput {
  return {
    appViewId: appView.id,
    appViewType: appView.type,
    contractId,
    definition,
    lastPreparedAt,
    ownerKey,
    status,
    workflowKey: getWorkflowKey(appView),
  };
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];

      index += 1;
      await worker(item);
    }
  });

  await Promise.all(runners);
}

function createAppViewTelemetry(appView: AppView): OfflinePreparationAppViewTelemetry {
  return {
    appViewCompletedAt: null,
    appViewStartedAt: new Date().toISOString(),
    appViewType: appView.type,
    durationMs: null,
    errorCode: null,
    fingerprint: fingerprintPrewarmValue(appView.id),
    result: "success",
    slow: false,
    stage: "idle",
    workflowKey: getWorkflowKey(appView),
  };
}

async function measurePrewarmStage<T>(
  telemetry: OfflinePreparationAppViewTelemetry,
  key: PrewarmStageKey,
  task: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const stage = prewarmStageName(key);

  telemetry.stage = stage;
  telemetry[key] = {
    completedAt: null,
    durationMs: null,
    result: "success",
    stage,
    startedAt,
  };

  try {
    const result = await task();
    const completedAt = new Date().toISOString();

    telemetry[key] = {
      ...telemetry[key]!,
      completedAt,
      durationMs: Date.now() - startedMs,
      result: "success",
    };
    return result;
  } catch (error) {
    const completedAt = new Date().toISOString();

    telemetry[key] = {
      ...telemetry[key]!,
      completedAt,
      durationMs: Date.now() - startedMs,
      result: "failed",
    };
    throw error;
  }
}

function prewarmStageName(key: PrewarmStageKey): OfflinePreparationStageTelemetry["stage"] {
  if (key === "definitionLoad") {
    return "definition_load";
  }

  if (key === "sourceRecordsFetch") {
    return "source_records_fetch";
  }

  if (key === "sqliteWrite") {
    return "sqlite_write";
  }

  return "snapshot";
}

function completeAppViewTelemetry(
  telemetry: OfflinePreparationAppViewTelemetry,
  startedMs: number,
  result: OfflinePreparationAppViewTelemetry["result"],
  error?: unknown,
) {
  const durationMs = Date.now() - startedMs;

  telemetry.appViewCompletedAt = new Date().toISOString();
  telemetry.durationMs = durationMs;
  telemetry.errorCode = error ? sanitizePrewarmError(error) : null;
  telemetry.result = result;
  telemetry.slow = durationMs > OFFLINE_PREPARATION_SLOW_THRESHOLD_MS;
  return telemetry;
}

function buildOfflinePreparationDiagnostics({
  appViewTelemetry,
  completedAt = null,
  completedMs,
  startedAt,
  startedMs,
  status,
  total,
}: {
  appViewTelemetry: Map<string, OfflinePreparationAppViewTelemetry>;
  completedAt?: string | null;
  completedMs?: number;
  startedAt: string;
  startedMs: number;
  status: OfflinePreparationDiagnostics["status"];
  total: number;
}): OfflinePreparationDiagnostics {
  const appViews = [...appViewTelemetry.values()];
  const completed = appViews.filter((appView) => appView.appViewCompletedAt).length;
  const failed = appViews.filter((appView) => appView.result === "failed").length;
  const prewarmDurationMs = completedMs ? completedMs - startedMs : null;
  const slowestStages = appViews
    .flatMap((appView) => [
      appView.definitionLoad,
      appView.sourceRecordsFetch,
      appView.sqliteWrite,
      appView.snapshot,
    ])
    .filter((stage): stage is OfflinePreparationStageTelemetry => Boolean(stage?.durationMs))
    .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
    .slice(0, 3);

  return {
    appViews: {
      completed,
      failed,
      running: status === "running" ? Math.max(0, total - completed) : 0,
      total,
    },
    lastAppView: findLastAppViewTelemetry(appViews),
    prewarmCompletedAt: completedAt,
    prewarmDurationMs,
    prewarmStartedAt: startedAt,
    slow: Boolean((prewarmDurationMs && prewarmDurationMs > OFFLINE_PREPARATION_SLOW_THRESHOLD_MS) || appViews.some((appView) => appView.slow)),
    slowestStages,
    status,
  };
}

function findLastAppViewTelemetry(appViews: OfflinePreparationAppViewTelemetry[]) {
  for (let index = appViews.length - 1; index >= 0; index -= 1) {
    if (appViews[index].appViewCompletedAt) {
      return appViews[index];
    }
  }

  return appViews[appViews.length - 1] ?? null;
}

function hasFailedAppViews(appViewTelemetry: Map<string, OfflinePreparationAppViewTelemetry>) {
  return [...appViewTelemetry.values()].some((appView) => appView.result === "failed");
}

async function recordOfflinePreparationTelemetry({
  diagnostics,
  onTelemetry,
  ownerKey,
  store,
}: {
  diagnostics: OfflinePreparationDiagnostics;
  onTelemetry?: (diagnostics: OfflinePreparationDiagnostics) => Promise<void> | void;
  ownerKey: string;
  store: AppViewPrewarmStore;
}) {
  try {
    await store.setOfflinePreparationDiagnostics?.(ownerKey, diagnostics);
  } catch {
    // Offline preparation telemetry is observational and must not block prewarm.
  }

  try {
    await onTelemetry?.(diagnostics);
  } catch {
    // UI telemetry listeners are best-effort; prewarm owns the real work.
  }
}

function sanitizePrewarmError(error: unknown) {
  return error instanceof Error && error.name ? error.name : "UNKNOWN";
}

function fingerprintPrewarmValue(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }

  return `fp_${Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8)}`;
}

export function parseOfflinePreparationDiagnostics(value: string): OfflinePreparationDiagnostics | null {
  try {
    const parsed = JSON.parse(value) as Partial<OfflinePreparationDiagnostics>;

    return normalizeOfflinePreparationDiagnostics(parsed);
  } catch {
    return null;
  }
}

export function normalizeOfflinePreparationDiagnostics(
  value: Partial<OfflinePreparationDiagnostics> | null | undefined,
): OfflinePreparationDiagnostics | null {
  if (!value || !isOfflinePreparationStatus(value.status)) {
    return null;
  }

  return {
    appViews: {
      completed: normalizeCount(value.appViews?.completed),
      failed: normalizeCount(value.appViews?.failed),
      running: normalizeCount(value.appViews?.running),
      total: normalizeCount(value.appViews?.total),
    },
    lastAppView: normalizeAppViewTelemetry(value.lastAppView),
    prewarmCompletedAt: normalizeNullableString(value.prewarmCompletedAt),
    prewarmDurationMs: normalizeNullableNumber(value.prewarmDurationMs),
    prewarmStartedAt: normalizeNullableString(value.prewarmStartedAt),
    slow: Boolean(value.slow),
    slowestStages: Array.isArray(value.slowestStages)
      ? value.slowestStages.map(normalizeStageTelemetry).filter((stage): stage is OfflinePreparationStageTelemetry => Boolean(stage)).slice(0, 3)
      : [],
    status: value.status,
  };
}

function normalizeAppViewTelemetry(
  value: OfflinePreparationAppViewTelemetry | null | undefined,
): OfflinePreparationAppViewTelemetry | null {
  if (!value) {
    return null;
  }

  return {
    appViewCompletedAt: normalizeNullableString(value.appViewCompletedAt),
    appViewStartedAt: normalizeNullableString(value.appViewStartedAt) ?? new Date(0).toISOString(),
    appViewType: value.appViewType,
    definitionLoad: normalizeStageTelemetry(value.definitionLoad) ?? undefined,
    durationMs: normalizeNullableNumber(value.durationMs),
    errorCode: normalizeNullableString(value.errorCode),
    fingerprint: typeof value.fingerprint === "string" && value.fingerprint.startsWith("fp_") ? value.fingerprint : "fp_unknown",
    result: isAppViewResult(value.result) ? value.result : "failed",
    slow: Boolean(value.slow),
    sourceRecordsFetch: normalizeStageTelemetry(value.sourceRecordsFetch) ?? undefined,
    sqliteWrite: normalizeStageTelemetry(value.sqliteWrite) ?? undefined,
    snapshot: normalizeStageTelemetry(value.snapshot) ?? undefined,
    stage: isStageName(value.stage) || value.stage === "idle" ? value.stage : "idle",
    workflowKey: normalizeNullableString(value.workflowKey),
  };
}

function normalizeStageTelemetry(
  value: OfflinePreparationStageTelemetry | null | undefined,
): OfflinePreparationStageTelemetry | null {
  if (!value || !isStageName(value.stage)) {
    return null;
  }

  return {
    completedAt: normalizeNullableString(value.completedAt),
    durationMs: normalizeNullableNumber(value.durationMs),
    result: isStageResult(value.result) ? value.result : "failed",
    sourceRecordsCount: typeof value.sourceRecordsCount === "number" ? value.sourceRecordsCount : undefined,
    stage: value.stage,
    startedAt: normalizeNullableString(value.startedAt),
  };
}

function isOfflinePreparationStatus(value: unknown): value is OfflinePreparationDiagnostics["status"] {
  return value === "idle" || value === "running" || value === "completed" || value === "failed";
}

function isAppViewResult(value: unknown): value is OfflinePreparationAppViewTelemetry["result"] {
  return value === "success" || value === "skipped" || value === "failed";
}

function isStageResult(value: unknown): value is OfflinePreparationStageTelemetry["result"] {
  return value === "success" || value === "skipped" || value === "failed";
}

function isStageName(value: unknown): value is OfflinePreparationStageTelemetry["stage"] {
  return value === "definition_load" ||
    value === "source_records_fetch" ||
    value === "sqlite_write" ||
    value === "snapshot";
}

function normalizeNullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

async function cacheAttendanceMonthSnapshots({
  api,
  appView,
  attendanceConfig,
  contractId,
  monthDates,
  ownerKey,
  response,
  store,
  token,
}: {
  api: Pick<OpcoApi, "getAttendanceWorkflow">;
  appView: AppView;
  attendanceConfig: AttendanceWorkflowConfig;
  contractId: string;
  monthDates: string[];
  ownerKey: string;
  response: Awaited<ReturnType<OpcoApi["getAttendanceWorkflow"]>>;
  store: Pick<StateUpdateOfflineStore, "markAttendanceDaySnapshotHydrated" | "upsertStateUpdateSnapshot">;
  token: string;
}) {
  try {
    await cacheAttendanceRemoteSnapshot({
      appViewId: appView.id,
      config: attendanceConfig,
      contractId,
      ownerKey,
      response,
      store,
    });
  } catch {
    // A single day can be retried later when the user opens it online.
  }

  const remainingDates = monthDates.filter((date) => date !== response.date);

  await runWithConcurrency(remainingDates, ATTENDANCE_MONTH_PREWARM_CONCURRENCY, async (date) => {
    try {
      const attendanceResponse = await api.getAttendanceWorkflow(token, contractId, appView.id, { date });

      await cacheAttendanceRemoteSnapshot({
        appViewId: appView.id,
        config: attendanceConfig,
        contractId,
        ownerKey,
        response: attendanceResponse,
        store,
      });
    } catch {
      // A single day can be retried later when the user opens it online.
    }
  });
}

function stateUpdatePreparedDefinition(appView: AppView, response: StateUpdateResponse): PreparedAppViewDefinition {
  return {
    appView,
    dateFieldId: response.dateFieldId,
    extraFields: response.extraFields,
    historyMode: response.historyMode,
    kind: "state-update",
    sourceEntityTypeId: response.sourceEntityType.id,
    stateFields: response.stateFields,
    subjectFieldId: response.subjectFieldId,
    targetEntityTypeId: response.targetEntityType.id,
    uniqueness: response.uniqueness,
  };
}

function formatLocalDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
