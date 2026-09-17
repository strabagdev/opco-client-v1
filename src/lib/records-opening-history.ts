export const RECORDS_OPENING_HISTORY_LIMIT = 20;

export type RecordsOpeningCoverage = "complete" | "partial" | "unknown";
export type RecordsOpeningResult = "in_progress" | "completed" | "error" | "cancelled" | "interrupted";
export type RecordsOpeningSource = "local" | "remote" | "none";

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
  if (history.length === 0) return "Rendimiento RECORDS\nSin información";

  return [
    "Rendimiento RECORDS",
    "Inicio de medición: montaje del renderer, no pulsación de la experiencia.",
    ...history.flatMap((entry) => [
      "",
      `${entry.startedAt} | ${entry.appViewTitle} | ${entry.result}`,
      `Medición: ${entry.id}`,
      `Fuente: ${entry.source} | Cobertura: ${entry.coverage}`,
      `Mostrados: ${entry.shownCount} | Procesados: ${entry.processedCount}`,
      `Primeras filas: ${duration(entry.timeToFirstRowsMs)} | Local: ${duration(entry.localReadMs)} | Remoto: ${duration(entry.remoteRefreshMs)} | Preparación: ${duration(entry.preparationMs)}`,
      `Error: ${entry.errorCode ?? "none"}`,
    ]),
  ].join("\n");
}

function duration(value: number | null) {
  return value === null ? "Sin información" : `${value} ms`;
}
