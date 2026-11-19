import type { PanelAppView, PanelResponse } from "./opco-api";

export const PANEL_FEATURES = ["operational-day-v1", "capture-time-v1", "counts-v1", "difference-v1", "groups-v1", "today-v1"] as const;
export type PanelCompatibility = { version: 1; status: "compatible" | "update-required"; required: string[]; accepted: string[]; definitionRevision: string };
// Safelisted Accept: ASCII, no quoted/unsafe bytes, fewer than 128 bytes. Old Core ignores its parameters.
export const PANEL_ACCEPT = `application/json;opco-panel=1;features=${PANEL_FEATURES.join(".")}`;
export class PanelCompatibilityError extends Error {
  readonly code = "PANEL_CLIENT_UPDATE_REQUIRED";
  constructor(message = "Esta experiencia requiere actualizar Opco Client. Tus datos guardados y pendientes se conservan.") { super(message); this.name = "PanelCompatibilityError"; }
}
const known = (required: readonly string[]) => required.every(feature => (PANEL_FEATURES as readonly string[]).includes(feature));
export function requiredPanelFeatures(config: PanelAppView["config"]): string[] {
  const required = new Set<string>();
  if(config.filters?.some(f=>f.defaultValue?.type==="OPERATIONAL_TODAY"))required.add("operational-day-v1");
  if(config.modules?.some(m=>m.visualization.type==="TABLE"&&m.visualization.config.columns?.some(c=>c.captureTime)))required.add("capture-time-v1");
  if (config.filters?.some(filter => filter.defaultValue?.type === "TODAY")) required.add("today-v1");
  for (const dataset of config.datasets ?? []) {
    if (dataset.groupBy) required.add("groups-v1");
    if (dataset.relationCounts?.length) required.add("counts-v1");
    if (dataset.relationCounts?.some(count => count.difference)) required.add("difference-v1");
  }
  return [...required].sort();
}
function verifiedAck(value: PanelCompatibility, revision: string | undefined, required: readonly string[]) {
  return value.version === 1 && value.status === "compatible" && value.definitionRevision === revision
    && Array.isArray(value.required) && Array.isArray(value.accepted) && known(value.required)
    && new Set(value.required).size === value.required.length && new Set(value.accepted).size === value.accepted.length
    && required.every(feature => value.required.includes(feature))
    && value.required.length === value.accepted.length && value.required.every(feature => value.accepted.includes(feature));
}
export function assertLocalPanelDefinition(view: PanelAppView) {
  if (view.config.schemaVersion !== undefined && view.config.schemaVersion !== 1) throw new PanelCompatibilityError();
  const required = requiredPanelFeatures(view.config), ack = view.panelCompatibility;
  if (!known(required)) throw new PanelCompatibilityError();
  if (ack && !verifiedAck(ack, view.configRevision, required)) throw new PanelCompatibilityError(
    ack.status === "update-required" && Array.isArray(ack.required) && known(ack.required)
      ? "Conéctate para descargar una definición compatible de esta experiencia. Tus copias guardadas y pendientes se conservan."
      : undefined);
}
export function assertPanelResponseCompatibility(panel: PanelResponse, mode: "online" | "cache", view?: PanelAppView) {
  const required = new Set(view ? requiredPanelFeatures(view.config) : []);
  if (panel.filters?.some(filter => filter.defaultValue?.type === "TODAY")) required.add("today-v1");
  for (const dataset of panel.datasets ?? []) {
    if (dataset.grouping) required.add("groups-v1");
    if (dataset.schema.fields.some(field => field.id.startsWith("count:"))) required.add("counts-v1");
    if (dataset.schema.fields.some(field => field.id.startsWith("difference:"))) required.add("difference-v1");
  }
  if(panel.modules?.some(m=>m.visualization.type==="TABLE"&&m.visualization.config.columns?.some(c=>c.captureTime)))required.add("capture-time-v1");
  const ack = panel.panelCompatibility;
  if (panel.schemaVersion !== 1 || !known([...required])) throw new PanelCompatibilityError();
  if (ack && !verifiedAck(ack, panel.configRevision, [...required])) throw new PanelCompatibilityError();
  if (required.size && mode === "online" && !ack) throw new PanelCompatibilityError(
    "Opco no confirmó la compatibilidad de esta experiencia. Conservamos la consulta guardada; necesita un servidor actualizado.");
  // Known pre-guard snapshots remain usable offline by this capable reader; no deletion or false freshness.
}
export function panelReadRepresentation(data: Record<string, unknown>): unknown | undefined {
  if (data.panelCompatibility) return data.panelCompatibility;
  if (!Array.isArray(data.views)) return undefined;
  const views = data.views.filter(view => view?.panelCompatibility).map(view => ({ id: view.id, panelCompatibility: view.panelCompatibility }));
  return views.length ? views.sort((a, b) => a.id.localeCompare(b.id)) : undefined;
}
