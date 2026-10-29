import {formatRecordValue} from "./entity-record-display";
import type {EntityField,EntityRecordValue} from "./opco-api";
import {parseSubjectPresentation,validSubjectProjection,verifyPresentationDefinition,type PresentedSubject,type SubjectPresentationDefinition} from "./subject-presentation";
export function subjectPresentationView(subject:PresentedSubject,rawConfig:unknown,metadata?:SubjectPresentationDefinition){
 const legacy={title:subject.displayName,secondary:[] as {fieldId:string;label:string;value:string}[],issue:null as string|null,complete:false};
 if(rawConfig===undefined)return legacy;
 try{
  const config=parseSubjectPresentation(rawConfig)!;const d=verifyPresentationDefinition(metadata,undefined,config);
  if(!validSubjectProjection(subject.presentation,d,subject.id))throw Error();
  const cells=subject.presentation.cells;let complete=true;
  const text=(id:string)=>{
   const f=d.fields.find(f=>f.id===id)!,cell=cells.find(c=>c.fieldId===id);
   if(!cell||cell.status==="unavailable"){complete=false;return "Dato no preparado";}
   if(cell.status==="inaccessible"){complete=false;return "Dato no disponible";}
   if(cell.status==="empty")return "";
   const value=cell.value;
   if(f.type==="SELECT"||f.type==="MULTISELECT"){
    const values=f.type==="MULTISELECT"?Array.isArray(value)?value:[value]:[value];
    return values.map(v=>{const label=f.options?.find(o=>o.value===v)?.label;if(label===undefined){complete=false;return "Opción no disponible";}return label;}).join(", ");
   }
   if(f.type==="RELATION"){
    return (Array.isArray(value)?value:[value]).map(v=>{if(v&&typeof v==="object"&&"displayName"in v&&typeof v.displayName==="string"&&"entityTypeId"in v&&v.entityTypeId===f.targetEntityTypeId)return v.displayName;complete=false;return "Relacionado no disponible en esta copia";}).join(", ");
   }
   if(!["string","number","boolean"].includes(typeof value)){complete=false;return "Dato no disponible";}
   return formatRecordValue(value as EntityRecordValue,f as EntityField);
  };
  const title=config.titleFieldIds.map(text).map(value=>value.trim()).filter(Boolean).join(" ")||"Sin datos de presentación";
  const secondary=config.secondaryFieldIds.map(id=>({fieldId:id,label:d.fields.find(f=>f.id===id)!.name,value:text(id)})).filter(f=>f.value!=="");
  return {title,secondary,complete,issue:complete?null:"Presentación parcial: algunos datos no están disponibles en esta copia."};
 }catch{return {...legacy,issue:"Presentación configurada no preparada o incompatible; se conserva la identificación disponible."};}
}
