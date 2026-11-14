import type {AppView,EntityDefinition,EntityField} from "./opco-api";
import type {PreparedAppViewDefinition} from "./app-view-definitions-cache";
import {getRelationTargetEntityTypeId,isRelationFieldMultiple} from "./record-form";
import {revisionCanonical,RevisionReceiptError} from "./revision-receipts";

export type CatalogDependency={entityTypeId:string;fieldId:string;type:string;roles:string[];targetEntityTypeId?:string;cardinality?:"ONE"|"MANY"};
export const catalogSupported=(v:AppView)=>v.type==="RECORDS"||v.type==="WORKFLOW"&&["attendance","state-update"].includes(v.config.workflowKey??"");
export function catalogRootIds(view:AppView):string[]{
 if(view.type==="RECORDS")return[view.config.entityTypeId];
 if(view.type==="WORKFLOW"&&["attendance","state-update"].includes(view.config.workflowKey??""))return[view.config.sourceEntityTypeId,view.config.targetEntityTypeId] as string[];
 throw new RevisionReceiptError("CATALOG_RENDERER_UNSUPPORTED");
}
const requireCatalog=(v:unknown,code="CATALOG_DEFINITION_MISMATCH")=>{if(!v)throw new RevisionReceiptError(code);};
/** Direct choices only. Returned relation labels are bound by Core's transitive revision vector. */
export function catalogDependencies(view:AppView,prepared:PreparedAppViewDefinition,definitions:Map<string,EntityDefinition>):CatalogDependency[]{
 const byField=new Map<string,CatalogDependency>();
 const root=(id:string)=>{const d=definitions.get(id);requireCatalog(d?.id===id&&d.active===true,"CATALOG_DEFINITION_UNAVAILABLE");return d!;};
 catalogRootIds(view).forEach(root);
 const add=(entityId:string,id:string,role:string,ui?:unknown)=>{
  const f=root(entityId).fields.find(f=>f.id===id&&f.active!==false);requireCatalog(f,"CATALOG_FIELD_UNAVAILABLE");
  const field=f!;if(ui){const u=ui as EntityField&{fieldId?:string};requireCatalog((u.fieldId??u.id)===field.id&&(u.type??(role==="state"?"SELECT":undefined))===field.type);
   if(["SELECT","MULTISELECT"].includes(field.type)){
    const options=(field.options??[]).filter(o=>o.active!==false),shown=(u.options??[]) as {id?:string;optionId?:string;label:string;value?:string;active?:boolean}[];
    requireCatalog(options.length===shown.filter(o=>o.active!==false).length&&options.every((o,index)=>{const s=shown.filter(o=>o.active!==false)[index];return s&&(s.id??s.optionId)===o.id&&s.label===o.label&&(s.value===undefined?role==="state":s.value===o.value);}),"CATALOG_OPTIONS_UNBOUND");
   }
   if(field.type==="RELATION")requireCatalog(getRelationTargetEntityTypeId(field)===getRelationTargetEntityTypeId(u)&&isRelationFieldMultiple(field)===isRelationFieldMultiple(u));
  }
  const key=entityId+":"+id,previous=byField.get(key);if(previous){previous.roles=[...new Set([...previous.roles,role])].sort();return;}
  const dependency:CatalogDependency={entityTypeId:entityId,fieldId:id,type:field.type,roles:[role]};
  if(field.type==="RELATION"){
   const target=getRelationTargetEntityTypeId(field);requireCatalog(target,"CATALOG_TARGET_UNAVAILABLE");
   dependency.targetEntityTypeId=target!;dependency.cardinality=isRelationFieldMultiple(field)?"MANY":"ONE";
  }
  byField.set(key,dependency);
 };
 if(view.type==="RECORDS"){
  const d=root(view.config.entityTypeId);requireCatalog(prepared.kind==="records"&&revisionCanonical(prepared.entityDefinition)===revisionCanonical(d));
  for(const f of d.fields.filter(f=>f.active!==false&&["SELECT","MULTISELECT","RELATION"].includes(f.type)))add(d.id,f.id,"record-field");
 }else if(view.type==="WORKFLOW"&&prepared.kind==="state-update"){
  const cfg=view.config as unknown as {sourceEntityTypeId:string;targetEntityTypeId:string;workflowKey:string;personFieldId?:string;subjectFieldId?:string;statusFieldId?:string;contextFieldIds?:string[];stateFields?:{fieldId:string}[];extraFieldIds?:string[]};
  requireCatalog(prepared.sourceEntityTypeId===cfg.sourceEntityTypeId&&prepared.targetEntityTypeId===cfg.targetEntityTypeId);
  const subject=cfg.workflowKey==="attendance"?cfg.personFieldId:cfg.subjectFieldId;requireCatalog(subject);add(cfg.targetEntityTypeId,subject!,"subject");
  requireCatalog(byField.get(cfg.targetEntityTypeId+":"+subject)?.targetEntityTypeId===cfg.sourceEntityTypeId);
  const states=cfg.workflowKey==="attendance"?[cfg.statusFieldId!]:cfg.stateFields?.map(f=>f.fieldId)??prepared.stateFields.map(f=>f.fieldId);
  for(const id of states){const ui=prepared.stateFields.find(f=>f.fieldId===id);requireCatalog(ui);add(cfg.targetEntityTypeId,id,"state",ui);}
  const extras=cfg.workflowKey==="attendance"?cfg.contextFieldIds??[]:cfg.extraFieldIds??prepared.extraFields.map(f=>f.id);
  for(const id of extras){const ui=prepared.extraFields.find(f=>f.id===id);requireCatalog(ui);add(cfg.targetEntityTypeId,id,cfg.workflowKey==="attendance"?"context":"extra",ui);}
  for(const ui of prepared.identityFields??[])add(cfg.targetEntityTypeId,ui.fieldId,"identity",ui);
 }else throw new RevisionReceiptError("CATALOG_DEFINITION_UNAVAILABLE");
 return [...byField.values()].sort((a,b)=>(a.entityTypeId+":"+a.fieldId).localeCompare(b.entityTypeId+":"+b.fieldId));
}
