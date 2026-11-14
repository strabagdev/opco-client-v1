import type {AttendanceResponse} from "./opco-api";
import {assertRevisionRequestBinding, revisionCanonical, validateRevisionDownload, RevisionReceiptError, type RevisionDownload, type RevisionResource} from "./revision-receipts";

// In-memory evidence, never accepted from JSON or inherited by object spread. The
// persisted proof remains the existing transaction/marker/content-hash receipt.
type DayScope={ownerKey:string;contractId:string;appViewId:string};
const completeDays = new WeakMap<object,string>();
const scopeKey=(scope:DayScope)=>JSON.stringify([scope.ownerKey,scope.contractId,scope.appViewId]);
export function assertVerifiedAttendanceDayScope(value:object,scope:DayScope) {
  const bound=completeDays.get(value);
  if(bound!==undefined && bound!==scopeKey(scope))throw new RevisionReceiptError("REVISION_SCOPE_MISMATCH");
}
export const isVerifiedAttendanceDay = (value: object) => completeDays.has(value);
function requireDay(value: unknown, code = "ATTENDANCE_DAY_INCOMPLETE"): asserts value {
  if (!value) throw new RevisionReceiptError(code);
}
function freeze<T>(value: T): T {
  if(value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze); Object.freeze(value);
  }
  return value;
}
function header(value: AttendanceResponse) {
  return revisionCanonical({appView:value.appView, date:value.date,source:value.sourceEntityType,target:value.targetEntityType,
    statuses:value.statuses,statusFieldId:value.statusFieldId,contextFields:value.contextFields,
    observationProjection:value.observationProjection,subjectPresentation:value.subjectPresentation,summary:value.summary});
}
export async function completeAttendanceDay(input: {
  seed: AttendanceResponse; ownerKey:string;contractId:string;appViewId:string;isCurrent():boolean;
  readPage?(resource:RevisionResource,expected?:string):Promise<RevisionDownload>;
}):Promise<{response:AttendanceResponse;pages:RevisionDownload[]}> {
  const {seed}=input;
  assertVerifiedAttendanceDayScope(seed,input);
  requireDay(input.isCurrent(),"REVISION_SCOPE_RETIRED");
  if(isVerifiedAttendanceDay(seed) || seed.summary.totalRegistered <= 10) return {response:seed,pages:[]};
  // Old Core remains explicitly limited; an unknown advertised contract is an error.
  const capability=seed.daySnapshotCapabilities;
  if(!capability) return {response:seed,pages:[]};
  requireDay(capability.version===1 && Number.isSafeInteger(capability.maxPageSize) && capability.maxPageSize>0,"ATTENDANCE_DAY_INCOMPATIBLE");
  requireDay(input.readPage,"READ_REVISION_REQUIRED");
  const size=Math.min(100,capability.maxPageSize),pages:RevisionDownload[]=[],events:AttendanceResponse["latest"]=[],ids=new Set<string>();
  let revision:string|undefined,totalPages=1;
  for(let page=1;page<=totalPages;page++) {
    requireDay(input.isCurrent(),"REVISION_SCOPE_RETIRED");
    const resource:RevisionResource={kind:"attendance",appViewId:input.appViewId,query:{date:seed.date,daySnapshotVersion:"1",page:String(page),pageSize:String(size)}};
    const download=await input.readPage(resource,revision);
    requireDay(input.isCurrent(),"REVISION_SCOPE_RETIRED");
    await validateRevisionDownload(download);await assertRevisionRequestBinding(input.contractId,resource,download);
    requireDay(!revision || download.readRevision.revision===revision,"REVISION_PAGES_MIXED");
    revision=download.readRevision.revision;
    const data=download.normalized as AttendanceResponse,p=data.daySnapshot,raw=download.data as AttendanceResponse;
    const values=(value:AttendanceResponse)=>value.latest.map(event=>({id:event.attendanceRecordId,personId:event.person?.id,
      observation:event.observation,contextValues:event.contextValues,statusOptionId:event.statusOptionId,statusLabel:event.statusLabel,
      updatedAt:new Date(event.updatedAt).toISOString()}));
    requireDay(Array.isArray(raw.latest) && Array.isArray(raw.items) && raw.items.length===0 &&
      revisionCanonical(values(raw))===revisionCanonical(values(data)) && revisionCanonical(raw.daySnapshot)===revisionCanonical(p),"READ_REVISION_CONTENT_MISMATCH");
    requireDay(data.appView.id===input.appViewId && data.date===seed.date && header(data)===header(seed),"ATTENDANCE_DAY_CONTEXT_CHANGED");
    requireDay(p?.version===1 && p.page===page && p.pageSize===size && Number.isSafeInteger(p.total) && p.total>=0 &&
      p.total===seed.summary.totalRegistered && p.totalPages===Math.max(1,Math.ceil(p.total/size)) && p.hasMore===(page*size<p.total) &&
      page<=p.totalPages && data.items.length===0 && data.latest.length===Math.min(size,Math.max(0,p.total-(page-1)*size)));
    totalPages=p.totalPages;
    for(const event of data.latest) {
      requireDay(event && typeof event.attendanceRecordId==="string" && event.attendanceRecordId.length>0 && typeof event.person?.id==="string" &&
        Number.isFinite(Date.parse(event.updatedAt)) && !ids.has(event.attendanceRecordId));
      ids.add(event.attendanceRecordId);events.push(event);
    }
    pages.push(download);
  }
  requireDay(input.isCurrent(),"REVISION_SCOPE_RETIRED");
  requireDay(events.length===seed.summary.totalRegistered);
  // Clone rather than freeze a caller-owned seed/page. Partial pages are never persisted.
  const response=JSON.parse(JSON.stringify({...pages[0].normalized as AttendanceResponse,daySnapshot:undefined,latest:events})) as AttendanceResponse;
  freeze(response);completeDays.set(response,scopeKey(input));
  return {response,pages};
}
