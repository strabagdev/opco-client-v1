import type { OfflinePreparationDiagnostics } from "./app-view-prewarm";

// Used by both the existing PWA detail and its diagnostic copy. No record payloads.
export function offlinePreparationFailureRows(diagnostics: OfflinePreparationDiagnostics | null): string[][] {
  if (!diagnostics) return [["Fallos individuales", "Sin ejecución registrada"]];
  const rows = [["runId", diagnostics.runId ?? "Sin información"], ["Scope", diagnostics.scopeKey ?? "Sin información"]];
  if (!diagnostics.failedAppViews) {
    return [...rows, ["Fallos individuales", "Detalle no conservado por esta versión; repetir la preparación para capturarlo"]];
  }
  return [...rows, ...(diagnostics.failedAppViews.length
    ? diagnostics.failedAppViews.map((entry, index) => [
      `Fallo ${index + 1}`,
      `${entry.appViewName ?? "Experiencia sin nombre"} | ${entry.fingerprint} | tipo=${entry.appViewType} | workflow=${entry.workflowKey ?? "none"} | fase=${entry.stage} | código=${entry.errorCode ?? "UNKNOWN"} | HTTP=${entry.httpStatus ?? "Sin información"}`,
    ])
    : [["Fallos individuales", "Sin fallos de AppView registrados"]])];
}
