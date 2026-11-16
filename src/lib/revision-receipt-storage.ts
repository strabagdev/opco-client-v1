import {observeNegotiatedReceipts} from "./revision-negotiation";
import {createConsultationRevisionStorage} from "./consultation-revision-storage";
import {createRecordsRevisionStorage,type VerifiedRecordsReader} from "./records-revision-storage";
import {createCatalogRevisionStorage} from "./catalog-revision-storage";
import { createPreparationRevisionStorage, type PreparationCoverageKeys } from "./preparation-revision-storage";
import type * as SQLite from "expo-sqlite";
import type { EntityRecord, StateUpdateItem } from "./opco-api";
import type { EntityRecordRow, PanelSnapshotScope, ReportSnapshotScope } from "./local-db";
import type { StateUpdateScope, OfflineStateUpdatePayload } from "./state-update-offline";
import { stateUpdateRemoteItemMatchesPayload } from "./state-update-offline";
import { stateUpdateV10Scope, stateUpdateSnapshots, stateUpdateLogicalRemoteId } from "./state-update-v10-storage";
import { assertRevisionScope, assertRevisionMatches, revisionCanonical, revisionHash, RevisionReceiptError, type RevisionScope, type RevisionManifest, type RevisionResource, type ReadRevision } from "./revision-receipts";

type Database=Omit<SQLite.SQLiteDatabase,"withTransactionAsync"> & {withTransactionAsync(work:(tx:SQLite.SQLiteDatabase)=>Promise<void>,name?:`transaction:${string}`):Promise<void>};
export type ReceiptArtifact=
 |{kind:"records";entityTypeId:string;total:number}
 |{kind:"definition";entityTypeId:string}
 |{kind:"views"}
 |{kind:"panel";scope:PanelSnapshotScope}
 |{kind:"report";scope:ReportSnapshotScope}
 |{kind:"workflow";scope:StateUpdateScope;eventIds:string[];currentSubjectIds:string[];completeEventIds?:string[]};
export type ReceiptExpected={json?:unknown;records?:EntityRecord[];events?:StateUpdateItem[];current?:{subjectId:string;recordId:string|null}[]};
export type RevisionReceipt={version:1;mode:"shadow";reuseAllowed:false;receiptId:string;snapshotId:string;scope:RevisionScope;resource:RevisionResource;artifact:ReceiptArtifact;
 coverage:{complete:true;completeCollection:boolean;wholeExperience:false;metadataAccredited:boolean;kind:ReceiptArtifact["kind"]};
 remote:{epoch:string;manifestVectorRevision:string;metadataRevision:string;selectionRevision:string;requestFingerprints:string[];contentHashes:string[]};
 local:{contentHash:string;verifiedAt:string;representationVersion:1};status:"verified"|"invalid";invalidReason?:string};
export type ReceiptObservation={key:string;status:"match_shadow"|"remote_unchecked"|"invalid"|"unavailable";reason:string|null;receipt:RevisionReceipt|null;reuseAllowed:false};
export type ReceiptContext={scope:RevisionScope;sessionId:string;manifest:RevisionManifest;isCurrent():boolean};
const ACTIVE="revision_receipt_active_v1",PREFIX="revision_receipt_v1:";
const prefix=(s:RevisionScope)=>PREFIX+JSON.stringify([s.ownerKey,s.contractId])+":";
async function readJson<T>(db:SQLite.SQLiteDatabase,key:string):Promise<T|null>{const row=await db.getFirstAsync<{value:string}>("SELECT value FROM app_metadata WHERE key=?",key);if(!row)return null;try{return JSON.parse(row.value) as T;}catch{return null;}}
async function writeJson(db:SQLite.SQLiteDatabase,key:string,value:unknown){await db.runAsync("INSERT INTO app_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",key,JSON.stringify(value));}
const keyFor=async(scope:RevisionScope,resource:RevisionResource)=>prefix(scope)+await revisionHash({applicationId:scope.applicationId,userId:scope.userId,resource});
function same(a:unknown,b:unknown){return revisionCanonical(a)===revisionCanonical(b);}
function assertLocal(condition:unknown,code="REVISION_LOCAL_CONTENT_MISMATCH"):asserts condition{if(!condition)throw new RevisionReceiptError(code);}

/** Reads only existing cache structures. Expected payloads stay in memory, not in receipts. */
async function materialization(db:SQLite.SQLiteDatabase,scope:RevisionScope,artifact:ReceiptArtifact,expected:ReceiptExpected|undefined,
 keys:{panel(scope:PanelSnapshotScope):string;report(scope:ReportSnapshotScope):string}):Promise<unknown>{
 const owner=scope.ownerKey,contract=scope.contractId;
 if(artifact.kind==="records"){
  const rows=await db.getAllAsync<EntityRecordRow>("SELECT * FROM entity_records WHERE owner_key=? AND contract_id=? AND entity_type_id=? ORDER BY server_id",owner,contract,artifact.entityTypeId);
  assertLocal(rows.every(r=>r.sync_status==="synced"),"REVISION_LOCAL_OVERLAY");
  const records=rows.map(r=>({id:r.server_id,displayName:r.display_name,updatedAt:r.remote_updated_at,values:JSON.parse(r.values_json)})).sort((a,b)=>(a.id??"").localeCompare(b.id??""));
  assertLocal(records.length===artifact.total&&records.every(r=>!!r.id)&&new Set(records.map(r=>r.id)).size===artifact.total);
  if(expected?.records)assertLocal(same(records,[...expected.records].sort((a,b)=>a.id.localeCompare(b.id))));
  return records;
 }
 if(artifact.kind==="definition"){
  const row=await db.getFirstAsync<{definition_json:string}>("SELECT definition_json FROM entity_definitions WHERE contract_id=? AND entity_type_id=?",contract,artifact.entityTypeId);assertLocal(row,"REVISION_LOCAL_METADATA_MISSING");const json=JSON.parse(row.definition_json);if(expected)assertLocal(same(json,expected.json));return json;
 }
 if(artifact.kind==="views"){
  const row=await db.getFirstAsync<{views_json:string}>("SELECT views_json FROM app_views WHERE owner_key=? AND contract_id=?",owner,contract);assertLocal(row,"REVISION_LOCAL_METADATA_MISSING");const json=JSON.parse(row.views_json);if(expected)assertLocal(same(json,expected.json));return json;
 }
 if(artifact.kind==="panel"||artifact.kind==="report"){
  const s=artifact.scope;assertLocal(s.ownerKey===owner&&s.contractId===contract,"REVISION_SCOPE_MISMATCH");
  let json:unknown;
  if(artifact.kind==="panel"){
   const s=artifact.scope;assertLocal(s.configRevision,"REVISION_LOCAL_METADATA_MISSING");const row=await db.getFirstAsync<{panel_json:string}>("SELECT panel_json FROM panel_snapshots WHERE owner_key=? AND contract_id=? AND app_view_id=? AND dataset_id=? AND query_key=? AND config_revision=?",owner,contract,s.appViewId,s.datasetId,keys.panel(s),s.configRevision);assertLocal(row);json=JSON.parse(row.panel_json);
  }else{const s=artifact.scope;const row=await db.getFirstAsync<{report_json:string}>("SELECT report_json FROM report_snapshots WHERE owner_key=? AND contract_id=? AND app_view_id=? AND query_key=?",owner,contract,s.appViewId,keys.report(s));assertLocal(row);json=JSON.parse(row.report_json);}
  if(expected){
   const projected=(value:unknown)=>{
    if(artifact.kind!=="panel")return value;
    const panel=value as {calculatedAt?:string;metrics?:{calculatedAt?:string}[]};
    return {...panel,calculatedAt:undefined,metrics:panel.metrics?.map(metric=>({...metric,calculatedAt:undefined}))};
   };
   assertLocal(same(projected(json),projected(expected.json)));
  }return json;
 }
 const input=artifact.scope;assertLocal(input.ownerKey===owner&&input.contractId===contract,"REVISION_SCOPE_MISMATCH");
 const definition=await db.getFirstAsync<{definition_json:string}>("SELECT definition_json FROM app_view_definitions WHERE owner_key=? AND contract_id=? AND app_view_id=?",owner,contract,input.appViewId);assertLocal(definition,"REVISION_LOCAL_METADATA_MISSING");
 const configured=await stateUpdateV10Scope(db,input);assertLocal(JSON.parse(configured.configuration)[3]!==null,"REVISION_LOCAL_METADATA_MISSING");
 const overlays=await db.getFirstAsync("SELECT 1 FROM entity_records WHERE owner_key=? AND contract_id=? AND entity_type_id=? AND sync_status!='synced' AND json_extract(values_json,'$.appViewId')=? LIMIT 1",owner,contract,input.targetEntityTypeId,input.appViewId);assertLocal(!overlays,"REVISION_LOCAL_OVERLAY");
 const projections=await stateUpdateSnapshots(db,configured);const rows=[];
 for(const id of [...artifact.eventIds].sort()){
  const found=projections.find(p=>p.verified&&stateUpdateLogicalRemoteId(p.row)===id);assertLocal(found);const values=JSON.parse(found.row.values_json) as OfflineStateUpdatePayload;
  const item=expected?.events?.find(e=>e.current?.recordId===id);if(expected){assertLocal(item?.current&&item.subject.displayName===found.row.display_name&&item.current.updatedAt===found.row.remote_updated_at&&stateUpdateRemoteItemMatchesPayload(item,values));assertLocal(same(item.current.extraValues??{},values.extraValues??{})&&same([...item.current.stateValues].sort((a,b)=>a.fieldId.localeCompare(b.fieldId)),[...values.stateValues].sort((a,b)=>a.fieldId.localeCompare(b.fieldId))));}
  rows.push({key:found.key,row:{id,displayName:found.row.display_name,updatedAt:found.row.remote_updated_at,values}});
 }
 if(artifact.completeEventIds){
  const rows=projections.filter(p=>!input.date||JSON.parse(p.row.values_json).date===input.date);
  assertLocal(rows.every(p=>p.verified)&&same(rows.map(p=>stateUpdateLogicalRemoteId(p.row)).sort(),[...artifact.completeEventIds].sort()),"REVISION_LOCAL_COVERAGE_MISMATCH");
 }
 const authorities=[];
 for(const subject of [...artifact.currentSubjectIds].sort()){
  const key="state_update_v10_current:"+JSON.stringify([owner,contract,input.targetEntityTypeId,input.appViewId,configured.configuration,input.date??null,subject]);
  const value=await readJson<{format:number;verified:boolean;remoteId:string|null;requiresCoverage?:boolean}>(db,key);assertLocal(value?.format===1&&value.verified);
  if(expected)assertLocal(expected.current?.some(c=>c.subjectId===subject&&c.recordId===value.remoteId));authorities.push({subject,value});
 }
 return {configuration:configured.configuration,definition:JSON.parse(definition.definition_json),rows,authorities};
}
export function createRevisionReceiptStorage(getDatabase:()=>Promise<Database>,queryKeys:{panel(scope:PanelSnapshotScope):string;report(scope:ReportSnapshotScope):string}&PreparationCoverageKeys,readRecords?:VerifiedRecordsReader){
 async function active(db:SQLite.SQLiteDatabase,c:ReceiptContext){assertRevisionScope(c.scope,c.manifest);assertLocal(c.isCurrent(),"REVISION_SCOPE_RETIRED");assertLocal(same(await readJson(db,ACTIVE),{scope:c.scope,sessionId:c.sessionId}),"REVISION_SCOPE_RETIRED");}
 return observeNegotiatedReceipts({
  ...createConsultationRevisionStorage(getDatabase,(db,scope,artifact,expected)=>materialization(db,scope,artifact,expected,queryKeys)),
  ...createRecordsRevisionStorage(getDatabase,(db,scope,artifact,expected)=>materialization(db,scope,artifact,expected,queryKeys),readRecords),
  ...createCatalogRevisionStorage(getDatabase,{active,materialize:(db,scope,artifact,expected)=>materialization(db,scope,artifact,expected,queryKeys)}),
  ...createPreparationRevisionStorage(getDatabase,{active,keys:queryKeys,materialize:(db,scope,artifact,expected)=>materialization(db,scope,artifact,expected,queryKeys)}),
  async invalidateRevisionReceiptScope(scope:RevisionScope,reason:string){
    const db=await getDatabase();await db.withTransactionAsync(async tx=>{const entries=await tx.getAllAsync<{key:string;value:string}>("SELECT key,value FROM app_metadata WHERE substr(key,1,length(?))=?",prefix(scope),prefix(scope));for(const entry of entries){try{const old=JSON.parse(entry.value) as RevisionReceipt;if(same(old.scope,scope))await writeJson(tx,entry.key,{...old,status:"invalid",invalidReason:reason});}catch{/* Corrupt metadata is never proof. */}}},"transaction:revision-receipt-invalidate-scope");
  },
  async recordRevisionReceiptDiagnostic(scope:RevisionScope,status:string,reason:string|null){
    const db=await getDatabase(),key="revision_receipt_diagnostics_v1:"+await revisionHash(scope);await db.withTransactionAsync(async tx=>{const old=await readJson<{at:string;status:string;reason:string|null}[]>(tx,key)??[];await writeJson(tx,key,[...old.slice(-29),{at:new Date().toISOString(),status,reason}]);},"transaction:revision-receipt-diagnostic");
  },
  async getRevisionReceiptDiagnostics(scope:RevisionScope){return await readJson<{at:string;status:string;reason:string|null}[]>(await getDatabase(),"revision_receipt_diagnostics_v1:"+await revisionHash(scope))??[];},
  async beginRevisionReceiptSession(context:ReceiptContext){assertRevisionScope(context.scope,context.manifest);assertLocal(context.isCurrent(),"REVISION_SCOPE_RETIRED");const db=await getDatabase();await db.withTransactionAsync(async tx=>{assertLocal(context.isCurrent(),"REVISION_SCOPE_RETIRED");await writeJson(tx,ACTIVE,{scope:context.scope,sessionId:context.sessionId});},"transaction:revision-receipt-session");},
  async invalidateRevisionReceipt(context:ReceiptContext,resource:RevisionResource,reason:string){const db=await getDatabase(),key=await keyFor(context.scope,resource);await db.withTransactionAsync(async tx=>{await active(tx,context);const old=await readJson<RevisionReceipt>(tx,key);if(old)await writeJson(tx,key,{...old,status:"invalid",invalidReason:reason});},"transaction:revision-receipt-invalidate");},
  async commitRevisionReceipt(input:{context:ReceiptContext;resource:RevisionResource;artifact:ReceiptArtifact;expected:ReceiptExpected;reads:ReadRevision[]}){
   const {context,resource,artifact,expected,reads}=input;assertLocal(reads.length>0,"READ_REVISION_INCOMPATIBLE");for(const read of reads){assertRevisionMatches(context.manifest,read);assertLocal(read.revision===reads[0].revision,"REVISION_PAGES_MIXED");}
   assertLocal(artifact.kind==="workflow"?["attendance","state-update"].includes(resource.kind):artifact.kind===resource.kind,"REVISION_COVERAGE_MISMATCH");
   if(artifact.kind==="records"||artifact.kind==="definition")assertLocal(artifact.entityTypeId===resource.entityTypeId,"REVISION_COVERAGE_MISMATCH");
   if(artifact.kind==="workflow"||artifact.kind==="panel"||artifact.kind==="report")assertLocal(artifact.scope.appViewId===resource.appViewId,"REVISION_COVERAGE_MISMATCH");
   if(artifact.kind==="panel"){
    const query=resource.query??{};assertLocal(Object.values(query).every(value=>typeof value==="string"),"REVISION_COVERAGE_MISMATCH");
    const scalar=query as Record<string,string>;assertLocal(!!scalar.page&&!!scalar.pageSize,"REVISION_COVERAGE_MISMATCH");const decoded={...artifact.scope,filters:scalar.filters?JSON.parse(scalar.filters):{},page:Number(scalar.page),pageSize:Number(scalar.pageSize),search:scalar.search};
    const panel=expected.json as {configRevision:string;appView:{id:string};datasets:{id:string}[]};assertLocal(queryKeys.panel(decoded)===queryKeys.panel(artifact.scope)&&panel.configRevision===artifact.scope.configRevision&&panel.appView.id===resource.appViewId&&panel.datasets[0]?.id===artifact.scope.datasetId&&(!scalar.datasetId||scalar.datasetId===artifact.scope.datasetId),"REVISION_COVERAGE_MISMATCH");
   }
   if(artifact.kind==="report"){
    const query=resource.query??{};const scalar=query as Record<string,string>;assertLocal(Object.values(query).every(value=>typeof value==="string")&&queryKeys.report({...artifact.scope,from:scalar.from,to:scalar.to,search:scalar.search})===queryKeys.report(artifact.scope),"REVISION_COVERAGE_MISMATCH");
   }
   const db=await getDatabase(),key=await keyFor(context.scope,resource);let receipt!:RevisionReceipt;
   await db.withTransactionAsync(async tx=>{await active(tx,context);const content=await materialization(tx,context.scope,artifact,expected,queryKeys);const contentHash=await revisionHash(content);await active(tx,context);
    receipt={version:1,mode:"shadow",reuseAllowed:false,receiptId:crypto.randomUUID(),snapshotId:crypto.randomUUID(),scope:context.scope,resource,artifact,
     coverage:{complete:true,completeCollection:artifact.kind==="records",wholeExperience:false,metadataAccredited:artifact.kind==="definition"||artifact.kind==="views",kind:artifact.kind},remote:{epoch:context.manifest.epoch,manifestVectorRevision:context.manifest.readBindingVector.revision,metadataRevision:context.manifest.readDefinitionsRevision,selectionRevision:reads[0].revision,requestFingerprints:reads.map(r=>r.requestFingerprint),contentHashes:reads.map(r=>r.contentHash)},
     local:{contentHash,verifiedAt:new Date().toISOString(),representationVersion:1},status:"verified"};await writeJson(tx,key,receipt);
   },"transaction:revision-receipt-commit");return receipt;
  },
  async inspectRevisionReceipts(input:{scope:RevisionScope;manifest?:RevisionManifest;isCurrent():boolean}):Promise<ReceiptObservation[]>{
   const db=await getDatabase(),observations:ReceiptObservation[]=[];await db.withTransactionAsync(async tx=>{
    assertLocal(input.isCurrent(),"REVISION_SCOPE_RETIRED");if(input.manifest)assertRevisionScope(input.scope,input.manifest);
    const entries=await tx.getAllAsync<{key:string;value:string}>("SELECT key,value FROM app_metadata WHERE substr(key,1,length(?))=?",prefix(input.scope),prefix(input.scope));
    for(const entry of entries){let receipt:RevisionReceipt|null=null;try{receipt=JSON.parse(entry.value) as RevisionReceipt;assertLocal(receipt.version===1&&receipt.mode==="shadow"&&receipt.reuseAllowed===false&&receipt.local.representationVersion===1,"REVISION_RECEIPT_INCOMPATIBLE");
      if(receipt.scope.applicationId!==input.scope.applicationId||receipt.scope.userId!==input.scope.userId)continue;assertLocal(same(receipt.scope,input.scope),"REVISION_AUTHORIZATION_CHANGED");assertLocal(receipt.status==="verified",receipt.invalidReason??"REVISION_RECEIPT_INVALID");assertLocal(await revisionHash(await materialization(tx,input.scope,receipt.artifact,undefined,queryKeys))===receipt.local.contentHash);
      if(input.manifest)assertLocal(input.manifest.epoch===receipt.remote.epoch&&input.manifest.readBindingVector.revision===receipt.remote.manifestVectorRevision&&input.manifest.readDefinitionsRevision===receipt.remote.metadataRevision,"REVISION_REMOTE_CHANGED");
      observations.push({key:entry.key,status:input.manifest?"match_shadow":"remote_unchecked",reason:null,receipt,reuseAllowed:false});
     }catch(error){const reason=error instanceof RevisionReceiptError?error.code:"REVISION_LOCAL_READ_FAILED";if(receipt)await writeJson(tx,entry.key,{...receipt,status:"invalid",invalidReason:reason});observations.push({key:entry.key,status:"invalid",reason,receipt:null,reuseAllowed:false});}
    }
    assertLocal(input.isCurrent(),"REVISION_SCOPE_RETIRED");
   },"transaction:revision-receipt-verify");return observations;
  },
 },getDatabase);
}
export type RevisionReceiptStore=ReturnType<typeof createRevisionReceiptStorage>;
