import type { AppView, EntityDefinitionResponse, EntityRecordsResponse, OpcoApi } from "./opco-api";
import type { RevisionReceiptStore } from "./revision-receipt-storage";
import type { RecordsRevisionContext } from "./records-revision-storage";
import { recordsCoveragePlan, recordsRevisionQuery, assertRecordsPage } from "./records-revision-contract";
import { assertRevisionMatches, assertRevisionScope, revisionCanonical, revisionHash, RevisionReceiptError, validateRevisionDownload, type RevisionDownload, type RevisionResource } from "./revision-receipts";

type Api = Pick<OpcoApi,"getEntityDefinition"|"getEntityRecords"> & Partial<Pick<OpcoApi,"getRevisionRead"|"getOfflineRevisionManifest">>;
function requireProof(v:unknown,code:string):asserts v {if(!v)throw new RevisionReceiptError(code);}
const reason = (e:unknown) => e && typeof e==="object" && "code"in e && typeof e.code==="string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(e.code)?e.code:"RECORDS_REVISION_UNAVAILABLE";
/** Observes existing RECORDS reads. It never schedules a collection download or decides reuse. */
export async function createRecordsRevisionRead(input:{api:Api;store:Partial<RevisionReceiptStore>;token:string;ownerKey:string;contractId:string;appView:AppView;isCurrent():boolean}) {
 const status=async(code:string,partial=false)=>{try{if(input.isCurrent())await input.store.recordRecordsRevisionStatus?.({...input,appViewId:input.appView.id,reason:code,partial});}catch{/* Diagnostics cannot block records or outbox. */}};
 const fallback={api:input.api,async finish(){await status("RECORDS_REVISION_UNAVAILABLE");}};
 if(!input.api.getRevisionRead || !input.api.getOfflineRevisionManifest || !input.store.beginRecordsRevisionRead || !input.store.commitRecordsRevisionReceipt)return fallback;
 let context:RecordsRevisionContext;const downloads:RevisionDownload[]=[],normalizedHashes=new WeakMap<RevisionDownload,string>(),revisions=new Map<string,string>();
 const current=()=>requireProof(input.isCurrent(),"REVISION_SCOPE_RETIRED");
 try {
  current();const manifest=await input.api.getOfflineRevisionManifest(input.token,input.contractId,{ownerKey:input.ownerKey,isCurrent:input.isCurrent});const scope={...manifest.scope,ownerKey:input.ownerKey};assertRevisionScope(scope,manifest);current();
  context={scope,manifest,sessionId:crypto.randomUUID(),appViewId:input.appView.id,isCurrent:input.isCurrent};await input.store.beginRecordsRevisionRead(context);
  await read({kind:"views"});
  requireProof(((downloads[0].normalized as {views:AppView[]}).views??[]).some(v=>revisionCanonical(v)===revisionCanonical(input.appView)),"RECORDS_CONFIGURATION_CHANGED");
 }catch(error){await status(reason(error));if(error&&typeof error==="object"&&"status"in error&&[401,403].includes(Number(error.status)))throw error;
  if(error instanceof RevisionReceiptError&&["REVISION_SCOPE_RETIRED","REVISION_SCOPE_MISMATCH","RECORDS_CONFIGURATION_CHANGED"].includes(error.code))throw error;
  return fallback;
 }
 async function read(resource:RevisionResource) {
  current();const q={...resource.query};delete q.page;const frame=revisionCanonical({...resource,query:q});const page=Number(resource.query?.page??1),expected=page>1?revisions.get(frame):undefined;
  requireProof(page<=1||expected,"READ_REVISION_REQUIRED");
  const d=await input.api.getRevisionRead!(input.token,input.contractId,resource,expected);current();
  await validateRevisionDownload(d);assertRevisionMatches(context.manifest,d.readRevision);current();
  if(expected)requireProof(d.readRevision.revision===expected,"REVISION_PAGES_MIXED");
  if(resource.kind==="records"){
   assertRecordsPage(d);const data=d.normalized as EntityRecordsResponse;
   const previous=downloads.filter(x=>x.resource.kind==="records");
   const first=previous[0]?.normalized as EntityRecordsResponse|undefined;
   requireProof(!first || first.pagination.total===data.pagination.total,"RECORDS_COVERAGE_INCOMPLETE");
   const ids=[...previous.flatMap(x=>(x.normalized as EntityRecordsResponse).records),...data.records].map(r=>r.id);
   requireProof(ids.every(id=>typeof id==="string"&&!!id)&&new Set(ids).size===ids.length,"RECORDS_COVERAGE_INCOMPLETE");
  }
  normalizedHashes.set(d,await revisionHash(d.normalized));downloads.push(d);revisions.set(frame,d.readRevision.revision);return d.normalized;
 }
 return {api:{
  getEntityDefinition:async(_token:string,contract:string,entity:string)=>{requireProof(contract===input.contractId && input.appView.type==="RECORDS" && entity===input.appView.config.entityTypeId,"REVISION_SCOPE_MISMATCH");return await read({kind:"definition",entityTypeId:entity}) as EntityDefinitionResponse;},
  getEntityRecords:async(_token:string,contract:string,entity:string,query={})=>{requireProof(contract===input.contractId && input.appView.type==="RECORDS" && entity===input.appView.config.entityTypeId,"REVISION_SCOPE_MISMATCH");return await read({kind:"records",entityTypeId:entity,query:recordsRevisionQuery(query)}) as EntityRecordsResponse;},
 } as Pick<OpcoApi,"getEntityDefinition"|"getEntityRecords">,
 async finish() {
  try{
   current();const filtered=downloads.some(d=>d.resource.kind==="records"&&Object.keys(d.resource.query??{}).some(k=>!["page","pageSize"].includes(k)));
   if(filtered){await status("RECORDS_QUERY_PARTIAL",true);return;}
   const plan=recordsCoveragePlan(input.appView,downloads),manifest=await input.api.getOfflineRevisionManifest!(input.token,input.contractId,{ownerKey:input.ownerKey,isCurrent:input.isCurrent,expected:context.manifest});assertRevisionScope(context.scope,manifest);current();
   for(const d of downloads){await validateRevisionDownload(d);assertRevisionMatches(manifest,d.readRevision);requireProof(await revisionHash(d.normalized)===normalizedHashes.get(d),"RECORDS_RESPONSE_MUTATED");}
   await input.store.commitRecordsRevisionReceipt!({...context,manifest},plan);await status("RECORDS_MANIFEST_MATCH_SHADOW");
  }catch(error){await status(reason(error),downloads.some(d=>d.resource.kind==="records"));}
 }};
}
