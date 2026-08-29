import type { ConnectivityStatus } from "../../../lib/connectivity";
import { OpcoApiError, OpcoNetworkError } from "../../../lib/opco-api";
import type {
  StateUpdateLastSyncTelemetry,
  StateUpdateVisibleErrorResolution,
  StateUpdateVisibleErrorTelemetry,
} from "../../../lib/state-update-offline";

export type StateUpdateOperationFeedbackPhase =
  | "CONFIRMING"
  | "CONFLICT"
  | "FAILED"
  | "IDLE"
  | "OFFLINE_SAVED"
  | "PENDING"
  | "RECONNECTING"
  | "RESTORING_SESSION"
  | "SUCCESS"
  | "SYNCING"
  | "UNRESOLVED_ERROR";

export type StateUpdateOperationFeedback = {
  message: string | null;
  phase: StateUpdateOperationFeedbackPhase;
};

export type StateUpdateVisibleErrorOperation =
  | "load-day"
  | "load-workflow"
  | "refresh"
  | "save"
  | "search"
  | "source-load"
  | "sync";

export type StateUpdateVisibleErrorDiagnostics = StateUpdateVisibleErrorTelemetry;

const TIMEOUT_ERROR_TEXT = "agoto el tiempo de espera";

export function resolveStateUpdateOperationFeedback({
  connectivityStatus,
  hasConflict = false,
  isAuthSessionRestoring = false,
  isSaving = false,
  isReadinessChecking = false,
  isSyncing = false,
  lastActivity,
  lastSync,
  pendingCount,
  successMessage,
  visibleError,
}: {
  connectivityStatus: ConnectivityStatus;
  hasConflict?: boolean;
  isAuthSessionRestoring?: boolean;
  isSaving?: boolean;
  isReadinessChecking?: boolean;
  isSyncing?: boolean;
  lastActivity?: {
    result: string;
    type: string;
  } | null;
  lastSync?: StateUpdateLastSyncTelemetry | null;
  pendingCount: number;
  successMessage?: string | null;
  visibleError?: string | null;
}): StateUpdateOperationFeedback {
  if (hasConflict) {
    return { message: "Conflicto pendiente de resolver.", phase: "CONFLICT" };
  }

  if (visibleError && !isReadinessOnlyPending({ connectivityStatus, lastActivity, pendingCount })) {
    return { message: visibleError, phase: "FAILED" };
  }

  if (isSyncing && pendingCount > 0) {
    return { message: "Sincronizando con Opco...", phase: "SYNCING" };
  }

  if (isSaving && connectivityStatus === "online") {
    return { message: "Confirmando con Opco...", phase: "CONFIRMING" };
  }

  if (isSaving && connectivityStatus !== "online") {
    return { message: "Guardando en este dispositivo...", phase: "OFFLINE_SAVED" };
  }

  if (lastSync?.timeoutOccurred && pendingCount > 0) {
    return lastSync.operationsFailed > 0
      ? { message: "No fue posible confirmar el cambio con Opco.", phase: "UNRESOLVED_ERROR" }
      : { message: "Confirmando con Opco...", phase: "CONFIRMING" };
  }

  if (connectivityStatus === "online" && pendingCount > 0 && lastActivity?.type === "auth_refresh") {
    return isAuthSessionRestoring
      ? { message: "Restableciendo sesion con Opco...", phase: "RESTORING_SESSION" }
      : { message: "Pendiente de sincronizacion.", phase: "PENDING" };
  }

  if (connectivityStatus === "online" && pendingCount > 0 && lastActivity?.type === "ready_check") {
    if (lastActivity.result === "reconnecting") {
      return isReadinessChecking
        ? { message: "Reconectando con Opco...", phase: "RECONNECTING" }
        : { message: "Pendiente de sincronizacion.", phase: "PENDING" };
    }

    if (lastActivity.result === "ready_failed" ||
      lastActivity.result === "cancelled_scope_changed" ||
      lastActivity.result === "interrupted" ||
      lastActivity.result === "ready_confirmed" ||
      lastActivity.result === "sync_started") {
      return { message: "Pendiente de sincronizacion.", phase: "PENDING" };
    }
  }

  if (connectivityStatus !== "online" && pendingCount > 0) {
    return { message: "Guardado en este dispositivo.", phase: "OFFLINE_SAVED" };
  }

  if (connectivityStatus === "online" && pendingCount > 0) {
    return { message: "Pendiente de sincronizacion.", phase: "PENDING" };
  }

  if (successMessage) {
    return { message: successMessage, phase: "SUCCESS" };
  }

  return { message: null, phase: "IDLE" };
}

export function hideStateUpdateTimeoutAfterConfirmedSync({
  error,
  lastSync,
  pendingCount,
}: {
  error: string | null;
  lastSync?: StateUpdateLastSyncTelemetry | null;
  pendingCount: number;
}) {
  return Boolean(
    error &&
      normalizeTimeoutError(error) &&
      pendingCount === 0 &&
      lastSync?.timeoutOccurred &&
      lastSync.result === "reconciled_success",
  );
}

function normalizeTimeoutError(error: string) {
  return error.normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(TIMEOUT_ERROR_TEXT);
}

export function createStateUpdateVisibleErrorDiagnostics({
  error,
  operation,
  resolution = "unresolved",
  syncRunId = null,
}: {
  error: unknown;
  operation: StateUpdateVisibleErrorOperation;
  resolution?: StateUpdateVisibleErrorResolution;
  syncRunId?: string | null;
}): StateUpdateVisibleErrorDiagnostics {
  const diagnostics = error instanceof OpcoNetworkError ? error.diagnostics : undefined;

  return {
    clearedAt: null,
    durationMs: diagnostics?.requestDurationMs ?? null,
    errorCode: error instanceof OpcoApiError ? error.code : error instanceof Error ? error.name : "UNKNOWN_ERROR",
    httpStatus: error instanceof OpcoApiError ? error.status : diagnostics?.httpStatus ?? null,
    method: diagnostics?.method ?? null,
    occurredAt: diagnostics?.requestStartedAt ?? new Date().toISOString(),
    operation,
    pathTemplate: diagnostics?.pathTemplate ?? null,
    resolution,
    syncRunId,
    timeoutOccurred: diagnostics?.abortControllerTriggered === true,
  };
}

function isReadinessOnlyPending({
  connectivityStatus,
  lastActivity,
  pendingCount,
}: {
  connectivityStatus: ConnectivityStatus;
  lastActivity?: {
    result: string;
    type: string;
  } | null;
  pendingCount: number;
}) {
  return connectivityStatus === "online" &&
    pendingCount > 0 &&
    lastActivity?.type === "ready_check" &&
    (
      lastActivity.result === "ready_failed" ||
      lastActivity.result === "reconnecting" ||
      lastActivity.result === "interrupted" ||
      lastActivity.result === "cancelled_scope_changed"
    );
}

export function stateUpdateRefreshErrorMessage(error: unknown) {
  if (error instanceof OpcoNetworkError && error.diagnostics?.abortControllerTriggered) {
    return "No se pudo actualizar la vista. Intenta actualizar nuevamente.";
  }

  return error instanceof Error ? error.message : "No se pudo actualizar la vista. Intenta actualizar nuevamente.";
}

export function shouldShowStateUpdateVisibleErrorDiagnostics() {
  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).get("stateUpdateDiagnostics") === "1";
}
