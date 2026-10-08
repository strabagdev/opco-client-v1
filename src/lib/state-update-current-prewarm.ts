import type { OpcoApi } from "./opco-api";
import type { OfflineRecordStore } from "./offline-records";
import type { StateUpdateCurrentCoverage, StateUpdateCurrentCoverageScope, StateUpdateOfflineStore } from "./state-update-offline";

type CurrentPreparationStore = Pick<OfflineRecordStore, "listCachedRecords"> &
  Pick<StateUpdateOfflineStore, "setStateUpdateCurrentCoverage" | "upsertStateUpdateSnapshot">;

/** Complete source refresh first; latest and filtered search never certify current. */
export async function prepareStateUpdateCurrent({
  api, token, scope, store, sourceRemoteTotal, sourceFetched, sourceCacheTotal,
  runWithConcurrency, concurrency, signal,
}: {
  api: Pick<OpcoApi, "getStateUpdateWorkflow">;
  token: string;
  scope: StateUpdateCurrentCoverageScope;
  store: CurrentPreparationStore;
  sourceRemoteTotal?: number;
  sourceFetched: number;
  sourceCacheTotal: number;
  runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void>;
  concurrency: number;
  signal?: AbortSignal;
}) {
  const started = Date.now();
  const coverage: StateUpdateCurrentCoverage = {
    status: "partial", sourceComplete: false, totalSubjects: sourceCacheTotal,
    subjects: {}, requestCount: 0, durationMs: 0, refreshedAt: new Date().toISOString(),
  };
  const writeCoverage = () => store.setStateUpdateCurrentCoverage({ ...scope, coverage: {
    ...coverage, subjects: { ...coverage.subjects }, durationMs: Date.now() - started,
  } });
  await writeCoverage();
  const ids = new Set<string>();
  let pages = 1;
  let stableCache = true;
  for (let page = 1; page <= pages; page++) {
    if (signal?.aborted) return;
    const cached = await store.listCachedRecords({ ownerKey: scope.ownerKey, contractId: scope.contractId,
      entityTypeId: scope.sourceEntityTypeId, page, pageSize: 100 });
    pages = Math.max(1, cached.pagination.totalPages);
    stableCache &&= cached.pagination.total === sourceCacheTotal;
    for (const record of cached.records) if (record.serverId) ids.add(record.serverId);
  }
  coverage.sourceComplete = stableCache && sourceRemoteTotal !== undefined &&
    sourceFetched === sourceRemoteTotal && ids.size === sourceRemoteTotal && sourceCacheTotal === sourceRemoteTotal;
  await writeCoverage();
  let failed = false;
  await runWithConcurrency([...ids], concurrency, async subjectRecordId => {
    if (signal?.aborted) return;
    coverage.requestCount++;
    try {
      const response = await api.getStateUpdateWorkflow(token, scope.contractId, scope.appViewId,
        { date: scope.date, subjectRecordId, pageSize: 1 });
      if (signal?.aborted) return;
      if (response.items.length !== 1 || response.items[0].subject.id !== subjectRecordId ||
        response.targetEntityType.id !== scope.targetEntityTypeId || response.sourceEntityType.id !== scope.sourceEntityTypeId ||
        response.dateFieldId !== scope.dateFieldId || response.uniqueness !== scope.uniqueness || response.historyMode !== scope.historyMode) {
        throw new Error("STATE_UPDATE_CURRENT_RESPONSE_MISMATCH");
      }
      // subjects[].current is authoritative, including explicit null. Do not fetch history.
      const result = await store.upsertStateUpdateSnapshot({ ...scope, complete: false, items: response.items, latest: [] });
      const current = response.items[0].current;
      if (result.contentVerified !== true || result.persistedRemoteEventCount !== (current ? 1 : 0)) {
        throw new Error("STATE_UPDATE_CURRENT_CONTENT_UNVERIFIED");
      }
      coverage.subjects[subjectRecordId] = { status: "verified", remoteRecordId: current?.recordId ?? null };
    } catch {
      failed = true;
      coverage.subjects[subjectRecordId] = { status: "failed" };
    }
    await writeCoverage();
  });
  const verified = Object.values(coverage.subjects).filter(subject => subject.status === "verified").length;
  coverage.status = !signal?.aborted && !failed && coverage.sourceComplete && verified === sourceRemoteTotal ? "complete" : "partial";
  await writeCoverage();
  if (failed) throw new Error("STATE_UPDATE_CURRENT_PREPARATION_FAILED");
}
