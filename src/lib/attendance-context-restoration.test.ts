import {it,expect} from "vitest";
import {stateUpdateItemToAttendanceItem, stateUpdateLatestToAttendanceLatest} from "./attendance-offline";
import type {AttendanceContextField, EntityRecordValue} from "./opco-api";
import {attendanceEditContextValues} from "../renderers/workflows/attendance/attendance-edit-command";
const related={id:"synthetic-related",displayName:"Synthetic catalog",entityTypeId:"synthetic-catalog"};
const fields:AttendanceContextField[]=[{id:"related",name:"Synthetic relation",type:"RELATION",required:false,config:{relation:{relationKind:"ONE",targetEntityTypeId:"synthetic-catalog"}}}];
const item=(value:EntityRecordValue)=>({subject:{id:"synthetic-subject",displayName:"Synthetic subject"},current:{recordId:"synthetic-event",updatedAt:"2026-11-06T10:00:00.000Z",stateValues:[{fieldId:"status",optionId:"a",label:"Synthetic A"}],extraValues:{related:value}}});
it("retains coherent ONE context in the real offline Attendance adapter",()=>{expect(stateUpdateItemToAttendanceItem(item(related),"status").attendance?.contextValues?.related).toEqual(related);});
it("archived RED: retains the historical singleton array rather than silently removing it",()=>{expect(stateUpdateItemToAttendanceItem(item([related]),"status").attendance?.contextValues?.related).toBeDefined();});
it("restores the historical ONE relation when editing, preserving its stored ID instead of a remembered default",()=>{const restored=stateUpdateItemToAttendanceItem(item([related]),"status");expect(attendanceEditContextValues(fields,restored,{related:"another-record"})).toEqual({related:related.id});});

import {readAttendanceContextValue} from "./attendance-context-values";
import {canonicalAttendanceContextValue} from "../renderers/workflows/attendance/attendance-workflow-logic";
it.each(["ONE", "MANY"] as const)("uses %s metadata rather than the array shape", kind => {
 const field={...fields[0],type:"RELATION" as const,config:{relationKind:kind,targetEntityTypeId:"synthetic-catalog"}};
 const raw=[related];const restored=stateUpdateItemToAttendanceItem(item(raw),"status",undefined,[field]);
 expect(restored.attendance?.contextValues?.related).toEqual(kind==="ONE"?related:raw);
 expect(readAttendanceContextValue(field,raw)).toEqual(kind==="ONE"?related:raw);
 expect(raw).toEqual([related]);
});
it("keeps the label, object shape and SELECT option contract, including latest",()=>{
 const current=item([related]);const restored=stateUpdateItemToAttendanceItem(current,"status",undefined,fields);
 expect(restored.attendance?.contextValues?.related).toEqual(related);
 expect(stateUpdateLatestToAttendanceLatest({...current.current,subject:current.subject},"status",fields).contextValues?.related).toEqual(related);
 const option={optionId:"choice-a",label:"Choice A"};
 expect(readAttendanceContextValue({type:"SELECT"},option)).toBe(option);
 expect(readAttendanceContextValue({type:"SELECT"},[option])).toEqual([option]);
 expect(readAttendanceContextValue(undefined,[related])).toEqual([related]);
 expect(canonicalAttendanceContextValue(fields[0],[related.id])).toBe(related.id);
});
it("never truncates incompatible ONE values, and edit requires review before selecting or saving",()=>{
 const raw=[related,{...related,id:"another"}];const restored=stateUpdateItemToAttendanceItem(item(raw),"status",undefined,fields);
 expect(restored.attendance?.contextValues?.related).toEqual(raw);
 expect(()=>attendanceEditContextValues(fields,restored,{related:"remembered"})).toThrow("relación simple válida");
 expect(readAttendanceContextValue(fields[0],raw)).toEqual(raw);
 expect(readAttendanceContextValue({type:"RELATION",config:{relationKind:"ONE",relation:{relationKind:"MANY"}}},[related])).toEqual([related]);
});

it("does not reinterpret MANY, contradictory metadata or malformed arrays; optional ONE empty stays absent",()=>{
 const many={type:"RELATION",config:{relation:{relationKind:"MANY"}}};
 for(const raw of [[],[related],[related,{...related,id:"second"}]])expect(readAttendanceContextValue(many,raw)).toBe(raw);
 expect(readAttendanceContextValue(fields[0],[])).toBeNull();
 expect(readAttendanceContextValue(fields[0],[false])).toEqual([false]);
 expect(readAttendanceContextValue(fields[0],[[related]])).toEqual([[related]]);
 const choice={type:"SELECT"};const value={optionId:"one",label:"One"};expect(readAttendanceContextValue(choice,value)).toBe(value);
});
