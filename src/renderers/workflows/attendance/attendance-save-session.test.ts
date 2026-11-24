// @ts-expect-error Node types are not part of the Expo application config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { finalizeAttendanceDay, savedAttendanceBandNotice } from "../../../lib/attendance-operational-day";
import { operationalCalendarKey, resolveOperationalDay } from "../../../lib/operational-calendar";
import { attendanceDailyCount, attendanceReadScope } from "../../../lib/attendance-repetition";
import { captureTimeCommand } from "../../../lib/capture-time";
import { copyAttendanceEntry, attendanceAttemptKey } from "./attendance-edit-command";
import { attendanceEntryToStateUpdateEntry, attendanceEntryExtraValues, normalizeAttendanceSearch } from "./attendance-workflow-logic";
import { attendanceStateFields } from "../../../lib/attendance-offline";
import { createOpcoApi, OpcoApiError } from "../../../lib/opco-api";
import { workflowWriteMetadata } from "../../../lib/workflow-write-contract";

const source = ts.createSourceFile("AttendanceWorkflow.tsx", readFileSync(`${process.cwd()}/src/renderers/workflows/attendance/AttendanceWorkflow.tsx`, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actual(name: string, context: Record<string, unknown>) {
  let body: string | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) body = `${node.getText(source)};return ${name};`;
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name && node.initializer && ts.isCallExpression(node.initializer)) body = `return ${node.initializer.arguments[0].getText(source)};`;
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!body) throw Error(`Missing actual handler ${name}`);
  return new Function(...Object.keys(context), ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(context));
}
const instant = "2026-11-24T09:10:11.092Z";
const calendar = { version: 1 as const, timeZone: "America/Santiago", dayStart: "08:00", bands: [{ optionId: "a", start: "08:00", end: "20:00" }, { optionId: "b", start: "20:00", end: "08:00" }] };
const mismatch = finalizeAttendanceDay({ statusOptionId: "a" }, { calendar, contract: { version: 1, calendarKey: operationalCalendarKey(calendar) }, date: "2026-11-23", mode: "AUTO", editing: false, instant }).notice!;
function fixture(online = false) {
  vi.useFakeTimers(); vi.setSystemTime(new Date(instant));
  const c: Record<string, any> = {
    calendar, operationalContract: { version: 1, calendarKey: operationalCalendarKey(calendar) },
    date: "2026-11-23", registrationReadDateRef: { current: "2026-11-23" }, editingDateRef: { current: null }, eventCapturedAtRef: { current: null },
    selectedItem: { person: { id: "person", displayName: "Synthetic" }, attendance: null }, editingTarget: null,
    ownerKey: "owner", selectedContractId: "contract", token: "synthetic", isOnline: online, isSaving: false,
    confirmationBasis: "basis", confirmationBasisRef: { current: "basis" }, resolutionScope: "scope", resolutionScopeRef: { current: "scope" }, resolutionMountedRef: { current: true },
    draftRevisionRef: { current: 0 }, confirmationSequenceRef: { current: 0 }, saveInFlightRef: { current: false }, repeatCheckingRef: { current: false }, onlineAttemptsRef: { current: new Map() },
    repeatWarning: null, contextFields: [], contextValues: {}, attendanceContextValidationErrors: () => [], observation: "", supportsObservation: false, conflict: null,
    writeContract: null, writeContractRequiredRef: { current: false }, captureWorkflowWriteCommand: () => ({}), captureTimeCommand,
    appView: { id: "view", name: "Synthetic", config: { operationalCalendar: calendar, captureTime: { fieldId: "capture", timeZone: calendar.timeZone }, repetitionPolicy: "MULTIPLE_WITH_WARNING", statusFieldId: "state", targetEntityTypeId: "target" } },
    captureContract: { version: 1, fieldId: "capture", timeZone: calendar.timeZone },
    statuses: [{ optionId: "a", label: "A", isDefaultCheckIn: true }, { optionId: "b", label: "B", isDefaultCheckIn: false }],
    resolveOperationalDay, finalizeAttendanceDay, savedAttendanceBandNotice, attendanceDailyCount, copyAttendanceEntry, attendanceAttemptKey, attendanceEntryToStateUpdateEntry, attendanceEntryExtraValues, normalizeAttendanceSearch, attendanceStateFields, workflowWriteMetadata, OpcoApiError,
    definitionCache: { getAttendanceDailyRecords: vi.fn(async () => []), saveStateUpdateLocally: vi.fn(async () => ({ localRecordId: "local", clientRequestId: "request" })), getStateUpdateResolutionOutcome: vi.fn(async () => "confirmed") },
    syncPendingRecords: vi.fn(async () => {}), refreshLocalDayState: vi.fn(async () => {}), refreshRecordsSyncSummary: vi.fn(async () => {}), clearVisibleError: vi.fn(), recordVisibleError: vi.fn(), reportWriteFeedback: vi.fn(),
    setError: vi.fn(), setConflict: vi.fn(), setRepeatChecking: vi.fn(), setContextErrors: vi.fn(), setIsSaving: vi.fn(), setRefreshError: vi.fn(), setSuccessMessage: vi.fn(),
  };
  for (const name of ["setPersonRecords", "setPersonRecordDate", "setConfirmationError", "setResolutionFeedback", "setSearchText", "setSearchFieldId", "setSearchReadId", "setItems", "setIsSearching", "setObservation", "setObservationExpanded", "setContextValues"]) c[name] = vi.fn();
  c.notice = mismatch; c.setTemporalNotice = vi.fn(value => { c.notice = value; });
  c.setSelectedItem = vi.fn(value => { c.selectedItem = value; });
  c.setEditingTarget = vi.fn(value => { c.editingTarget = value; });
  c.setRepeatWarning = vi.fn(value => { c.repeatWarning = value; });
  c.requestSequenceRef = { current: 0 };
  c.finalizeTemporalEntry = (...args: unknown[]) => actual("finalizeTemporalEntry", c)(...args);
  c.clearPersonFlow = () => actual("clearPersonFlow", c)();
  c.saveEntry = vi.fn(async () => {});
  return c;
}
afterEach(() => vi.useRealTimers());


function deferred<T>() { let resolve!: (value:T)=>void, reject!: (error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; }
function sessionFixture() {
 const c=fixture(true);
 c.api=createOpcoApi({apiUrl:"http://isolated.invalid",platformOS:"web",fetcher:async()=>new Response(JSON.stringify({ok:true,data:{accessToken:"synthetic-current-token"}}),{status:200})});
 c.authGeneration=c.api.getAuthSessionGeneration();c.resolutionSessionRef={current:c.authGeneration};
 c.resolutionScope="owner-A/view/day";c.resolutionScopeRef.current=c.resolutionScope;
 c.busy=false;c.setIsSaving=vi.fn((value:boolean)=>{c.busy=value;});c.saveInFlightRef.current=null;
 for(const key of ["setWriteContract","setCaptureContract","setOperationalContract"])c[key]=vi.fn();c.writePolicyConfigured=false;
 return c;
}
function entry(c:Record<string,any>) { const f=c.finalizeTemporalEntry({personRecordId:"person",statusOptionId:"a",repetitionPolicy:"MULTIPLE_WITH_WARNING",contextValues:{}},false);return [f.entry,f.date,f.notice] as const; }
function scopeEffect(c:Record<string,any>) {
 let callback="";
 const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(source)==="useLayoutEffect"&&node.arguments[0]?.getText(source).includes("resolutionSessionRef.current"))callback=node.arguments[0].getText(source);ts.forEachChild(node,visit);};visit(source);
 if(!callback)throw Error("Missing actual session/scope retirement effect");
 return new Function(...Object.keys(c),ts.transpileModule(`return (${callback})();`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(c));
}
async function savedWaiting(c:Record<string,any>) {
 const ack=deferred<void>();const entered=deferred<void>();c.syncPendingRecords.mockImplementation(()=>{entered.resolve();return ack.promise;});
 const save=actual("saveEntry",c)(...entry(c));await entered.promise;
 c.setIsSaving.mockClear();c.setError.mockClear();c.setTemporalNotice.mockClear();c.reportWriteFeedback.mockClear();return {ack,save};
}
function noPublication(c:Record<string,any>) {expect(c.reportWriteFeedback).not.toHaveBeenCalled();expect(c.setTemporalNotice).not.toHaveBeenCalled();expect(c.setError).not.toHaveBeenCalled();expect(c.setIsSaving).not.toHaveBeenCalled();expect(c.recordVisibleError).not.toHaveBeenCalled();}

describe("Attendance save action belongs to its C-08 generation",()=>{
 it.each(["ack","error"] as const)("logout during save suppresses a late %s and its finally indicators",async outcome=>{
  const c=sessionFixture(),old=await savedWaiting(c);await c.api.logout();if(outcome==="ack")old.ack.resolve();else old.ack.reject(Error("Controlled late transport failure"));
  await old.save;noPublication(c);expect(c.saveInFlightRef.current).toBeNull();expect(c.definitionCache.saveStateUpdateLocally).toHaveBeenCalledOnce();
 });
 it.each(["B","A"])("a completed A action cannot publish into a new %s generation even with reused scope",async next=>{
  const c=sessionFixture(),old=await savedWaiting(c);await c.api.logout();await c.api.login(`${next}@example.invalid`,"synthetic");
  if(next==="B")c.resolutionScopeRef.current="owner-B/view/day";old.ack.resolve();await old.save;noPublication(c);
 });
 it("an obsolete callback cannot create a new local intent in a later login",async()=>{
  const c=sessionFixture(),save=actual("saveEntry",c);await c.api.logout();await save(...entry(c));expect(c.definitionCache.saveStateUpdateLocally).not.toHaveBeenCalled();expect(c.setIsSaving).not.toHaveBeenCalled();expect(c.setError).not.toHaveBeenCalled();
 });
 it.each(["ack","error"] as const)("old %s/finally does not clear a current B save, and B completes",async outcome=>{
  const c=sessionFixture(),old=await savedWaiting(c);await c.api.logout();await c.api.login("B@example.invalid","synthetic");
  const next:Record<string,any>={...c,authGeneration:c.api.getAuthSessionGeneration(),resolutionScope:"owner-B/view/day",ownerKey:"owner-B",selectedItem:{person:{id:"person",displayName:"Synthetic B"},attendance:null},isSaving:false};
  next.resolutionScopeRef.current=next.resolutionScope;scopeEffect(next);const current=await savedWaiting(next);expect(c.busy).toBe(true);const slot=c.saveInFlightRef.current;
  if(outcome==="ack")old.ack.resolve();else old.ack.reject(Error("Controlled old failure"));await old.save;noPublication(c);expect(c.saveInFlightRef.current).toBe(slot);expect(c.busy).toBe(true);
  current.ack.resolve();await current.save;expect(c.busy).toBe(false);expect(c.saveInFlightRef.current).toBeNull();expect(c.reportWriteFeedback).toHaveBeenCalledOnce();
 });
 it("changing person blocks old messages; finally releases only the old action's busy slot",async()=>{
  const c=sessionFixture(),old=await savedWaiting(c);actual("changeSearchText",c)("another person");c.setError.mockClear();c.setTemporalNotice.mockClear();old.ack.resolve();await old.save;
  expect(c.reportWriteFeedback).not.toHaveBeenCalled();expect(c.setTemporalNotice).not.toHaveBeenCalled();expect(c.setError).not.toHaveBeenCalled();expect(c.busy).toBe(false);expect(c.saveInFlightRef.current).toBeNull();
 });
 it("a replaced operation in the same session owns its own indicators",async()=>{
  const c=sessionFixture(),old=await savedWaiting(c);const next:Record<string,any>={...c,isSaving:false,selectedItem:{person:{id:"person",displayName:"Next"},attendance:null}};next.draftRevisionRef.current++;next.saveInFlightRef.current=null;
  const current=await savedWaiting(next),slot=c.saveInFlightRef.current;old.ack.resolve();await old.save;noPublication(c);expect(c.busy).toBe(true);expect(c.saveInFlightRef.current).toBe(slot);
  current.ack.resolve();await current.save;expect(c.busy).toBe(false);expect(c.reportWriteFeedback).toHaveBeenCalledOnce();
 });
 it("a current local commit still reports local success without claiming a remote ACK",async()=>{
  const c=sessionFixture();c.isOnline=false;await actual("saveEntry",c)(...entry(c));expect(c.reportWriteFeedback).toHaveBeenCalledWith(expect.objectContaining({kind:"local-saved"}));expect(c.busy).toBe(false);
 });
});

describe("Attendance save publication across its dependent reads",()=>{
 it("does not publish or finish an obsolete refresh started by the save action",async()=>{
  const c=sessionFixture(),reply=deferred<any>(),entered=deferred<void>();c.requestSequenceRef={current:0};
  c.api.getAttendanceWorkflow=vi.fn(()=>{entered.resolve();return reply.promise;});
  c.beginLoadingRequest=()=>++c.requestSequenceRef.current;c.finishLoadingRequest=vi.fn();c.isAttendanceRequestCurrent=(current:number,id:number)=>current===id;
  c.cacheAttendanceOnlineResponse=vi.fn();c.applyAttendanceResponse=vi.fn();c.isContractBootstrapPending=false;
  const read=actual("loadDay",c)({operation:"refresh",isCurrent:()=>c.api.isAuthSessionCurrent(c.authGeneration)});await entered.promise;
  c.setError.mockClear();c.setRefreshError.mockClear();await c.api.logout();reply.resolve({latest:[],summary:{totalRegistered:0}});await read;
  expect(c.cacheAttendanceOnlineResponse).not.toHaveBeenCalled();expect(c.applyAttendanceResponse).not.toHaveBeenCalled();expect(c.finishLoadingRequest).not.toHaveBeenCalled();expect(c.setError).not.toHaveBeenCalled();expect(c.setRefreshError).not.toHaveBeenCalled();
 });
 it("rechecks the save guard after the local day read, before changing counters",async()=>{
  const c=sessionFixture(),summary=deferred<any>();c.attendanceReadScope=attendanceReadScope;
  Object.assign(c.definitionCache,{getStateUpdateSummary:()=>summary.promise,listStateUpdateLatest:async()=>({items:[]}),listStateUpdateConflicts:async()=>[],getAttendanceDaySnapshotHydration:async()=>null});
  for(const key of ["setLatest","setTotalRegistered","setPendingCount","setLocalConflicts","setDaySnapshotHydrated","setLoadedDate"])c[key]=vi.fn();
  const read=actual("refreshLocalDayState",c)(undefined,undefined,()=>c.api.isAuthSessionCurrent(c.authGeneration));await c.api.logout();summary.resolve({totalRegistered:0,pendingCount:0,failedCount:0,conflictCount:0,syncingCount:0});await read;
  for(const key of ["setLatest","setTotalRegistered","setPendingCount","setLocalConflicts","setDaySnapshotHydrated","setLoadedDate"])expect(c[key]).not.toHaveBeenCalled();
 });
 it("keeps a valid direct-write ACK but publishes no old-session result",async()=>{
  const c=sessionFixture(),reply=deferred<any>(),entered=deferred<void>();c.calendar=undefined;
  c.api.saveStateUpdateWorkflow=vi.fn(()=>{entered.resolve();return reply.promise;});c.createClientRequestId=()=>"direct-stable-key";
  c.stateUpdateResultToAttendanceResult=(result:unknown)=>result;c.firstBlockingAttendanceResult=()=>null;c.hasSuccessfulAttendanceResult=()=>true;
  const save=actual("saveEntry",c)({personRecordId:"person",statusOptionId:"a"});await entered.promise;
  c.setIsSaving.mockClear();c.setError.mockClear();await c.api.logout();reply.resolve({results:[{result:"CREATED",recordId:"owned-A-row"}]});await save;
  expect(c.api.saveStateUpdateWorkflow).toHaveBeenCalledOnce();expect(c.definitionCache.saveStateUpdateLocally).not.toHaveBeenCalled();noPublication(c);expect(c.onlineAttemptsRef.current.size).toBe(0);expect(c.saveInFlightRef.current).toBeNull();
 });
});
