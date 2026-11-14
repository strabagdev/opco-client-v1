import type { AppView, OpcoApi, PanelResponse, ReportResponse, PanelQuery, ReportQuery } from "./opco-api";
import type { RevisionReceiptStore } from "./revision-receipt-storage";
import type { ConsultationContext } from "./consultation-revision-storage";
import { consultationPlan, consultationQuery, type ConsultationRequest } from "./consultation-revision-contract";
import { assertRevisionMatches, assertRevisionScope, revisionCanonical, revisionHash, validateRevisionDownload, RevisionReceiptError, type RevisionDownload, type RevisionResource } from "./revision-receipts";
type Api=Partial<Pick<OpcoApi,"getPanel"|"getReport"|"getAppViews"|"getRevisionRead"|"getOfflineRevisionManifest">>;
const generations=new WeakMap<object,Map<string,object>>();
const proof=(v:unknown,code:string)=>{if(!v)throw new RevisionReceiptError(code);};
export async function createConsultationRevisionRead(input:{api:Api;store:Partial<RevisionReceiptStore>&{getOfflinePreparationCoordinatorKey?():object};appView?:AppView;appViewId?:string;kind:"panel"|"report";query:PanelQuery&ReportQuery;snapshotDatasetId?:string;ownerKey:string;contractId:string;token:string;isCurrent():boolean}) {
 const rawRequest:ConsultationRequest={appView:input.appView!,resource:{kind:input.kind,appViewId:input.appView?.id??input.appViewId,query:consultationQuery(input.kind,input.query)},snapshotDatasetId:input.snapshotDatasetId};
 const identity=input.store.getOfflinePreparationCoordinatorKey?.()??input.store,scopeKey=revisionCanonical({owner:input.ownerKey,contract:input.contractId,kind:input.kind,view:input.appView?.id??input.appViewId,query:rawRequest.resource.query,snapshot:input.snapshotDatasetId});
 let map=generations.get(identity);if(!map){map=new Map();generations.set(identity,map);}const generation={};map.set(scopeKey,generation);
 const current=()=>input.isCurrent()&&map!.get(scopeKey)===generation;
 const assertActive=()=>proof(current(),"REVISION_SCOPE_RETIRED");
 const status=async(reason:string)=>{try{if(current())await input.store.recordConsultationRevisionStatus?.({...input,appViewId:input.appView?.id??input.appViewId??"unknown",reason,isCurrent:current});}catch{/* Receipt diagnostics cannot alter data or outbox. */}};
 const fallback={api:input.api,assertActive,async finish(){await status("CONSULTATION_REVISION_UNAVAILABLE");}};
 if(!input.appView||input.kind==="report"&&(input.appView.type!=="REPORT"||!["TABLE","MATRIX"].includes(input.appView.config.presentationMode)||!input.query.from||!input.query.to)||!input.api.getRevisionRead||!input.api.getOfflineRevisionManifest||!input.store.beginConsultationRevision||!input.store.commitConsultationRevision)return fallback;
 let context:ConsultationContext,assignment:RevisionDownload,download:RevisionDownload|undefined,request=rawRequest,normalizedHash:string;
 try{
  assertActive();const manifest=await input.api.getOfflineRevisionManifest(input.token,input.contractId,{ownerKey:input.ownerKey,isCurrent:current});const scope={...manifest.scope,ownerKey:input.ownerKey};assertRevisionScope(scope,manifest);assertActive();
  assignment=await input.api.getRevisionRead(input.token,input.contractId,{kind:"views"});await validateRevisionDownload(assignment);assertRevisionMatches(manifest,assignment.readRevision);assertActive();
  const effective=(assignment.normalized as {views:AppView[]}).views.find(v=>v.id===input.appView!.id);proof(effective?.type===input.appView.type,"CONSULTATION_ASSIGNMENTS_CHANGED");
  if(input.kind==="report")proof(revisionCanonical(effective)===revisionCanonical(input.appView),"CONSULTATION_CONFIGURATION_CHANGED");
  request={...rawRequest,appView:effective!};context={scope,manifest,sessionId:crypto.randomUUID(),request,isCurrent:current};await input.store.beginConsultationRevision(context);
 }catch(error){await status(error instanceof RevisionReceiptError?error.code:"CONSULTATION_REVISION_UNAVAILABLE");if(error&&typeof error==="object"&&"status"in error&&[401,403].includes(Number(error.status)))throw error;if(error instanceof RevisionReceiptError&&["REVISION_SCOPE_RETIRED","REVISION_SCOPE_MISMATCH","CONSULTATION_ASSIGNMENTS_CHANGED","CONSULTATION_CONFIGURATION_CHANGED"].includes(error.code))throw error;return fallback;}
 const api:Api={...input.api,getAppViews:async(_token,_contract)=>{proof(_contract===input.contractId,"REVISION_SCOPE_MISMATCH");return{views:(assignment.normalized as {views:AppView[]}).views};}};
 const read=async(diagnostics?:{diagnosticRequestId:string})=>{
  assertActive();let expected:string|undefined;
  if(input.kind==="panel"&&Number(request.resource.query?.page??1)>1){
   expected=await input.store.getConsultationContinuation!({scope:context.scope,request,isCurrent:current});assertActive();
   if(!expected){const anchorResource:RevisionResource={...request.resource,query:{...request.resource.query,page:"1"}};const anchor=await input.api.getRevisionRead!(input.token,input.contractId,anchorResource);await validateRevisionDownload(anchor);assertRevisionMatches(context.manifest,anchor.readRevision);expected=anchor.readRevision.revision;assertActive();}
  }
  const transport={diagnosticOperation:undefined,...(diagnostics?{headers:{"X-Opco-Request-Id":diagnostics.diagnosticRequestId}}:{})};
  const result=await input.api.getRevisionRead!(input.token,input.contractId,request.resource,expected,transport);assertActive();await validateRevisionDownload(result);assertRevisionMatches(context.manifest,result.readRevision);if(expected)proof(result.readRevision.revision===expected,"REVISION_PAGES_MIXED");
  consultationPlan(request,context.scope,result,assignment.readRevision);download=result;normalizedHash=await revisionHash(result.normalized);assertActive();return result.normalized;
 };
 if(input.kind==="panel")api.getPanel=async(_token,_contract,_view,_query,diagnostics)=>{proof(_contract===input.contractId&&_view===request.appView.id&&revisionCanonical(consultationQuery("panel",_query??{}))===revisionCanonical(request.resource.query),"REVISION_SCOPE_MISMATCH");return await read(diagnostics)as PanelResponse;};
 else api.getReport=async(_token,_contract,_view,_query)=>{proof(_contract===input.contractId&&_view===request.appView.id&&revisionCanonical(consultationQuery("report",_query??{}))===revisionCanonical(request.resource.query),"REVISION_SCOPE_MISMATCH");return await read()as ReportResponse;};
 return{api,assertActive,async finish(){try{
  assertActive();proof(download,"CONSULTATION_RESPONSE_MISSING");await validateRevisionDownload(assignment);await validateRevisionDownload(download);proof(await revisionHash(download!.normalized)===normalizedHash,"CONSULTATION_RESPONSE_MUTATED");const manifest=await input.api.getOfflineRevisionManifest!(input.token,input.contractId,{ownerKey:input.ownerKey,isCurrent:current,expected:context.manifest});assertRevisionScope(context.scope,manifest);assertRevisionMatches(manifest,download!.readRevision);assertRevisionMatches(manifest,assignment.readRevision);assertActive();
  await input.store.commitConsultationRevision!({...context,manifest},consultationPlan(request,context.scope,download!,assignment.readRevision));await status("CONSULTATION_MANIFEST_MATCH_SHADOW");
 }catch(error){await status(error instanceof RevisionReceiptError?error.code:"CONSULTATION_REVISION_FAILED");}}};
}
