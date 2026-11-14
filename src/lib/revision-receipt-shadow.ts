import type { OpcoApi, EntityRecord, EntityRecordsResponse, StateUpdateResponse, AttendanceResponse, AttendanceWorkflowConfig, StateUpdateItem } from "./opco-api";
import type { StateUpdateScope } from "./state-update-offline";
import { compositeIdentityKey } from "./state-update-identity";
import { attendanceResponseToStateUpdateItems } from "../renderers/workflows/attendance/attendance-workflow-logic";
import { assertRevisionScope, assertRevisionMatches, validateRevisionDownload, RevisionReceiptError, type RevisionScope, type RevisionResource, type RevisionDownload, type ReadRevision } from "./revision-receipts";
import type { ReceiptArtifact, ReceiptExpected, ReceiptContext, RevisionReceiptStore } from "./revision-receipt-storage";

type Base={api:Pick<OpcoApi,"getOfflineRevisionManifest"|"getRevisionRead">;store:RevisionReceiptStore;scope:RevisionScope;token:string;sessionId:string;isCurrent():boolean};
async function start(input:Base,resource:RevisionResource):Promise<ReceiptContext>{
 const manifest=await input.api.getOfflineRevisionManifest(input.token,input.scope.contractId);assertRevisionScope(input.scope,manifest);
 const context={scope:input.scope,manifest,sessionId:input.sessionId,isCurrent:input.isCurrent};await input.store.beginRevisionReceiptSession(context);await input.store.invalidateRevisionReceipt(context,resource,"REVISION_REFRESH_IN_PROGRESS");return context;
}
async function finish(input:Base,context:ReceiptContext,reads:ReadRevision[]){
 if(!input.isCurrent())throw new RevisionReceiptError("REVISION_SCOPE_RETIRED");
 const manifest=await input.api.getOfflineRevisionManifest(input.token,input.scope.contractId);assertRevisionScope(input.scope,manifest);for(const read of reads)assertRevisionMatches(manifest,read);
 return {...context,manifest};
}
async function diagnostic(input:Base,status:string,reason:string|null){try{await input.store.recordRevisionReceiptDiagnostic(input.scope,status,reason);}catch{/* Diagnostic failure never changes business data or authorizes reuse. */}}
async function failed(input:Base,status:string,error:unknown){
 if(error&&typeof error==="object"&&"status"in error&&(error.status===401||error.status===403)){try{await input.store.invalidateRevisionReceiptScope(input.scope,"REVISION_AUTHORIZATION_REJECTED");}catch{/* No stale proof is accepted by a failed comparison. */}}
 await diagnostic(input,status,reason(error));
}
function reason(error:unknown){const code=error instanceof RevisionReceiptError?error.code:error&&typeof error==="object"&&"code"in error&&typeof error.code==="string"?error.code:"REVISION_CAPTURE_FAILED";return /^[A-Z][A-Z0-9_]{0,79}$/.test(code)?code:"REVISION_CAPTURE_FAILED";}
/** Explicit opt-in shadow pass. Automatic prewarm and ordinary API reads never call it. */
export async function captureCachedRecordsReceipt(input:Base&{entityTypeId:string;pageSize?:number}){
 const pageSize=input.pageSize??100,resource:RevisionResource={kind:"records",entityTypeId:input.entityTypeId,query:{pageSize:String(pageSize)}};
 try{
  const context=await start(input,resource);const records:EntityRecord[]=[],reads:ReadRevision[]=[];let pages=1,total:number|undefined,revision:string|undefined;
  for(let page=1;page<=pages;page++){
   if(!input.isCurrent())throw new RevisionReceiptError("REVISION_SCOPE_RETIRED");
   const result=await input.api.getRevisionRead(input.token,input.scope.contractId,{...resource,query:{page:String(page),pageSize:String(pageSize)}},revision);await validateRevisionDownload({data:result.data,readRevision:result.readRevision});assertRevisionMatches(context.manifest,result.readRevision);
   if(revision&&result.readRevision.revision!==revision)throw new RevisionReceiptError("REVISION_PAGES_MIXED");revision=result.readRevision.revision;
   const data=result.normalized as EntityRecordsResponse,p=data.pagination;
   if(!p||p.page!==page||p.pageSize!==pageSize||!Number.isInteger(p.total)||p.total<0||!Number.isInteger(p.totalPages)||p.totalPages!==Math.max(1,Math.ceil(p.total/pageSize))||p.totalPages>500||!Array.isArray(data.records)||data.records.length!==Math.min(pageSize,Math.max(0,p.total-(page-1)*pageSize))||(total!==undefined&&p.total!==total))throw new RevisionReceiptError("REVISION_COVERAGE_INCOMPLETE");
   total=p.total;pages=p.totalPages;records.push(...data.records);reads.push(result.readRevision);
  }
  if(total===undefined||records.length!==total||new Set(records.map(r=>r.id)).size!==total)throw new RevisionReceiptError("REVISION_COVERAGE_INCOMPLETE");
  const final=await finish(input,context,reads);
  const receipt=await input.store.commitRevisionReceipt({context:final,resource,artifact:{kind:"records",entityTypeId:input.entityTypeId,total},expected:{records},reads});await diagnostic(input,"receipt_verified",null);return receipt;
 }catch(error){await failed(input,"capture_failed",error);throw error;}
}
/** Observes an already persisted exact snapshot. Never writes business data or certifies a whole experience. */
export async function captureCachedSnapshotReceipt(input:Base&{resource:RevisionResource;materialized(download:RevisionDownload):{artifact:ReceiptArtifact;expected:ReceiptExpected}}){
 try{
  const context=await start(input,input.resource);const download=await input.api.getRevisionRead(input.token,input.scope.contractId,input.resource);await validateRevisionDownload({data:download.data,readRevision:download.readRevision});assertRevisionMatches(context.manifest,download.readRevision);
  if(!input.isCurrent())throw new RevisionReceiptError("REVISION_SCOPE_RETIRED");
  const materialized=input.materialized(download);await validateRevisionDownload({data:download.data,readRevision:download.readRevision});
  const final=await finish(input,context,[download.readRevision]);
  const receipt=await input.store.commitRevisionReceipt({context:final,resource:input.resource,...materialized,reads:[download.readRevision]});await diagnostic(input,"receipt_verified",null);return receipt;
 }catch(error){await failed(input,"capture_failed",error);throw error;}
}
export async function compareRevisionReceiptsShadow(input:Base){
 try{const manifest=await input.api.getOfflineRevisionManifest(input.token,input.scope.contractId);assertRevisionScope(input.scope,manifest);const result=await input.store.inspectRevisionReceipts({scope:input.scope,manifest,isCurrent:input.isCurrent});for(const item of result)await diagnostic(input,item.status,item.reason);return result;}
 catch(error){await failed(input,"comparison_unavailable",error);throw error;}
}
/** Expected event values come from the normalized DTO used by the existing persistence adapter. */
export function workflowReceiptMaterialization(scope:StateUpdateScope,response:StateUpdateResponse|AttendanceResponse,attendanceConfig?:Pick<AttendanceWorkflowConfig,"statusFieldId"|"observationFieldId"|"contextFieldIds">){
 let items:StateUpdateItem[],events:StateUpdateItem[];
 if(attendanceConfig){const r=response as AttendanceResponse;items=attendanceResponseToStateUpdateItems({...r,latest:[]},attendanceConfig);events=attendanceResponseToStateUpdateItems({...r,items:[]},attendanceConfig);}
 else{const r=response as StateUpdateResponse;if(r.contextRequired||compositeIdentityKey(r.identityContext)!==compositeIdentityKey(scope.identity))throw new RevisionReceiptError("REVISION_COVERAGE_INCOMPLETE");if(r.currentBatch?.results.some(s=>s.status!=="resolved"))throw new RevisionReceiptError("REVISION_COVERAGE_INCOMPLETE");items=r.items;events=(r.latest??[]).map(event=>{if(!event.stateValues)throw new RevisionReceiptError("REVISION_COVERAGE_INCOMPLETE");return {subject:event.subject,current:{...event,stateValues:event.stateValues}};});}
 const byId=new Map<string,StateUpdateItem>();for(const item of [...events,...items])if(item.current)byId.set(item.current.recordId,item);
 if(scope.appViewId!==response.appView.id||scope.targetEntityTypeId!==response.targetEntityType.id||scope.date!==(response.date??undefined))throw new RevisionReceiptError("REVISION_SCOPE_MISMATCH");
 return {artifact:{kind:"workflow" as const,scope,eventIds:[...byId.keys()],currentSubjectIds:items.map(i=>i.subject.id)},expected:{events:[...byId.values()],current:items.map(i=>({subjectId:i.subject.id,recordId:i.current?.recordId??null}))}};
}
