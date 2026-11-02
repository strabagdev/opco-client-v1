import { LocalDatabase, PanelSnapshotScope } from "./local-db";
import { OpcoApi, OpcoNetworkError, PanelQuery, PanelResponse } from "./opco-api";

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
};

export async function loadPanelDatasetWithOfflineCache({
  api,
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
  api: Pick<OpcoApi, "getPanel">;
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

  async function readCached() {
    assertActive();
    try {
      const cached = await store.getPanelSnapshot(scope);
      assertActive();
      return cached;
    } catch (error) {
      assertActive();
      if (error instanceof PanelReadCancelledError) throw error;
      throw new PanelLocalReadError();
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
    const panel = await api.getPanel(token, contractId, appViewId, query);
    assertActive();
    const syncedAt = new Date().toISOString();

    await store.upsertPanelSnapshot({ ...scope, assertActive, configRevision: panel.configRevision, panel, syncedAt });
    assertActive();
    const executedDatasetId = panel.datasets[0]?.id;

    if (executedDatasetId && executedDatasetId !== scope.datasetId) {
      await store.upsertPanelSnapshot({
        ...scope,
        assertActive,
        configRevision: panel.configRevision,
        datasetId: executedDatasetId,
        panel,
        syncedAt,
      });
      assertActive();
    }

    return { fromCache: false, offline: false, panel, syncedAt };
  } catch (error) {
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
