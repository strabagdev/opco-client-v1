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

const PREWARM_CONCURRENCY = 4;

const activePrewarms = new Map<string, Promise<void>>();

export type AppViewPrewarmStore = AppViewDefinitionCache & {
  getAppViewDefinition(ownerKey: string, contractId: string, appViewId: string): Promise<{
    definition: PreparedAppViewDefinition;
    status: string;
  } | null>;
  upsertEntityDefinition(contractId: string, entityTypeId: string, definition: EntityDefinition, syncedAt: string): Promise<void>;
} & Pick<OfflineRecordStore, "listCachedRecords" | "reconcileRemoteRecordsSnapshot"> &
  Partial<Pick<SyncTelemetryStore, "markSyncError" | "markSyncPhase" | "markSyncPhaseCompleted">>;

export function prewarmAssignedAppViewsOnce(params: {
  api: Pick<OpcoApi, "getAttendanceWorkflow" | "getStateUpdateWorkflow" | "getEntityDefinition" | "getEntityRecords">;
  appViews: AppView[];
  contractId: string;
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
  ownerKey,
  store,
  token,
}: {
  api: Pick<OpcoApi, "getAttendanceWorkflow" | "getStateUpdateWorkflow" | "getEntityDefinition" | "getEntityRecords">;
  appViews: AppView[];
  contractId: string;
  ownerKey: string;
  store: AppViewPrewarmStore;
  token: string;
}) {
  await store.reconcileAppViewDefinitions(ownerKey, contractId, appViews.map((view) => view.id));
  await runWithConcurrency(appViews, PREWARM_CONCURRENCY, (appView) =>
    prewarmOneAppView({ api, appView, contractId, ownerKey, store, token }),
  );
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
}) {
  const lastPreparedAt = new Date().toISOString();

  try {
    if (appView.type === "RECORDS") {
      const response = await api.getEntityDefinition(token, contractId, appView.config.entityTypeId);

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
      return;
    }

    if (appView.type === "WORKFLOW" && appView.config.workflowKey === "attendance") {
      const attendanceConfig = appView.config as AttendanceWorkflowConfig;
      const response = await api.getAttendanceWorkflow(token, contractId, appView.id, {
        date: formatLocalDateInput(new Date()),
      });
      const sourceDefinition = await api.getEntityDefinition(token, contractId, response.sourceEntityType.id);

      await store.upsertEntityDefinition(contractId, response.sourceEntityType.id, sourceDefinition.entity, lastPreparedAt);
      await refreshEntityRecordsCache({
        api,
        contractId,
        entityTypeId: response.sourceEntityType.id,
        ownerKey,
        store,
        token,
      });

      await store.upsertAppViewDefinition(baseDefinitionInput({
        appView,
        contractId,
        definition: {
          appView,
          dateFieldId: attendanceConfig.dateFieldId,
          extraFields: [],
          historyMode: "update-current",
          kind: "state-update",
          sourceEntityTypeId: response.sourceEntityType.id,
          stateFields: attendanceStateFields(response.statuses, attendanceConfig),
          subjectFieldId: attendanceConfig.personFieldId,
          targetEntityTypeId: response.targetEntityType.id,
          uniqueness: "subject-date",
        },
        lastPreparedAt,
        ownerKey,
        status: "ready",
      }));
      return;
    }

    if (appView.type === "WORKFLOW" && appView.config.workflowKey === "state-update") {
      const response = await api.getStateUpdateWorkflow(token, contractId, appView.id, {
        date: appView.config.dateFieldId ? formatLocalDateInput(new Date()) : undefined,
      });
      const sourceDefinition = await api.getEntityDefinition(token, contractId, response.sourceEntityType.id);

      await store.upsertEntityDefinition(contractId, response.sourceEntityType.id, sourceDefinition.entity, lastPreparedAt);
      await refreshEntityRecordsCache({
        api,
        contractId,
        entityTypeId: response.sourceEntityType.id,
        ownerKey,
        store,
        token,
      });

      await store.upsertAppViewDefinition(baseDefinitionInput({
        appView,
        contractId,
        definition: stateUpdatePreparedDefinition(appView, response),
        lastPreparedAt,
        ownerKey,
        status: "ready",
      }));
      return;
    }

    await store.upsertAppViewDefinition(baseDefinitionInput({
      appView,
      contractId,
      definition: {
        appView,
        kind: "unsupported",
      },
      lastPreparedAt,
      ownerKey,
      status: "ready",
    }));
  } catch (error) {
    await preserveOrMarkPrewarmFailure({
      appView,
      contractId,
      error,
      lastPreparedAt,
      ownerKey,
      store,
    });
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
