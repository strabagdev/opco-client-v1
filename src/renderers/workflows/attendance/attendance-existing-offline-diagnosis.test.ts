// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { buildOfflineStateValues, stateUpdateIntentsEqual } from "../../../lib/state-update-offline";
import { attendanceStateFields } from "../../../lib/attendance-offline";
import { attendanceEntryExtraValues } from "./attendance-workflow-logic";
import { describe, expect, it, vi } from "vitest";

// Execute the actual renderer handlers without a DOM/native renderer. Persistence is covered separately.
const sourcePath = process.env.ATTENDANCE_CONFLICT_HANDLER_SOURCE ?? `${process.cwd()}/src/renderers/workflows/attendance/AttendanceWorkflow.tsx`;
const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name: string, context: Record<string, unknown>) {
  let declaration: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!declaration) throw new Error(`Renderer handler missing: ${name}`);
  const code = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), `${code}; return ${name};`)(...Object.values(context)) as (entry?: unknown) => Promise<void>;
}

function context(online: boolean) {
 const saveStateUpdateLocally = vi.fn(async () => ({}));
 const saveStateUpdateWorkflow = vi.fn(async () => ({results:[]}));
 return {selectedContractId:"contract",selectedItem:{person:{id:"person",displayName:"Synthetic"},attendance:{updatedAt:"2026-10-09T10:00:00.000Z"}},ownerKey:"synthetic:user",isOnline:online,token:"test-only",date:"2026-10-09",appView:{id:"view",config:{statusFieldId:"status",targetEntityTypeId:"target"}},contextFields:[],statuses:[],
 definitionCache:{saveStateUpdateLocally},api:{saveStateUpdateWorkflow},setIsSaving:vi.fn(),setError:vi.fn(),setRefreshError:vi.fn(),setSuccessMessage:vi.fn(),clearPersonFlow:vi.fn(),refreshLocalDayState:vi.fn(),refreshRecordsSyncSummary:vi.fn(),clearVisibleError:vi.fn(),reportWriteFeedback:vi.fn(),attendanceEntryExtraValues:()=>({}),attendanceStateFields:()=>[],attendanceEntryToStateUpdateEntry:(e:any)=>({subjectRecordId:e.personRecordId,stateValues:[{fieldId:"status",optionId:e.statusOptionId}],overwrite:e.overwrite,expectedUpdatedAt:e.expectedUpdatedAt}),createClientRequestId:()=>"fresh-intent",firstBlockingAttendanceResult:()=>null,hasSuccessfulAttendanceResult:()=>false,stateUpdateResultToAttendanceResult:()=>({}),recordVisibleError:vi.fn()};
}
describe("Attendance existing change authorization characterization",()=>{
 it("offline ordinary save retains base version but does not authorize overwrite",async()=>{
  const c=context(false);await handler("saveEntry",c)({personRecordId:"person",statusOptionId:"present"});
  expect(c.setError).toHaveBeenCalledTimes(1);
  expect(c.definitionCache.saveStateUpdateLocally).toHaveBeenCalledWith(expect.objectContaining({expectedUpdatedAt:"2026-10-09T10:00:00.000Z",overwrite:undefined,uniqueness:"subject-date",historyMode:"update-current"}));
  expect(c.api.saveStateUpdateWorkflow).not.toHaveBeenCalled();
 });
 it("online confirmation authorizes overwrite with conflict version",async()=>{
  const saveEntry=vi.fn();const c={conflict:{personRecordId:"person",existing:{updatedAt:"2026-10-09T10:00:00.000Z"},requested:{statusOptionId:"present"}},isSaving:false,contextFields:[],contextValues:{},supportsObservation:false,observation:"",attendanceContextValidationErrors:()=>[],setContextErrors:vi.fn(),saveEntry};
  await handler("confirmConflict",c)();expect(saveEntry).toHaveBeenCalledWith(expect.objectContaining({overwrite:true,expectedUpdatedAt:c.conflict.existing.updatedAt,statusOptionId:"present"}));
 });
});

describe("offline Attendance replacement confirmation",()=>{
 function fixture(){
  const saveEntry=vi.fn(); const setConflict=vi.fn();
  return {buildOfflineStateValues,stateUpdateIntentsEqual,attendanceStateFields,attendanceEntryExtraValues,statuses:[],selectedContractId:"contract",selectedItem:{person:{id:"person",displayName:"Synthetic"},attendance:{recordId:"row",statusOptionId:"training",statusLabel:"Training",updatedAt:"2026-10-09T10:00:00.000Z",observation:null}},ownerKey:"synthetic:user",isSaving:false,isOnline:false,date:"2026-10-09",appView:{id:"view",config:{targetEntityTypeId:"target"}},contextFields:[],contextValues:{context:"original"},supportsObservation:true,observation:"original",attendanceContextValidationErrors:()=>[],setContextErrors:vi.fn(),setError:vi.fn(),recordVisibleError:vi.fn(),saveEntry,setConflict,
  resolutionMountedRef:{current:true},resolutionScope:"scope",resolutionScopeRef:{current:"scope"},requestSequenceRef:{current:0},definitionCache:{listPendingStateUpdateOperations:vi.fn(async()=>[]),getCachedRecord:vi.fn(async()=>({syncStatus:"synced",serverId:"remote",remoteUpdatedAt:"2026-10-09T10:00:00.000Z",values:{appViewId:"view",subjectRecordId:"person",date:"2026-10-09"}}))}};
 }
 it("opens the existing confirmation without changing SQLite or outbox; cancellation only clears UI",async()=>{
  const c=fixture();await handler("saveStatus",c)({optionId:"present",label:"Present"});expect(c.saveEntry).not.toHaveBeenCalled();expect(c.setConflict).toHaveBeenCalledWith(expect.objectContaining({existing:c.selectedItem.attendance,requested:{statusOptionId:"present",statusLabel:"Present"}}));
  handler("cancelConflict",c)();expect(c.setConflict).toHaveBeenLastCalledWith(null);expect(c.saveEntry).not.toHaveBeenCalled();
 });
 it("acceptance uses exactly the displayed version and captured intent",async()=>{
  const c=fixture();await handler("saveStatus",c)({optionId:"present",label:"Present"});const conflict=c.setConflict.mock.calls[0][0];
  c.selectedItem.attendance.updatedAt="2026-10-09T11:00:00.000Z";
  // The modal snapshot must not follow mutations of the selected item.
  expect(conflict.existing.updatedAt).toBe("2026-10-09T10:00:00.000Z");
  await handler("confirmConflict",{...c,conflict,contextValues:{context:"changed"},observation:"changed"})();
  expect(c.saveEntry).toHaveBeenCalledWith(expect.objectContaining({overwrite:true,expectedUpdatedAt:"2026-10-09T10:00:00.000Z",contextValues:{context:"original"},observation:"original"}));
 });
 it.each(["pending_update","pending_create","conflict","failed"])("does not authorize old %s intents",async(syncStatus)=>{
  const c=fixture();c.definitionCache.getCachedRecord.mockResolvedValue({...await c.definitionCache.getCachedRecord(),syncStatus});await handler("saveStatus",c)({optionId:"present",label:"Present"});expect(c.setConflict).not.toHaveBeenCalled();expect(c.saveEntry).toHaveBeenCalledWith(expect.not.objectContaining({overwrite:true}));
 });
 it("same value keeps ordinary save",async()=>{
  const c=fixture();await handler("saveStatus",c)({optionId:"training",label:"Training"});expect(c.saveEntry).toHaveBeenCalled();
 });
 it("new attendance keeps ordinary creation without authorization",async()=>{
  const c={...fixture(),selectedItem:{person:{id:"person",displayName:"Synthetic"},attendance:null}};await handler("saveStatus",c)({optionId:"present",label:"Present"});expect(c.definitionCache.getCachedRecord).not.toHaveBeenCalled();expect(c.saveEntry).toHaveBeenCalledWith(expect.not.objectContaining({overwrite:true}));
 });
 it("another AppView cache cannot authorize this replacement",async()=>{
  const c=fixture();c.definitionCache.getCachedRecord.mockResolvedValue({...await c.definitionCache.getCachedRecord(),values:{appViewId:"other",subjectRecordId:"person",date:"2026-10-09"}});await handler("saveStatus",c)({optionId:"present",label:"Present"});expect(c.setConflict).not.toHaveBeenCalled();expect(c.saveEntry).toHaveBeenCalledWith(expect.not.objectContaining({overwrite:true}));
 });
 it("unmounted response cannot open confirmation",async()=>{
  const c=fixture();c.definitionCache.getCachedRecord.mockImplementation(async()=>{c.resolutionMountedRef.current=false;return {syncStatus:"synced",serverId:"remote",remoteUpdatedAt:c.selectedItem.attendance.updatedAt,values:{appViewId:"view",subjectRecordId:"person",date:"2026-10-09"}}});await handler("saveStatus",c)({optionId:"present",label:"Present"});expect(c.setConflict).not.toHaveBeenCalled();expect(c.saveEntry).not.toHaveBeenCalled();
 });
 it("late cache response cannot open confirmation after scope changes",async()=>{
  const c=fixture();c.definitionCache.getCachedRecord.mockImplementation(async()=>{c.resolutionScopeRef.current="other-date-view";return {syncStatus:"synced",serverId:"remote",remoteUpdatedAt:c.selectedItem.attendance.updatedAt,values:{appViewId:"view",subjectRecordId:"person",date:"2026-10-09"}}});await handler("saveStatus",c)({optionId:"present",label:"Present"});expect(c.setConflict).not.toHaveBeenCalled();expect(c.saveEntry).not.toHaveBeenCalled();
 });
 it("stale confirmation cannot write into another person or date",async()=>{
  const c=fixture();await handler("saveStatus",c)({optionId:"present",label:"Present"});const conflict=c.setConflict.mock.calls[0][0];c.resolutionScopeRef.current="other-date";await handler("confirmConflict",{...c,conflict})();expect(c.saveEntry).not.toHaveBeenCalled();
 });
 it("a different selected person cannot accept the previous person's confirmation",async()=>{
  const c=fixture();await handler("saveStatus",c)({optionId:"present",label:"Present"});const conflict=c.setConflict.mock.calls[0][0];c.selectedItem.person.id="other-person";await handler("confirmConflict",{...c,conflict})();expect(c.saveEntry).not.toHaveBeenCalled();expect(c.setConflict).toHaveBeenLastCalledWith(null);
 });
 it("a superseded request cannot accept an earlier confirmation",async()=>{
  const c=fixture();await handler("saveStatus",c)({optionId:"present",label:"Present"});const conflict=c.setConflict.mock.calls[0][0];c.requestSequenceRef.current+=1;await handler("confirmConflict",{...c,conflict})();expect(c.saveEntry).not.toHaveBeenCalled();expect(c.setConflict).toHaveBeenLastCalledWith(null);
 });
 it("a late cache response superseded by person selection cannot authorize a save",async()=>{
  const c=fixture();const cached=await c.definitionCache.getCachedRecord();c.definitionCache.getCachedRecord.mockImplementation(async()=>{c.requestSequenceRef.current+=1;return cached});await handler("saveStatus",c)({optionId:"present",label:"Present"});expect(c.setConflict).not.toHaveBeenCalled();expect(c.saveEntry).not.toHaveBeenCalled();
 });
 it("persistence retains confirmed version instead of current selected version",async()=>{
  const c=context(false);await handler("saveEntry",c)({personRecordId:"person",statusOptionId:"present",overwrite:true,expectedUpdatedAt:"2026-10-09T09:00:00.000Z"});expect(c.definitionCache.saveStateUpdateLocally).toHaveBeenCalledWith(expect.objectContaining({overwrite:true,expectedUpdatedAt:"2026-10-09T09:00:00.000Z"}));
 });
});
