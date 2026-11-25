import {assertConsultationCompatibility,consultationQuery} from "./consultation-revision-contract";
import { assertLocalPanelDefinition, assertPanelResponseCompatibility, PanelCompatibilityError } from "./panel-compatibility";
import type { RevisionReceiptStore } from "./revision-receipt-storage";
import { createConsultationRevisionRead } from "./consultation-revision-read";
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
  store: Pick<LocalDatabase, "getPanelSnapshot" | "upsertPanelSnapshot"> & Partial<RevisionReceiptStore>;
  token: string;
}): Promise<LoadPanelDatasetResult> {
  const scope = panelSnapshotScope({ appViewId, configRevision, contractId, ownerKey, query, snapshotDatasetId });
  let revision:Awaited<ReturnType<typeof createConsultationRevisionRead>>|undefined;
  const assertActive = () => { assertPanelReadActive(isActive); revision?.assertActive(); };
  const diagnostic = beginPanelRead(scope);
  const failureCode = (error: unknown) => error instanceof PanelReadCancelledError ? "PANEL_READ_CANCELLED"
    : error instanceof PanelDefinitionError ? error.code : "PANEL_READ_FAILED";

  async function readCached() {
    assertActive();
    recordPanelRead(diagnostic, "snapshot_read", "started");
    try {
      const cached = await store.getPanelSnapshot(scope);
      assertActive();
      if (cached) { assertPanelResponseCompatibility(cached.panel, "cache", appView); if(appView)assertConsultationCompatibility({appView,resource:{kind:"panel",appViewId,query:consultationQuery("panel",query)},snapshotDatasetId},cached.panel); }
      recordPanelRead(diagnostic, "snapshot_read", cached ? "hit" : "miss", cached?.panel.configRevision, cached ? null : "PANEL_SNAPSHOT_MISSING", cached?.syncedAt);
      return cached;
    } catch (error) {
      const cancelled = error instanceof PanelReadCancelledError || Boolean(isActive && !isActive());
      recordPanelRead(diagnostic, "snapshot_read", cancelled ? "cancelled" : "failed", undefined, cancelled ? "PANEL_READ_CANCELLED" : "PANEL_LOCAL_READ_FAILED");
      assertActive();
      if (error instanceof PanelReadCancelledError || error instanceof PanelCompatibilityError || error instanceof Error && "code" in error && error.code === "CONSULTATION_CONFIGURATION_INCOMPATIBLE") throw error;
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
  if (appView) assertLocalPanelDefinition(appView);
  if (knownOffline) {
    if (requireConfigRevision && !configRevision) throw new PanelSnapshotMissingError();
    const cached = await readCached();
    if (!cached) throw new PanelSnapshotMissingError();
    return { fromCache: true, offline: true, panel: cached.panel, syncedAt: cached.syncedAt };
  }

  try {
    recordPanelRead(diagnostic, "request", "started");
    revision=await createConsultationRevisionRead({api,store,appView,appViewId,kind:"panel",query,snapshotDatasetId,ownerKey,contractId,token,isCurrent:()=>!isActive||isActive()});
    if(revision.reused){
      assertActive();const panel=revision.reused.response as PanelResponse;
      assertPanelResponseCompatibility(panel,"cache",revision.reused.appView as PanelAppView);
      recordPanelRead(diagnostic,"snapshot_read","hit",panel.configRevision,null,revision.reused.verifiedAt);
      return{fromCache:true,offline:false,panel,syncedAt:revision.reused.verifiedAt,definition:revision.reused.appView as PanelAppView};
    }
    const readApi=revision.api;
    const panel = await readApi.getPanel!(token, contractId, appViewId, query, { diagnosticRequestId: diagnostic.readId });
    assertActive();
    assertPanelResponseCompatibility(panel, "online", appView);
    recordPanelRead(diagnostic, "response", "received", panel.configRevision);
    if (appView && panel.appView.id !== appViewId) throw new PanelDefinitionError("PANEL_DEFINITION_UNAVAILABLE");
    const syncedAt = new Date().toISOString();
    let definition: PanelAppView | undefined;
    let definitionError: unknown;
    if (appView) {
      recordPanelRead(diagnostic, "definition", "started", panel.configRevision);
      try {
        definition = await reconcilePanelDefinition({ api:readApi, appView, revision: panel.configRevision, token, contractId, assertActive });
        recordPanelRead(diagnostic, "definition", appView.configRevision === panel.configRevision ? "matched" : "reconciled", panel.configRevision);
      } catch (error) {
        assertActive();
        definitionError = error;
        recordPanelRead(diagnostic, "definition", "failed", panel.configRevision, failureCode(error));
      }
    }

    if (appView && !definitionError) assertConsultationCompatibility({ appView: definition ?? appView, resource: { kind: "panel", appViewId, query: consultationQuery("panel", query) }, snapshotDatasetId }, panel);
    await persist(panel, syncedAt, definition);
    const executedDatasetId = panel.datasets[0]?.id;

    if (executedDatasetId && executedDatasetId !== scope.datasetId) {
      await persist(panel, syncedAt, definition, executedDatasetId);
    }

    if (definitionError) throw definitionError;
    await revision.finish();
    assertActive();
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
