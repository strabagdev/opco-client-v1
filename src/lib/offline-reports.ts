import type { RevisionReceiptStore } from "./revision-receipt-storage";
import { createConsultationRevisionRead } from "./consultation-revision-read";
import type { ReportAppView } from "./opco-api";
import { LocalDatabase, ReportSnapshotScope } from "./local-db";
import { OpcoApi, OpcoNetworkError, ReportQuery, ReportResponse } from "./opco-api";

export class ReportReadCancelledError extends Error {readonly code="REPORT_READ_CANCELLED";constructor(){super("La lectura del reporte ya no está vigente.");}}
export class ReportSnapshotMissingError extends Error {readonly code="REPORT_SNAPSHOT_MISSING";constructor(){super("Esta consulta no está disponible sin conexión. Conéctate y consulta el mismo período para guardarla.");}}

export type LoadReportResult = {
  fromCache: boolean;
  offline: boolean;
  report: ReportResponse;
  syncedAt: string | null;
};

export async function loadReportWithOfflineCache({
  api,
  appView,
  knownOffline=false,
  isActive,
  appViewId,
  contractId,
  ownerKey,
  query,
  store,
  token,
}: {
  api: Pick<OpcoApi, "getReport">;
  appView?:ReportAppView;knownOffline?:boolean;isActive?:()=>boolean;
  appViewId: string;
  contractId: string;
  ownerKey: string;
  query: ReportQuery;
  store: Pick<LocalDatabase, "getReportSnapshot" | "upsertReportSnapshot"> & Partial<RevisionReceiptStore>;
  token: string;
}): Promise<LoadReportResult> {
  const scope = reportSnapshotScope({ appViewId, contractId, ownerKey, query });

  let revision:Awaited<ReturnType<typeof createConsultationRevisionRead>>|undefined;
  const assertActive=()=>{if(isActive&&!isActive())throw new ReportReadCancelledError();revision?.assertActive();};
  const readCached=async()=>{assertActive();const cached=await store.getReportSnapshot(scope);assertActive();return cached;};
  assertActive();
  if(knownOffline){const cached=await readCached();if(!cached)throw new ReportSnapshotMissingError();return{fromCache:true,offline:true,report:cached.report,syncedAt:cached.syncedAt};}
  try {
    revision=await createConsultationRevisionRead({api,store,appView,appViewId,kind:"report",query,ownerKey,contractId,token,isCurrent:()=>!isActive||isActive()});
    if(revision.reused){assertActive();return{fromCache:true,offline:false,report:revision.reused.response as ReportResponse,syncedAt:revision.reused.verifiedAt};}
    const report=await revision.api.getReport!(token,contractId,appViewId,query);assertActive();
    const syncedAt=new Date().toISOString();await store.upsertReportSnapshot({...scope,report,syncedAt,assertActive});assertActive();await revision.finish();assertActive();
    return{fromCache:false,offline:false,report,syncedAt};
  }catch(error){assertActive();if(!(error instanceof OpcoNetworkError))throw error;const cached=await readCached();if(cached)return{fromCache:true,offline:true,report:cached.report,syncedAt:cached.syncedAt};throw error;}

}

function reportSnapshotScope({
  appViewId,
  contractId,
  ownerKey,
  query,
}: {
  appViewId: string;
  contractId: string;
  ownerKey: string;
  query: ReportQuery;
}): ReportSnapshotScope {
  return {
    appViewId,
    contractId,
    from: query.from,
    ownerKey,
    search: query.search,
    to: query.to,
  };
}
