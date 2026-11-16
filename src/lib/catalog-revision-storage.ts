import type * as SQLite from "expo-sqlite";
import type {AppView,EntityDefinition} from "./opco-api";
import type {PreparedAppViewDefinition} from "./app-view-definitions-cache";
import type {PreparationPart} from "./preparation-revision-contract";
import type {ReceiptArtifact,ReceiptContext,ReceiptExpected} from "./revision-receipt-storage";
import {catalogDependencies,catalogRootIds,type CatalogDependency} from "./catalog-revision-contract";
import {assertRevisionScope,assertRevisionMatches,revisionCanonical,revisionHash,RevisionReceiptError,type RevisionScope,type RevisionManifest} from "./revision-receipts";
type Database=Omit<SQLite.SQLiteDatabase,"withTransactionAsync">&{withTransactionAsync(work:(tx:SQLite.SQLiteDatabase)=>Promise<void>,name?:`transaction:${string}`):Promise<void>};
export type CatalogPlan={appView:AppView;prepared:PreparedAppViewDefinition;dependencies:CatalogDependency[];parts:PreparationPart[]};
export type CatalogReceipt={version:1;mode:"shadow";reuseAllowed:false;scope:RevisionScope;appViewId:string;snapshotId:string;
 coverage:{kind:"field-options-and-direct-catalogs";complete:true;contextBusinessRecords:false;transitiveCatalogs:false};dependencies:CatalogDependency[];parts:Omit<PreparationPart,"expected">[];
 remote:{epoch:string;vector:string;metadata:string};localHash:string;verifiedAt:string;status:"verified"|"invalid";invalidReason?:string};
export type CatalogObservation={status:"match_shadow"|"remote_unchecked"|"invalid";reason:string|null;receipt:CatalogReceipt|null;reuseAllowed:false};
const PREFIX="catalog_revision_receipt:v1:";
const prefix=(s:Pick<RevisionScope,"ownerKey"|"contractId">)=>PREFIX+JSON.stringify([s.ownerKey,s.contractId])+":";
const key=(s:RevisionScope,id:string)=>prefix(s)+JSON.stringify([s.applicationId,s.userId,id]);
const same=(a:unknown,b:unknown)=>revisionCanonical(a)===revisionCanonical(b);
function requireProof(v:unknown,code="CATALOG_COVERAGE_INCOMPLETE"):asserts v{if(!v)throw new RevisionReceiptError(code);}
export function createCatalogRevisionStorage(getDatabase:()=>Promise<Database>,deps:{active(db:SQLite.SQLiteDatabase,c:ReceiptContext):Promise<void>;materialize(db:SQLite.SQLiteDatabase,s:RevisionScope,a:ReceiptArtifact,e?:ReceiptExpected):Promise<unknown>}){
 const write=(db:SQLite.SQLiteDatabase,k:string,v:unknown)=>db.runAsync("INSERT INTO app_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",k,JSON.stringify(v));
 async function content(db:SQLite.SQLiteDatabase,scope:RevisionScope,receipt:Pick<CatalogReceipt,"appViewId"|"dependencies"|"parts">,plan?:CatalogPlan){
  const row=await db.getFirstAsync<{definition_json:string;status:string}>("SELECT definition_json,status FROM app_view_definitions WHERE owner_key=? AND contract_id=? AND app_view_id=?",scope.ownerKey,scope.contractId,receipt.appViewId);requireProof(row?.status==="ready","CATALOG_DEFINITION_UNAVAILABLE");
  const prepared=JSON.parse(row.definition_json) as PreparedAppViewDefinition,view=prepared.appView;requireProof(view.id===receipt.appViewId);
  if(plan)requireProof(same(plan.prepared,prepared)&&same(plan.appView,view),"CATALOG_DEFINITION_MISMATCH");
  const fields=new Map<string,EntityDefinition>(),parts:unknown[]=[];let views=0;
  for(let i=0;i<receipt.parts.length;i++){
   const part=receipt.parts[i],a=part.artifact;requireProof(["definition","records","views"].includes(a.kind)&&a.kind===part.resource.kind&&part.reads.length>0);
   if(a.kind==="definition"||a.kind==="records")requireProof(a.entityTypeId===part.resource.entityTypeId);
   const value=await deps.materialize(db,scope,a,plan?.parts[i].expected);parts.push(value);
   if(a.kind==="definition"){requireProof(!fields.has(a.entityTypeId));fields.set(a.entityTypeId,value as EntityDefinition);}
   if(a.kind==="views"){views++;requireProof(Array.isArray(value)&&same(value.find(v=>v.id===view.id),view),"CATALOG_ASSIGNMENTS_CHANGED");}
  }
  requireProof(views===1);catalogRootIds(view).forEach(id=>requireProof(fields.has(id)));
  const dependencies=catalogDependencies(view,prepared,fields);requireProof(same(dependencies,receipt.dependencies),"CATALOG_DEFINITION_MISMATCH");
  for(const id of new Set(dependencies.flatMap(d=>d.targetEntityTypeId?[d.targetEntityTypeId]:[]))){
   requireProof(fields.has(id)&&receipt.parts.filter(p=>p.artifact.kind==="records"&&p.artifact.entityTypeId===id).length===1);
  }
  return{prepared,dependencies,recipe:receipt.parts,parts};
 }
 return{
  async retireCatalogRevisionReceipts(scope:Pick<RevisionScope,"ownerKey"|"contractId">,isCurrent:()=>boolean){
   const db=await getDatabase();await db.withTransactionAsync(async tx=>{requireProof(isCurrent(),"REVISION_SCOPE_RETIRED");for(const row of await tx.getAllAsync<{key:string;value:string}>("SELECT key,value FROM app_metadata WHERE substr(key,1,length(?))=?",prefix(scope),prefix(scope))){try{await write(tx,row.key,{...JSON.parse(row.value),status:"invalid",invalidReason:"CATALOG_REFRESH_IN_PROGRESS"});}catch{throw new RevisionReceiptError("CATALOG_RETIRE_FAILED");}}requireProof(isCurrent(),"REVISION_SCOPE_RETIRED");},"transaction:catalog-revision-retire");
  },
  async commitCatalogRevisionReceipt(context:ReceiptContext,plan:CatalogPlan):Promise<CatalogReceipt>{
   assertRevisionScope(context.scope,context.manifest);
   for(const part of plan.parts){requireProof(part.reads.length>0);for(const seal of part.reads){assertRevisionMatches(context.manifest,seal);requireProof(seal.revision===part.reads[0].revision,"REVISION_PAGES_MIXED");}}
   const db=await getDatabase();let receipt!:CatalogReceipt;
   await db.withTransactionAsync(async tx=>{await deps.active(tx,context);const base={appViewId:plan.appView.id,dependencies:plan.dependencies,parts:plan.parts.map(({expected:_expected,...p})=>p)};
    const localHash=await revisionHash(await content(tx,context.scope,base,plan));await deps.active(tx,context);
    receipt={...base,version:1,mode:"shadow",reuseAllowed:false,scope:context.scope,snapshotId:crypto.randomUUID(),coverage:{kind:"field-options-and-direct-catalogs",complete:true,contextBusinessRecords:false,transitiveCatalogs:false},remote:{epoch:context.manifest.epoch,vector:context.manifest.readBindingVector.revision,metadata:context.manifest.readDefinitionsRevision},localHash,verifiedAt:new Date().toISOString(),status:"verified"};await write(tx,key(context.scope,receipt.appViewId),receipt);
   },"transaction:catalog-revision-commit");return receipt;
  },
  async inspectCatalogRevisionReceipts(input:{scope:RevisionScope;manifest?:RevisionManifest;appViewId?:string;isCurrent():boolean;onVerified?(receipt:CatalogReceipt,storage:object,prepared:PreparedAppViewDefinition):Promise<void>}):Promise<CatalogObservation[]>{
   const db=await getDatabase(),result:CatalogObservation[]=[];if(input.manifest)assertRevisionScope(input.scope,input.manifest);
   await db.withTransactionAsync(async tx=>{requireProof(input.isCurrent(),"REVISION_SCOPE_RETIRED");
    for(const row of await tx.getAllAsync<{key:string;value:string}>("SELECT key,value FROM app_metadata WHERE substr(key,1,length(?))=?",prefix(input.scope),prefix(input.scope))){let receipt:CatalogReceipt|null=null;
     try{receipt=JSON.parse(row.value);requireProof(receipt?.version===1&&typeof receipt.snapshotId==="string"&&receipt.mode==="shadow"&&receipt.reuseAllowed===false&&receipt.coverage.kind==="field-options-and-direct-catalogs"&&receipt.coverage.complete===true&&receipt.coverage.contextBusinessRecords===false&&receipt.coverage.transitiveCatalogs===false,"CATALOG_RECEIPT_INCOMPATIBLE");
      if(input.appViewId&&receipt.appViewId!==input.appViewId)continue;
      if(receipt.scope.applicationId!==input.scope.applicationId||receipt.scope.userId!==input.scope.userId)continue;
      requireProof(same(receipt.scope,input.scope),"REVISION_AUTHORIZATION_CHANGED");requireProof(receipt.status==="verified",receipt.invalidReason??"CATALOG_RECEIPT_INVALID");
      const local=await content(tx,input.scope,receipt);requireProof(await revisionHash(local)===receipt.localHash,"REVISION_LOCAL_CONTENT_MISMATCH");
      if(input.manifest)requireProof(receipt.remote.epoch===input.manifest.epoch&&receipt.remote.vector===input.manifest.readBindingVector.revision&&receipt.remote.metadata===input.manifest.readDefinitionsRevision,"REVISION_REMOTE_CHANGED");
      if(input.manifest)await input.onVerified?.(receipt,db,local.prepared);requireProof(input.isCurrent(),"REVISION_SCOPE_RETIRED");
      result.push({status:input.manifest?"match_shadow":"remote_unchecked",reason:null,receipt,reuseAllowed:false});
     }catch(error){const reason=error instanceof RevisionReceiptError?error.code:"CATALOG_LOCAL_READ_FAILED";if(receipt)await write(tx,row.key,{...receipt,status:"invalid",invalidReason:reason});result.push({status:"invalid",reason,receipt:null,reuseAllowed:false});}
    }requireProof(input.isCurrent(),"REVISION_SCOPE_RETIRED");
   },"transaction:catalog-revision-inspect");return result;
  },
 };
}
