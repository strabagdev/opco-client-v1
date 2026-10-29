export type SubjectPresentationConfig = { version: 1; titleFieldIds: string[]; secondaryFieldIds: string[] };
export type SubjectPresentationField = { id: string; key: string; name: string; type: string; multiple: boolean; config?: Record<string, unknown>; options?: {value:string;label:string}[]; targetEntityTypeId?:string; relationReadable?:boolean };
export type SubjectPresentationDefinition = { version:1; sourceEntityTypeId:string; config:SubjectPresentationConfig; fields:SubjectPresentationField[]; fingerprint:string };
export type SubjectPresentationCell = { fieldId:string; status:"value"|"empty"|"unavailable"|"inaccessible"; value?:unknown };
export type SubjectPresentationProjection = { version:1; subjectId:string; fingerprint:string; sourceUpdatedAt?:string; capturedAt?:string; cells:SubjectPresentationCell[] };
export type PresentedSubject = { id:string; displayName:string; presentation?:SubjectPresentationProjection };
export function parseSubjectPresentation(value:unknown):SubjectPresentationConfig|null {
 if(value===undefined)return null;
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("INVALID_SUBJECT_PRESENTATION");
 const v=value as Record<string,unknown>;
 if(v.version!==1||Object.keys(v).sort().join()!=="secondaryFieldIds,titleFieldIds,version")throw Error("INVALID_SUBJECT_PRESENTATION");
 const ids=(x:unknown,max:number)=>{if(!Array.isArray(x)||x.length>max||x.some(id=>typeof id!=="string"||!id.trim()||id!==id.trim())||new Set(x).size!==x.length)throw Error("INVALID_SUBJECT_PRESENTATION");return x as string[];};
 const titleFieldIds=ids(v.titleFieldIds,8),secondaryFieldIds=ids(v.secondaryFieldIds,12);if(!titleFieldIds.length)throw Error("INVALID_SUBJECT_PRESENTATION");
 return {version:1,titleFieldIds,secondaryFieldIds};
}
export const subjectPresentationTypes = new Set(["TEXT","TEXTAREA","EMAIL","PHONE","URL","TIME","DATE","DATETIME","INTEGER","DECIMAL","MONEY","BOOLEAN","SELECT","MULTISELECT","RELATION"]);
export function presentationFingerprint(sourceEntityTypeId:string,config:SubjectPresentationConfig,fields:SubjectPresentationField[]){return JSON.stringify({version:1,sourceEntityTypeId,config,fields});}
export function verifyPresentationDefinition(value:unknown,sourceEntityTypeId?:string,config?:SubjectPresentationConfig):SubjectPresentationDefinition {
 const d=value as SubjectPresentationDefinition;if(!d||d.version!==1||typeof d.sourceEntityTypeId!=="string"||(sourceEntityTypeId&&sourceEntityTypeId!==d.sourceEntityTypeId)||!Array.isArray(d.fields))throw Error("SUBJECT_PRESENTATION_UNAVAILABLE");
 const parsed=parseSubjectPresentation(d.config)!;if(config&&JSON.stringify(parsed)!==JSON.stringify(config))throw Error("SUBJECT_PRESENTATION_UNAVAILABLE");
 const ids=[...new Set([...parsed.titleFieldIds,...parsed.secondaryFieldIds])];if(ids.length!==d.fields.length||ids.some((id,i)=>d.fields[i]?.id!==id))throw Error("SUBJECT_PRESENTATION_UNAVAILABLE");
 for(const f of d.fields){if(!f||!f.key||!f.name||!subjectPresentationTypes.has(f.type)||typeof f.multiple!=="boolean"||f.options?.some(o=>typeof o.label!=="string"||typeof o.value!=="string"))throw Error("SUBJECT_PRESENTATION_UNAVAILABLE");}
 if(d.fingerprint!==presentationFingerprint(d.sourceEntityTypeId,parsed,d.fields))throw Error("SUBJECT_PRESENTATION_UNAVAILABLE");return d;
}
export function projectSubject(definition:SubjectPresentationDefinition,subjectId:string,values:Record<string,unknown>,inaccessibleFields:string[]=[],sourceUpdatedAt?:string,capturedAt?:string):SubjectPresentationProjection {
 return {version:1,subjectId,fingerprint:definition.fingerprint,...(sourceUpdatedAt?{sourceUpdatedAt}:{}),...(capturedAt?{capturedAt}:{}),cells:definition.fields.map(f=>{
  if(inaccessibleFields.includes(f.id))return {fieldId:f.id,status:"inaccessible"};
  if(f.type==="RELATION"&&f.relationReadable!==true)return {fieldId:f.id,status:"inaccessible"};
  if(!Object.prototype.hasOwnProperty.call(values,f.key))return {fieldId:f.id,status:"unavailable"};
  const value=values[f.key];if(value===null||value===""||(Array.isArray(value)&&!value.length))return {fieldId:f.id,status:"empty"};
  return {fieldId:f.id,status:"value",value};
 })};
}
export function validSubjectProjection(value:unknown,definition:SubjectPresentationDefinition,subjectId:string):value is SubjectPresentationProjection {
 const p=value as SubjectPresentationProjection;return !!p&&p.version===1&&p.subjectId===subjectId&&p.fingerprint===definition.fingerprint&&Array.isArray(p.cells)&&p.cells.length===definition.fields.length&&p.cells.every((c,i)=>c?.fieldId===definition.fields[i].id&&["value","empty","unavailable","inaccessible"].includes(c.status));
}
