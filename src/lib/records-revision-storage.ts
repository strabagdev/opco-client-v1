import type * as SQLite from "expo-sqlite";
import type { AppView } from "./opco-api";
import type { ReceiptArtifact, ReceiptContext, ReceiptExpected } from "./revision-receipt-storage";
import type { PreparationPart } from "./preparation-revision-contract";
import type { RecordsCoveragePlan } from "./records-revision-contract";
import { assertRevisionMatches, assertRevisionScope, revisionCanonical, revisionHash, RevisionReceiptError, type RevisionManifest, type RevisionScope } from "./revision-receipts";

type Database = Omit<SQLite.SQLiteDatabase,"withTransactionAsync"> & {withTransactionAsync(work:(tx:SQLite.SQLiteDatabase)=>Promise<void>,name?:`transaction:${string}`):Promise<void>};
export type RecordsRevisionContext = ReceiptContext & {appViewId:string};
export type RecordsRevisionReceipt = {
 version:1; mode:"shadow"; reuseAllowed:false; scope:RevisionScope; appViewId:string; entityTypeId:string; snapshotId:string;
 coverage:{kind:"unfiltered-collection";complete:true;arbitraryQueries:false;catalogsIncluded:false};
 parts:Omit<PreparationPart,"expected">[]; remote:{epoch:string;vector:string;metadata:string}; localHash:string;
 status:"verified"|"invalid"; invalidReason?:string; verifiedAt:string;
};
const key = (s:Pick<RevisionScope,"ownerKey"|"contractId">,id:string) => JSON.stringify([s.ownerKey,s.contractId,id]);
const same = (a:unknown,b:unknown) => revisionCanonical(a) === revisionCanonical(b);
function proof(v:unknown,code="RECORDS_COVERAGE_INCOMPLETE"):asserts v {if(!v)throw new RevisionReceiptError(code);}
const write = (db:SQLite.SQLiteDatabase,k:string,v:unknown) => db.runAsync("INSERT INTO app_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",k,JSON.stringify(v));
export function createRecordsRevisionStorage(getDatabase:()=>Promise<Database>,materialize:(db:SQLite.SQLiteDatabase,s:RevisionScope,a:ReceiptArtifact,e?:ReceiptExpected)=>Promise<unknown>) {
 async function active(db:SQLite.SQLiteDatabase,c:RecordsRevisionContext) {
  proof(c.isCurrent(),"REVISION_SCOPE_RETIRED");assertRevisionScope(c.scope,c.manifest);
  const row=await db.getFirstAsync<{value:string}>("SELECT value FROM app_metadata WHERE key=?","records_revision_active:v1:"+key(c.scope,c.appViewId));
  proof(row && same(JSON.parse(row.value),{scope:c.scope,sessionId:c.sessionId}),"REVISION_SCOPE_RETIRED");
 }
 async function content(db:SQLite.SQLiteDatabase,scope:RevisionScope,r:Pick<RecordsRevisionReceipt,"appViewId"|"entityTypeId"|"parts">,expected?:RecordsCoveragePlan) {
  proof(r.parts.length===3 && r.parts[0].artifact.kind==="views" && r.parts[1].artifact.kind==="definition" && r.parts[2].artifact.kind==="records");
  const values:unknown[]=[];
  for(const [i,p]of r.parts.entries()) {
   proof(p.resource.kind===p.artifact.kind && p.reads.length>0);
   if(p.artifact.kind==="definition"||p.artifact.kind==="records")proof(p.artifact.entityTypeId===r.entityTypeId && p.resource.entityTypeId===r.entityTypeId);
   values.push(await materialize(db,scope,p.artifact,expected?.parts[i].expected));
  }
  const view=(values[0] as AppView[]).find(v=>v.id===r.appViewId);
  proof(view?.type==="RECORDS" && view.config.entityTypeId===r.entityTypeId,"RECORDS_CONFIGURATION_CHANGED");
  if(expected)proof(same(view,expected.appView),"RECORDS_CONFIGURATION_CHANGED");
  return {parts:r.parts,values};
 }
 return {
  async recordRecordsRevisionStatus(input:{ownerKey:string;contractId:string;appViewId:string;reason:string;partial?:boolean;isCurrent():boolean}) {
   const db=await getDatabase();await db.withTransactionAsync(async tx=>{proof(input.isCurrent(),"REVISION_SCOPE_RETIRED");await write(tx,"records_revision_status:v1:"+key(input,input.appViewId),{reason:input.reason,partial:input.partial===true,at:new Date().toISOString()});},"transaction:records-revision-status");
  },
  async beginRecordsRevisionRead(c:RecordsRevisionContext) {
   assertRevisionScope(c.scope,c.manifest);const db=await getDatabase();await db.withTransactionAsync(async tx=>{
    proof(c.isCurrent(),"REVISION_SCOPE_RETIRED");await write(tx,"records_revision_active:v1:"+key(c.scope,c.appViewId),{scope:c.scope,sessionId:c.sessionId});
    const k="records_revision_receipt:v1:"+key(c.scope,c.appViewId),row=await tx.getFirstAsync<{value:string}>("SELECT value FROM app_metadata WHERE key=?",k);
    if(row){try{const old=JSON.parse(row.value);if(!same(old.scope,c.scope)||old.remote.epoch!==c.manifest.epoch||old.remote.vector!==c.manifest.readBindingVector.revision||old.remote.metadata!==c.manifest.readDefinitionsRevision)await write(tx,k,{...old,status:"invalid",invalidReason:"REVISION_REMOTE_CHANGED"});}catch{/* Invalid metadata cannot become a proof. */}}
    proof(c.isCurrent(),"REVISION_SCOPE_RETIRED");
   },"transaction:records-revision-session");
  },
  async commitRecordsRevisionReceipt(c:RecordsRevisionContext,plan:RecordsCoveragePlan) {
   assertRevisionScope(c.scope,c.manifest);proof(c.appViewId===plan.appView.id);
   for(const p of plan.parts){proof(p.reads.length>0);for(const seal of p.reads){assertRevisionMatches(c.manifest,seal);proof(seal.revision===p.reads[0].revision,"REVISION_PAGES_MIXED");}}
   const db=await getDatabase();let receipt!:RecordsRevisionReceipt;
   await db.withTransactionAsync(async tx=>{await active(tx,c);const base={appViewId:plan.appView.id,entityTypeId:plan.entityTypeId,parts:plan.parts.map(({expected:_expected,...p})=>p)};
    const localHash=await revisionHash(await content(tx,c.scope,base,plan));await active(tx,c);
    receipt={...base,version:1,mode:"shadow",reuseAllowed:false,scope:c.scope,snapshotId:crypto.randomUUID(),coverage:{kind:"unfiltered-collection",complete:true,arbitraryQueries:false,catalogsIncluded:false},remote:{epoch:c.manifest.epoch,vector:c.manifest.readBindingVector.revision,metadata:c.manifest.readDefinitionsRevision},localHash,status:"verified",verifiedAt:new Date().toISOString()};
    await write(tx,"records_revision_receipt:v1:"+key(c.scope,c.appViewId),receipt);
   },"transaction:records-revision-commit");return receipt;
  },
  async inspectRecordsRevisionCoverage(input:{scope:RevisionScope;appView:AppView;manifest?:RevisionManifest;isCurrent():boolean}) {
   const db=await getDatabase();if(input.manifest)assertRevisionScope(input.scope,input.manifest);
   let result!:{coverage:"complete"|"partial"|"unprepared";status:"match_shadow"|"remote_unchecked"|"invalid"|"unavailable";reason:string|null;receipt:RecordsRevisionReceipt|null;reuseAllowed:false};
   await db.withTransactionAsync(async tx=>{
    proof(input.isCurrent(),"REVISION_SCOPE_RETIRED");const k="records_revision_receipt:v1:"+key(input.scope,input.appView.id);
    const row=await tx.getFirstAsync<{value:string}>("SELECT value FROM app_metadata WHERE key=?",k);let receipt:RecordsRevisionReceipt|null=null;
    try {
     proof(row,"RECORDS_RECEIPT_MISSING");receipt=JSON.parse(row.value);
     proof(receipt?.version===1 && receipt.mode==="shadow" && receipt.reuseAllowed===false && typeof receipt.snapshotId==="string" && receipt.coverage.kind==="unfiltered-collection" && receipt.coverage.complete===true && receipt.coverage.arbitraryQueries===false && receipt.coverage.catalogsIncluded===false,"RECORDS_RECEIPT_INCOMPATIBLE");
     proof(same(receipt.scope,input.scope),"REVISION_AUTHORIZATION_CHANGED");proof(receipt.appViewId===input.appView.id && input.appView.type==="RECORDS" && input.appView.config.entityTypeId===receipt.entityTypeId,"RECORDS_CONFIGURATION_CHANGED");
     proof(receipt.status==="verified",receipt.invalidReason??"RECORDS_RECEIPT_INVALID");
     const views=await materialize(tx,input.scope,{kind:"views"});proof(same((views as AppView[]).find(v=>v.id===input.appView.id),input.appView),"RECORDS_CONFIGURATION_CHANGED");
     proof(await revisionHash(await content(tx,input.scope,receipt))===receipt.localHash,"REVISION_LOCAL_CONTENT_MISMATCH");
     if(input.manifest)proof(receipt.remote.epoch===input.manifest.epoch && receipt.remote.vector===input.manifest.readBindingVector.revision && receipt.remote.metadata===input.manifest.readDefinitionsRevision,"REVISION_REMOTE_CHANGED");
     result={coverage:"complete",status:input.manifest?"match_shadow":"remote_unchecked",reason:null,receipt,reuseAllowed:false};
    } catch(error) {
     const reason=error instanceof RevisionReceiptError?error.code:"RECORDS_RECEIPT_LOCAL_ERROR";
     if(receipt)await write(tx,k,{...receipt,status:"invalid",invalidReason:reason});
     const count=input.appView.type==="RECORDS"?await tx.getFirstAsync<{total:number}>("SELECT count(*) AS total FROM entity_records WHERE owner_key=? AND contract_id=? AND entity_type_id=?",input.scope.ownerKey,input.scope.contractId,input.appView.config.entityTypeId):null;
     const state=await tx.getFirstAsync<{value:string}>("SELECT value FROM app_metadata WHERE key=?","records_revision_status:v1:"+key(input.scope,input.appView.id));
     let partial=false;try{partial=!!state && JSON.parse(state.value).partial===true;}catch{/* Not proof. */}
     result={coverage:(count?.total??0)>0||partial?"partial":"unprepared",status:row?"invalid":"unavailable",reason,receipt:null,reuseAllowed:false};
    }
    proof(input.isCurrent(),"REVISION_SCOPE_RETIRED");
   },"transaction:records-revision-inspect");return result;
  },
 };
}
