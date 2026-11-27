import type { AppView } from "./opco-api";

/** Function is explicit configuration, never inferred from names, roles or KPIs. */
export type ConsultationPurpose = "OPERATIONAL" | "ANALYSIS";
export function isAnalysisExperience(view: Pick<AppView, "type" | "config"> | undefined) {
  return Boolean(view && (view.type === "REPORT"
    ? ["TABLE", "MATRIX"].includes((view.config as { presentationMode?: string }).presentationMode ?? "")
    : view.type === "PANEL" && (view.config as { purpose?: ConsultationPurpose }).purpose === "ANALYSIS"));
}
export const ANALYSIS_OFFLINE_NOTICE = "Análisis disponible sólo con conexión a internet";
export const ANALYSIS_UPDATE_NOTICE = "No fue posible actualizar el análisis. Comprueba la conexión con Opco y vuelve a intentarlo.";
export class AnalysisUnavailableError extends Error {
  readonly code: "ANALYSIS_ONLINE_REQUIRED" | "ANALYSIS_UPDATE_FAILED";
  constructor(offline: boolean) {
    super(offline ? ANALYSIS_OFFLINE_NOTICE : ANALYSIS_UPDATE_NOTICE);
    this.name = "AnalysisUnavailableError";
    this.code = offline ? "ANALYSIS_ONLINE_REQUIRED" : "ANALYSIS_UPDATE_FAILED";
  }
}
