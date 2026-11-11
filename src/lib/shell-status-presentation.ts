import type { AppShellStatusIndicator, AppShellFeedbackInput } from "./app-shell-feedback";
import type { StateUpdateRequestHistoryEvent, StateUpdateSyncDiagnosticsTelemetry } from "./state-update-offline";
import type { OperationalTone } from "../theme/operational-presentation";

export type ShellStatusPart = {
  label: string;
  tone: OperationalTone;
  kind: "online" | "offline" | "checking" | "unknown" | "syncing" | "pending" | "synced" | "idle" | "error" | "conflict";
};

export type ShellOperationalStatus = {
  connection: ShellStatusPart;
  sync: ShellStatusPart;
  notice: string | null;
};

export function coreConnectionSince(reconnect: Pick<StateUpdateSyncDiagnosticsTelemetry, "currentConnectivity" | "lastReconnect">, observedSince?: string) {
  // currentConnectivity.updatedAt also advances on ACK/diagnostic merges; it is not an epoch.
  const detectedAt = reconnect.lastReconnect.detected && reconnect.currentConnectivity.status === "online" && reconnect.lastReconnect.resultingConnectivityStatus === "online"
    ? reconnect.lastReconnect.detectedAt : null;
  if (!detectedAt) return observedSince ?? null;
  if (!observedSince) return detectedAt;
  // A new document must not inherit Online from a persisted diagnostic of an old runtime.
  return Date.parse(detectedAt) >= Date.parse(observedSince) ? detectedAt : observedSince;
}

/** Pure projection of existing evidence. Never probes Core, starts work or stores an ACK. */
export function resolveShellOperationalStatus(input: AppShellFeedbackInput & {
  connectionSince: string | null;
  requestHistory: readonly StateUpdateRequestHistoryEvent[];
  pendingKnown: boolean;
}): ShellOperationalStatus {
  const connection = resolveCoreConnection(input);
  const pending = Math.max(0, input.pendingCount);
  const sync: ShellStatusPart = input.hasError
    ? { kind: "error", label: "Error de sincronización", tone: "danger" }
    : input.hasConflict
      ? { kind: "conflict", label: input.syncConflictCount === 1 ? "1 conflicto" : `${input.syncConflictCount ?? 1} conflictos`, tone: "conflict" }
      : input.isPendingWorkSyncing
        ? { kind: "syncing", label: "Sincronizando", tone: "info" }
        : pending > 0
          ? { kind: "pending", label: pending === 1 ? "1 pendiente" : `${pending} pendientes`, tone: "warning" }
          : !input.pendingKnown
            ? { kind: "unknown", label: "Pendientes sin comprobar", tone: "neutral" }
            : connection.kind === "online" && input.writeFeedback?.kind === "server-confirmed"
              ? { kind: "synced", label: "Sincronizado", tone: "success" }
              : { kind: "idle", label: "Sin pendientes", tone: "neutral" };

  // Reads/preparation are separate from sending pending changes. Keep their notices visible.
  const notice = input.localStorageRecoveryNotice ? "Revisar datos locales"
    : input.experienceActivity?.errorCode ? "No se pudo actualizar la experiencia"
      : input.offlinePreparationDiagnosticWriteFailed ? "Diagnóstico de preparación sin guardar"
        : input.offlinePreparationRecoveryFailed ? "No se pudo recuperar la preparación offline"
          : input.isOfflinePreparationRunning ? "Preparando uso offline"
            : input.offlinePreparationStatus === "failed" ? "Preparación offline incompleta"
              : input.offlinePreparationStatus === "running" ? "Preparación offline interrumpida"
                : input.writeFeedback?.kind === "local-saved" ? "Guardado en este dispositivo"
                  : (input.experienceActivity?.activeRuns.length ?? 0) > 0
                    ? input.experienceActivity?.readMode === "initial" ? "Cargando datos" : "Actualizando datos"
                    : input.isAuthSessionRestoring ? "Restaurando sesión" : null;
  return { connection, sync, notice };
}

function resolveCoreConnection(input: Parameters<typeof resolveShellOperationalStatus>[0]): ShellStatusPart {
  if (input.connectivityStatus === "offline") return { kind: "offline", label: "Offline", tone: "neutral" };
  const since = Date.parse(input.connectionSince ?? "");
  // Persisted evidence predating the current connectivity epoch is not a live connection.
  const latest = Number.isFinite(since) && input.connectivityStatus === "online"
    ? input.requestHistory.filter(event => Date.parse(event.requestStartedAt) >= since && Number.isFinite(Date.parse(event.requestCompletedAt ?? "")))
      .reduce<StateUpdateRequestHistoryEvent | null>((current, event) => !current || Date.parse(event.requestStartedAt) >= Date.parse(current.requestStartedAt) ? event : current, null)
    : null;
  const reachable = latest && !latest.abortControllerTriggered && latest.httpStatus !== null && latest.httpStatus > 0 && latest.httpStatus < 500;
  if (reachable) return { kind: "online", label: "Online", tone: "success" };
  if (input.isOperationalCoreReadinessChecking) return { kind: "checking", label: "Conectando", tone: "info" };
  if (latest) return { kind: "offline", label: "Offline", tone: "neutral" };
  return { kind: "unknown", label: "Conexión sin comprobar", tone: "neutral" };
}

/** Wording/paint only. The existing shell resolver remains the source of activity and priority. */
export function shellStatusPresentation(indicator: AppShellStatusIndicator, input: {
  conflicts: number;
  hasSyncError: boolean;
  hasReadError: boolean;
  storageRecovery: boolean;
}) {
  if (indicator.state === "online" && indicator.label === "Listo") {
    // Idle is not an ACK and does not certify that every record is synchronized or prepared.
    return { label: "Sin operaciones en curso", neutral: true };
  }
  if (indicator.state === "error") {
    if (input.storageRecovery) return { label: "Revisar datos locales", neutral: false };
    if (input.hasSyncError && input.conflicts > 0) return { label: "Errores y conflictos pendientes", neutral: false };
    if (input.hasSyncError) return { label: "Error al enviar cambios", neutral: false };
    if (input.conflicts > 0 && !input.hasReadError) return { label: input.conflicts === 1 ? "1 conflicto pendiente" : `${input.conflicts} conflictos pendientes`, neutral: false };
  }
  return { label: indicator.label, neutral: false };
}
