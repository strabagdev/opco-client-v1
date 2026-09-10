import type { ConnectivityStatus } from "@/lib/connectivity";
import type { SyncTelemetry } from "@/lib/sync-telemetry";

export const RECORDS_LIST_LOAD_ERROR_MESSAGE = "No pudimos cargar la lista de personas";

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

export function getRecordsCacheBannerMessage({
  connectivityStatus,
  fromCache,
  isLoading,
}: {
  connectivityStatus: ConnectivityStatus;
  fromCache: boolean;
  isLoading: boolean;
}) {
  if (!fromCache) {
    return null;
  }

  if (connectivityStatus !== "online") {
    return null;
  }

  return isLoading ? "Actualizando datos..." : "Datos guardados localmente.";
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

export function getRecordsListErrorMessage(error: unknown) {
  return error ? RECORDS_LIST_LOAD_ERROR_MESSAGE : null;
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
