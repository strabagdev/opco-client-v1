import type { ConnectivityStatus } from "./connectivity";
import type { OfflineReadiness } from "./pwa";
import { formatPendingSyncErrorNotice } from "./pending-sync-errors";

export type AppShellFeedbackTone = "error" | "warning" | "info" | "success";
export type AppShellFeedbackVisual = "error" | "warning" | "info" | "success" | "loading";

export type AppShellFeedbackMessage = {
  id: string;
  message: string;
  tone: AppShellFeedbackTone;
  visual: AppShellFeedbackVisual;
};

export type AppShellStatusIndicatorState = "online" | "working" | "offline" | "error";

export type AppShellStatusIndicator = {
  accessibilityLabel: string;
  state: AppShellStatusIndicatorState;
};

export type AppShellFeedbackInput = {
  connectivityStatus: ConnectivityStatus;
  hasConflict: boolean;
  hasError: boolean;
  hasReadConnectivityIssue?: boolean;
  isAuthSessionRestoring: boolean;
  isOfflinePreparationRunning: boolean;
  isOperationalCoreReadinessChecking: boolean;
  isPendingWorkSyncing: boolean;
  localStorageRecoveryNotice?: string | null;
  offlineReadiness: OfflineReadiness;
  pendingCount: number;
  syncConflictCount?: number;
  syncErrorCount?: number;
  pendingSyncErrorCount?: number;
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

  return null;
}

export function resolveAppShellStatusIndicator({
  connectivityStatus,
  hasConflict,
  hasError,
  isAuthSessionRestoring,
  isOfflinePreparationRunning,
  isOperationalCoreReadinessChecking,
  isPendingWorkSyncing,
  localStorageRecoveryNotice,
}: AppShellFeedbackInput): AppShellStatusIndicator {
  if (localStorageRecoveryNotice || hasError || hasConflict) {
    return {
      accessibilityLabel: "Problema de conexion o sincronizacion",
      state: "error",
    };
  }

  if (
    isAuthSessionRestoring ||
    isOfflinePreparationRunning ||
    isOperationalCoreReadinessChecking ||
    isPendingWorkSyncing
  ) {
    return {
      accessibilityLabel: "Sincronizando",
      state: "working",
    };
  }

  if (connectivityStatus !== "online") {
    return {
      accessibilityLabel: "Sin conexion",
      state: "offline",
    };
  }

  return {
    accessibilityLabel: "Online",
    state: "online",
  };
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
