import { SyncTelemetry } from "@/lib/sync-telemetry";
import { RecordCacheStatusCounts, RecordsRefreshDiagnostics } from "@/lib/offline-records";

export type RecordsSyncDiagnosticsSummary = {
  conflictCount: number;
  failedCount: number;
  pendingCount: number;
  syncingCount: number;
};

export function getSyncDiagnosticsRows({
  summary,
  telemetry,
}: {
  summary: RecordsSyncDiagnosticsSummary;
  telemetry: SyncTelemetry | null;
}) {
  return [
    ["Estado actual", telemetry?.syncPhase ?? "idle"],
    ["Entity scope", telemetry ? abbreviateScopeValue(telemetry.entityTypeId) : "none"],
    ["Ultimo intento", telemetry?.lastSyncAttemptAt ?? "none"],
    ["Ultimo push", telemetry?.lastPushCompletedAt ?? "none"],
    ["Ultimo snapshot remoto", telemetry?.lastFullRefreshCompletedAt ?? "none"],
    ["Ultima reconciliacion", telemetry?.lastReconcileCompletedAt ?? "none"],
    ["Ultima sincronizacion exitosa", telemetry?.lastSuccessfulSyncAt ?? "none"],
    ["Ultimo error fecha", telemetry?.lastSyncErrorAt ?? "none"],
    ["Ultimo error", telemetry?.lastSyncErrorCode ?? "none"],
    ["Fase del error", telemetry?.lastSyncErrorPhase ?? "none"],
    ["Pendientes", String(summary.pendingCount)],
    ["Errores", String(summary.failedCount)],
    ["Conflictos", String(summary.conflictCount)],
  ];
}

export type RecordsDiagnosticsState = {
  appViewId: string;
  connectivityStatus: string;
  contractId: string;
  entityTypeId: string;
  error: string | null;
  isLoading: boolean;
  local: RecordCacheStatusCounts | null;
  ownerKey: string;
  page: number;
  refresh: RecordsRefreshDiagnostics | null;
  rendererRecords: number;
  search: string;
  sessionStatus: string;
};

export function getRecordsDiagnosticsRows(diagnostics: RecordsDiagnosticsState | null, telemetry: SyncTelemetry | null) {
  if (!diagnostics) {
    return [["Estado", "sin carga"]];
  }

  const refresh = diagnostics.refresh;
  const local = diagnostics.local;
  const pages = refresh?.pages.map((page) => `${page.page}:${page.count}`).join(", ") ?? "none";

  return [
    ["connectivityStatus", diagnostics.connectivityStatus],
    ["session status", diagnostics.sessionStatus],
    ["ownerKey", abbreviateScopeValue(diagnostics.ownerKey)],
    ["contractId", abbreviateScopeValue(diagnostics.contractId)],
    ["appViewId", abbreviateScopeValue(diagnostics.appViewId)],
    ["entityTypeId", abbreviateScopeValue(diagnostics.entityTypeId)],
    ["lastHttpStatus", String(refresh?.lastHttpStatus ?? "none")],
    ["remoteTotal", String(refresh?.remoteTotal ?? "none")],
    ["totalPages", String(refresh?.totalPages ?? "none")],
    ["pagesFetched", pages],
    ["recordsFetched", String(refresh?.recordsFetched ?? 0)],
    ["local total", String(local?.total ?? "none")],
    ["local synced", String(local?.synced ?? "none")],
    ["local pending_create", String(local?.pendingCreate ?? "none")],
    ["local pending_update", String(local?.pendingUpdate ?? "none")],
    ["local failed", String(local?.failed ?? "none")],
    ["local conflict", String(local?.conflict ?? "none")],
    ["renderer records", String(diagnostics.rendererRecords)],
    ["search", diagnostics.search ? "set" : "empty"],
    ["page", String(diagnostics.page)],
    ["loading", String(diagnostics.isLoading)],
    ["error", diagnostics.error ? "set" : "none"],
    ["phase", telemetry?.syncPhase ?? "idle"],
    ["lastSyncAttemptAt", telemetry?.lastSyncAttemptAt ?? "none"],
    ["lastFullRefreshCompletedAt", telemetry?.lastFullRefreshCompletedAt ?? "none"],
    ["lastReconcileCompletedAt", telemetry?.lastReconcileCompletedAt ?? "none"],
    ["lastSuccessfulSyncAt", telemetry?.lastSuccessfulSyncAt ?? "none"],
    ["lastSyncErrorCode", telemetry?.lastSyncErrorCode ?? "none"],
    ["lastSyncErrorPhase", telemetry?.lastSyncErrorPhase ?? "none"],
  ];
}

function abbreviateScopeValue(value: string) {
  if (value.length <= 8) {
    return value;
  }

  return `...${value.slice(-6)}`;
}
