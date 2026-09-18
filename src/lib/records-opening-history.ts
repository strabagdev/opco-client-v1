export const RECORDS_OPENING_HISTORY_LIMIT = 20;

export type RecordsOpeningCoverage = "complete" | "partial" | "unknown";
export type RecordsOpeningResult = "in_progress" | "completed" | "partial" | "error" | "cancelled" | "interrupted";
export type RecordsOpeningSource = "local" | "remote" | "mixed" | "unknown" | "none";

export type RecordsOpeningMeasurement = {
  appViewId: string;
  appViewTitle: string;
  coverage: RecordsOpeningCoverage;
  errorCode: string | null;
  id: string;
  localReadMs: number | null;
  preparationMs: number | null;
  processedCount: number;
  remoteRefreshMs: number | null;
  result: RecordsOpeningResult;
  shownCount: number;
  source: RecordsOpeningSource;
  startedAt: string;
  timeToFirstRowsMs: number | null;
  appViewType?: "RECORDS" | "WORKFLOW" | "REPORT" | "BOARD" | "DASHBOARD" | "PANEL";
  variant?: string | null;
  origin?: "navigation" | "route" | "renderer";
  appViewResolutionMs?: number | null;
  configurationMs?: number | null;
  firstUsefulContentMs?: number | null;
  readyMs?: number | null;
  initialUpdateMs?: number | null;
  moduleSummary?: { empty: number; failed: number; loaded: number; total: number } | null;
};

export type RecordsOpeningHistoryStore = {
  clearRecordsOpeningHistory(ownerKey: string): Promise<void>;
  getRecordsOpeningHistory(ownerKey: string, contractId: string): Promise<RecordsOpeningMeasurement[]>;
  upsertRecordsOpeningMeasurement(
    ownerKey: string,
    contractId: string,
    measurement: RecordsOpeningMeasurement,
  ): Promise<void>;
};

export function upsertRecordsOpeningHistory(
  history: RecordsOpeningMeasurement[],
  measurement: RecordsOpeningMeasurement,
) {
  return [measurement, ...history.filter((entry) => entry.id !== measurement.id)]
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .slice(0, RECORDS_OPENING_HISTORY_LIMIT);
}

export function interruptUnfinishedRecordsOpenings(history: RecordsOpeningMeasurement[]) {
  return history.map((entry) => entry.result === "in_progress"
    ? { ...entry, result: "interrupted" as const }
    : entry);
}

export function formatRecordsOpeningPerformanceCopy(history: RecordsOpeningMeasurement[]) {
  if (history.length === 0) return "Rendimiento de experiencias\nSin información";

  return [
    "Rendimiento de experiencias",
    "El origen indica si la medición comenzó en navegación, entrada a ruta o renderer.",
    ...history.flatMap((entry) => [
      "",
      `${entry.startedAt} | ${entry.appViewTitle} | ${entry.result}`,
      `Medición: ${entry.id}`,
      `Tipo: ${entry.appViewType ?? "RECORDS"} | Variante: ${entry.variant ?? "No aplica"} | Origen: ${entry.origin ?? "renderer (historial anterior)"}`,
      `Fuente: ${entry.source} | Cobertura: ${entry.coverage}`,
      `Mostrados: ${entry.shownCount} | Procesados: ${entry.processedCount}`,
      `Primeras filas: ${duration(entry.timeToFirstRowsMs)} | Local: ${duration(entry.localReadMs)} | Remoto: ${duration(entry.remoteRefreshMs)} | Preparación: ${duration(entry.preparationMs)}`,
      `Primera presentación útil: ${duration(entry.firstUsefulContentMs ?? entry.timeToFirstRowsMs)} | Lista para operar: ${duration(entry.readyMs ?? null)} | Resolución: ${duration(entry.appViewResolutionMs ?? null)} | Configuración: ${duration(entry.configurationMs ?? null)} | Actualización inicial: ${duration(entry.initialUpdateMs ?? null)}`,
      entry.moduleSummary ? `Módulos: ${entry.moduleSummary.loaded} cargados | ${entry.moduleSummary.empty} vacíos | ${entry.moduleSummary.failed} fallidos | ${entry.moduleSummary.total} total` : "Módulos: No aplica",
      `Error: ${entry.errorCode ?? "none"}`,
    ]),
  ].join("\n");
}

export function getOpeningPrimaryTimingLabel(entry: RecordsOpeningMeasurement) {
  const value = entry.firstUsefulContentMs ?? entry.timeToFirstRowsMs;
  if (value !== null) return `${value} ms · primeras filas`;
  return entry.result === "in_progress" ? "En curso" : "Sin información";
}

function duration(value: number | null) {
  return value === null ? "Sin información" : `${value} ms`;
}
