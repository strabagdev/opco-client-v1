import { SyncTelemetry } from "@/lib/sync-telemetry";
import {
  RecordCacheStatusCounts,
  RecordOutboxConsistency,
  RecordsRefreshDiagnostics,
} from "@/lib/offline-records";

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
}): [string, string | number | boolean | null][] {
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
  outboxConsistency?: RecordOutboxConsistency | null;
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
  const consistency = diagnostics.outboxConsistency;
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
    ["localCountBeforeRefresh", String(refresh?.beforeRefresh?.total ?? "none")],
    ["localCountAfterUpsert", String(refresh?.afterUpsert?.total ?? "none")],
    ["localSyncedAfterUpsert", String(refresh?.afterUpsert?.synced ?? "none")],
    ["localCountAfterReconcile", String(refresh?.afterReconcile?.total ?? "none")],
    ["localSyncedAfterReconcile", String(refresh?.afterReconcile?.synced ?? "none")],
    ["localCountBeforeRender", String(refresh?.beforeRender?.total ?? local?.total ?? "none")],
    ["local total", String(local?.total ?? "none")],
    ["local synced", String(local?.synced ?? "none")],
    ["local pending_create", String(local?.pendingCreate ?? "none")],
    ["local pending_update", String(local?.pendingUpdate ?? "none")],
    ["local failed", String(local?.failed ?? "none")],
    ["local conflict", String(local?.conflict ?? "none")],
    ["outboxConsistency", consistency ? (consistency.ok ? "OK" : "ISSUE") : "none"],
    ["orphanedLocalIntent", String(consistency?.issueCounts.ORPHANED_LOCAL_INTENT ?? "none")],
    ["orphanedOutbox", String(consistency?.issueCounts.ORPHANED_OUTBOX ?? "none")],
    ["inconsistentCompletion", String(consistency?.issueCounts.INCONSISTENT_COMPLETION ?? "none")],
    ["renderer records", String(diagnostics.rendererRecords)],
    ["rendererCount", String(diagnostics.rendererRecords)],
    ["writeScope", refresh?.writeScope?.scope ?? "none"],
    ["reconcileScope", refresh?.reconcileScope?.scope ?? "none"],
    ["readScope", refresh?.readScope?.scope ?? "none"],
    ["writeOwner", refresh?.writeScope?.owner ?? "none"],
    ["writeContract", refresh?.writeScope?.contract ?? "none"],
    ["writeEntity", refresh?.writeScope?.entity ?? "none"],
    ["reconcileOwner", refresh?.reconcileScope?.owner ?? "none"],
    ["reconcileContract", refresh?.reconcileScope?.contract ?? "none"],
    ["reconcileEntity", refresh?.reconcileScope?.entity ?? "none"],
    ["readOwner", refresh?.readScope?.owner ?? "none"],
    ["readContract", refresh?.readScope?.contract ?? "none"],
    ["readEntity", refresh?.readScope?.entity ?? "none"],
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
