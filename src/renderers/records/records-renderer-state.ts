import type { ConnectivityStatus } from "@/lib/connectivity";
import type { SyncTelemetry } from "@/lib/sync-telemetry";

export const RECORDS_LIST_LOAD_ERROR_MESSAGE = "No pudimos cargar los registros. Conservamos los datos disponibles para que puedas volver a intentar.";

export type RecordsRendererScope = {
  appViewId: string;
  entityTypeId: string;
};

export type RecordsSearchState = {
  debouncedSearch: string;
  searchText: string;
};

export function resolveRecordsSearchForScopeChange({
  currentSearch,
  nextScope,
  previousScope,
}: {
  currentSearch: RecordsSearchState;
  nextScope: RecordsRendererScope;
  previousScope: RecordsRendererScope;
}): RecordsSearchState {
  if (
    previousScope.appViewId === nextScope.appViewId &&
    previousScope.entityTypeId === nextScope.entityTypeId
  ) {
    return currentSearch;
  }

  return {
    debouncedSearch: "",
    searchText: "",
  };
}

export function shouldShowRecordsSyncProblem({
  connectivityStatus,
  telemetry,
}: {
  connectivityStatus: ConnectivityStatus;
  telemetry: SyncTelemetry | null;
}) {
  return connectivityStatus === "online" && telemetry?.syncPhase === "error";
}

export function getRecordsSyncProblemMessage({
  connectivityStatus,
  telemetry,
}: {
  connectivityStatus: ConnectivityStatus;
  telemetry: SyncTelemetry | null;
}) {
  if (!shouldShowRecordsSyncProblem({ connectivityStatus, telemetry })) {
    return null;
  }

  return telemetry?.lastSyncErrorPhase === "pushing"
    ? "Problema al enviar cambios"
    : "Problema al actualizar registros";
}

export function getRecordsListErrorMessage(error: unknown) {
  if (error instanceof Error && "code" in error && error.code === "RECORDS_LOCAL_READ_FAILED") return error.message;
  return error ? RECORDS_LIST_LOAD_ERROR_MESSAGE : null;
}

export function getRecordsReadErrorCode(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "RECORDS_LOCAL_READ_FAILED"
    ? "RECORDS_LOCAL_READ_FAILED" : "RECORDS_READ_FAILED";
}

export function getRecordsInlineSyncSummary({
  conflictCount,
  failedCount,
  pendingCount,
  syncingCount,
}: {
  conflictCount: number;
  failedCount: number;
  pendingCount: number;
  syncingCount: number;
}) {
  const activeParts = [
    pendingCount ? `${pendingCount} pendientes` : null,
    syncingCount ? `${syncingCount} sincronizando` : null,
  ].filter(Boolean);

  if (activeParts.length > 0) {
    return activeParts.join(" · ");
  }

  if (failedCount > 0 || conflictCount > 0) {
    return "Hay cambios que requieren revision.";
  }

  return "";
}
