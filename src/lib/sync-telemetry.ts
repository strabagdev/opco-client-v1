import { isLocalDatabaseUnavailableError } from "./local-db-recovery";
import { OpcoApiError, OpcoNetworkError } from "./opco-api";

export type SyncPhase = "idle" | "pushing" | "refreshing" | "reconciling" | "error";

export type SyncErrorCode = "NETWORK" | "AUTH" | "SERVER" | "CONFLICT" | "SQLITE" | "UNKNOWN";

export type SyncErrorPhase = Exclude<SyncPhase, "idle" | "error">;

export type SyncTelemetry = {
  contractId: string;
  entityTypeId: string;
  lastFullRefreshCompletedAt: string | null;
  lastPushCompletedAt: string | null;
  lastReconcileCompletedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastSyncAttemptAt: string | null;
  lastSyncErrorAt: string | null;
  lastSyncErrorCode: SyncErrorCode | null;
  lastSyncErrorPhase: SyncErrorPhase | null;
  ownerKey: string;
  syncPhase: SyncPhase;
};

export type SyncTelemetryScope = {
  contractId: string;
  entityTypeId: string;
  ownerKey: string;
};

export type SyncTelemetryStore = {
  getSyncTelemetry(scope: SyncTelemetryScope): Promise<SyncTelemetry | null>;
  markSyncError(scope: SyncTelemetryScope & { code: SyncErrorCode; occurredAt?: string; phase: SyncErrorPhase }): Promise<void>;
  markSyncPhase(scope: SyncTelemetryScope & { attemptedAt?: string; phase: SyncPhase }): Promise<void>;
  markSyncPhaseCompleted(scope: SyncTelemetryScope & { completedAt?: string; phase: SyncErrorPhase }): Promise<void>;
};

export function emptySyncTelemetry({ contractId, entityTypeId, ownerKey }: SyncTelemetryScope): SyncTelemetry {
  return {
    contractId,
    entityTypeId,
    lastFullRefreshCompletedAt: null,
    lastPushCompletedAt: null,
    lastReconcileCompletedAt: null,
    lastSuccessfulSyncAt: null,
    lastSyncAttemptAt: null,
    lastSyncErrorAt: null,
    lastSyncErrorCode: null,
    lastSyncErrorPhase: null,
    ownerKey,
    syncPhase: "idle",
  };
}

export function classifySyncTelemetryError(error: unknown): SyncErrorCode {
  if (isLocalDatabaseUnavailableError(error)) {
    return "SQLITE";
  }

  if (error instanceof OpcoNetworkError) {
    return "NETWORK";
  }

  if (error instanceof OpcoApiError) {
    if (error.status === 401 || error.status === 403 || error.code === "TOKEN_EXPIRED") {
      return "AUTH";
    }

    if (error.status === 409 || error.code.includes("CONFLICT")) {
      return "CONFLICT";
    }

    if (error.status >= 500) {
      return "SERVER";
    }

    return "UNKNOWN";
  }

  if (error instanceof Error && error.message.toLocaleLowerCase("en-US").includes("sqlite")) {
    return "SQLITE";
  }

  return "UNKNOWN";
}

export function formatLastSuccessfulSyncAt(value: string | null, now = new Date()) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const sameLocalDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = new Intl.DateTimeFormat("es-CL", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  if (sameLocalDay) {
    return `Hoy ${time}`;
  }

  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(date);
}
