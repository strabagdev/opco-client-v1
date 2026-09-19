import type { ConnectivityStatus } from "./connectivity";
import type { ExperienceActivitySnapshot } from "./experience-activity";
import type { OfflineReadiness } from "./pwa";
import { formatPendingSyncErrorNotice } from "./pending-sync-errors";
import type { WriteFeedbackSnapshot } from "./write-feedback";

export type AppShellFeedbackTone = "error" | "warning" | "info" | "success";
export type AppShellFeedbackVisual = "error" | "warning" | "info" | "success" | "loading";

export type AppShellFeedbackMessage = {
  id: string;
  message: string;
  tone: AppShellFeedbackTone;
  visual: AppShellFeedbackVisual;
};

export type AppShellStatusIndicatorState = "online" | "working" | "pending" | "offline" | "error";

export type AppShellStatusIndicator = {
  accessibilityLabel: string;
  label: string;
  state: AppShellStatusIndicatorState;
};

export type AppShellFeedbackInput = {
  connectivityStatus: ConnectivityStatus;
  experienceActivity?: ExperienceActivitySnapshot | null;
  hasConflict: boolean;
  hasError: boolean;
  hasReadConnectivityIssue?: boolean;
  isAuthSessionRestoring: boolean;
  isOfflinePreparationRunning: boolean;
  offlinePreparationStatus?: "idle" | "running" | "completed" | "failed" | null;
  isOperationalCoreReadinessChecking: boolean;
  isPendingWorkSyncing: boolean;
  localStorageRecoveryNotice?: string | null;
  offlineReadiness: OfflineReadiness;
  pendingCount: number;
  syncConfirmationVisible?: boolean;
  syncConflictCount?: number;
  syncErrorCount?: number;
  pendingSyncErrorCount?: number;
  writeFeedback?: WriteFeedbackSnapshot | null;
};

export type AppShellVisibleErrorKind = "read" | "write" | "sync" | "unknown";

export type AppShellVisibleErrorEvent = {
  method?: string | null;
  operation?: string | null;
  pathTemplate?: string | null;
  resolution?: string | null;
};

export function resolveAppShellPersistentFeedback({
  connectivityStatus,
  hasConflict,
  hasError,
  hasReadConnectivityIssue = false,
  isAuthSessionRestoring,
  isOfflinePreparationRunning,
  isOperationalCoreReadinessChecking,
  isPendingWorkSyncing,
  localStorageRecoveryNotice,
  offlineReadiness,
  offlinePreparationStatus = null,
  pendingCount,
  syncConflictCount = 1,
  syncErrorCount,
  pendingSyncErrorCount = 1,
}: AppShellFeedbackInput): AppShellFeedbackMessage | null {
  if (localStorageRecoveryNotice) {
    return {
      id: "local-storage-recovery",
      message: localStorageRecoveryNotice,
      tone: "error",
      visual: "error",
    };
  }

  if (hasError) {
    return {
      id: "sync-error",
      message: formatPendingSyncErrorNotice(syncErrorCount ?? pendingSyncErrorCount),
      tone: "error",
      visual: "error",
    };
  }

  if (hasConflict) {
    return {
      id: "sync-conflict",
      message: formatSyncConflictNotice(syncConflictCount),
      tone: "error",
      visual: "error",
    };
  }

  if (isPendingWorkSyncing) {
    return {
      id: "syncing",
      message: "Sincronizando con Opco...",
      tone: "info",
      visual: "loading",
    };
  }

  if (isAuthSessionRestoring) {
    return {
      id: "auth-restoring",
      message: "Restableciendo sesion con Opco...",
      tone: "info",
      visual: "loading",
    };
  }

  if (isOperationalCoreReadinessChecking) {
    return {
      id: "reconnecting",
      message: "Reconectando con Opco...",
      tone: "info",
      visual: "loading",
    };
  }

  if (pendingCount > 0) {
    return {
      id: "pending-work",
      message: formatPendingWorkMessage(pendingCount),
      tone: "info",
      visual: "info",
    };
  }

  if (hasReadConnectivityIssue) {
    return {
      id: "read-connectivity-issue",
      message: "Conexion inestable. Mostrando datos guardados.",
      tone: "info",
      visual: "info",
    };
  }

  if (connectivityStatus !== "online") {
    return {
      id: "offline",
      message: "Trabajando sin conexion",
      tone: "info",
      visual: "info",
    };
  }

  if (isOfflinePreparationRunning && offlineReadiness !== "ready" && offlineReadiness !== "unsupported") {
    return {
      id: "offline-preparing",
      message: "Preparando uso sin conexion...",
      tone: "info",
      visual: "loading",
    };
  }

  if (offlinePreparationStatus === "failed") {
    return {
      id: "offline-preparation-failed",
      message: "Preparacion sin conexion incompleta.",
      tone: "warning",
      visual: "warning",
    };
  }

  if (offlinePreparationStatus === "running" && !isOfflinePreparationRunning) {
    return {
      id: "offline-preparation-interrupted",
      message: "Preparacion anterior interrumpida.",
      tone: "info",
      visual: "info",
    };
  }

  return null;
}

export function resolveAppShellStatusIndicator({
  connectivityStatus,
  experienceActivity,
  hasConflict,
  hasError,
  isAuthSessionRestoring,
  isOperationalCoreReadinessChecking,
  isPendingWorkSyncing,
  localStorageRecoveryNotice,
  pendingCount,
  syncConfirmationVisible = false,
  writeFeedback,
}: AppShellFeedbackInput): AppShellStatusIndicator {
  if (localStorageRecoveryNotice || hasError || hasConflict || experienceActivity?.errorCode) {
    return {
      accessibilityLabel: experienceActivity?.errorCode
        ? `La actualización de ${experienceActivity.appViewTitle ?? "la experiencia"} requiere atención`
        : "Problema de conexion o sincronizacion",
      label: "Requiere atención",
      state: "error",
    };
  }

  if (writeFeedback?.kind) {
    const label = writeFeedback.kind === "server-confirmed" ? "Guardado en Opco" : "Guardado localmente";
    const context = isPendingWorkSyncing
      ? " · Sincronizando cambios…"
      : connectivityStatus !== "online"
        ? " · Sin conexión"
        : "";
    const pending = pendingCount > 0 ? ` · ${formatPendingCount(pendingCount)}` : "";
    return {
      accessibilityLabel: `${label}${context}${pending}`,
      label: `${label}${context}${pending}`,
      state: isPendingWorkSyncing ? "working" : pendingCount > 0 ? "pending" : "online",
    };
  }

  if (connectivityStatus !== "online") {
    return {
      accessibilityLabel: pendingCount > 0
        ? `Sin conexion. ${formatPendingCount(pendingCount)}`
        : "Sin conexion",
      label: pendingCount > 0 ? `Sin conexión · ${formatPendingCount(pendingCount)}` : "Sin conexión",
      state: "offline",
    };
  }

  if (isPendingWorkSyncing) {
    return {
      accessibilityLabel: "Sincronizando cambios pendientes",
      label: "Sincronizando cambios…",
      state: "working",
    };
  }

  if (syncConfirmationVisible) {
    return {
      accessibilityLabel: "Sincronización confirmada por Opco",
      label: "Sincronización confirmada",
      state: "online",
    };
  }

  if (isOperationalCoreReadinessChecking) {
    return {
      accessibilityLabel: "Comprobando disponibilidad de Opco",
      label: "Comprobando disponibilidad",
      state: "working",
    };
  }

  if (isAuthSessionRestoring) {
    return {
      accessibilityLabel: "Restableciendo sesion con Opco",
      label: "Restaurando sesión",
      state: "working",
    };
  }

  if ((experienceActivity?.activeRuns.length ?? 0) > 0) {
    const title = experienceActivity?.appViewTitle;
    const activity = title ? `Actualizando ${title}…` : "Actualizando experiencia…";
    return {
      accessibilityLabel: pendingCount > 0 ? `${activity} ${formatPendingCount(pendingCount)}` : activity,
      label: pendingCount > 0 ? `${activity} · ${formatPendingCount(pendingCount)}` : activity,
      state: "working",
    };
  }

  if (pendingCount > 0) {
    return {
      accessibilityLabel: pendingCount === 1 ? "1 cambio pendiente" : `${pendingCount} cambios pendientes`,
      label: formatPendingCount(pendingCount),
      state: "pending",
    };
  }

  return {
    accessibilityLabel: "Listo",
    label: "Listo",
    state: "online",
  };
}

function formatPendingCount(count: number) {
  return count === 1 ? "1 cambio pendiente" : `${count} cambios pendientes`;
}

export function resolveAppShellSuccessToast({
  operationsCompleted,
  result,
}: {
  operationsCompleted: number;
  result?: string | null;
}): AppShellFeedbackMessage | null {
  if (operationsCompleted <= 0 || (result !== "success" && result !== "reconciled_success")) {
    return null;
  }

  return {
    id: "sync-success",
    message: "Sincronizacion completada.",
    tone: "success",
    visual: "success",
  };
}

export function formatPendingWorkMessage(_count: number) {
  return "Cambios guardados. Se sincronizaran al recuperar conexion.";
}

export function formatSyncConflictNotice(count: number) {
  if (count > 1) {
    return `${count} cambios requieren revision.`;
  }

  return "1 cambio requiere revision.";
}

export function classifyAppShellVisibleErrorEvent(
  event: AppShellVisibleErrorEvent | null | undefined,
): AppShellVisibleErrorKind | null {
  if (!event || event.resolution !== "unresolved") {
    return null;
  }

  const operation = event.operation?.toLocaleLowerCase("en-US") ?? "";
  const method = event.method?.toLocaleUpperCase("en-US") ?? "";

  if (method === "GET") {
    return "read";
  }

  if (operation === "sync" || operation.includes("retry")) {
    return "sync";
  }

  if (operation === "save" || operation === "create" || operation === "update") {
    return "write";
  }

  if (
    operation === "load-day" ||
    operation === "load-workflow" ||
    operation === "refresh" ||
    operation === "search" ||
    operation === "source-load" ||
    operation === "hydration" ||
    operation === "prewarm"
  ) {
    return "read";
  }

  return "unknown";
}

export function shouldRenderAppShellFeedbackBand(feedback: AppShellFeedbackMessage | null) {
  return feedback !== null;
}

export function shouldShowAppShellFeedbackSpinner(feedback: AppShellFeedbackMessage | null) {
  return feedback?.visual === "loading";
}
