import type { ConnectivityStatus } from "./connectivity";
import type { OfflineReadiness } from "./pwa";

export type AppShellFeedbackTone = "error" | "warning" | "info" | "success";

export type AppShellFeedbackMessage = {
  id: string;
  message: string;
  tone: AppShellFeedbackTone;
};

export type AppShellFeedbackInput = {
  connectivityStatus: ConnectivityStatus;
  hasConflict: boolean;
  hasError: boolean;
  isAuthSessionRestoring: boolean;
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
    };
  }

  if (hasError) {
    return {
      id: "sync-error",
      message: "Hay un error pendiente de revisar.",
      tone: "error",
    };
  }

  if (hasConflict) {
    return {
      id: "sync-conflict",
      message: "Hay un conflicto pendiente de resolver.",
      tone: "error",
    };
  }

  if (isPendingWorkSyncing) {
    return {
      id: "syncing",
      message: "Sincronizando con Opco...",
      tone: "info",
    };
  }

  if (isAuthSessionRestoring) {
    return {
      id: "auth-restoring",
      message: "Restableciendo sesion con Opco...",
      tone: "info",
    };
  }

  if (isOperationalCoreReadinessChecking) {
    return {
      id: "reconnecting",
      message: "Reconectando con Opco...",
      tone: "info",
    };
  }

  if (pendingCount > 0) {
    return {
      id: "pending-work",
      message: formatPendingWorkMessage(pendingCount),
      tone: "warning",
    };
  }

  if (connectivityStatus !== "online") {
    return {
      id: "offline",
      message: "Sin conexion. Los registros se guardan en este dispositivo.",
      tone: "warning",
    };
  }

  if (offlineReadiness !== "ready" && offlineReadiness !== "unsupported") {
    return {
      id: "offline-preparing",
      message: "Preparando uso sin conexion...",
      tone: "info",
    };
  }

  return null;
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
  };
}

export function formatPendingWorkMessage(count: number) {
  return `${count} ${count === 1 ? "registro" : "registros"} por sincronizar`;
}
