import { LocalDatabaseStorageState } from "../lib/local-db-recovery";
import { AttendanceResponse, DEFAULT_REQUEST_TIMEOUT_MS, OpcoApi, OpcoApiError, OpcoNetworkError } from "../lib/opco-api";
import { StateUpdateOutboxDiagnostics, StateUpdateSyncDiagnosticsTelemetry } from "../lib/state-update-offline";
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

export type StateUpdateDiagnosticsObservationPlan = {
  autoAttendanceGet: false;
  autoMutationRequest: false;
  autoSync: false;
  readOutbox: boolean;
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

export function getStateUpdateDiagnosticsObservationPlan(
  routeState: StateUpdateDiagnosticsRouteState,
): StateUpdateDiagnosticsObservationPlan {
  return {
    autoAttendanceGet: false,
    autoMutationRequest: false,
    autoSync: false,
    readOutbox: routeState.ready,
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

export type StateUpdateDiagnosticHealth = {
  cards: {
    label: string;
    tone: "good" | "risk" | "warn";
    value: string;
  }[];
  currentActivity: {
    result: string;
    syncRunId: string | null;
    type: string;
  };
  interpretation: string;
  pendingState: string;
};

export const STATE_UPDATE_RECENT_TIMEOUT_WINDOW_MS = 5 * 60 * 1000;

export function buildStateUpdateDiagnosticHealth({
  diagnostics,
  now = new Date(),
  reconnect,
}: {
  diagnostics: StateUpdateOutboxDiagnostics | null;
  now?: Date;
  reconnect: StateUpdateSyncDiagnosticsTelemetry;
}): StateUpdateDiagnosticHealth {
  const summary = diagnostics?.summary;
  const pending = summary
    ? summary.pendingCreate + summary.pendingUpdate + summary.syncing + summary.failed + summary.conflict
    : 0;
  const currentActivity = resolveStateUpdateCurrentActivity({ pending, reconnect });
  const recentTimeout = hasRecentStateUpdateTimeout({ now, reconnect });
  const hasError = Boolean(reconnect.lastVisibleErrorEvent && !reconnect.lastVisibleErrorEvent.clearedAt);
  const pendingState = summary
    ? [
        summary.pendingCreate ? `pending_create:${summary.pendingCreate}` : null,
        summary.pendingUpdate ? `pending_update:${summary.pendingUpdate}` : null,
        summary.syncing ? `syncing:${summary.syncing}` : null,
        summary.failed ? `failed:${summary.failed}` : null,
        summary.conflict ? `conflict:${summary.conflict}` : null,
      ].filter(Boolean).join(", ") || "none"
    : "loading";

  return {
    cards: [
      {
        label: "Conectividad",
        tone: reconnect.currentConnectivity.status === "online" ? "good" : reconnect.currentConnectivity.status === "offline" ? "warn" : "risk",
        value: reconnect.currentConnectivity.status,
      },
      {
        label: "Trabajo local",
        tone: pending > 0 ? "warn" : "good",
        value: summary ? String(pending) : "loading",
      },
      {
        label: "Ultimo sync completado",
        tone: reconnect.lastStateUpdateSync?.result === "success" || reconnect.lastStateUpdateSync?.result === "reconciled_success" ? "good" : reconnect.lastStateUpdateSync ? "warn" : "risk",
        value: reconnect.lastStateUpdateSync?.result ?? "none",
      },
      {
        label: "Actividad actual",
        tone: currentActivity.type === "idle" ? "good" : currentActivity.result === "ready_failed" ? "warn" : "warn",
        value: currentActivity.type,
      },
      {
        label: "Timeout reciente",
        tone: recentTimeout ? "warn" : "good",
        value: recentTimeout ? "si" : "no",
      },
      {
        label: "Error visible",
        tone: hasError ? "risk" : "good",
        value: hasError ? reconnect.lastVisibleErrorEvent?.errorCode ?? "error" : "none",
      },
    ],
    currentActivity,
    interpretation: describeStateUpdateHealth({
      hasError,
      pending,
      recentTimeout,
      syncResult: reconnect.lastStateUpdateSync?.result ?? null,
    }),
    pendingState,
  };
}

export function resolveStateUpdateCurrentActivity({
  pending,
  reconnect,
}: {
  pending: number;
  reconnect: StateUpdateSyncDiagnosticsTelemetry;
}) {
  const activity = reconnect.lastStateUpdateActivity;
  const lastSync = reconnect.lastStateUpdateSync;
  const latestReadyCheck = getLatestRequestHistoryEvent(reconnect.requestHistory ?? [], "READY_CHECK");
  const activityTimestampMs = parseTelemetryTimestampMs(activity?.completedAt ?? activity?.startedAt ?? null);
  const latestReadyCheckTimestampMs = parseTelemetryTimestampMs(
    latestReadyCheck?.requestCompletedAt ?? latestReadyCheck?.requestStartedAt ?? null,
  );

  if (pending === 0 && isSuccessfulSyncResult(lastSync?.result)) {
    return {
      result: "none",
      syncRunId: null,
      type: "idle",
    };
  }

  if (
    latestReadyCheck &&
    latestReadyCheck.diagnosticSyncRunId &&
    latestReadyCheck.diagnosticSyncRunId !== activity?.syncRunId &&
    (activityTimestampMs === null || latestReadyCheckTimestampMs === null || latestReadyCheckTimestampMs >= activityTimestampMs)
  ) {
    return {
      result: isSuccessfulRequest(latestReadyCheck) ? "ready_confirmed" : "ready_failed",
      syncRunId: latestReadyCheck.diagnosticSyncRunId,
      type: "ready_check",
    };
  }

  if (activity?.type === "ready_check" && activity.result === "ready_failed" && activity.syncRunId) {
    const readySucceeded = (reconnect.requestHistory ?? []).some((request) =>
      request.diagnosticOperation === "READY_CHECK" &&
      request.diagnosticSyncRunId === activity.syncRunId &&
      request.httpStatus === 200 &&
      request.abortControllerTriggered !== true
    );

    if (readySucceeded) {
      return {
        result: "ready_confirmed",
        syncRunId: activity.syncRunId,
        type: "ready_check",
      };
    }
  }

  if (activity) {
    return {
      result: activity.result,
      syncRunId: activity.syncRunId,
      type: activity.type,
    };
  }

  return {
    result: lastSync?.result ?? "none",
    syncRunId: lastSync?.syncRunId ?? null,
    type: lastSync ? "sync" : "idle",
  };
}

export function hasRecentStateUpdateTimeout({
  now = new Date(),
  reconnect,
  windowMs = STATE_UPDATE_RECENT_TIMEOUT_WINDOW_MS,
}: {
  now?: Date;
  reconnect: StateUpdateSyncDiagnosticsTelemetry;
  windowMs?: number;
}) {
  const nowMs = now.getTime();

  return (reconnect.requestHistory ?? []).some((request) => {
    if (!request.abortControllerTriggered) {
      return false;
    }

    const completedAtMs = Date.parse(request.requestCompletedAt);

    return Number.isFinite(completedAtMs) && nowMs - completedAtMs >= 0 && nowMs - completedAtMs <= windowMs;
  });
}

function getLatestRequestHistoryEvent(
  requestHistory: NonNullable<StateUpdateSyncDiagnosticsTelemetry["requestHistory"]>,
  operation: NonNullable<StateUpdateSyncDiagnosticsTelemetry["requestHistory"]>[number]["diagnosticOperation"],
) {
  return requestHistory.reduce<NonNullable<StateUpdateSyncDiagnosticsTelemetry["requestHistory"]>[number] | null>((latest, request) => {
    if (request.diagnosticOperation !== operation) {
      return latest;
    }

    if (!latest) {
      return request;
    }

    const latestTimestampMs = parseTelemetryTimestampMs(latest.requestCompletedAt ?? latest.requestStartedAt);
    const requestTimestampMs = parseTelemetryTimestampMs(request.requestCompletedAt ?? request.requestStartedAt);

    return requestTimestampMs !== null && (latestTimestampMs === null || requestTimestampMs >= latestTimestampMs)
      ? request
      : latest;
  }, null);
}

function isSuccessfulRequest(
  request: NonNullable<StateUpdateSyncDiagnosticsTelemetry["requestHistory"]>[number],
) {
  return request.httpStatus === 200 && request.abortControllerTriggered !== true;
}

function parseTelemetryTimestampMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const timestampMs = Date.parse(value);

  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function isSuccessfulSyncResult(result: string | null | undefined) {
  return result === "success" || result === "reconciled_success";
}

function describeStateUpdateHealth({
  hasError,
  pending,
  recentTimeout,
  syncResult,
}: {
  hasError: boolean;
  pending: number;
  recentTimeout: boolean;
  syncResult: string | null;
}) {
  if (hasError) {
    return "Hay un error visible sin resolver; revisar ultimo request y actividad antes de reintentar.";
  }

  if (pending > 0) {
    return "Existe intencion local pendiente; el registro debe seguir visible mientras sync/reconcile lo resuelve.";
  }

  if (syncResult === "reconciled_success") {
    return "El ultimo timeout tecnico fue reconciliado con exito remoto.";
  }

  if (recentTimeout) {
    return "Hubo timeout reciente; comparar duracion cliente con Server-Timing para ubicar red vs servidor.";
  }

  return "No hay senales activas de bloqueo STATE_UPDATE.";
}

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
