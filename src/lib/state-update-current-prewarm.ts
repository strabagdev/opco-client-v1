import { compositeIdentityKey } from "./state-update-identity";
import type { OpcoApi, StateUpdateCurrentBatchCapabilities } from "./opco-api";
import type { OfflineRecordStore } from "./offline-records";
import type { StateUpdateCurrentCoverage, StateUpdateCurrentCoverageScope, StateUpdateOfflineStore } from "./state-update-offline";

type CurrentPreparationStore = Pick<OfflineRecordStore, "listCachedRecords"> &
  Pick<StateUpdateOfflineStore, "setStateUpdateCurrentCoverage" | "upsertStateUpdateSnapshot">;

/** Complete source refresh first; latest and filtered search never certify current. */
export async function prepareStateUpdateCurrent({
  api, token, scope, store, sourceRemoteTotal, sourceFetched, sourceCacheTotal,
  runWithConcurrency, concurrency, signal, currentBatchCapabilities, retainCoverageUntilComplete = false,
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
  currentBatchCapabilities?: StateUpdateCurrentBatchCapabilities;
  signal?: AbortSignal;
  /** A refresh must not replace an existing usable marker with its unfinished attempt. */
  retainCoverageUntilComplete?: boolean;
}) {
  const started = Date.now();
  const coverage: StateUpdateCurrentCoverage = {
    status: "partial", sourceComplete: false, totalSubjects: sourceCacheTotal,
    subjects: {}, requestCount: 0, durationMs: 0, refreshedAt: new Date().toISOString(),
  };
  const writeCoverage = () => retainCoverageUntilComplete && coverage.status !== "complete"
    ? Promise.resolve() : store.setStateUpdateCurrentCoverage({ ...scope, coverage: {
    ...coverage, subjects: { ...coverage.subjects }, durationMs: Date.now() - started,
  } });
  await writeCoverage();
  if (scope.scheduleBindingId) {
    const response=await api.getStateUpdateWorkflow(token,scope.contractId,scope.appViewId,{date:scope.date,identity:scope.identity,pageSize:1});
    if (signal?.aborted) return;
    if (response.appView.id!==scope.appViewId || response.targetEntityType.id!==scope.targetEntityTypeId || response.date!==scope.date ||
      compositeIdentityKey(response.identityContext)!==compositeIdentityKey(scope.identity) || response.schedulePolicy?.bindingId!==scope.scheduleBindingId) throw new Error("SCHEDULE_CONTEXT_RESPONSE_MISMATCH");
    await store.upsertStateUpdateSnapshot({...scope,complete:false,items:[],latest:[],schedulePolicy:response.schedulePolicy,scheduleResolution:response.scheduleResolution});
  }
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
  if (currentBatchCapabilities && (currentBatchCapabilities.version !== 1 || !Number.isInteger(currentBatchCapabilities.maxSubjects) || currentBatchCapabilities.maxSubjects < 1 || !/^[a-f0-9]{64}$/.test(currentBatchCapabilities.configurationFingerprint))) throw new Error("CURRENT_BATCH_CAPABILITY_INCOMPATIBLE");
  const batchSize = currentBatchCapabilities ? Math.min(100,currentBatchCapabilities.maxSubjects) : 1;
  if (currentBatchCapabilities) coverage.requestBatchSize = batchSize;
  const subjects = [...ids];
  const batches = Array.from({length:Math.ceil(subjects.length/batchSize)},(_,index)=>subjects.slice(index*batchSize,(index+1)*batchSize));
  await runWithConcurrency(batches, concurrency, async batch => {
    if (signal?.aborted) return;
    coverage.requestCount++;
    let response: Awaited<ReturnType<OpcoApi["getStateUpdateWorkflow"]>>;
    try {
      response = await api.getStateUpdateWorkflow(token, scope.contractId, scope.appViewId,
        { date: scope.date, identity: scope.identity, ...(currentBatchCapabilities
          ? {subjectRecordIds:batch,currentBatchCapabilities} : {subjectRecordId:batch[0],pageSize:1}) });
      if (signal?.aborted) return;
      if (response.appView.id!==scope.appViewId || response.date!==scope.date ||
        (scope.identity && compositeIdentityKey(response.identityContext)!==compositeIdentityKey(scope.identity)) ||
        response.targetEntityType.id!==scope.targetEntityTypeId || response.sourceEntityType.id!==scope.sourceEntityTypeId ||
        response.dateFieldId!==scope.dateFieldId || response.uniqueness!==scope.uniqueness || response.historyMode!==scope.historyMode ||
        (scope.scheduleBindingId && response.schedulePolicy?.bindingId!==scope.scheduleBindingId)) throw new Error("STATE_UPDATE_CURRENT_RESPONSE_MISMATCH");
      if (currentBatchCapabilities) {
        const proof=response.currentBatch;
        if (response.contractId!==scope.contractId || proof?.version!==1 || JSON.stringify(proof.requestedSubjectIds)!==JSON.stringify(batch) ||
          response.currentBatchCapabilities?.configurationFingerprint!==currentBatchCapabilities.configurationFingerprint ||
          proof.results.length!==batch.length || new Set(proof.results.map(item=>item.subjectRecordId)).size!==batch.length ||
          proof.results.some(item=>!batch.includes(item.subjectRecordId) || !["resolved","error"].includes(item.status))) throw new Error("CURRENT_BATCH_RESPONSE_INCOMPLETE");
        const resolved=proof.results.filter(item=>item.status==="resolved").map(item=>item.subjectRecordId);
        if(response.items.length!==resolved.length || new Set(response.items.map(item=>item.subject.id)).size!==resolved.length ||
          response.items.some(item=>!resolved.includes(item.subject.id) || !Object.prototype.hasOwnProperty.call(item,"current") || item.current===undefined)) throw new Error("CURRENT_BATCH_RESPONSE_INCOMPLETE");
      } else if (response.items.length!==1 || response.items[0].subject.id!==batch[0] || response.items[0].current===undefined) throw new Error("STATE_UPDATE_CURRENT_RESPONSE_MISMATCH");
    } catch {
      failed=true;
      for(const id of batch) coverage.subjects[id]={status:"failed"};
      await writeCoverage(); return;
    }
    // One subject's persistence failure never certifies null or prevents other verified results from being kept.
    for(const subjectRecordId of batch) {
      if(signal?.aborted) return;
      try {
        if(response.currentBatch?.results.find(item=>item.subjectRecordId===subjectRecordId)?.status==="error") throw new Error("CURRENT_SUBJECT_UNAVAILABLE");
        const item=response.items.find(item=>item.subject.id===subjectRecordId);
        if(!item) throw new Error("CURRENT_SUBJECT_OMITTED");
        const result=await store.upsertStateUpdateSnapshot({...scope,complete:false,
          subjectPresentation:response.subjectPresentation,schedulePolicy:response.schedulePolicy,scheduleResolution:response.scheduleResolution,projectionDefinition:{
            sourceEntityTypeId:response.sourceEntityType.id,subjectFieldId:response.subjectFieldId,
            identityFields:response.identityFields,identityDefinition:response.identityDefinition,dateFieldId:response.dateFieldId,
            stateFields:response.stateFields,extraFields:response.extraFields,
          },items:[item],latest:[]});
        if(result.contentVerified!==true || result.persistedRemoteEventCount!==(item.current?1:0)) throw new Error("STATE_UPDATE_CURRENT_CONTENT_UNVERIFIED");
        coverage.subjects[subjectRecordId]={status:"verified",remoteRecordId:item.current?.recordId??null};
      } catch { failed=true; coverage.subjects[subjectRecordId]={status:"failed"}; }
      await writeCoverage();
    }
  });
  const verified = Object.values(coverage.subjects).filter(subject => subject.status === "verified").length;
  coverage.status = !signal?.aborted && !failed && coverage.sourceComplete && verified === sourceRemoteTotal ? "complete" : "partial";
  await writeCoverage();
  if (failed) throw new Error("STATE_UPDATE_CURRENT_PREPARATION_FAILED");
  return coverage;
}
