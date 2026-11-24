import {it,expect,vi} from "vitest";
import {hydrateSubjectPresentations} from "./subject-presentation-cache";
import {presentationFingerprint,projectSubject} from "./subject-presentation";
import {subjectPresentationView} from "./subject-presentation-display";
import {readAttendancePresentedSubject} from "../renderers/workflows/attendance/attendance-record-presentation";
const config={version:1 as const,titleFieldIds:["name"],secondaryFieldIds:["role"]},fields=[{id:"name",key:"name",name:"Name",type:"TEXT",multiple:false},{id:"role",key:"role",name:"Role",type:"TEXT",multiple:false}];
const definition={version:1 as const,sourceEntityTypeId:"people",config,fields,fingerprint:presentationFingerprint("people",config,fields)};
const raw={id:"person",displayName:"IDENTIFIER"},scope={ownerKey:"org:A",contractId:"contract",appViewId:"view",sourceEntityTypeId:"people"};
const prepared={appView:{id:"view",config:{sourceEntityTypeId:"people",subjectPresentation:config}},subjectPresentation:definition};
function database(){return {getFirstAsync:vi.fn(async()=>null),getAllAsync:vi.fn(async(sql:string)=>sql.includes("FROM app_metadata")?[{key:"subject_presentation:v1:"+JSON.stringify([scope.ownerKey,scope.contractId,scope.appViewId,scope.sourceEntityTypeId,definition.fingerprint,raw.id]),value:JSON.stringify(projectSubject(definition,raw.id,{name:"Persisted name",role:"Persisted role"}))}]:[]),runAsync:vi.fn(async()=>{throw Error("Read-only presentation");})};}
it("keeps a valid incoming remote projection instead of replacing it with an older cached presentation",async()=>{
 const db=database(),incoming={...raw,presentation:projectSubject(definition,raw.id,{name:"Current remote",role:"Current role"},[],"2026-11-24T09:10:00Z")};const result=await hydrateSubjectPresentations(db,scope,prepared,[incoming]);expect(result[0]).toBe(incoming);expect(subjectPresentationView(result[0],config,definition).title).toBe("Current remote");expect(db.getAllAsync).not.toHaveBeenCalled();expect(db.runAsync).not.toHaveBeenCalled();
});
it("recovers a persisted projection without a source entity row, with no writes",async()=>{
 const db=database();const result=await hydrateSubjectPresentations(db,scope,prepared,[raw]);expect(subjectPresentationView(result[0],config,definition)).toMatchObject({title:"Persisted name",complete:true});expect(result[0].id).toBe(raw.id);expect(result[0].displayName).toBe(raw.displayName);expect(db.runAsync).not.toHaveBeenCalled();
});
it("the existing Attendance resolver delegates to the shared persisted hydrator facade",async()=>{
 const read=vi.fn(async()=>[{...raw,presentation:projectSubject(definition,raw.id,{name:"Persisted name",role:"Persisted role"})}]);const store={getCachedRecord:vi.fn(async()=>null),getAttendanceDailyRecords:vi.fn(async()=>[]),getSubjectPresentations:read};const result=await readAttendancePresentedSubject(store,{ownerKey:scope.ownerKey,contractId:scope.contractId,appViewId:scope.appViewId,targetEntityTypeId:"events",date:"2026-11-23"},raw,config,definition);
 expect(subjectPresentationView(result,config,definition).title).toBe("Persisted name");expect(read).toHaveBeenCalledOnce();expect(store.getCachedRecord).not.toHaveBeenCalled();
});
it.each(["missing","fingerprint","source","view"])("leaves unavailable/incompatible %s definitions as controlled fallback",async mode=>{
 const db=database();const p=structuredClone(prepared);if(mode==="missing")delete(p as {subjectPresentation?:unknown}).subjectPresentation;if(mode==="fingerprint")p.subjectPresentation.fingerprint="different";if(mode==="source")p.subjectPresentation.sourceEntityTypeId="other";if(mode==="view")p.appView.id="other";
 const result=await hydrateSubjectPresentations(db,scope,p,[raw]);expect(result[0]).toBe(raw);expect(subjectPresentationView(result[0],config,definition).issue).toBeTruthy();expect(db.runAsync).not.toHaveBeenCalled();
});

it("missing duplicate daily subjects share one persisted display batch without changing IDs",async()=>{
 const {readAttendancePresentedSubjects}=await import("../renderers/workflows/attendance/attendance-record-presentation");
 const value={...raw,presentation:projectSubject(definition,raw.id,{name:"Batch name",role:"Batch role"})};const read=vi.fn(async()=>[value]);const store={getCachedRecord:vi.fn(async()=>null),getAttendanceDailyRecords:vi.fn(async()=>[]),getSubjectPresentations:read};
 const result=await readAttendancePresentedSubjects(store,{ownerKey:scope.ownerKey,contractId:scope.contractId,appViewId:scope.appViewId,targetEntityTypeId:"events",date:"2026-11-23"},[raw,{...raw}],config,definition);expect(read).toHaveBeenCalledOnce();expect(read).toHaveBeenCalledWith(scope,[raw]);expect(result.map(p=>p.id)).toEqual([raw.id,raw.id]);expect(result.map(p=>p.displayName)).toEqual([raw.displayName,raw.displayName]);expect(subjectPresentationView(result[1],config,definition).title).toBe("Batch name");
});
it("does not accept an internally valid definition for another configured source entity",async()=>{
 const foreign={...definition,sourceEntityTypeId:"other",fingerprint:presentationFingerprint("other",config,fields)};const read=vi.fn();const store={getCachedRecord:vi.fn(),getAttendanceDailyRecords:vi.fn(),getSubjectPresentations:read};const result=await readAttendancePresentedSubject(store,{...scope,targetEntityTypeId:"events",date:"2026-11-23"},raw,config,foreign);expect(result).toBe(raw);expect(read).not.toHaveBeenCalled();expect(store.getCachedRecord).not.toHaveBeenCalled();
});
