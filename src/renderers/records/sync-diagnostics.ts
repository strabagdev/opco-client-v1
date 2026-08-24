import { SyncTelemetry } from "@/lib/sync-telemetry";

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

function abbreviateScopeValue(value: string) {
  if (value.length <= 8) {
    return value;
  }

  return `...${value.slice(-6)}`;
}
