import { describe, expect, it, vi } from "vitest";
import { readAttendanceLocalRecord, inspectAttendanceLocalQueries, type AttendanceLocalReader, type AttendanceReadView } from "./attendance-local-read";
const view = { id:"view",type:"WORKFLOW",name:"Experiencia sintética",config:{workflowKey:"attendance",sourceEntityTypeId:"people",targetEntityTypeId:"events",personFieldId:"person",dateFieldId:"day",statusFieldId:"state",contextFieldIds:["context"],repetitionPolicy:"MULTIPLE_WITH_WARNING",captureTime:{fieldId:"captured",timeZone:"America/Santiago"}} } as AttendanceReadView;
const input={ownerKey:"owner",contractId:"contract",appView:view,recordId:"local-exact",requestedDate:"2026-11-19"};
const instant="2026-11-19T22:02:17.355Z";
const row=()=>({id:"local-exact",localId:"local-exact",serverId:null,remoteUpdatedAt:null,updatedAt:instant,syncStatus:"pending_create",displayName:"Sujeto de prueba",values:{appViewId:"view",subjectRecordId:"person",subjectDisplayName:"Sujeto de prueba",date:input.requestedDate,stateValues:[{fieldId:"state",optionId:"a",label:"Etiqueta configurada"}],extraValues:{context:"related-id",observation:"DO NOT COPY",other:"DO NOT COPY"},captureTime:{version:1,fieldId:"captured",timeZone:"America/Santiago",value:instant,source:"DEVICE_CONFIRMATION"},eventOccurredAt:instant}});
function fixture(){
 const cached=row(); const store={getCachedRecord:vi.fn(async(q:any)=>q.recordId==="related-id"?{id:"related-id",localId:"related-id",serverId:"related-id",displayName:"Catálogo legible"}:cached),getAppViewDefinition:vi.fn(async()=>({status:"ready",lastPreparedAt:instant,definition:{kind:"state-update",appView:view,sourceEntityTypeId:"people",targetEntityTypeId:"events",stateFields:[{fieldId:"state",options:[{optionId:"a",label:"Etiqueta configurada"}]}],extraFields:[{id:"context",name:"Contexto configurado",key:"context",type:"RELATION",required:true,active:true,multiple:false,config:{relationKind:"ONE",targetEntityTypeId:"catalog"}}]}})),getAttendanceDailyRecords:vi.fn(async()=>[{localRecordId:"local-exact",stateValues:cached.values.stateValues,extraValues:cached.values.extraValues,syncStatus:"pending"}]),listStateUpdateLatest:vi.fn(async()=>({items:[{recordId:"local-exact"}],pagination:{page:1,pageSize:20,total:1,hasMore:false}})),getAttendanceDaySnapshotHydration:vi.fn(async()=>null),listPendingStateUpdateOperations:vi.fn(async()=>[{ownerKey:"owner",contractId:"contract",entityTypeId:"events",localRecordId:"local-exact",clientRequestId:"intent",payload:{appViewId:"view",date:input.requestedDate,eventOccurredAt:instant,extraValues:cached.values.extraValues}},{ownerKey:"owner",contractId:"another-contract",entityTypeId:"events",localRecordId:"local-exact",payload:{appViewId:"view",extraValues:{context:"OTHER CONTRACT"}}}])};
 return {cached,store:store as unknown as AttendanceLocalReader,raw:store};
}
describe("exact local Attendance detail and read-only query inspection",()=>{
 it("uses the exact local identity and existing capture/DATE/context/status without creating an intention",async()=>{
  const {store,raw,cached}=fixture();const before=JSON.stringify(cached);const detail=await readAttendanceLocalRecord(store,input);
  expect(raw.getCachedRecord).toHaveBeenNthCalledWith(1,{ownerKey:"owner",contractId:"contract",entityTypeId:"events",recordId:"local-exact"});
  expect(detail.record.localRecordId).toBe("local-exact");expect(detail.presentation.fields.map(f=>f.values[0].text)).toEqual(["Etiqueta configurada","Catálogo legible"]);expect(detail.presentation.capture?.compact).toBe("19:02");expect(detail.scope.date).toBe("2026-11-19");expect(detail.presentation.syncLabel).toBe("Guardado local · pendiente");expect(JSON.stringify(cached)).toBe(before);
 });
 it("does not choose a different local row, even when it carries the requested server alias",async()=>{
  const {store,raw,cached}=fixture();cached.localId="another-local";cached.serverId="local-exact" as never;
  await expect(readAttendanceLocalRecord(store,input)).rejects.toMatchObject({code:"LOCAL_RECORD_NOT_FOUND"});expect(raw.getAttendanceDailyRecords).not.toHaveBeenCalled();
 });
 it("does not select another record when the reference is absent or belongs to another experience",async()=>{
  const {store,raw,cached}=fixture();raw.getCachedRecord.mockResolvedValueOnce(null as never);await expect(readAttendanceLocalRecord(store,input)).rejects.toMatchObject({code:"LOCAL_RECORD_NOT_FOUND"});
  cached.values.appViewId="another-view";await expect(readAttendanceLocalRecord(store,input)).rejects.toMatchObject({code:"LOCAL_RECORD_SCOPE_MISMATCH"});expect(raw.getAttendanceDailyRecords).not.toHaveBeenCalled();
 });
 it("preserves the original DATE when the attention link names a different day",async()=>{
  const {store}=fixture();const detail=await readAttendanceLocalRecord(store,{...input,requestedDate:"2026-11-18"});expect(detail.scope.date).toBe("2026-11-19");expect(detail.requestedDateMatches).toBe(false);
 });
 it("does not invent a capture for an older command with only eventOccurredAt",async()=>{
  const {store,cached}=fixture();delete (cached.values as any).captureTime;const detail=await readAttendanceLocalRecord(store,input);expect(detail.presentation.capture?.compact).toBe("Hora de captura no disponible");expect(detail.presentation.timestamps.some(t=>t.label==="Hora de captura")).toBe(false);
 });
 it("reads the same local identity after ACK and never substitutes another subject/date record",async()=>{
  const {store,cached}=fixture();const before=await readAttendanceLocalRecord(store,input);cached.serverId="remote-alias" as never;cached.syncStatus="synced";cached.remoteUpdatedAt=instant as never;const after=await readAttendanceLocalRecord(store,input);
  expect(after.record.localRecordId).toBe(before.record.localRecordId);expect(after.record.captureTime).toEqual(before.record.captureTime);expect(after.presentation.syncLabel).toBe("Sincronizado");
 });
 it("compares the actual group/person/recent queries and scopes the exported payload to this operation",async()=>{
  const {store,raw}=fixture();const detail=await readAttendanceLocalRecord(store,input);const report=await inspectAttendanceLocalQueries(store,input,detail);
  expect(report.daily).toMatchObject({selectedIncluded:true,count:1,historyMode:"append"});expect(report.personSelection).toMatchObject({selectedIncluded:true});expect(report.recent).toMatchObject({selectedIncluded:true});expect(report.outbox).toMatchObject({activeMatchingOperations:1});expect(report.stored).toMatchObject({date:input.requestedDate,eventOccurredAt:instant,contexts:{context:"related-id"}});expect(report.consistency.selectedRecordStableAcrossReads).toBe(true);
  expect(raw.getAttendanceDailyRecords).toHaveBeenNthCalledWith(1,expect.objectContaining({subjectRecordId:"person",historyMode:"append",uniqueness:"subject-date",date:input.requestedDate}));
  const exported=JSON.stringify(report);expect(exported).not.toContain("DO NOT COPY");expect(exported).not.toContain("OTHER CONTRACT");expect(exported).not.toContain("Sujeto de prueba");
 });
 it("reports a failed local query as an error, never as zero matching records",async()=>{
  const {store,raw}=fixture();raw.getAttendanceDailyRecords.mockRejectedValue(new TypeError("private driver detail"));const report=await inspectAttendanceLocalQueries(store,input,await readAttendanceLocalRecord(store,input));expect(report.daily).toEqual({status:"error",code:"TypeError"});expect(report.personSelection).toEqual({status:"error",code:"TypeError"});expect(JSON.stringify(report)).not.toContain("private driver detail");
 });
 it("does not claim a remote permission check or completeness from a local read",async()=>{
  const {store,raw}=fixture();raw.listStateUpdateLatest.mockResolvedValue({items:[],pagination:{page:1,pageSize:20,total:31,hasMore:true}});const report=await inspectAttendanceLocalQueries(store,input,await readAttendanceLocalRecord(store,input));expect(report.recent).toMatchObject({selectedIncluded:false,pagination:{total:31,hasMore:true}});expect(report.daily).toMatchObject({selectedIncluded:true});expect(report.consistency.atomic).toBe(false);
 });
 it("refuses a fabricated date instead of substituting the clock",async()=>{const {store,cached}=fixture();cached.values.date="not-a-date";await expect(readAttendanceLocalRecord(store,input)).rejects.toMatchObject({code:"LOCAL_DATE_UNAVAILABLE"});});
});

it("marks a diagnostic interrupted by ACK as non-stable without retrying any query",async()=>{
 const {store,raw,cached}=fixture();raw.getCachedRecord.mockImplementation(async(q:any)=>q.recordId==="related-id"?{id:"related-id",localId:"related-id",serverId:"related-id",displayName:"Catálogo legible"}:JSON.parse(JSON.stringify(cached)));
 raw.listStateUpdateLatest.mockImplementation(async()=>{cached.serverId="new-server-alias" as never;cached.syncStatus="synced";return{items:[{recordId:"local-exact"}],pagination:{page:1,pageSize:20,total:1,hasMore:false}};});
 const detail=await readAttendanceLocalRecord(store,input);const report=await inspectAttendanceLocalQueries(store,input,detail);expect(report.consistency.selectedRecordStableAcrossReads).toBe(false);expect(raw.listStateUpdateLatest).toHaveBeenCalledTimes(2);
});
