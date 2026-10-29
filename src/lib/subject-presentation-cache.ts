import {subjectPresentationView} from "./subject-presentation-display";
import type {SQLiteDatabase} from "expo-sqlite";
import {projectSubject,verifyPresentationDefinition,validSubjectProjection,parseSubjectPresentation,type PresentedSubject,type SubjectPresentationDefinition} from "./subject-presentation";
type DB=Pick<SQLiteDatabase,"getFirstAsync"|"getAllAsync"|"runAsync">;
export type PresentationScope={ownerKey:string;contractId:string;appViewId:string;sourceEntityTypeId:string};
const key=(scope:PresentationScope,fingerprint:string,id:string)=>"subject_presentation:v1:"+JSON.stringify([scope.ownerKey,scope.contractId,scope.appViewId,scope.sourceEntityTypeId,fingerprint,id]);
export async function persistSubjectPresentations(db:DB,scope:PresentationScope,definition:SubjectPresentationDefinition,subjects:PresentedSubject[]){
 verifyPresentationDefinition(definition,scope.sourceEntityTypeId);
 let persistedSubjects=0;let complete=true;const unique=[...new Map(subjects.map(s=>[s.id,s])).values()];
 for(const subject of unique){if(!validSubjectProjection(subject.presentation,definition,subject.id)){complete=false;continue;}
  complete&&=subjectPresentationView(subject,definition.config,definition).complete;persistedSubjects++;
  const existing=await db.getFirstAsync<{value:string}>("SELECT value FROM app_metadata WHERE key=?",key(scope,definition.fingerprint,subject.id));
  if(existing){try{const old=JSON.parse(existing.value) as typeof subject.presentation;const incoming=subject.presentation;if(old.sourceUpdatedAt&&(!incoming.sourceUpdatedAt||old.sourceUpdatedAt>incoming.sourceUpdatedAt))continue;if(old.sourceUpdatedAt===incoming.sourceUpdatedAt&&old.capturedAt&&(!incoming.capturedAt||old.capturedAt>incoming.capturedAt))continue;}catch{ /* invalid visual entry can be replaced */ }}
  await db.runAsync("INSERT INTO app_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",key(scope,definition.fingerprint,subject.id),JSON.stringify(subject.presentation));}
 return {persistedSubjects,requestedSubjects:unique.length,complete};
}
/** No networking and no writes to entity_records/outbox. Old/missing metadata keeps legacy operations usable. */
export async function hydrateSubjectPresentations(db:DB,scope:PresentationScope,prepared:unknown,subjects:PresentedSubject[]):Promise<PresentedSubject[]>{
 try{
  const p=prepared as {appView:{config:{subjectPresentation?:unknown}};subjectPresentation?:SubjectPresentationDefinition};
  if(p?.appView?.config.subjectPresentation===undefined)return subjects;
  const config=parseSubjectPresentation(p.appView.config.subjectPresentation)!;const definition=verifyPresentationDefinition(p.subjectPresentation,scope.sourceEntityTypeId,config);
  if(!subjects.length)return subjects;
  const ids=[...new Set(subjects.map(s=>s.id))];
  const rows=await db.getAllAsync<{server_id:string;values_json:string;remote_updated_at:string|null}>(`SELECT server_id,values_json,remote_updated_at FROM entity_records WHERE owner_key=? AND contract_id=? AND entity_type_id=? AND server_id IN (${ids.map(()=>"?").join(",")})`,scope.ownerKey,scope.contractId,scope.sourceEntityTypeId,...ids);
  const records=new Map(rows.map(row=>[row.server_id,{values:JSON.parse(row.values_json) as Record<string,unknown>,updatedAt:row.remote_updated_at??undefined}]));
  const keys=subjects.map(s=>key(scope,definition.fingerprint,s.id));
  const cached=await db.getAllAsync<{key:string;value:string}>(`SELECT key,value FROM app_metadata WHERE key IN (${keys.map(()=>"?").join(",")})`,...keys);
  const projections=new Map(cached.map(row=>[row.key,JSON.parse(row.value) as unknown]));
  return subjects.map(subject=>{
   const projection=projections.get(key(scope,definition.fingerprint,subject.id));
   if(validSubjectProjection(projection,definition,subject.id))return {...subject,presentation:projection};
   const record=records.get(subject.id);return record?{...subject,presentation:projectSubject(definition,subject.id,record.values,[],record.updatedAt)}:subject;
  });
 }catch{return subjects;}
}
/** Availability for the already prepared source only; never a certificate of remote freshness or a larger source scope. */
export async function preparedPresentationAvailable(store:{listCachedRecords:(query:{ownerKey:string;contractId:string;entityTypeId:string;page:number;pageSize:number})=>Promise<{records:{id:string;serverId?:string|null;displayName:string;values:Record<string,unknown>}[];pagination:{total:number;totalPages:number}} >},scope:PresentationScope,prepared:unknown){
 const p=prepared as {appView?:{config?:{subjectPresentation?:unknown}};subjectPresentation?:SubjectPresentationDefinition};
 if(p?.appView?.config?.subjectPresentation===undefined)return true;
 try{
  const config=parseSubjectPresentation(p.appView.config.subjectPresentation)!;const definition=verifyPresentationDefinition(p.subjectPresentation,scope.sourceEntityTypeId,config);
  let pages=1,total:number|undefined;const seen=new Set<string>();
  for(let page=1;page<=pages;page++){
   const cached=await store.listCachedRecords({ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:scope.sourceEntityTypeId,page,pageSize:100});
   total??=cached.pagination.total;if(total!==cached.pagination.total)return false;pages=Math.max(1,cached.pagination.totalPages);
   for(const record of cached.records){const id=record.serverId??record.id;if(seen.has(id))return false;seen.add(id);const subject={id:record.serverId??record.id,displayName:record.displayName,presentation:projectSubject(definition,record.serverId??record.id,record.values)};if(!subjectPresentationView(subject,config,definition).complete)return false;}
  }
  return seen.size===total;
 }catch{return false;}
}
