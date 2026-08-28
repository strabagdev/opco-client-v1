import type { ConnectivityStatus } from "@/lib/connectivity";
import type { StateUpdateLastSyncTelemetry } from "@/lib/state-update-offline";

export type StateUpdateOperationFeedbackPhase =
  | "CONFIRMING"
  | "CONFLICT"
  | "FAILED"
  | "IDLE"
  | "OFFLINE_SAVED"
  | "SUCCESS"
  | "SYNCING"
  | "UNRESOLVED_ERROR";

export type StateUpdateOperationFeedback = {
  message: string | null;
  phase: StateUpdateOperationFeedbackPhase;
};

const TIMEOUT_ERROR_TEXT = "agoto el tiempo de espera";

export function resolveStateUpdateOperationFeedback({
  connectivityStatus,
  hasConflict = false,
  isSaving = false,
  lastSync,
  pendingCount,
  successMessage,
  visibleError,
}: {
  connectivityStatus: ConnectivityStatus;
  hasConflict?: boolean;
  isSaving?: boolean;
  lastSync?: StateUpdateLastSyncTelemetry | null;
  pendingCount: number;
  successMessage?: string | null;
  visibleError?: string | null;
}): StateUpdateOperationFeedback {
  if (hasConflict) {
    return { message: "Conflicto pendiente de resolver.", phase: "CONFLICT" };
  }

  if (visibleError) {
    return { message: visibleError, phase: "FAILED" };
  }

  if (isSaving && connectivityStatus === "online") {
    return { message: "Sincronizando con Opco...", phase: "SYNCING" };
  }

  if (isSaving && connectivityStatus !== "online") {
    return { message: "Guardando en este dispositivo...", phase: "OFFLINE_SAVED" };
  }

  if (lastSync?.timeoutOccurred && pendingCount > 0) {
    return lastSync.operationsFailed > 0
      ? { message: "No fue posible confirmar el cambio con Opco.", phase: "UNRESOLVED_ERROR" }
      : { message: "Confirmando con Opco...", phase: "CONFIRMING" };
  }

  if (connectivityStatus !== "online" && pendingCount > 0) {
    return { message: "Guardado en este dispositivo.", phase: "OFFLINE_SAVED" };
  }

  if (connectivityStatus === "online" && pendingCount > 0) {
    return { message: "Sincronizando con Opco...", phase: "SYNCING" };
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
