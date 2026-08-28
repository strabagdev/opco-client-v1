import { LocalDatabaseStorageState } from "../lib/local-db-recovery";
import { AttendanceResponse, DEFAULT_REQUEST_TIMEOUT_MS, OpcoApi, OpcoApiError, OpcoNetworkError } from "../lib/opco-api";
import { StateUpdateOutboxDiagnostics } from "../lib/state-update-offline";
import { StateUpdateSyncStore } from "../sync/state-update-sync";

type DiagnosticsSessionStatus = "loading" | "anonymous" | "authenticated" | "offline";

export type StateUpdateDiagnosticsRouteState =
  | {
      message: "Cargando sesion...";
      ready: false;
      reason: "session";
    }
  | {
      message: "Abriendo datos locales...";
      ready: false;
      reason: "sqlite";
    }
  | {
      message: "Esperando contexto local...";
      ready: false;
      reason: "owner";
    }
  | {
      message: "Esperando contrato seleccionado...";
      ready: false;
      reason: "contract";
    }
  | {
      message: "Diagnostico listo";
      ownerKey: string;
      ready: true;
      selectedContractId: string;
    };

export function getStateUpdateDiagnosticsRouteState({
  localDatabaseStorageState,
  ownerKey,
  selectedContractId,
  status,
}: {
  localDatabaseStorageState: LocalDatabaseStorageState;
  ownerKey: string | null;
  selectedContractId: string | null;
  status: DiagnosticsSessionStatus;
}): StateUpdateDiagnosticsRouteState {
  if (status === "loading" || status === "anonymous") {
    return {
      message: "Cargando sesion...",
      ready: false,
      reason: "session",
    };
  }

  if (localDatabaseStorageState.status !== "ready") {
    return {
      message: "Abriendo datos locales...",
      ready: false,
      reason: "sqlite",
    };
  }

  if (!ownerKey) {
    return {
      message: "Esperando contexto local...",
      ready: false,
      reason: "owner",
    };
  }

  if (!selectedContractId) {
    return {
      message: "Esperando contrato seleccionado...",
      ready: false,
      reason: "contract",
    };
  }

  return {
    message: "Diagnostico listo",
    ownerKey,
    ready: true,
    selectedContractId,
  };
}

export type AttendanceGetDiagnostics = {
  appViewFingerprint: string;
  case: "SUMMARY_AND_LATEST_MATCH_EXPECTED" | "SUMMARY_AND_LATEST_BELOW_EXPECTED" | "SUMMARY_EXCEEDS_LATEST" | "LATEST_EXCEEDS_SUMMARY" | "UNCLASSIFIED";
  date: string;
  expectedTotal: number | null;
  itemsCount: number;
  latest: {
    attendanceRecordFingerprint: string;
    hasPerson: boolean;
    personFingerprint: string;
    statusLabel: string | null;
    statusOptionFingerprint: string;
    updatedAt: string | null;
  }[];
  latestCount: number;
  summaryTotalRegistered: number;
};

export type StateUpdateDiagnosticRow = {
  clientRequestId: string;
  endpoint: string;
  fetchResolvedAt: string | null;
  finalSyncStatus: string;
  httpStatus: number | null;
  requestAbortControllerTriggered: boolean | null;
  requestCompletedAt: string | null;
  requestAttempted: boolean;
  requestDurationMs: number | null;
  requestStartedAt: string | null;
  requestTimeoutMs: number | null;
  responseBodyStartedAt: string | null;
  responseParsedAt: string | null;
  responseStarted: boolean | null;
  result: string;
  selectedForSync: boolean;
};

export type StateUpdateDiagnosticEvents = Map<string, StateUpdateDiagnosticRow>;

export function abbreviateDiagnosticValue(value: string | null) {
  if (!value) {
    return "missing";
  }

  if (value.length <= 12) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function createStateUpdateDiagnosticEvents(diagnostics: StateUpdateOutboxDiagnostics): StateUpdateDiagnosticEvents {
  const events: StateUpdateDiagnosticEvents = new Map();

  for (const operation of diagnostics.operations) {
    events.set(operation.clientRequestId, {
      clientRequestId: operation.clientRequestId,
      endpoint: "none",
      fetchResolvedAt: null,
      finalSyncStatus: operation.syncStatus,
      httpStatus: null,
      requestAbortControllerTriggered: null,
      requestCompletedAt: null,
      requestAttempted: false,
      requestDurationMs: null,
      requestStartedAt: null,
      requestTimeoutMs: null,
      responseBodyStartedAt: null,
      responseParsedAt: null,
      responseStarted: null,
      result: "not-selected",
      selectedForSync: false,
    });
  }

  return events;
}

export function createStateUpdateDiagnosticStore<TStore extends StateUpdateSyncStore>(
  store: TStore,
  events: StateUpdateDiagnosticEvents,
): TStore {
  return {
    ...store,
    async listPendingStateUpdateOperations(ownerKey: string) {
      const operations = await store.listPendingStateUpdateOperations(ownerKey);

      for (const operation of operations) {
        events.set(abbreviateDiagnosticValue(operation.clientRequestId), {
          clientRequestId: abbreviateDiagnosticValue(operation.clientRequestId),
          endpoint: "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update",
          fetchResolvedAt: null,
          finalSyncStatus: "unknown",
          httpStatus: null,
          requestAbortControllerTriggered: null,
          requestCompletedAt: null,
          requestAttempted: false,
          requestDurationMs: null,
          requestStartedAt: null,
          requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
          responseBodyStartedAt: null,
          responseParsedAt: null,
          responseStarted: null,
          result: "selected",
          selectedForSync: true,
        });
      }

      return operations;
    },
    async completeStateUpdateOperation(...args: Parameters<StateUpdateSyncStore["completeStateUpdateOperation"]>) {
      const event = events.get(abbreviateDiagnosticValue(args[0].clientRequestId));

      if (event) {
        event.finalSyncStatus = "synced";
        event.result = args[1].result;
      }

      return store.completeStateUpdateOperation(...args);
    },
    async failStateUpdateOperation(...args: Parameters<StateUpdateSyncStore["failStateUpdateOperation"]>) {
      const event = events.get(abbreviateDiagnosticValue(args[0].clientRequestId));

      if (event) {
        event.finalSyncStatus = "failed";
        event.result = args[1];
      }

      return store.failStateUpdateOperation(...args);
    },
    async markStateUpdateOperationConflict(...args: Parameters<StateUpdateSyncStore["markStateUpdateOperationConflict"]>) {
      const event = events.get(abbreviateDiagnosticValue(args[0].clientRequestId));

      if (event) {
        event.finalSyncStatus = "conflict";
        event.result = "CONFLICT";
      }

      return store.markStateUpdateOperationConflict(...args);
    },
    async retryStateUpdateOperation(...args: Parameters<StateUpdateSyncStore["retryStateUpdateOperation"]>) {
      const event = events.get(abbreviateDiagnosticValue(args[0].clientRequestId));

      if (event) {
        event.finalSyncStatus = "pending_update";
        event.result = args[1];
      }

      return store.retryStateUpdateOperation(...args);
    },
  };
}

export function createStateUpdateDiagnosticApi<TApi extends Pick<OpcoApi, "saveStateUpdateWorkflow">>(
  api: TApi,
  events: StateUpdateDiagnosticEvents,
): TApi {
  return {
    ...api,
    async saveStateUpdateWorkflow(...args: Parameters<OpcoApi["saveStateUpdateWorkflow"]>) {
      const input = args[3];
      const event = [...events.values()].find((item) => item.clientRequestId === abbreviateDiagnosticValue(input.clientRequestId ?? ""));

      if (event) {
        event.endpoint = "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update";
        event.requestAttempted = true;
        event.requestStartedAt = new Date().toISOString();
        event.requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
      }
      const requestStartedMs = Date.now();

      try {
        const response = await api.saveStateUpdateWorkflow(...args);

        if (event) {
          event.httpStatus = 200;
          event.requestAbortControllerTriggered = false;
          event.requestCompletedAt = new Date().toISOString();
          event.requestDurationMs = Date.now() - requestStartedMs;
          event.result = response.results[0]?.result ?? "EMPTY_RESULT";
          event.responseStarted = true;
        }

        return response;
      } catch (error) {
        if (event) {
          event.httpStatus = error instanceof OpcoApiError ? error.status : null;
          event.fetchResolvedAt = error instanceof OpcoNetworkError ? error.diagnostics?.fetchResolvedAt ?? null : event.fetchResolvedAt;
          event.requestAbortControllerTriggered = error instanceof OpcoNetworkError ? error.diagnostics?.abortControllerTriggered ?? null : false;
          event.requestCompletedAt = error instanceof OpcoNetworkError ? error.diagnostics?.requestCompletedAt ?? new Date().toISOString() : new Date().toISOString();
          event.requestDurationMs = error instanceof OpcoNetworkError ? error.diagnostics?.requestDurationMs ?? Date.now() - requestStartedMs : Date.now() - requestStartedMs;
          event.requestStartedAt = error instanceof OpcoNetworkError ? error.diagnostics?.requestStartedAt ?? event.requestStartedAt : event.requestStartedAt;
          event.requestTimeoutMs = error instanceof OpcoNetworkError ? error.diagnostics?.timeoutMs ?? event.requestTimeoutMs : event.requestTimeoutMs;
          event.responseBodyStartedAt = error instanceof OpcoNetworkError ? error.diagnostics?.responseBodyStartedAt ?? null : event.responseBodyStartedAt;
          event.responseParsedAt = error instanceof OpcoNetworkError ? error.diagnostics?.responseParsedAt ?? null : event.responseParsedAt;
          event.result = error instanceof OpcoApiError ? error.code : error instanceof Error ? error.name : "UNKNOWN_ERROR";
          event.responseStarted = error instanceof OpcoNetworkError ? error.diagnostics?.responseStarted ?? false : true;
        }

        throw error;
      }
    },
  };
}

export function summarizeAttendanceGetResponse({
  appViewId,
  expectedTotal = null,
  response,
}: {
  appViewId: string;
  expectedTotal?: number | null;
  response: AttendanceResponse;
}): AttendanceGetDiagnostics {
  const summaryTotalRegistered = response.summary.totalRegistered;
  const latestCount = response.latest.length;

  return {
    appViewFingerprint: fingerprintDiagnosticValue(appViewId),
    case: classifyAttendanceGetCounts({ expectedTotal, latestCount, summaryTotalRegistered }),
    date: response.date,
    expectedTotal,
    itemsCount: response.items.length,
    latest: response.latest.map((item) => ({
      attendanceRecordFingerprint: fingerprintDiagnosticValue(item.attendanceRecordId),
      hasPerson: Boolean(item.person),
      personFingerprint: fingerprintDiagnosticValue(item.person?.id ?? null),
      statusLabel: item.statusLabel,
      statusOptionFingerprint: fingerprintDiagnosticValue(item.statusOptionId),
      updatedAt: item.updatedAt ?? null,
    })),
    latestCount,
    summaryTotalRegistered,
  };
}

function classifyAttendanceGetCounts({
  expectedTotal,
  latestCount,
  summaryTotalRegistered,
}: {
  expectedTotal: number | null;
  latestCount: number;
  summaryTotalRegistered: number;
}): AttendanceGetDiagnostics["case"] {
  if (summaryTotalRegistered < latestCount) {
    return "LATEST_EXCEEDS_SUMMARY";
  }

  if (summaryTotalRegistered > latestCount) {
    return "SUMMARY_EXCEEDS_LATEST";
  }

  if (expectedTotal !== null && summaryTotalRegistered === expectedTotal && latestCount === expectedTotal) {
    return "SUMMARY_AND_LATEST_MATCH_EXPECTED";
  }

  if (expectedTotal !== null && summaryTotalRegistered < expectedTotal && latestCount < expectedTotal) {
    return "SUMMARY_AND_LATEST_BELOW_EXPECTED";
  }

  return "UNCLASSIFIED";
}

function fingerprintDiagnosticValue(value: string | null | undefined) {
  if (!value) {
    return "none";
  }

  if (value.length <= 10) {
    return `${value.slice(0, 2)}...${value.slice(-2)}`;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
