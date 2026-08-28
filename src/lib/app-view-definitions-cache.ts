import {
  AppView,
  AppViewType,
  EntityField,
  StateUpdateField,
  StateUpdateHistoryMode,
  StateUpdateUniqueness,
} from "./opco-api";
import { isStateUpdateCompatibleWorkflow } from "./state-update-offline";
import { SyncTelemetry } from "./sync-telemetry";

export type AppViewDefinitionStatus = "ready" | "partial" | "error";

export type OfflineAvailability =
  | "ready"
  | "data-not-cached"
  | "definition-missing"
  | "online-only"
  | "unsupported";

export type CachedAppViewDefinition = {
  appViewId: string;
  appViewType: AppViewType;
  contractId: string;
  definition: PreparedAppViewDefinition;
  lastPreparedAt: string;
  ownerKey: string;
  status: AppViewDefinitionStatus;
  workflowKey: string | null;
};

export type PreparedAppViewDefinition =
  | {
      appView: AppView;
      kind: "records";
      entityDefinition: unknown;
    }
  | {
      appView: AppView;
      kind: "attendance";
      sourceEntityTypeId?: string;
      targetEntityTypeId?: string;
      statuses: {
        isDefaultCheckIn: boolean;
        label: string;
        optionId: string;
      }[];
    }
  | {
      appView: AppView;
      dateFieldId?: string;
      extraFields: EntityField[];
      historyMode: StateUpdateHistoryMode;
      kind: "state-update";
      sourceEntityTypeId: string;
      stateFields: StateUpdateField[];
      subjectFieldId: string;
      targetEntityTypeId: string;
      uniqueness: StateUpdateUniqueness;
    }
  | {
      appView: AppView;
      kind: "unsupported";
    }
  | {
      appView: AppView;
      errorCode?: string;
      kind: "error";
    };

export type AppViewDefinitionCache = {
  getAppViewDefinition(ownerKey: string, contractId: string, appViewId: string): Promise<CachedAppViewDefinition | null>;
  listAppViewDefinitions(ownerKey: string, contractId: string): Promise<CachedAppViewDefinition[]>;
  reconcileAppViewDefinitions(ownerKey: string, contractId: string, assignedAppViewIds: string[]): Promise<void>;
  upsertAppViewDefinition(input: UpsertAppViewDefinitionInput): Promise<void>;
};

export type UpsertAppViewDefinitionInput = {
  appViewId: string;
  appViewType: AppViewType;
  contractId: string;
  definition: PreparedAppViewDefinition;
  lastPreparedAt: string;
  ownerKey: string;
  status: AppViewDefinitionStatus;
  workflowKey?: string | null;
};

export type AppViewOfflineReadinessReason =
  | "definition-ready-data-ready"
  | "definition-missing"
  | "data-never-hydrated"
  | "unsupported"
  | "online-only";

export type AppViewOfflineReadiness = {
  dataReady: boolean;
  definitionReady: boolean;
  offlineReady: boolean;
  reason: AppViewOfflineReadinessReason;
};

export function getWorkflowKey(appView: AppView) {
  return appView.type === "WORKFLOW" ? String(appView.config.workflowKey ?? "") || null : null;
}

export function deriveOfflineAvailability({
  appView,
  definition,
  recordsTelemetry,
  sourceTelemetry,
}: {
  appView: AppView;
  definition: CachedAppViewDefinition | null;
  recordsTelemetry?: Pick<SyncTelemetry, "lastFullRefreshCompletedAt"> | null;
  sourceTelemetry?: Pick<SyncTelemetry, "lastFullRefreshCompletedAt"> | null;
}): OfflineAvailability {
  const readiness = getAppViewOfflineReadiness({
    appView,
    definition,
    recordsTelemetry,
    sourceTelemetry,
  });

  if (readiness.offlineReady) {
    return "ready";
  }

  if (readiness.reason === "unsupported") {
    return "unsupported";
  }

  if (readiness.reason === "online-only") {
    return "online-only";
  }

  if (readiness.definitionReady) {
    return "data-not-cached";
  }

  return "definition-missing";
}

export function getAppViewOfflineReadiness({
  appView,
  definition,
  recordsTelemetry,
  sourceTelemetry,
}: {
  appView: AppView;
  definition: CachedAppViewDefinition | null;
  recordsTelemetry?: Pick<SyncTelemetry, "lastFullRefreshCompletedAt"> | null;
  sourceTelemetry?: Pick<SyncTelemetry, "lastFullRefreshCompletedAt"> | null;
}): AppViewOfflineReadiness {
  if (appView.type === "BOARD" || appView.type === "DASHBOARD") {
    return readiness({
      dataReady: false,
      definitionReady: false,
      reason: "unsupported",
    });
  }

  if (!definition || definition.status !== "ready") {
    return readiness({
      dataReady: false,
      definitionReady: false,
      reason: "definition-missing",
    });
  }

  if (appView.type === "RECORDS") {
    const dataReady = hasSuccessfulHydration(recordsTelemetry);

    return readiness({
      dataReady,
      definitionReady: true,
      reason: dataReady ? "definition-ready-data-ready" : "data-never-hydrated",
    });
  }

  if (appView.type === "WORKFLOW" && isStateUpdateCompatibleWorkflow(appView.config.workflowKey)) {
    const prepared = definition.definition;

    if (prepared.kind === "state-update") {
      const dataReady = hasSuccessfulHydration(sourceTelemetry);

      return readiness({
        dataReady,
        definitionReady: true,
        reason: dataReady ? "definition-ready-data-ready" : "data-never-hydrated",
      });
    }

    if (prepared.kind === "attendance") {
      const dataReady = prepared.sourceEntityTypeId ? hasSuccessfulHydration(sourceTelemetry) : false;

      return readiness({
        dataReady,
        definitionReady: true,
        reason: dataReady ? "definition-ready-data-ready" : "data-never-hydrated",
      });
    }
  }

  return readiness({
    dataReady: false,
    definitionReady: false,
    reason: "online-only",
  });
}

export function hasSuccessfulHydration(telemetry?: Pick<SyncTelemetry, "lastFullRefreshCompletedAt"> | null) {
  return typeof telemetry?.lastFullRefreshCompletedAt === "string" && telemetry.lastFullRefreshCompletedAt.length > 0;
}

function readiness({
  dataReady,
  definitionReady,
  reason,
}: {
  dataReady: boolean;
  definitionReady: boolean;
  reason: AppViewOfflineReadinessReason;
}): AppViewOfflineReadiness {
  return {
    dataReady,
    definitionReady,
    offlineReady: definitionReady && dataReady,
    reason,
  };
}
