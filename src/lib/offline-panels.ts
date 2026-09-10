import { LocalDatabase, PanelSnapshotScope } from "./local-db";
import { OpcoApi, OpcoNetworkError, PanelQuery, PanelResponse } from "./opco-api";

export const PANEL_DISCOVERY_SNAPSHOT_DATASET_ID = "__panel_discovery__";

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
  contractId,
  ownerKey,
  query,
  snapshotDatasetId,
  store,
  token,
}: {
  api: Pick<OpcoApi, "getPanel">;
  appViewId: string;
  configRevision?: string | null;
  contractId: string;
  ownerKey: string;
  query: PanelQuery & { page: number; pageSize: number };
  snapshotDatasetId?: string;
  store: Pick<LocalDatabase, "getPanelSnapshot" | "upsertPanelSnapshot">;
  token: string;
}): Promise<LoadPanelDatasetResult> {
  const scope = panelSnapshotScope({ appViewId, configRevision, contractId, ownerKey, query, snapshotDatasetId });

  try {
    const panel = await api.getPanel(token, contractId, appViewId, query);
    const syncedAt = new Date().toISOString();

    await store.upsertPanelSnapshot({ ...scope, configRevision: panel.configRevision, panel, syncedAt });
    const executedDatasetId = panel.datasets[0]?.id;

    if (executedDatasetId && executedDatasetId !== scope.datasetId) {
      await store.upsertPanelSnapshot({
        ...scope,
        configRevision: panel.configRevision,
        datasetId: executedDatasetId,
        panel,
        syncedAt,
      });
    }

    return { fromCache: false, offline: false, panel, syncedAt };
  } catch (error) {
    const cached = await store.getPanelSnapshot(scope);

    if (cached && error instanceof OpcoNetworkError) {
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
