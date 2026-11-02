import { LocalDatabase, PanelSnapshotScope } from "./local-db";
import { OpcoApi, OpcoNetworkError, PanelQuery, PanelResponse, PanelAppView } from "./opco-api";
import { PanelDefinitionError, reconcilePanelDefinition } from "./panel-definition";
import { beginPanelRead, recordPanelRead } from "./panel-read-diagnostics";

export const PANEL_DISCOVERY_SNAPSHOT_DATASET_ID = "__panel_discovery__";

export class PanelReadCancelledError extends Error {
  constructor() {
    super("La lectura del panel ya no está vigente.");
    this.name = "PanelReadCancelledError";
  }
}

export class PanelLocalReadError extends Error {
  readonly code = "PANEL_LOCAL_READ_FAILED";
  constructor() {
    super("No pudimos leer la consulta guardada en este dispositivo. Puedes reintentar.");
    this.name = "PanelLocalReadError";
  }
}

export class PanelSnapshotMissingError extends Error {
  readonly code = "PANEL_SNAPSHOT_MISSING";
  constructor() {
    super("Esta consulta no está disponible sin conexión. Conéctate y consulta los mismos filtros y página para guardarla.");
    this.name = "PanelSnapshotMissingError";
  }
}

export function assertPanelReadActive(isActive?: () => boolean) {
  if (isActive && !isActive()) throw new PanelReadCancelledError();
}

export type LoadPanelDatasetResult = {
  fromCache: boolean;
  offline: boolean;
  panel: PanelResponse;
  syncedAt: string | null;
  definition?: PanelAppView;
};

export async function loadPanelDatasetWithOfflineCache({
  api,
  appView,
  appViewId,
  configRevision,
  requireConfigRevision = false,
  contractId,
  isActive,
  knownOffline = false,
  ownerKey,
  query,
  snapshotDatasetId,
  store,
  token,
}: {
  api: Pick<OpcoApi, "getPanel"> & Partial<Pick<OpcoApi, "getAppViews">>;
  appView?: PanelAppView;
  appViewId: string;
  configRevision?: string | null;
  requireConfigRevision?: boolean;
  contractId: string;
  isActive?: () => boolean;
  knownOffline?: boolean;
  ownerKey: string;
  query: PanelQuery & { page: number; pageSize: number };
  snapshotDatasetId?: string;
  store: Pick<LocalDatabase, "getPanelSnapshot" | "upsertPanelSnapshot">;
  token: string;
}): Promise<LoadPanelDatasetResult> {
  const scope = panelSnapshotScope({ appViewId, configRevision, contractId, ownerKey, query, snapshotDatasetId });
  const assertActive = () => assertPanelReadActive(isActive);
  const diagnostic = beginPanelRead(scope);
  const failureCode = (error: unknown) => error instanceof PanelReadCancelledError ? "PANEL_READ_CANCELLED"
    : error instanceof PanelDefinitionError ? error.code : "PANEL_READ_FAILED";

  async function readCached() {
    assertActive();
    recordPanelRead(diagnostic, "snapshot_read", "started");
    try {
      const cached = await store.getPanelSnapshot(scope);
      assertActive();
      recordPanelRead(diagnostic, "snapshot_read", cached ? "hit" : "miss", cached?.panel.configRevision, cached ? null : "PANEL_SNAPSHOT_MISSING", cached?.syncedAt);
      return cached;
    } catch (error) {
      const cancelled = error instanceof PanelReadCancelledError || Boolean(isActive && !isActive());
      recordPanelRead(diagnostic, "snapshot_read", cancelled ? "cancelled" : "failed", undefined, cancelled ? "PANEL_READ_CANCELLED" : "PANEL_LOCAL_READ_FAILED");
      assertActive();
      if (error instanceof PanelReadCancelledError) throw error;
      throw new PanelLocalReadError();
    }
  }

  async function persist(panel: PanelResponse, syncedAt: string, definition?: PanelAppView, datasetId = scope.datasetId) {
    const writeScope = { ...scope, datasetId };
    const writeDiagnostic = { ...diagnostic, key: writeScope };
    recordPanelRead(writeDiagnostic, "snapshot_write", "started", panel.configRevision);
    try {
      await store.upsertPanelSnapshot({ ...writeScope, assertActive, configRevision: panel.configRevision, panel, definition, syncedAt });
      assertActive();
      recordPanelRead(writeDiagnostic, "snapshot_write", "persisted", panel.configRevision, null, syncedAt);
    } catch (error) {
      recordPanelRead(writeDiagnostic, "snapshot_write", isActive && !isActive() ? "cancelled" : "failed", panel.configRevision, failureCode(error));
      throw error;
    }
  }

  assertActive();
  if (knownOffline) {
    if (requireConfigRevision && !configRevision) throw new PanelSnapshotMissingError();
    const cached = await readCached();
    if (!cached) throw new PanelSnapshotMissingError();
    return { fromCache: true, offline: true, panel: cached.panel, syncedAt: cached.syncedAt };
  }

  try {
    recordPanelRead(diagnostic, "request", "started");
    const panel = await api.getPanel(token, contractId, appViewId, query, { diagnosticRequestId: diagnostic.readId });
    assertActive();
    recordPanelRead(diagnostic, "response", "received", panel.configRevision);
    if (appView && panel.appView.id !== appViewId) throw new PanelDefinitionError("PANEL_DEFINITION_UNAVAILABLE");
    const syncedAt = new Date().toISOString();
    let definition: PanelAppView | undefined;
    let definitionError: unknown;
    if (appView) {
      recordPanelRead(diagnostic, "definition", "started", panel.configRevision);
      try {
        definition = await reconcilePanelDefinition({ api, appView, revision: panel.configRevision, token, contractId, assertActive });
        recordPanelRead(diagnostic, "definition", appView.configRevision === panel.configRevision ? "matched" : "reconciled", panel.configRevision);
      } catch (error) {
        assertActive();
        definitionError = error;
        recordPanelRead(diagnostic, "definition", "failed", panel.configRevision, failureCode(error));
      }
    }

    await persist(panel, syncedAt, definition);
    const executedDatasetId = panel.datasets[0]?.id;

    if (executedDatasetId && executedDatasetId !== scope.datasetId) {
      await persist(panel, syncedAt, definition, executedDatasetId);
    }

    if (definitionError) throw definitionError;
    return { fromCache: false, offline: false, panel, syncedAt, ...(definition ? { definition } : {}) };
  } catch (error) {
    recordPanelRead(diagnostic, "request", isActive && !isActive() ? "cancelled" : "failed", undefined, failureCode(error));
    assertActive();
    if (!(error instanceof OpcoNetworkError)) throw error;
    if (requireConfigRevision && !configRevision) throw error;
    const cached = await readCached();

    if (cached) {
      return { fromCache: true, offline: true, panel: cached.panel, syncedAt: cached.syncedAt };
    }

    throw error;
  }
}

function panelSnapshotScope({
  appViewId,
  configRevision,
  contractId,
  ownerKey,
  query,
  snapshotDatasetId,
}: {
  appViewId: string;
  configRevision?: string | null;
  contractId: string;
  ownerKey: string;
  query: PanelQuery & { page: number; pageSize: number };
  snapshotDatasetId?: string;
}): PanelSnapshotScope {
  return {
    appViewId,
    configRevision,
    contractId,
    datasetId: snapshotDatasetId ?? query.datasetId ?? PANEL_DISCOVERY_SNAPSHOT_DATASET_ID,
    filters: query.filters,
    ownerKey,
    page: query.page,
    pageSize: query.pageSize,
    search: query.search,
  };
}
