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

export type StateUpdateRunSummary = {
  authDecision: string | null;
  authRefreshCompletedAt: string | null;
  authRefreshStartedAt: string | null;
  countPendingOperationsCount: number | null;
  phase: "activity" | "request" | "sync" | "none";
  listPendingStateUpdateOperationsCount: number | null;
  operationsAttempted: number | null;
  operationsCompleted: number | null;
  operationsFailed: number | null;
  operationsSelected: number | null;
  readinessAttempts: number | null;
  readinessCompletedAt: string | null;
  readinessConfirmedAt: string | null;
  readinessStartedAt: string | null;
  recordsOperationsCompleted: number | null;
  recordsOperationsConflicted: number | null;
  recordsOperationsFailed: number | null;
  recordsOperationsRetriable: number | null;
  recordsPhaseCompletedAt: string | null;
  recordsPhaseFailedAt: string | null;
  recordsPhaseResult: string | null;
  recordsPhaseStartedAt: string | null;
  reconnectDetectedAt: string | null;
  runSyncStartedAt: string | null;
  scopeCheckAfterReadiness: string | null;
  stateUpdateOperationsSelected: number | null;
  stateUpdatePhaseCompletedAt: string | null;
  stateUpdatePhaseFailedAt: string | null;
  stateUpdatePhaseResult: string | null;
  stateUpdatePhaseStartedAt: string | null;
  syncPendingWorkCompletedAt: string | null;
  syncPendingWorkStartedAt: string | null;
  syncRunId: string | null;
  terminalResult: string;
  trigger: string | null;
};

export type StateUpdateDiagnosticDisplayRow = [string, string | number | boolean | null];

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

export function resolveLatestStateUpdateRunSummary(
  reconnect: StateUpdateSyncDiagnosticsTelemetry,
): StateUpdateRunSummary {
  const candidates: {
    phase: StateUpdateRunSummary["phase"];
    syncRunId: string | null;
    terminalResult: string;
    timestampMs: number | null;
    trigger: string | null;
  }[] = [];

  const lastRequest = (reconnect.requestHistory ?? []).reduce<NonNullable<StateUpdateSyncDiagnosticsTelemetry["requestHistory"]>[number] | null>((latest, request) => {
    if (!latest) {
      return request;
    }

    const latestTimestampMs = parseTelemetryTimestampMs(latest.requestCompletedAt ?? latest.requestStartedAt);
    const requestTimestampMs = parseTelemetryTimestampMs(request.requestCompletedAt ?? request.requestStartedAt);

    return requestTimestampMs !== null && (latestTimestampMs === null || requestTimestampMs >= latestTimestampMs)
      ? request
      : latest;
  }, null);

  if (lastRequest) {
    candidates.push({
      phase: "request",
      syncRunId: lastRequest.diagnosticSyncRunId ?? null,
      terminalResult: requestTerminalResult(lastRequest),
      timestampMs: parseTelemetryTimestampMs(lastRequest.requestCompletedAt ?? lastRequest.requestStartedAt),
      trigger: null,
    });
  }

  if (reconnect.lastStateUpdateActivity) {
    candidates.push({
      phase: "activity",
      syncRunId: reconnect.lastStateUpdateActivity.syncRunId,
      terminalResult: reconnect.lastStateUpdateActivity.result,
      timestampMs: parseTelemetryTimestampMs(
        reconnect.lastStateUpdateActivity.completedAt ?? reconnect.lastStateUpdateActivity.startedAt,
      ),
      trigger: reconnect.lastStateUpdateActivity.trigger,
    });
  }

  if (reconnect.lastStateUpdateSync) {
    candidates.push({
      phase: "sync",
      syncRunId: reconnect.lastStateUpdateSync.syncRunId,
      terminalResult: reconnect.lastStateUpdateSync.result,
      timestampMs: parseTelemetryTimestampMs(
        reconnect.lastStateUpdateSync.completedAt ?? reconnect.lastStateUpdateSync.startedAt,
      ),
      trigger: reconnect.lastStateUpdateSync.trigger,
    });
  }

  const latest = candidates.reduce<typeof candidates[number] | null>((current, candidate) => {
    if (!current) {
      return candidate;
    }

    return candidate.timestampMs !== null && (current.timestampMs === null || candidate.timestampMs >= current.timestampMs)
      ? candidate
      : current;
  }, null);

  const preflight = latest?.syncRunId ? findReconnectPreflightForRun(reconnect, latest.syncRunId) : null;
  const sync = latest?.syncRunId && reconnect.lastStateUpdateSync?.syncRunId === latest.syncRunId
    ? reconnect.lastStateUpdateSync
    : null;
  const activity = latest?.syncRunId && reconnect.lastStateUpdateActivity?.syncRunId === latest.syncRunId
    ? reconnect.lastStateUpdateActivity
    : null;

  return {
    authDecision: preflight?.authDecision ?? null,
    authRefreshCompletedAt: preflight?.authRefreshCompletedAt ?? null,
    authRefreshStartedAt: preflight?.authRefreshStartedAt ?? null,
    countPendingOperationsCount: preflight?.countPendingOperationsCount ?? null,
    phase: latest?.phase ?? "none",
    listPendingStateUpdateOperationsCount: preflight?.listPendingStateUpdateOperationsCount ?? null,
    operationsAttempted: sync?.operationsAttempted ?? null,
    operationsCompleted: sync?.operationsCompleted ?? activity?.operationsCompleted ?? null,
    operationsFailed: sync?.operationsFailed ?? activity?.operationsFailed ?? null,
    operationsSelected: sync?.operationsSelected ?? null,
    readinessAttempts: preflight?.readinessAttempts ?? null,
    readinessCompletedAt: preflight?.readinessCompletedAt ?? null,
    readinessConfirmedAt: preflight?.readinessConfirmedAt ?? null,
    readinessStartedAt: preflight?.readinessStartedAt ?? null,
    recordsOperationsCompleted: preflight?.recordsOperationsCompleted ?? null,
    recordsOperationsConflicted: preflight?.recordsOperationsConflicted ?? null,
    recordsOperationsFailed: preflight?.recordsOperationsFailed ?? null,
    recordsOperationsRetriable: preflight?.recordsOperationsRetriable ?? null,
    recordsPhaseCompletedAt: preflight?.recordsPhaseCompletedAt ?? null,
    recordsPhaseFailedAt: preflight?.recordsPhaseFailedAt ?? null,
    recordsPhaseResult: preflight?.recordsPhaseResult ?? null,
    recordsPhaseStartedAt: preflight?.recordsPhaseStartedAt ?? null,
    reconnectDetectedAt: preflight?.reconnectDetectedAt ?? null,
    runSyncStartedAt: preflight?.runSyncStartedAt ?? null,
    scopeCheckAfterReadiness: preflight?.scopeCheckAfterReadiness ?? null,
    stateUpdateOperationsSelected: preflight?.stateUpdateOperationsSelected ?? null,
    stateUpdatePhaseCompletedAt: preflight?.stateUpdatePhaseCompletedAt ?? null,
    stateUpdatePhaseFailedAt: preflight?.stateUpdatePhaseFailedAt ?? null,
    stateUpdatePhaseResult: preflight?.stateUpdatePhaseResult ?? null,
    stateUpdatePhaseStartedAt: preflight?.stateUpdatePhaseStartedAt ?? null,
    syncPendingWorkCompletedAt: preflight?.syncPendingWorkCompletedAt ?? null,
    syncPendingWorkStartedAt: preflight?.syncPendingWorkStartedAt ?? null,
    syncRunId: latest?.syncRunId ?? null,
    terminalResult: latest?.terminalResult ?? "none",
    trigger: preflight?.trigger ?? latest?.trigger ?? null,
  };
}

export function resolveCurrentStateUpdateRunSummary(
  reconnect: StateUpdateSyncDiagnosticsTelemetry,
): StateUpdateRunSummary {
  const preflight = reconnect.lastReconnectPreflight;

  if (!preflight?.syncRunId || isFinishedPreflight(preflight)) {
    return emptyRunSummary();
  }

  return buildStateUpdateRunSummary({
    activity: reconnect.lastStateUpdateActivity?.syncRunId === preflight.syncRunId ? reconnect.lastStateUpdateActivity : null,
    latest: {
      phase: "activity",
      syncRunId: preflight.syncRunId,
      terminalResult: reconnect.lastStateUpdateActivity?.syncRunId === preflight.syncRunId
        ? reconnect.lastStateUpdateActivity.result
        : "reconnecting",
      timestampMs: parseTelemetryTimestampMs(preflight.runSyncStartedAt ?? preflight.reconnectDetectedAt),
      trigger: preflight.trigger,
    },
    preflight,
    sync: null,
  });
}

export function resolveLastFinishedStateUpdateRunSummary(
  reconnect: StateUpdateSyncDiagnosticsTelemetry,
): StateUpdateRunSummary {
  if (reconnect.lastStateUpdateSync?.syncRunId) {
    const syncRunId = reconnect.lastStateUpdateSync.syncRunId;

    return buildStateUpdateRunSummary({
      activity: reconnect.lastStateUpdateActivity?.syncRunId === syncRunId ? reconnect.lastStateUpdateActivity : null,
      latest: {
        phase: "sync",
        syncRunId,
        terminalResult: reconnect.lastStateUpdateSync.result,
        timestampMs: parseTelemetryTimestampMs(
          reconnect.lastStateUpdateSync.completedAt ?? reconnect.lastStateUpdateSync.startedAt,
        ),
        trigger: reconnect.lastStateUpdateSync.trigger,
      },
      preflight: findReconnectPreflightForRun(reconnect, syncRunId),
      sync: reconnect.lastStateUpdateSync,
    });
  }

  return emptyRunSummary();
}

export function formatStateUpdateRunRows(run: StateUpdateRunSummary): StateUpdateDiagnosticDisplayRow[] {
  return [
    ["estado", describeStateUpdateRunStatus(run)],
    ["operaciones", describeStateUpdateRunOperations(run)],
    ["readiness", describeStateUpdateRunReadiness(run)],
    ["syncRunId", formatDiagnosticValue(run.syncRunId)],
    ["trigger", formatDiagnosticValue(run.trigger)],
    ["phase", formatDiagnosticValue(run.phase)],
    ["terminalResult", formatDiagnosticValue(run.terminalResult)],
    ["reconnectDetectedAt", formatDiagnosticValue(run.reconnectDetectedAt)],
    ["runSyncStartedAt", formatDiagnosticValue(run.runSyncStartedAt)],
    ["readinessStartedAt", formatDiagnosticValue(run.readinessStartedAt)],
    ["readinessConfirmedAt", formatDiagnosticValue(run.readinessConfirmedAt)],
    ["readinessCompletedAt", formatDiagnosticValue(run.readinessCompletedAt)],
    ["readinessAttempts", formatDiagnosticValue(run.readinessAttempts)],
    ["authDecision", formatDiagnosticValue(run.authDecision)],
    ["authRefreshStartedAt", formatDiagnosticValue(run.authRefreshStartedAt)],
    ["authRefreshCompletedAt", formatDiagnosticValue(run.authRefreshCompletedAt)],
    ["scopeCheckAfterReadiness", formatDiagnosticValue(run.scopeCheckAfterReadiness)],
    ["syncPendingWorkStartedAt", formatDiagnosticValue(run.syncPendingWorkStartedAt)],
    ["syncPendingWorkCompletedAt", formatDiagnosticValue(run.syncPendingWorkCompletedAt)],
    ["recordsPhaseStartedAt", formatDiagnosticValue(run.recordsPhaseStartedAt)],
    ["recordsPhaseCompletedAt", formatDiagnosticValue(run.recordsPhaseCompletedAt)],
    ["recordsPhaseFailedAt", formatDiagnosticValue(run.recordsPhaseFailedAt)],
    ["recordsPhaseResult", formatDiagnosticValue(run.recordsPhaseResult)],
    ["recordsOperationsCompleted", formatDiagnosticValue(run.recordsOperationsCompleted)],
    ["recordsOperationsConflicted", formatDiagnosticValue(run.recordsOperationsConflicted)],
    ["recordsOperationsFailed", formatDiagnosticValue(run.recordsOperationsFailed)],
    ["recordsOperationsRetriable", formatDiagnosticValue(run.recordsOperationsRetriable)],
    ["stateUpdatePhaseStartedAt", formatDiagnosticValue(run.stateUpdatePhaseStartedAt)],
    ["stateUpdatePhaseCompletedAt", formatDiagnosticValue(run.stateUpdatePhaseCompletedAt)],
    ["stateUpdatePhaseFailedAt", formatDiagnosticValue(run.stateUpdatePhaseFailedAt)],
    ["stateUpdatePhaseResult", formatDiagnosticValue(run.stateUpdatePhaseResult)],
    ["stateUpdateOperationsSelected", formatDiagnosticValue(run.stateUpdateOperationsSelected)],
    ["countPendingOperationsCount", formatDiagnosticValue(run.countPendingOperationsCount)],
    ["listPendingStateUpdateOperationsCount", formatDiagnosticValue(run.listPendingStateUpdateOperationsCount)],
    ["operationsSelected", formatDiagnosticValue(run.operationsSelected)],
    ["operationsAttempted", formatDiagnosticValue(run.operationsAttempted)],
    ["operationsCompleted", formatDiagnosticValue(run.operationsCompleted)],
    ["operationsFailed", formatDiagnosticValue(run.operationsFailed)],
  ];
}

export function formatStateUpdatePreflightRows(
  preflight: StateUpdateSyncDiagnosticsTelemetry["lastReconnectPreflight"],
): StateUpdateDiagnosticDisplayRow[] {
  if (!preflight) {
    return [
      ["syncRunId", "-"],
      ["trigger", "-"],
      ["Readiness", "-"],
      ["Intentos", "-"],
      ["Duracion", "-"],
    ];
  }

  return [
    ["syncRunId", formatDiagnosticValue(preflight.syncRunId)],
    ["trigger", preflight.trigger],
    ["Readiness", describePreflightReadiness(preflight)],
    ["Intentos", formatAttemptCount(preflight.readinessAttempts)],
    ["Duracion", formatDurationMs(preflight.readinessDurationMs ?? elapsedTelemetryMs(preflight.readinessStartedAt, preflight.readinessCompletedAt))],
    ["reconnectDetectedAt", formatDiagnosticValue(preflight.reconnectDetectedAt)],
    ["debounceStartedAt", formatDiagnosticValue(preflight.debounceStartedAt)],
    ["debounceCompletedAt", formatDiagnosticValue(preflight.debounceCompletedAt)],
    ["debounceDurationMs", formatDiagnosticValue(preflight.debounceDurationMs)],
    ["shouldSyncStartedAt", formatDiagnosticValue(preflight.shouldSyncStartedAt)],
    ["shouldSyncCompletedAt", formatDiagnosticValue(preflight.shouldSyncCompletedAt)],
    ["shouldSyncDurationMs", formatDiagnosticValue(preflight.shouldSyncDurationMs)],
    ["countPendingOperationsCount", formatDiagnosticValue(preflight.countPendingOperationsCount)],
    ["countPendingOperationsDurationMs", formatDiagnosticValue(preflight.countPendingOperationsDurationMs)],
    ["listPendingStateUpdateOperationsCount", formatDiagnosticValue(preflight.listPendingStateUpdateOperationsCount)],
    ["listPendingStateUpdateOperationsDurationMs", formatDiagnosticValue(preflight.listPendingStateUpdateOperationsDurationMs)],
    ["shouldSyncResult", formatDiagnosticValue(preflight.shouldSyncResult)],
    ["runSyncStartedAt", formatDiagnosticValue(preflight.runSyncStartedAt)],
    ["readinessStartedAt", formatDiagnosticValue(preflight.readinessStartedAt)],
    ["readinessCompletedAt", formatDiagnosticValue(preflight.readinessCompletedAt)],
    ["readinessConfirmedAt", formatDiagnosticValue(preflight.readinessConfirmedAt)],
    ["readinessDurationMs", formatDiagnosticValue(preflight.readinessDurationMs)],
    ["readinessAttempts", formatDiagnosticValue(preflight.readinessAttempts)],
    ["authDecision", formatDiagnosticValue(preflight.authDecision)],
    ["authRefreshStartedAt", formatDiagnosticValue(preflight.authRefreshStartedAt)],
    ["authRefreshCompletedAt", formatDiagnosticValue(preflight.authRefreshCompletedAt)],
    ["scopeCheckAfterReadiness", formatDiagnosticValue(preflight.scopeCheckAfterReadiness)],
    ["syncPendingWorkStartedAt", formatDiagnosticValue(preflight.syncPendingWorkStartedAt)],
    ["syncPendingWorkCompletedAt", formatDiagnosticValue(preflight.syncPendingWorkCompletedAt)],
    ["recordsPhaseStartedAt", formatDiagnosticValue(preflight.recordsPhaseStartedAt)],
    ["recordsPhaseCompletedAt", formatDiagnosticValue(preflight.recordsPhaseCompletedAt)],
    ["recordsPhaseFailedAt", formatDiagnosticValue(preflight.recordsPhaseFailedAt)],
    ["recordsPhaseResult", formatDiagnosticValue(preflight.recordsPhaseResult)],
    ["recordsOperationsCompleted", formatDiagnosticValue(preflight.recordsOperationsCompleted)],
    ["recordsOperationsConflicted", formatDiagnosticValue(preflight.recordsOperationsConflicted)],
    ["recordsOperationsFailed", formatDiagnosticValue(preflight.recordsOperationsFailed)],
    ["recordsOperationsRetriable", formatDiagnosticValue(preflight.recordsOperationsRetriable)],
    ["stateUpdatePhaseStartedAt", formatDiagnosticValue(preflight.stateUpdatePhaseStartedAt)],
    ["stateUpdatePhaseCompletedAt", formatDiagnosticValue(preflight.stateUpdatePhaseCompletedAt)],
    ["stateUpdatePhaseFailedAt", formatDiagnosticValue(preflight.stateUpdatePhaseFailedAt)],
    ["stateUpdatePhaseResult", formatDiagnosticValue(preflight.stateUpdatePhaseResult)],
    ["stateUpdateOperationsSelected", formatDiagnosticValue(preflight.stateUpdateOperationsSelected)],
    ["completedAt", formatDiagnosticValue(preflight.completedAt)],
  ];
}

function findReconnectPreflightForRun(
  reconnect: StateUpdateSyncDiagnosticsTelemetry,
  syncRunId: string,
) {
  if (reconnect.lastReconnectPreflight?.syncRunId === syncRunId) {
    return reconnect.lastReconnectPreflight;
  }

  return (reconnect.reconnectRunHistory ?? []).find((entry) => entry.syncRunId === syncRunId) ?? null;
}

function isFinishedPreflight(preflight: NonNullable<StateUpdateSyncDiagnosticsTelemetry["lastReconnectPreflight"]>) {
  return Boolean(preflight.completedAt || preflight.syncPendingWorkCompletedAt || preflight.stateUpdatePhaseCompletedAt || preflight.stateUpdatePhaseFailedAt);
}

function buildStateUpdateRunSummary({
  activity,
  latest,
  preflight,
  sync,
}: {
  activity: StateUpdateSyncDiagnosticsTelemetry["lastStateUpdateActivity"];
  latest: {
    phase: StateUpdateRunSummary["phase"];
    syncRunId: string | null;
    terminalResult: string;
    timestampMs: number | null;
    trigger: string | null;
  } | null;
  preflight: StateUpdateSyncDiagnosticsTelemetry["lastReconnectPreflight"];
  sync: StateUpdateSyncDiagnosticsTelemetry["lastStateUpdateSync"];
}): StateUpdateRunSummary {
  return {
    authDecision: preflight?.authDecision ?? null,
    authRefreshCompletedAt: preflight?.authRefreshCompletedAt ?? null,
    authRefreshStartedAt: preflight?.authRefreshStartedAt ?? null,
    countPendingOperationsCount: preflight?.countPendingOperationsCount ?? null,
    phase: latest?.phase ?? "none",
    listPendingStateUpdateOperationsCount: preflight?.listPendingStateUpdateOperationsCount ?? null,
    operationsAttempted: sync?.operationsAttempted ?? null,
    operationsCompleted: sync?.operationsCompleted ?? activity?.operationsCompleted ?? null,
    operationsFailed: sync?.operationsFailed ?? activity?.operationsFailed ?? null,
    operationsSelected: sync?.operationsSelected ?? null,
    readinessAttempts: preflight?.readinessAttempts ?? null,
    readinessCompletedAt: preflight?.readinessCompletedAt ?? null,
    readinessConfirmedAt: preflight?.readinessConfirmedAt ?? null,
    readinessStartedAt: preflight?.readinessStartedAt ?? null,
    recordsOperationsCompleted: preflight?.recordsOperationsCompleted ?? null,
    recordsOperationsConflicted: preflight?.recordsOperationsConflicted ?? null,
    recordsOperationsFailed: preflight?.recordsOperationsFailed ?? null,
    recordsOperationsRetriable: preflight?.recordsOperationsRetriable ?? null,
    recordsPhaseCompletedAt: preflight?.recordsPhaseCompletedAt ?? null,
    recordsPhaseFailedAt: preflight?.recordsPhaseFailedAt ?? null,
    recordsPhaseResult: preflight?.recordsPhaseResult ?? null,
    recordsPhaseStartedAt: preflight?.recordsPhaseStartedAt ?? null,
    reconnectDetectedAt: preflight?.reconnectDetectedAt ?? null,
    runSyncStartedAt: preflight?.runSyncStartedAt ?? null,
    scopeCheckAfterReadiness: preflight?.scopeCheckAfterReadiness ?? null,
    stateUpdateOperationsSelected: preflight?.stateUpdateOperationsSelected ?? null,
    stateUpdatePhaseCompletedAt: preflight?.stateUpdatePhaseCompletedAt ?? null,
    stateUpdatePhaseFailedAt: preflight?.stateUpdatePhaseFailedAt ?? null,
    stateUpdatePhaseResult: preflight?.stateUpdatePhaseResult ?? null,
    stateUpdatePhaseStartedAt: preflight?.stateUpdatePhaseStartedAt ?? null,
    syncPendingWorkCompletedAt: preflight?.syncPendingWorkCompletedAt ?? null,
    syncPendingWorkStartedAt: preflight?.syncPendingWorkStartedAt ?? null,
    syncRunId: latest?.syncRunId ?? null,
    terminalResult: latest?.terminalResult ?? "none",
    trigger: preflight?.trigger ?? latest?.trigger ?? null,
  };
}

function emptyRunSummary(): StateUpdateRunSummary {
  return buildStateUpdateRunSummary({
    activity: null,
    latest: null,
    preflight: null,
    sync: null,
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

function requestTerminalResult(
  request: NonNullable<StateUpdateSyncDiagnosticsTelemetry["requestHistory"]>[number],
) {
  if (isSuccessfulRequest(request)) {
    return "success";
  }

  if (request.abortControllerTriggered) {
    return "timeout";
  }

  return request.errorCode ?? "request_failed";
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

function describeStateUpdateRunStatus(run: StateUpdateRunSummary) {
  if ((run.operationsSelected ?? 0) === 0 && run.terminalResult === "success") {
    return "Sin pendientes";
  }

  if (isSuccessfulSyncResult(run.terminalResult)) {
    return "Sincronizacion completada";
  }

  if (run.terminalResult === "timeout") {
    return "Timeout";
  }

  if (run.terminalResult === "ready_failed" || run.terminalResult.includes("failed") || run.terminalResult.includes("error")) {
    return "Fallido";
  }

  if (run.terminalResult === "none" && run.phase === "none") {
    return "-";
  }

  return run.terminalResult;
}

function describeStateUpdateRunOperations(run: StateUpdateRunSummary) {
  const completed = run.operationsCompleted ?? 0;
  const attempted = run.operationsAttempted ?? 0;
  const selected = run.operationsSelected ?? 0;
  const failed = run.operationsFailed ?? 0;

  if (selected === 0 && attempted === 0 && completed === 0 && failed === 0) {
    return "Sin pendientes";
  }

  if (isSuccessfulSyncResult(run.terminalResult) && failed === 0 && completed === attempted && attempted > 0) {
    return completed === 1 ? "1 operacion sincronizada" : `${completed} operaciones sincronizadas`;
  }

  return `${completed}/${attempted} completadas${failed ? `, ${failed} fallidas` : ""}`;
}

function describeStateUpdateRunReadiness(run: StateUpdateRunSummary) {
  if (run.readinessConfirmedAt) {
    return `Readiness confirmado en ${formatAttemptCount(run.readinessAttempts)}`;
  }

  if (run.readinessStartedAt && run.readinessCompletedAt) {
    return `Readiness fallido en ${formatAttemptCount(run.readinessAttempts)}`;
  }

  if (run.readinessStartedAt) {
    return `Readiness en curso (${formatAttemptCount(run.readinessAttempts)})`;
  }

  return "-";
}

function describePreflightReadiness(preflight: NonNullable<StateUpdateSyncDiagnosticsTelemetry["lastReconnectPreflight"]>) {
  if (preflight.readinessConfirmedAt) {
    return "Confirmado";
  }

  if (preflight.readinessStartedAt && preflight.readinessCompletedAt) {
    return "Fallido";
  }

  if (preflight.readinessStartedAt) {
    return "Comprobando";
  }

  return "-";
}

function formatAttemptCount(attempts: number | null | undefined) {
  if (!attempts) {
    return "-";
  }

  return `${attempts} ${attempts === 1 ? "intento" : "intentos"}`;
}

function formatDurationMs(value: number | null | undefined) {
  return typeof value === "number" ? `${value} ms` : "-";
}

function formatDiagnosticValue(value: string | number | boolean | null | undefined) {
  return value === "none" ? "-" : value ?? "-";
}

function elapsedTelemetryMs(start: string | null | undefined, end: string | null | undefined) {
  const startMs = parseTelemetryTimestampMs(start);
  const endMs = parseTelemetryTimestampMs(end);

  if (startMs === null || endMs === null || endMs < startMs) {
    return null;
  }

  return endMs - startMs;
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
