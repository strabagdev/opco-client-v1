import {compositeIdentityKey} from "./state-update-identity";
import type {StateUpdateCurrentCoverageScope} from "./state-update-offline";
import {genericPreparationRequest,matchesPreparationRequest} from "./preparation-revision-contract";
import {canConsumeAttendanceReceipt,canConsumeGenericReceipt} from "./revision-negotiation";
import {recordSelectiveReuseDiagnostic} from "./selective-reuse";
import {catalogDependencies,catalogRootIds,catalogSupported} from "./catalog-revision-contract";
import type {CatalogPlan} from "./catalog-revision-storage";
import {refreshEntityRecordsCache} from "./offline-records";
import {completeAttendanceDay} from "./attendance-day-pages";
import type { AppViewPrewarmStore } from "./app-view-prewarm";
import { attendanceDiagnosticOperation, stateUpdateReadDiagnosticOperation, type OpcoDiagnosticRequestOperation, type AppView, type AppViewsResponse, type AttendanceResponse, type AttendanceWorkflowConfig, type EntityDefinitionResponse, type EntityRecord, type EntityRecordsResponse, type OpcoApi, type StateUpdateResponse } from "./opco-api";
import type { PreparedAppViewDefinition, UpsertAppViewDefinitionInput } from "./app-view-definitions-cache";
import { normalizePreparedAppViewDefinition } from "./app-view-definitions-cache";
import { currentMonthDateKeys,attendancePreparationPeriod } from "./attendance-snapshot-cache";
import { attendanceLatestObservationIsBound, isAttendanceRemoteSnapshotComplete } from "../renderers/workflows/attendance/attendance-workflow-logic";
import { workflowReceiptMaterialization } from "./revision-receipt-shadow";
import type { RevisionReceiptStore } from "./revision-receipt-storage";
import type { PreparationCoverage, PreparationMarker, PreparationPart, PreparationPlan, PreparationRevisionContext } from "./preparation-revision-contract";
import { assertRevisionMatches, assertRevisionScope, revisionCanonical, revisionHash, validateRevisionDownload, RevisionReceiptError, type RevisionDownload, type RevisionResource } from "./revision-receipts";

type BusinessApi = Pick<OpcoApi, "getAttendanceWorkflow" | "getStateUpdateWorkflow" | "getEntityDefinition" | "getEntityRecords">;
export type PreparationRevisionApi = BusinessApi & Partial<Pick<OpcoApi, "getOfflineRevisionManifest" | "getRevisionRead" | "selectiveReuseEnabled" | "genericReuseEnabled">>;
type Store = AppViewPrewarmStore & Partial<RevisionReceiptStore>;
type Input = { api: PreparationRevisionApi; store: Store; token: string; ownerKey: string; contractId: string; appViews: AppView[]; runId: string; signal?: AbortSignal; contextScope?:StateUpdateCurrentCoverageScope; contextPrepared?:PreparedAppViewDefinition };
const generations = new WeakMap<object, Map<string,object>>();
const same = (a: unknown, b: unknown) => revisionCanonical(a) === revisionCanonical(b);
function requireProof(value: unknown, code: string): asserts value {if (!value) throw new RevisionReceiptError(code);}
function errorCode(error: unknown) {
  const code = error instanceof RevisionReceiptError ? error.code : error && typeof error === "object" && "code" in error ? error.code : null;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : "PREPARATION_REVISION_FAILED";
}
function scalarQuery(query: Record<string, unknown> = {}): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const key of ["date", "page", "pageSize", "sort", "direction", "fieldIdHasValue", "subjectRecordId", "personRecordId", "searchFieldId"]) {
    const value = query[key]; if (value !== undefined) result[key] = String(value);
  }
  if (typeof query.search === "string" && query.search.trim()) {result.search = query.search.trim(); result.searchComparisonVersion = "1";}
  if (query.identity) result.identity = JSON.stringify(query.identity);
  if (Array.isArray(query.subjectRecordIds)) {
    result.subjectRecordIds = query.subjectRecordIds as string[]; result.currentBatchVersion = "1";
    result.currentBatchFingerprint = (query.currentBatchCapabilities as {configurationFingerprint: string}).configurationFingerprint;
  }
  return result;
}
function frame(resource: RevisionResource) {
  const query = {...resource.query}; delete query.page;
  if (resource.kind === "state-update") delete query.subjectRecordIds;
  return revisionCanonical({...resource, query});
}
function workflowScope(input: Input, appView: AppView, response: AttendanceResponse | StateUpdateResponse, prepared: Extract<PreparedAppViewDefinition, {kind: "state-update"}>) {
  return {ownerKey: input.ownerKey, contractId: input.contractId, appViewId: appView.id,
    sourceEntityTypeId: response.sourceEntityType.id, targetEntityTypeId: response.targetEntityType.id,
    date: response.date, dateFieldId: prepared.dateFieldId, uniqueness: prepared.uniqueness, historyMode: prepared.historyMode};
}
/** Uses existing downloads, writers and scheduling. Omission requires the independent negotiated Attendance or generic gate plus a verified receipt. */
export async function createPreparationRevisionRun(input: Input) {
  const fallback = {validatedReuseIds(){return [] as string[];},async tryReuseAttendance(_view:AppView){return false;},async tryReusePreparation(_view:AppView){return false;},recording:false,async prepareCatalogs() {},api: input.api as BusinessApi, store: input.store, viewResult(_id: string, _result: string) {}, async finish() {return [] as string[];}};
  const store = input.store;
  if (!store.commitPreparationRevisionReceipt || !store.retirePreparationRevisionReceipts || !store.recordPreparationRevisionStatus ||
      !store.beginRevisionReceiptSession || !input.api.getOfflineRevisionManifest || !input.api.getRevisionRead) return fallback;
  const identity = store.getOfflinePreparationCoordinatorKey?.() ?? store, generation = {};
  const slot=input.contextScope?"context:"+revisionCanonical(input.contextScope):"ordinary";
  let slots=generations.get(identity);if(!slots){slots=new Map();generations.set(identity,slots);}slots.set(slot,generation);
  const current = () => !input.signal?.aborted && slots!.get(slot) === generation;
  const status = async (state: "emitted" | "rejected" | "unavailable", reason: string | null, appViewId?: string) => {
    try {if (current()) await store.recordPreparationRevisionStatus!(input.ownerKey, input.contractId, {runId: input.runId, appViewId, status: state, reason});} catch { /* Observability cannot alter preparation/outbox. */ }
  };
  const normalizedHashes = new WeakMap<RevisionDownload,string>();
  const attendanceDays = new Map<string,{response:AttendanceResponse;pages:RevisionDownload[]}>();
  const downloads: RevisionDownload[] = [], definitions = new Map<string, PreparedAppViewDefinition>(), outcomes = new Map<string, string>();
  if(input.contextPrepared)definitions.set(input.contextPrepared.appView.id,input.contextPrepared);
  const reused=new Set<string>(),reusedCatalogs=new Set<string>();let reuseValidated=false;
  const reuseDates=currentMonthDateKeys(new Date());
  const negotiationOptions={...(input.api.selectiveReuseEnabled?{selectiveReuse:true,month:reuseDates[0].slice(0,7)}:{}),...(input.api.genericReuseEnabled?{genericReuse:true}:{})};
  let context: PreparationRevisionContext, views: RevisionDownload;
  try {
    const manifest = await input.api.getOfflineRevisionManifest(input.token, input.contractId,{ownerKey:input.ownerKey,isCurrent:current,...negotiationOptions});
    const scope = {...manifest.scope, ownerKey: input.ownerKey}; assertRevisionScope(scope, manifest);
    requireProof(current(), "REVISION_SCOPE_RETIRED");
    context = {scope, manifest, runId: input.runId, sessionId: crypto.randomUUID(), isCurrent: current};
    await store.beginRevisionReceiptSession(context);
    // Compare before ordinary writers run. A refresh attempt alone does not invalidate an intact proof.
    await store.inspectPreparationRevisionReceipts?.({scope, manifest, isCurrent: current});
    await store.inspectCatalogRevisionReceipts?.({scope, manifest, isCurrent: current});
    // Home's existing /views handoff has no seal. This single diagnostic binding read never changes it.
    views = await input.api.getRevisionRead(input.token, input.contractId, {kind: "views"});
    assertRevisionMatches(manifest, views.readRevision);
    requireProof(same((views.normalized as AppViewsResponse).views, input.appViews), "PREPARATION_ASSIGNMENTS_CHANGED");
    normalizedHashes.set(views, await revisionHash(views.normalized));
    requireProof(current(), "REVISION_SCOPE_RETIRED");
  } catch (error) {
    if (current() && ([401,403].includes(Number(error && typeof error === "object" && "status" in error ? error.status : null)) || errorCode(error) === "REVISION_SCOPE_MISMATCH")) {
      // Known denial withdraws proof for this attempt only; cached business data stays available.
      try {
        await store.retirePreparationRevisionReceipts(input.ownerKey,input.contractId,"REVISION_AUTHORIZATION_REJECTED",current);
        await store.retireCatalogRevisionReceipts?.({ownerKey:input.ownerKey,contractId:input.contractId},current);
      } catch { await status("unavailable","REVISION_WITHDRAWAL_FAILED"); }
    }
    await status("unavailable", errorCode(error));
    const statusCode = error && typeof error === "object" && "status" in error ? error.status : null;
    if ([401,403].includes(Number(statusCode)) || ["REVISION_SCOPE_MISMATCH","PREPARATION_ASSIGNMENTS_CHANGED"].includes(errorCode(error))) {
      const deny = async (): Promise<never> => {throw new RevisionReceiptError(errorCode(error));};
      return {...fallback, api: {getEntityDefinition: deny, getEntityRecords: deny, getAttendanceWorkflow: deny, getStateUpdateWorkflow: deny}};
    }
    return fallback; // Explicit diagnostic downgrade: ordinary legacy preparation remains available.
  }
  const revisions = new Map<string, string>();
  async function read(resource: RevisionResource, diagnostics: {diagnosticOperation?: OpcoDiagnosticRequestOperation;diagnosticSyncRunId?: string | null} = {}) {
    requireProof(current(), "REVISION_SCOPE_RETIRED");
    const page = Number(resource.query?.page ?? 1), expected = page > 1 ? revisions.get(frame(resource)) : undefined;
    requireProof(page <= 1 || expected, "READ_REVISION_REQUIRED");
    const result = await input.api.getRevisionRead!(input.token, input.contractId, resource, expected, diagnostics);
    // Independent ordinary queries may observe a later data vector. Keep their downloads;
    // only final composition rejects mixed vectors. Authorization/epoch and pagination still fence writes.
    requireProof(result.readRevision.authorizationFingerprint === context.scope.authorizationFingerprint, "REVISION_AUTHORIZATION_CHANGED");
    requireProof(result.readRevision.epoch === context.manifest.epoch, "REVISION_REMOTE_CHANGED");
    const previous = revisions.get(frame(resource));
    requireProof(page <= 1 || !previous || previous === result.readRevision.revision, "REVISION_PAGES_MIXED");
    requireProof(current(), "REVISION_SCOPE_RETIRED");
    revisions.set(frame(resource), result.readRevision.revision);
    if (resource.kind === "records") {
      const data = result.normalized as EntityRecordsResponse, p = data.pagination;
      requireProof(p && p.page === page && p.pageSize === Number(resource.query?.pageSize ?? 100) && Number.isInteger(p.total) && p.total >= 0 &&
        p.totalPages === Math.max(1, Math.ceil(p.total / p.pageSize)) && data.records.length === Math.min(p.pageSize, Math.max(0, p.total - (page - 1) * p.pageSize)), "REVISION_COVERAGE_INCOMPLETE");
      const first = downloads.find(d => d.resource.kind === "records" && frame(d.resource) === frame(resource));
      requireProof(!first || (first.normalized as EntityRecordsResponse).pagination.total === p.total, "REVISION_COVERAGE_INCOMPLETE");
    }
    normalizedHashes.set(result, await revisionHash(result.normalized));
    downloads.push(result);
    return result.normalized;
  }
  const api: BusinessApi = {
    getEntityDefinition: async (_token, contract, entityTypeId) => {requireProof(contract === input.contractId, "REVISION_SCOPE_MISMATCH"); return await read({kind: "definition", entityTypeId}) as EntityDefinitionResponse;},
    getEntityRecords: async (_token, contract, entityTypeId, query = {}) => {requireProof(contract === input.contractId, "REVISION_SCOPE_MISMATCH"); const q = scalarQuery(query); delete q.searchComparisonVersion; return await read({kind: "records", entityTypeId, query: q}) as EntityRecordsResponse;},
    getAttendanceWorkflow: async (_token, contract, appViewId, query, diagnosticOperation, diagnosticSyncRunId) => {
      requireProof(contract === input.contractId, "REVISION_SCOPE_MISMATCH"); const normalized = typeof query === "string" ? {date: query} : query;
      const diagnostics={diagnosticOperation:diagnosticOperation ?? attendanceDiagnosticOperation(normalized),diagnosticSyncRunId};
      const seed=await read({kind:"attendance",appViewId,query:scalarQuery(normalized)},diagnostics) as AttendanceResponse;
      if(normalized.search?.trim() || normalized.personRecordId || normalized.searchFieldId!==undefined)return seed;
      const completed=await completeAttendanceDay({seed,ownerKey:input.ownerKey,contractId:contract,appViewId,isCurrent:current,readPage:async(resource,expected)=>{
        const value=await read(resource,diagnostics);const download=downloads.find(d=>d.normalized===value)!;
        requireProof(!expected || download.readRevision.revision===expected,"REVISION_PAGES_MIXED");return download;
      }});
      attendanceDays.set(appViewId+":"+seed.date,completed);
      return completed.response;
    },
    getStateUpdateWorkflow: async (_token, contract, appViewId, query = {}, options = {}) => {
      requireProof(contract === input.contractId, "REVISION_SCOPE_MISMATCH");
      return await read({kind: "state-update", appViewId, query: scalarQuery(query)}, {diagnosticOperation: query.subjectRecordIds || query.subjectRecordId?.trim() ? "RECONCILE" : stateUpdateReadDiagnosticOperation(query), diagnosticSyncRunId: options.diagnosticSyncRunId}) as StateUpdateResponse;
    },
  };
  const observedStore: Store = {...store, async upsertAppViewDefinition(value: UpsertAppViewDefinitionInput) {
    await store.upsertAppViewDefinition(value);
    if (current() && value.status === "ready") definitions.set(value.appViewId, normalizePreparedAppViewDefinition(value.definition));
  }};
  function definitionPart(entityTypeId: string): PreparationPart {
    const d = downloads.find(d => d.resource.kind === "definition" && d.resource.entityTypeId === entityTypeId);
    requireProof(d, "PREPARATION_METADATA_UNBOUND");
    return {resource: d.resource, artifact: {kind: "definition", entityTypeId}, reads: [d.readRevision], expected: {json: (d.normalized as EntityDefinitionResponse).entity}};
  }
  function collection(entityTypeId: string): PreparationPart {
    const ds = downloads.filter(d => d.resource.kind === "records" && d.resource.entityTypeId === entityTypeId).sort((a,b) => Number(a.resource.query?.page) - Number(b.resource.query?.page));
    requireProof(ds.length > 0, "PREPARATION_SOURCE_UNBOUND");
    const first = ds[0].normalized as EntityRecordsResponse, p = first.pagination;
    const records = ds.flatMap(d => (d.normalized as EntityRecordsResponse).records);
    requireProof(ds.length === p.totalPages && ds.every((d,index) => (d.normalized as EntityRecordsResponse).pagination.page === index + 1) &&
      records.length === p.total && new Set(records.map(r => r.id)).size === p.total, "REVISION_COVERAGE_INCOMPLETE");
    return {resource: {kind: "records", entityTypeId, query: {pageSize: String(p.pageSize)}}, artifact: {kind: "records", entityTypeId, total: p.total}, reads: ds.map(d => d.readRevision), expected: {records: records as EntityRecord[]}};
  }
  function plan(appView: AppView): PreparationPlan {
    requireProof(outcomes.get(appView.id) === "success" || outcomes.get(appView.id) === "skipped", "PREPARATION_EXPERIENCE_FAILED");
    requireProof(same((views.normalized as AppViewsResponse).views.find(view=>view.id === appView.id), appView), "PREPARATION_ASSIGNMENTS_CHANGED");
    const prepared = definitions.get(appView.id); requireProof(prepared, "PREPARATION_DEFINITION_UNAVAILABLE");
    const parts: PreparationPart[] = [{resource: views.resource, artifact: {kind: "views"}, expected: {json: (views.normalized as AppViewsResponse).views}, reads: [views.readRevision]}];
    const coverage: PreparationCoverage = {version: 1, kind: "metadata-only", complete: true, scope: "ordinary-preparation", businessDataIncluded: false, arbitraryQueries: false, relationCatalogs: false, latest: "not-included", dates: []};
    const markers: PreparationMarker[] = [];
    if (appView.type === "RECORDS") {parts.push(definitionPart(appView.config.entityTypeId)); return {appView, prepared, coverage, parts, markers};}
    if (appView.type === "PANEL" || appView.type === "REPORT") return {appView, prepared, coverage, parts, markers};
    requireProof(appView.type === "WORKFLOW" && prepared.kind === "state-update", "PREPARATION_RENDERER_UNSUPPORTED");
    const workflowReads = downloads.filter(d => d.resource.appViewId === appView.id);
    requireProof(workflowReads.length > 0, "PREPARATION_WORKFLOW_UNBOUND");
    const initial = workflowReads[0].normalized as StateUpdateResponse | AttendanceResponse;
    requireProof(initial.appView.id === appView.id && initial.sourceEntityType.id === prepared.sourceEntityTypeId && initial.targetEntityType.id === prepared.targetEntityTypeId, "PREPARATION_DEFINITION_MISMATCH");
    parts.push(definitionPart(prepared.sourceEntityTypeId), collection(prepared.sourceEntityTypeId));
    coverage.sourceEntityTypeId = prepared.sourceEntityTypeId; coverage.subjectCount = (parts[parts.length - 1].artifact as {total: number}).total;
    if (prepared.uniqueness === "subject-date-fields"&&!input.contextScope) {coverage.kind = "context-required"; return {appView, prepared, coverage, parts, markers};}
    if (appView.config.workflowKey === "attendance") {
      coverage.kind = "attendance-month"; coverage.businessDataIncluded = true; coverage.latest = "complete-snapshot";
      const anchor = (initial as AttendanceResponse).date; requireProof(/^\d{4}-\d{2}-\d{2}$/.test(anchor), "PREPARATION_CONTEXT_MISMATCH");
      coverage.dates = currentMonthDateKeys(new Date(anchor + "T12:00:00"));
      requireProof(new Set(workflowReads.map(d => (d.normalized as AttendanceResponse).date)).size === coverage.dates.length, "PREPARATION_DAYS_INCOMPLETE");
      for (const date of coverage.dates) {
        const d = workflowReads.find(d => (d.normalized as AttendanceResponse).date === date); requireProof(d, "PREPARATION_DAYS_INCOMPLETE");
        const completed=attendanceDays.get(appView.id+":"+date);requireProof(completed,"PREPARATION_DAYS_INCOMPLETE");
        const data=completed.response;requireProof(isAttendanceRemoteSnapshotComplete(data),"PREPARATION_DAY_INCOMPLETE");
        if ((appView.config as AttendanceWorkflowConfig).observationFieldId) requireProof(data.latest.every(event => attendanceLatestObservationIsBound(event, data.observationProjection, (appView.config as AttendanceWorkflowConfig).observationFieldId) || data.items.some(item => item.attendance?.recordId === event.attendanceRecordId && item.attendance.updatedAt === event.updatedAt && Object.hasOwn(item.attendance, "observation") && (item.attendance.observation === null || typeof item.attendance.observation === "string"))), "PREPARATION_OBSERVATION_UNBOUND");
        const scope = {...workflowScope(input, appView, data, prepared), date};
        const materialized = workflowReceiptMaterialization(scope, data, appView.config as AttendanceWorkflowConfig);
        const bound=completed.pages.length?completed.pages:[d];
        parts.push({...materialized, artifact: {...materialized.artifact, completeEventIds: materialized.artifact.eventIds}, resource:bound[0].resource, reads:bound.map(page=>page.readRevision)});markers.push({kind:"attendance",scope});
      }
    } else {
      const data = initial as StateUpdateResponse, scope:StateUpdateCurrentCoverageScope = input.contextScope??workflowScope(input, appView, data, prepared);
      if(input.contextScope)requireProof(scope.appViewId===appView.id&&scope.sourceEntityTypeId===data.sourceEntityType.id&&scope.targetEntityTypeId===data.targetEntityType.id&&scope.date===data.date&&scope.uniqueness===data.uniqueness&&scope.historyMode===data.historyMode&&compositeIdentityKey(scope.identity)===compositeIdentityKey(data.identityContext)&&(!scope.scheduleBindingId||scope.scheduleBindingId===data.schedulePolicy?.bindingId),"PREPARATION_CONTEXT_MISMATCH");
      requireProof(!data.contextRequired, "PREPARATION_CONTEXT_REQUIRED");
      const fullCurrent = !!input.contextScope || prepared.uniqueness === "subject" && prepared.historyMode === "append" && !!prepared.dateFieldId;
      coverage.kind = fullCurrent ? "state-update-current" : "state-update-snapshot";
      coverage.businessDataIncluded = true; coverage.latest = fullCurrent ? "bounded-first-page" : "complete-snapshot"; coverage.dates = scope.date ? [scope.date] : [];
      if (!fullCurrent) requireProof(data.latestPagination?.page === 1 && !data.latestPagination.hasMore && data.latestPagination.total === (data.latest?.length ?? 0), "PREPARATION_LATEST_INCOMPLETE");
      for (const d of workflowReads) {
        const value = d.normalized as StateUpdateResponse, materialized = workflowReceiptMaterialization(scope, value);
        parts.push({...materialized, artifact: fullCurrent ? materialized.artifact : {...materialized.artifact, completeEventIds: materialized.artifact.eventIds}, resource: d.resource, reads: [d.readRevision]});
      }
      if (fullCurrent) {
        const subjects: Record<string, string | null> = {};
        for (const d of workflowReads.filter(d => d.resource.query?.subjectRecordId || d.resource.query?.subjectRecordIds)) for (const item of (d.normalized as StateUpdateResponse).items) {
          requireProof(!Object.hasOwn(subjects, item.subject.id), "PREPARATION_CURRENT_DUPLICATE"); subjects[item.subject.id] = item.current?.recordId ?? null;
        }
        const source = parts.find(p => p.artifact.kind === "records")!.expected.records!;
        requireProof(Object.keys(subjects).length === source.length && source.every(s => Object.hasOwn(subjects, s.id)), "PREPARATION_CURRENT_INCOMPLETE");
        markers.push({kind: "current", scope, subjects});
      } else markers.push({kind: "snapshot", scope, total: data.latestPagination!.total});
    }
    return {appView, prepared, coverage, parts, markers};
  }
  async function checkReuse(appView:AppView,manifest=context.manifest){
    if(!input.api.selectiveReuseEnabled||appView.type!=="WORKFLOW"||appView.config.workflowKey!=="attendance"||!store.inspectPreparationRevisionReceipts)return null;
    let accepted:PreparedAppViewDefinition|null=null;
    await store.inspectPreparationRevisionReceipts({scope:context.scope,manifest,isCurrent:current,
      request:{appViewId:appView.id,kind:"attendance-month",dates:appView.config.operationalCalendar?attendancePreparationPeriod(new Date(),(appView.config as AttendanceWorkflowConfig).operationalCalendar).dates:reuseDates,definition:appView},
      onVerified:async(receipt,storage,prepared)=>{
        if(receipt.coverage.businessDataIncluded && receipt.coverage.latest==="complete-snapshot" &&
           await canConsumeAttendanceReceipt({manifest,receipt,storage,isCurrent:current}))accepted=prepared;
      }});
    return current()?accepted:null;
  }
  async function tryReuseAttendance(appView:AppView){
    if(!input.api.selectiveReuseEnabled)return false;
    try{
      const prepared=await checkReuse(appView);
      if(!prepared){recordSelectiveReuseDiagnostic("NORMAL_DOWNLOAD");return false;}
      definitions.set(appView.id,prepared);reused.add(appView.id);
      recordSelectiveReuseDiagnostic("ATTENDANCE_REUSED",true);return true;
    }catch{recordSelectiveReuseDiagnostic("NORMAL_DOWNLOAD");return false;}
  }
  async function checkGenericPreparation(appView:AppView,manifest=context.manifest){
    if(!input.api.genericReuseEnabled||!store.inspectPreparationRevisionReceipts)return null;
    let accepted:PreparedAppViewDefinition|null=null;
    await store.inspectPreparationRevisionReceipts({scope:context.scope,manifest,isCurrent:current,
      appViewId:appView.id,
      onVerified:async(receipt,storage,prepared)=>{
        const request=input.contextScope?{appViewId:appView.id,kind:"state-update-current" as const,dates:input.contextScope.date?[input.contextScope.date]:[],identity:input.contextScope.identity,definition:appView}:genericPreparationRequest(appView,prepared);
        if(request&&request.kind!=="attendance-month"&&matchesPreparationRequest(receipt,request,prepared)&&await canConsumeGenericReceipt({manifest,receipt,appViewId:appView.id,kind:request.kind,storage,isCurrent:current}))accepted=prepared;
      }});
    return current()?accepted:null;
  }
  async function tryReusePreparation(appView:AppView){
    if(appView.type==="WORKFLOW"&&appView.config.workflowKey==="attendance")return tryReuseAttendance(appView);
    try{
      const prepared=await checkGenericPreparation(appView);
      if(!prepared)return false;
      definitions.set(appView.id,prepared);reused.add(appView.id);recordSelectiveReuseDiagnostic("PREPARATION_REUSED",true);return true;
    }catch{return false;}
  }
  async function checkCatalogReuse(appView:AppView,manifest=context.manifest){
    if(!input.api.genericReuseEnabled||!store.inspectCatalogRevisionReceipts)return false;
    let accepted=false;
    await store.inspectCatalogRevisionReceipts({scope:context.scope,manifest,appViewId:appView.id,isCurrent:current,
      onVerified:async(receipt,storage,prepared)=>{
        if(same(prepared.appView,appView)&&await canConsumeGenericReceipt({manifest,receipt,appViewId:appView.id,kind:"field-options-and-direct-catalogs",storage,isCurrent:current}))accepted=true;
      }});
    return current()&&accepted;
  }
  const catalogPlans=new Map<string,CatalogPlan>(),catalogDefinitions=new Map<string,Promise<void>>(),catalogCollections=new Map<string,Promise<void>>();
  const loadCatalogDefinition=(id:string)=>{
    let promise=catalogDefinitions.get(id);if(promise)return promise;
    promise=(async()=>{
      const existing=downloads.find(d=>d.resource.kind==="definition"&&d.resource.entityTypeId===id);
      const value=existing?.normalized??await read({kind:"definition",entityTypeId:id});
      requireProof(current(),"REVISION_SCOPE_RETIRED");
      await store.upsertEntityDefinition(input.contractId,id,(value as EntityDefinitionResponse).entity,new Date().toISOString());
      requireProof(current(),"REVISION_SCOPE_RETIRED");
    })();catalogDefinitions.set(id,promise);return promise;
  };
  const loadCatalogCollection=(id:string)=>{
    let promise=catalogCollections.get(id);if(promise)return promise;
    promise=(async()=>{
      const prior=downloads.filter(d=>d.resource.kind==="records"&&d.resource.entityTypeId===id);
      if(prior.length){requireProof(prior.every(d=>Object.keys(d.resource.query??{}).every(k=>["page","pageSize"].includes(k))),"CATALOG_COVERAGE_INCOMPATIBLE");collection(id);return;}
      await refreshEntityRecordsCache({api:{getEntityRecords:async(_token,_contract,entity,query)=>{
        requireProof(_contract===input.contractId&&entity===id,"REVISION_SCOPE_MISMATCH");
        return await read({kind:"records",entityTypeId:id,query:scalarQuery(query)}) as EntityRecordsResponse;
      }},store,ownerKey:input.ownerKey,contractId:input.contractId,entityTypeId:id,token:input.token,isActive:current,suppressNetworkTelemetry:true});
      collection(id);
    })();catalogCollections.set(id,promise);return promise;
  };
  async function prepareCatalogs(){
    if(!store.commitCatalogRevisionReceipt)return;
    for(const view of input.appViews){
      if(!catalogSupported(view)||!outcomes.has(view.id))continue;
      try{
        requireProof(current(),"REVISION_SCOPE_RETIRED");
        if(await checkCatalogReuse(view)){reusedCatalogs.add(view.id);recordSelectiveReuseDiagnostic("CATALOG_REUSED",true);continue;}
        const prepared=definitions.get(view.id);requireProof(prepared,"CATALOG_DEFINITION_UNAVAILABLE");
        const roots=catalogRootIds(view);for(const id of roots)await loadCatalogDefinition(id);
        const entities=new Map(downloads.filter(d=>d.resource.kind==="definition").map(d=>[d.resource.entityTypeId!, (d.normalized as EntityDefinitionResponse).entity]));
        const dependencies=catalogDependencies(view,prepared,entities);
        const targets=[...new Set(dependencies.flatMap(d=>d.targetEntityTypeId?[d.targetEntityTypeId]:[]))];
        for(const id of targets){await loadCatalogDefinition(id);await loadCatalogCollection(id);}
        const parts:PreparationPart[]=[{resource:views.resource,artifact:{kind:"views"},expected:{json:(views.normalized as AppViewsResponse).views},reads:[views.readRevision]}];
        for(const id of new Set([...roots,...targets]))parts.push(definitionPart(id));
        for(const id of targets)parts.push(collection(id));
        catalogPlans.set(view.id,{appView:view,prepared,dependencies,parts});
      }catch(error){await status("rejected",errorCode(error),view.id);}
    }
  }
  return {recording:true,api, store: observedStore,prepareCatalogs,tryReuseAttendance,tryReusePreparation,validatedReuseIds:()=>reuseValidated&&current()?[...reused]:[], viewResult(id: string, result: string) {outcomes.set(id, result);}, async finish() {
    try {
      requireProof(current(), "REVISION_SCOPE_RETIRED");
      const manifest = await input.api.getOfflineRevisionManifest!(input.token, input.contractId,{ownerKey:input.ownerKey,isCurrent:current,expected:context.manifest,...negotiationOptions}); assertRevisionScope(context.scope, manifest);
      for (const d of [views, ...downloads]) {
        await validateRevisionDownload({data: d.data, readRevision: d.readRevision});
        requireProof(await revisionHash(d.normalized) === normalizedHashes.get(d), "PREPARATION_RESPONSE_MUTATED");
        assertRevisionMatches(manifest, d.readRevision);
      }
      for(const id of reused){
        const view=input.appViews.find(view=>view.id===id)!;
        requireProof(await (view.type==="WORKFLOW"&&view.config.workflowKey==="attendance"?checkReuse(view,manifest):checkGenericPreparation(view,manifest)),"SELECTIVE_REUSE_WITHDRAWN");
      }
      for(const id of reusedCatalogs)requireProof(await checkCatalogReuse(input.appViews.find(view=>view.id===id)!,manifest),"SELECTIVE_CATALOG_REUSE_WITHDRAWN");
      context = {...context, manifest};
      for(const [id,plan] of catalogPlans){
        try{await store.commitCatalogRevisionReceipt!(context,plan);await status("emitted","CATALOG_MANIFEST_MATCH_SHADOW",id);}
        catch(error){await status("rejected",errorCode(error),id);}
      }
      for (const appView of input.appViews) {
        if (reused.has(appView.id) || !outcomes.has(appView.id)) continue; // Local reuse did not download or recertify it.
        try {await store.commitPreparationRevisionReceipt!(context, plan(appView)); await status("emitted", "MANIFEST_MATCH_SHADOW", appView.id);}
        catch (error) {await status("rejected", errorCode(error), appView.id);}
      }
      reuseValidated=current();
      return [] as string[];
    } catch (error) {
      await status("rejected", errorCode(error));
      if(current()&&(reused.size||reusedCatalogs.size)){recordSelectiveReuseDiagnostic("REUSE_WITHDRAWN");return [...new Set([...reused,...reusedCatalogs])];}
      return [] as string[];
    }
  }};
}
