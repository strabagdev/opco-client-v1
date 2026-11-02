import type { AppView, OpcoApi, PanelAppView } from "./opco-api";
import { beginPanelRead, recordPanelRead } from "./panel-read-diagnostics";

export type PanelDefinitionScope = { ownerKey: string; contractId: string; appViewId: string };
export type PanelDefinitionCache = {
  getCoherentPanelDefinition?(scope: PanelDefinitionScope): Promise<PanelAppView | null>;
};

export class PanelDefinitionError extends Error {
  constructor(readonly code: "PANEL_DEFINITION_UNAVAILABLE" | "PANEL_CONTEXT_CHANGED" | "PANEL_DEFINITION_READ_FAILED") {
    super(code === "PANEL_CONTEXT_CHANGED"
      ? "La configuración del panel cambió. Vuelve a abrir la experiencia con conexión para revisar los filtros."
      : code === "PANEL_DEFINITION_READ_FAILED" ? "No pudimos leer la configuración guardada del panel. Puedes reintentar."
      : "No pudimos confirmar la configuración actual del panel. Conservamos las copias guardadas; puedes reintentar con conexión.");
    this.name = "PanelDefinitionError";
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value ?? null;
}

// Context meaning must survive adoption, not just visible filter labels.
export function panelContextSignature(view: PanelAppView) {
  return JSON.stringify(stable({
    datasets: view.config.datasets,
    filters: view.config.filters?.map(({ id, required, valueType }) => ({ id, required: Boolean(required), valueType })),
  }));
}

export async function reconcilePanelDefinition({ api, appView, revision, token, contractId, assertActive }: {
  api: Partial<Pick<OpcoApi, "getAppViews">>; appView: PanelAppView; revision: string;
  token: string; contractId: string; assertActive(): void;
}): Promise<PanelAppView> {
  assertActive();
  if (appView.configRevision === revision) return appView;
  let views: AppView[];
  try {
    if (!api.getAppViews) throw new PanelDefinitionError("PANEL_DEFINITION_UNAVAILABLE");
    views = (await api.getAppViews(token, contractId)).views;
  } catch {
    assertActive();
    throw new PanelDefinitionError("PANEL_DEFINITION_UNAVAILABLE");
  }
  assertActive();
  const definition = Array.isArray(views) ? views.find(view => view.id === appView.id) : undefined;
  if (!definition || definition.type !== "PANEL" || definition.configRevision !== revision) {
    throw new PanelDefinitionError("PANEL_DEFINITION_UNAVAILABLE");
  }
  if (panelContextSignature(definition) !== panelContextSignature(appView)) throw new PanelDefinitionError("PANEL_CONTEXT_CHANGED");
  return definition;
}

// This can only enrich an already assigned cached AppView. It never reconstructs assignments.
export async function coherentCachedPanelViews(cache: PanelDefinitionCache, scope: Omit<PanelDefinitionScope, "appViewId">,
  views: AppView[], appViewId: string): Promise<AppView[]> {
  const assigned = views.find(view => view.id === appViewId);
  if (assigned?.type !== "PANEL" || !cache.getCoherentPanelDefinition) return views;
  const diagnostic = beginPanelRead({ ...scope, appViewId, datasetId: "__definition__", configRevision: assigned.configRevision, page: 1, pageSize: 1 });
  let definition: PanelAppView | null;
  try {
    definition = await cache.getCoherentPanelDefinition({ ...scope, appViewId });
  } catch {
    recordPanelRead(diagnostic, "definition", "failed", undefined, "PANEL_DEFINITION_READ_FAILED");
    throw new PanelDefinitionError("PANEL_DEFINITION_READ_FAILED");
  }
  recordPanelRead(diagnostic, "definition", !definition ? "miss" : definition.configRevision === assigned.configRevision ? "matched" : "reconciled", definition?.configRevision);
  return definition ? views.map(view => view.id === appViewId ? definition : view) : views;
}

export function panelDefinitionKey(scope: PanelDefinitionScope) {
  return "panel_coherent_definition:v1:" + JSON.stringify([scope.ownerKey, scope.contractId, scope.appViewId]);
}

export function parseCoherentPanelDefinition(value: string, appViewId: string): PanelAppView | null {
  try {
    const receipt = JSON.parse(value);
    const view = receipt.appView;
    return receipt.version === 1 && view?.id === appViewId && view.type === "PANEL" &&
      typeof view.configRevision === "string" && view.configRevision && view.config && typeof view.config === "object"
      ? view : null;
  } catch { return null; }
}
