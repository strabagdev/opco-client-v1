import { LocalDatabase, ReportSnapshotScope } from "./local-db";
import { OpcoApi, OpcoNetworkError, ReportQuery, ReportResponse } from "./opco-api";

export type LoadReportResult = {
  fromCache: boolean;
  offline: boolean;
  report: ReportResponse;
  syncedAt: string | null;
};

export async function loadReportWithOfflineCache({
  api,
  appViewId,
  contractId,
  ownerKey,
  query,
  store,
  token,
}: {
  api: Pick<OpcoApi, "getReport">;
  appViewId: string;
  contractId: string;
  ownerKey: string;
  query: ReportQuery;
  store: Pick<LocalDatabase, "getReportSnapshot" | "upsertReportSnapshot">;
  token: string;
}): Promise<LoadReportResult> {
  const scope = reportSnapshotScope({ appViewId, contractId, ownerKey, query });

  try {
    const report = await api.getReport(token, contractId, appViewId, query);
    const syncedAt = new Date().toISOString();

    await store.upsertReportSnapshot({ ...scope, report, syncedAt });

    return { fromCache: false, offline: false, report, syncedAt };
  } catch (error) {
    const cached = await store.getReportSnapshot(scope);

    if (cached && error instanceof OpcoNetworkError) {
      return { fromCache: true, offline: true, report: cached.report, syncedAt: cached.syncedAt };
    }

    throw error;
  }
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
