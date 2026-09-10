import type {
  StateUpdateOutboxDiagnostics,
  StateUpdateOutboxDiagnosticsOperation,
  StateUpdateSyncErrorFieldDetails,
} from "./state-update-offline";

export type PendingStateUpdateSyncError = StateUpdateOutboxDiagnosticsOperation;

export function getPendingStateUpdateSyncErrors(
  diagnostics: StateUpdateOutboxDiagnostics | null,
): PendingStateUpdateSyncError[] {
  return (diagnostics?.operations ?? []).filter((operation) =>
    operation.syncStatus === "failed" &&
    Boolean(operation.lastErrorCode || operation.lastBackendErrorCode)
  );
}

export function formatPendingSyncErrorNotice(count: number) {
  if (count > 1) {
    return `${count} cambios no pudieron sincronizarse.`;
  }

  return "Un cambio no pudo sincronizarse.";
}

export function formatPendingSyncErrorMessage(error: PendingStateUpdateSyncError | null) {
  if (!error) {
    return "Revisa el diagnostico de sincronizacion para ver el detalle tecnico.";
  }

  const field = error.lastErrorDetails?.fields[0];

  if (field?.fieldType === "RELATION") {
    return `El campo ${field.fieldLabel ?? field.fieldId} referencia registros que Opco no puede guardar.`;
  }

  if (field?.fieldLabel) {
    return `El campo ${field.fieldLabel} tiene un valor que Opco no puede guardar.`;
  }

  if (error.lastBackendErrorCode === "INVALID_FIELD_VALUE" || error.lastErrorCode === "INVALID_FIELD_VALUE") {
    return "Uno de los campos tiene un valor que Opco no puede guardar.";
  }

  return error.lastErrorMessage ?? "No fue posible sincronizar este cambio.";
}

export function getPendingSyncErrorTechnicalRows(
  error: PendingStateUpdateSyncError | null,
): [string, string | number | boolean | null][] {
  return getStateUpdateErrorDiagnosticRows(error);
}

export function getStateUpdateErrorDiagnosticRows(
  error: PendingStateUpdateSyncError | null,
): [string, string | number | boolean | null][] {
  if (!error) {
    return [["detalle", "sin operacion seleccionada"]];
  }

  const field = error.lastErrorDetails?.fields[0] ?? null;
  const relationIssue = field?.relationIssues?.[0] ?? null;

  return [
    ["sync_status", error.syncStatus],
    ["operation_type", error.operationType],
    ["httpStatus", error.lastHttpStatus ?? "not stored"],
    ["lastErrorCode", error.lastErrorCode ?? "none"],
    ["lastBackendErrorCode", error.lastBackendErrorCode ?? "none"],
    ["fieldId", field?.fieldId ?? "none"],
    ["fieldLabel", field?.fieldLabel ?? "none"],
    ["fieldType", field?.fieldType ?? "none"],
    ["source", field?.source ?? "none"],
    ["expectedRelationEntityId", field?.relatedEntityTypeId ?? relationIssue?.relatedEntityTypeId ?? "none"],
    ["expectedRelationEntityName", field?.relatedEntityTypeName ?? relationIssue?.relatedEntityTypeName ?? "none"],
    ["submittedRecordIds", formatDiagnosticFieldValue(field?.submittedRecordIds ?? field?.rejectedValue)],
    ["relationTargetRecordId", relationIssue?.targetRecordId ?? "none"],
    ["relationActualEntityId", relationIssue?.actualEntityTypeId ?? "not exposed"],
    ["relationActualEntityName", relationIssue?.actualEntityTypeName ?? "not exposed"],
    ["cause", formatRelationCause(relationIssue?.cause)],
    ["rejectedValue", formatDiagnosticFieldValue(field?.rejectedValue)],
    ["expectedType", field?.expectedType ?? "none"],
    ["expectedValues", field?.expectedValues?.join(", ") ?? "none"],
    ["message", formatDiagnosticMessages(field)],
    ["clientRequestId", error.clientRequestId],
    ["retryable", error.retryable],
    ["manualRetryable", error.manualRetryable],
  ];
}

function formatDiagnosticMessages(field: StateUpdateSyncErrorFieldDetails | null) {
  return field?.messages?.join(" ") || "none";
}

function formatRelationCause(cause: string | null | undefined) {
  if (!cause || cause === "UNDETERMINED") {
    return "Causa no determinada";
  }

  return cause;
}

function formatDiagnosticFieldValue(value: unknown): string {
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
