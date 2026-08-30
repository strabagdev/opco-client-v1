import type { ConnectivityStatus } from "./connectivity";
import type { OfflineReadiness } from "./pwa";

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
  isAuthSessionRestoring: boolean;
  isOfflinePreparationRunning: boolean;
  isOperationalCoreReadinessChecking: boolean;
  isPendingWorkSyncing: boolean;
  localStorageRecoveryNotice?: string | null;
  offlineReadiness: OfflineReadiness;
  pendingCount: number;
};

export function resolveAppShellPersistentFeedback({
  connectivityStatus,
  hasConflict,
  hasError,
  isAuthSessionRestoring,
  isOfflinePreparationRunning,
  isOperationalCoreReadinessChecking,
  isPendingWorkSyncing,
  localStorageRecoveryNotice,
  offlineReadiness,
  pendingCount,
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
      message: "Hay un error pendiente de revisar.",
      tone: "error",
      visual: "error",
    };
  }

  if (hasConflict) {
    return {
      id: "sync-conflict",
      message: "Hay un conflicto pendiente de resolver.",
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
      tone: "warning",
      visual: "warning",
    };
  }

  if (connectivityStatus !== "online") {
    return {
      id: "offline",
      message: "Sin conexion. Los registros se guardan en este dispositivo.",
      tone: "warning",
      visual: "warning",
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

export function formatPendingWorkMessage(count: number) {
  return `${count} ${count === 1 ? "registro" : "registros"} por sincronizar`;
}

export function shouldRenderAppShellFeedbackBand(feedback: AppShellFeedbackMessage | null) {
  return feedback !== null;
}

export function shouldShowAppShellFeedbackSpinner(feedback: AppShellFeedbackMessage | null) {
  return feedback?.visual === "loading";
}
