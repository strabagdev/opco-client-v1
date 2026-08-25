import { AppView, AppViewType } from "./opco-api";

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
      statuses: {
        isDefaultCheckIn: boolean;
        label: string;
        optionId: string;
      }[];
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

export function getWorkflowKey(appView: AppView) {
  return appView.type === "WORKFLOW" ? String(appView.config.workflowKey ?? "") || null : null;
}

export function deriveOfflineAvailability({
  appView,
  cachedRecordsCount = 0,
  definition,
}: {
  appView: AppView;
  cachedRecordsCount?: number;
  definition: CachedAppViewDefinition | null;
}): OfflineAvailability {
  if (appView.type === "BOARD" || appView.type === "DASHBOARD") {
    return "unsupported";
  }

  if (appView.type === "WORKFLOW") {
    return appView.config.workflowKey === "attendance" && definition?.status === "ready"
      ? "online-only"
      : "definition-missing";
  }

  if (!definition || definition.status !== "ready") {
    return "definition-missing";
  }

  return cachedRecordsCount > 0 ? "ready" : "data-not-cached";
}
