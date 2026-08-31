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
  if (!error) {
    return [["detalle", "sin operacion seleccionada"]];
  }

  const field = error.lastErrorDetails?.fields[0] ?? null;

  return [
    ["sync_status", error.syncStatus],
    ["operation_type", error.operationType],
    ["lastErrorCode", error.lastErrorCode ?? "none"],
    ["lastBackendErrorCode", error.lastBackendErrorCode ?? "none"],
    ["fieldId", field?.fieldId ?? "none"],
    ["fieldLabel", field?.fieldLabel ?? "none"],
    ["fieldType", field?.fieldType ?? "none"],
    ["source", field?.source ?? "none"],
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
