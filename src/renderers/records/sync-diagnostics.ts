import { SyncTelemetry } from "@/lib/sync-telemetry";
import {
  RecordCacheStatusCounts,
  RecordsFailedOperationDiagnostics,
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

export type RecordsFailedOperationDiagnosticsSection = {
  copyRows: [string, string | number | boolean | null][];
  manualRetryToken: string | null;
  manualRetryable: boolean;
  rows: [string, string | number | boolean | null][];
  title: string;
};

export function getRecordsFailedOperationDiagnosticsSections(
  operations: RecordsFailedOperationDiagnostics[],
): RecordsFailedOperationDiagnosticsSection[] {
  return operations.map((operation, index) => {
    const code = operation.lastErrorCode ?? operation.syncErrorCode ?? "none";
    const message = operation.lastErrorMessage ?? operation.syncErrorMessage ?? "none";
    const firstField = operation.lastErrorDetails?.fields[0] ?? null;
    const firstIssue = firstField?.relationIssues?.[0] ?? null;
    const relationDiagnosticsJson = operation.lastErrorDetails
      ? JSON.stringify(operation.lastErrorDetails)
      : "Este rechazo no contiene detalle técnico; reintenta para actualizarlo";
    const diagnosticRows: [string, string | number | boolean | null][] = [
      ["Operacion", operation.operation],
      ["Entidad", operation.entityTypeId],
      ["Registro local", operation.localRecordId],
      ["Registro servidor", operation.serverRecordId ?? "none"],
      ["Intentos", String(operation.retryCount)],
      ["HTTP status", operation.lastHttpStatus ?? "not stored"],
      ["Codigo", code],
      ["Mensaje", message],
      ["Estado local", operation.syncStatus],
      ["Actualizado", operation.updatedAt],
      ["Detalle estructurado", operation.hasStructuredDetails ? "available" : "none"],
      ["fieldId", firstField?.fieldId ?? "none"],
      ["fieldName", firstField?.fieldLabel ?? firstIssue?.fieldName ?? "none"],
      ["fieldType", firstField?.fieldType ?? "none"],
      ["expectedRelationEntityId", firstField?.relatedEntityTypeId ?? firstIssue?.relatedEntityTypeId ?? "none"],
      ["expectedRelationEntityName", firstField?.relatedEntityTypeName ?? firstIssue?.relatedEntityTypeName ?? "none"],
      ["submittedRecordIds", formatDiagnosticValue(firstField?.submittedRecordIds ?? firstField?.rejectedValue)],
      ["relationTargetRecordId", firstIssue?.targetRecordId ?? "none"],
      ["relationActualEntityId", firstIssue?.actualEntityTypeId ?? "not exposed"],
      ["relationActualEntityName", firstIssue?.actualEntityTypeName ?? "not exposed"],
      ["cause", formatRelationCause(firstIssue?.cause)],
      ["relationDiagnostics", relationDiagnosticsJson],
      ["manualRetryable", operation.manualRetryable],
    ];

    return {
      title: `#${index + 1}`,
      copyRows: diagnosticRows,
      manualRetryToken: operation.manualRetryToken,
      manualRetryable: operation.manualRetryable,
      rows: diagnosticRows.map(([label, value]) => {
        if (label === "Entidad" || label === "Registro local" || label === "Registro servidor") {
          return [label, typeof value === "string" ? abbreviateScopeValue(value) : value];
        }

        return [label, value];
      }),
    };
  });
}

export function formatRecordsFailedOperationDiagnosticsCopyText(
  sections: RecordsFailedOperationDiagnosticsSection[],
) {
  return sections
    .map((section) => {
      const body = section.copyRows
        .map(([label, value]) => `${label}: ${formatDiagnosticCopyValue(value)}`)
        .join("\n");

      return `[RECORDS ${section.title}]\n${body}`;
    })
    .join("\n\n");
}

export function getRecordsFailedOperationsNotice(summary: RecordsSyncDiagnosticsSummary) {
  if (summary.failedCount <= 0) {
    return null;
  }

  if (summary.pendingCount === 0) {
    return "Los errores quedan retenidos para revision o reintento manual.";
  }

  return "Hay errores retenidos junto con cambios pendientes.";
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
  const remoteRecordsDisappearedAfterReconcile = Boolean(
    refresh &&
    (refresh.remoteTotal ?? 0) > 0 &&
    refresh.recordsFetched > 0 &&
    refresh.afterReconcile?.synced === 0,
  );

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
    ["remoteRecordsDisappearedAfterReconcile", remoteRecordsDisappearedAfterReconcile ? "yes" : "no"],
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

function formatRelationCause(cause: string | null | undefined) {
  if (!cause || cause === "UNDETERMINED") {
    return "Causa no determinada";
  }

  return cause;
}

function formatDiagnosticValue(value: unknown) {
  if (value === undefined) {
    return "none";
  }

  if (typeof value === "string") {
    return value || "empty";
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function formatDiagnosticCopyValue(value: string | number | boolean | null) {
  if (typeof value !== "string") {
    return String(value);
  }

  const trimmed = value.trim();

  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return value;
  }

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return value;
  }
}
