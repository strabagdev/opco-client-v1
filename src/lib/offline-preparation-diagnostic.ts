import type { OfflinePreparationDiagnostics } from "./app-view-prewarm";

// Used by both the existing PWA detail and its diagnostic copy. No record payloads.
export function offlinePreparationFailureRows(diagnostics: OfflinePreparationDiagnostics | null): string[][] {
  if (!diagnostics) return [["Fallos individuales", "Sin ejecución registrada"]];
  const rows = [["runId", diagnostics.runId ?? "Sin información"], ["Scope", diagnostics.scopeKey ?? "Sin información"],
    ["Lista de Inicio", diagnostics.homeList ? `fase=cache_write | resultado=${diagnostics.homeList.status} | cantidad=${diagnostics.homeList.count} | fecha=${diagnostics.homeList.syncedAt ?? "Sin información"} | código=${diagnostics.homeList.errorCode ?? "none"} | requestId=${diagnostics.homeList.requestId ?? "none"}` : "No verificada por esta versión histórica"]];
  if (diagnostics.diagnosticWrite) rows.push(["Persistencia del diagnóstico", diagnostics.diagnosticWrite === "failed"
    ? "No se pudo guardar el diagnóstico principal; reconciliar el recibo sin repetir descargas" : "Guardado"]);
  if (diagnostics.recoveryOf) rows.push(["Recuperación de run", diagnostics.recoveryOf]);
  if (diagnostics.runErrorCode) rows.push(["Error de recuperación", diagnostics.runErrorCode]);
  rows.push(["Alcance del detalle", "Esta ejecución; no atribuye fallos de ejecuciones anteriores"]);
  if (diagnostics.requestContext) {
    const request = diagnostics.requestContext;
    rows.push(["Motivo de preparación", `seleccionadas=${request.selected.length} | reutilizadas=${request.reused} | invalidación=${request.invalidationFingerprint ?? "none"}`]);
    if (request.previous) rows.push(["Ejecución anterior", `${request.previous.runId} | ${request.previous.status} | fin=${request.previous.completedAt ?? "Sin información"}`]);
    for (const item of request.selected) rows.push(["Trabajo seleccionado", `${item.fingerprint} | motivo=${item.reason}`]);
  }
  if (diagnostics.globalFailure) rows.push(["Fallo global de esta ejecución", `fase=${diagnostics.globalFailure.stage} | código=${diagnostics.globalFailure.code} | HTTP=${diagnostics.globalFailure.httpStatus ?? "Sin información"}`]);
  if (diagnostics.status === "failed" && diagnostics.failedAppViews?.length === 0 && !diagnostics.globalFailure && !diagnostics.runErrorCode && diagnostics.homeList?.status !== "error") rows.push(["Causa global", "La causa no quedó conservada; cero fallos de AppView no acredita ausencia de un fallo global o de dependencias"]);
  if (diagnostics.lastFailure && diagnostics.lastFailure.runId !== diagnostics.runId) {
    const previous = diagnostics.lastFailure;
    rows.push(["Último fallo conservado", `${previous.runId} | scope=${previous.scopeKey} | fin=${previous.completedAt ?? "Sin información"}`]);
    if (previous.globalFailure) rows.push(["Causa del último fallo", `fase=${previous.globalFailure.stage} | código=${previous.globalFailure.code} | HTTP=${previous.globalFailure.httpStatus ?? "Sin información"}`]);
    if (previous.runErrorCode) rows.push(["Recuperación del último fallo", previous.runErrorCode]);
    for (const entry of previous.failedAppViews) rows.push(["AppView del último fallo", `${entry.fingerprint} | fase=${entry.stage} | código=${entry.errorCode ?? "UNKNOWN"}`]);
    if (!previous.globalFailure && !previous.runErrorCode && !previous.failedAppViews.length) rows.push(["Causa del último fallo", "No conservada por la ejecución original; no se reconstruye"]);
  }
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
