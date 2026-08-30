import type { ConnectivityStatus } from "@/lib/connectivity";
import type { SyncTelemetry } from "@/lib/sync-telemetry";

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
    return "Sin conexion. Datos guardados localmente.";
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
