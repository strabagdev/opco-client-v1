// @ts-expect-error Node types are intentionally absent from the Expo config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveOperationalDay } from "../../../lib/operational-calendar";
const file="src/renderers/workflows/attendance/AttendanceWorkflow.tsx",source=ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function actual(name:string,c:Record<string,unknown>){let code:string|undefined;function visit(n:ts.Node){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)code=n.getText(source);if(ts.isVariableDeclaration(n)&&n.name.getText(source)===name&&n.initializer&&ts.isCallExpression(n.initializer))code=`const ${name}=${n.initializer.arguments[0].getText(source)}`;ts.forEachChild(n,visit)}visit(source);if(!code)throw Error("Missing actual handler");return new Function(...Object.keys(c),ts.transpileModule(code+`;return ${name};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(c));}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve}}
function fixture(policy="MULTIPLE_WITH_WARNING"){
 let generation=1;
 const calendar={version:1 as const,timeZone:"UTC",dayStart:"08:00",bands:[{optionId:"a",start:"08:00",end:"20:00"},{optionId:"b",start:"20:00",end:"08:00"}]};
 const c:Record<string,any>={authGeneration:1,api:{isAuthSessionCurrent:(g:number)=>g===generation,getAttendanceWorkflow:vi.fn()},calendar,resolveOperationalDay,date:"2026-11-26",ownerKey:"org:A",selectedContractId:"contract",token:"synthetic",appView:{id:"view",config:{operationalCalendar:calendar,repetitionPolicy:policy,targetEntityTypeId:"events"}},
 resolutionMountedRef:{current:true},resolutionScope:"scope",resolutionScopeRef:{current:"scope"},personReadRef:{current:null},personReadPending:false,draftRevisionRef:{current:0},confirmationSequenceRef:{current:0},eventCapturedAtRef:{current:null},registrationReadDateRef:{current:null},editingDateRef:{current:null},selectedItem:null,editingTarget:null,isOnline:true,isSaving:false,
 contextFields:[],contextValues:{lot:"chosen"},observation:"original",recordAttendanceLocalRead:vi.fn(),stateUpdateItemToAttendanceItem:vi.fn(),attendanceEditContextValues:()=>({lot:"remote"}),definitionCache:{getAttendanceDailyRecords:vi.fn(async()=>[])},cacheAttendanceRemoteSnapshot:vi.fn(async()=>{}),applyAttendanceResponse:vi.fn(),setError:vi.fn(),setTemporalNotice:vi.fn(),setEditingTarget:vi.fn(),setRepeatWarning:vi.fn(),setPersonRecords:vi.fn(),setPersonRecordDate:vi.fn(),setConflict:vi.fn(),confirmationBasis:"basis",confirmationBasisRef:{current:"basis"},clearPersonFlow:vi.fn(),saveEntry:vi.fn()};
 c.setSelectedItem=vi.fn(v=>{c.selectedItem=v});c.setPersonReadPending=vi.fn(v=>{c.personReadPending=v});c.setObservation=vi.fn(v=>{c.observation=typeof v==="function"?v(c.observation):v});c.setContextValues=vi.fn(v=>{c.contextValues=typeof v==="function"?v(c.contextValues):v});
 c.response=(id="person")=>({appView:{id:"view"},date:resolveOperationalDay(new Date(),calendar).date,repetitionPolicy:policy,items:[],dailyRecords:[{person:{id},attendance:{recordId:"remote",observation:"server",contextValues:{lot:"remote"}}}]});
 return{c,retire(){generation++}};
}
afterEach(()=>vi.useRealTimers());
const tick=async()=>{for(let n=0;n<12;n++)await Promise.resolve()};
describe("exact-person read and editable Attendance draft",()=>{
 it.each(["MULTIPLE_WITH_WARNING","ONE_PER_DAY"])("keeps observation/context edits while %s read completes",async policy=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-26T12:00:00Z"));const{c}=fixture(policy),held=deferred<any>();c.api.getAttendanceWorkflow.mockReturnValue(held.promise);const reading=actual("selectRepeatedPerson",c)({person:{id:"person"}});await tick();
  c.observation="typed while waiting";c.contextValues={lot:"edited"};c.draftRevisionRef.current++;held.resolve(c.response());await reading;
  expect(c.registrationReadDateRef.current).toBe("2026-11-26");expect(c.observation).toBe("typed while waiting");expect(c.contextValues).toEqual({lot:"edited"});expect(c.personReadPending).toBe(false);expect(c.clearPersonFlow).not.toHaveBeenCalled();expect(c.saveEntry).not.toHaveBeenCalled();
 });
 it("does not confirm while required identity metadata is pending",async()=>{const{c}=fixture();c.personReadPending=true;await actual("saveRepeatedStatus",c)({optionId:"a"});expect(c.saveEntry).not.toHaveBeenCalled();expect(c.definitionCache.getAttendanceDailyRecords).not.toHaveBeenCalled();});
 it("distinguishes an unavailable read from an actual changed day, retaining the draft",async()=>{
  const{c}=fixture();c.selectedItem={person:{id:"person"}};c.saveInFlightRef={current:null};c.repeatCheckingRef={current:false};c.contextFields=[];c.attendanceContextValidationErrors=()=>[];c.captureWorkflowWriteCommand=()=>({});c.writeContract=null;c.writeContractRequiredRef={current:false};c.captureContract=undefined;c.repeatWarning=null;c.registrationReadDateRef.current=null;
  await actual("saveRepeatedStatus",c)({optionId:"a"});expect(c.setTemporalNotice).toHaveBeenCalledWith(expect.stringContaining("aún no está comprobada"));expect(c.clearPersonFlow).not.toHaveBeenCalled();expect(c.observation).toBe("original");expect(c.saveEntry).not.toHaveBeenCalled();
 });
 it("still retires the read after crossing the real operational boundary",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-26T07:59:59Z"));const{c}=fixture(),held=deferred<any>();c.api.getAttendanceWorkflow.mockReturnValue(held.promise);const reading=actual("selectRepeatedPerson",c)({person:{id:"person"}});await tick();const response=c.response();vi.setSystemTime(new Date("2026-11-26T08:00:00Z"));held.resolve(response);await reading;expect(c.clearPersonFlow).toHaveBeenCalledOnce();expect(c.setTemporalNotice).toHaveBeenCalledWith(expect.stringContaining("Cambió el día operativo"));expect(c.saveEntry).not.toHaveBeenCalled();
 });
 it("an old read/finally cannot replace the new person or finish their indicator",async()=>{
  const{c}=fixture(),first=deferred<any>(),second=deferred<any>();c.api.getAttendanceWorkflow.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const a=actual("selectRepeatedPerson",c)({person:{id:"old"}});await tick();const b=actual("selectRepeatedPerson",c)({person:{id:"new"}});await tick();first.resolve(c.response("old"));await a;expect(c.personReadPending).toBe(true);expect(c.selectedItem.person.id).toBe("new");second.resolve(c.response("new"));await b;expect(c.personReadPending).toBe(false);expect(c.selectedItem.person.id).toBe("new");
 });
 it.each(["session","contract"])("ignores a late error after %s changes",async change=>{
  const{c,retire}=fixture();let fail!:(e:Error)=>void;c.api.getAttendanceWorkflow.mockReturnValue(new Promise((_,reject)=>{fail=reject}));const reading=actual("selectRepeatedPerson",c)({person:{id:"person"}});await tick();if(change==="session")retire();else c.resolutionScopeRef.current="other";c.personReadRef.current=null;c.personReadPending=false;const calls=c.setPersonReadPending.mock.calls.length;fail(Error("old scope"));await reading;expect(c.setPersonReadPending).toHaveBeenCalledTimes(calls);expect(c.setError.mock.calls).toEqual([[null]]);
 });
});

// Execute the actual observation input callback, including its edit marker.
function actualObservationInput(c: Record<string, unknown>) {
 let expression: ts.Node | undefined;
 function visit(n: ts.Node) {
  if(ts.isJsxAttribute(n) && n.name.getText(source)==="onChangeText" && n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression?.getText(source).includes("setObservation(value)")) expression=n.initializer.expression;
  ts.forEachChild(n,visit);
 }
 visit(source);if(!expression)throw Error("Actual observation input handler missing");
 return new Function(...Object.keys(c),ts.transpileModule("const change="+expression.getText(source)+";return change;",{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText)(...Object.values(c)) as (text:string)=>void;
}
it("external ABA: preserves an explicitly cleared observation while the exact-person read completes",async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-26T12:00:00Z"));
 const{c}=fixture("ONE_PER_DAY"),held=deferred<any>();c.observation="";
 Object.assign(c.appView.config,{observationFieldId:"note",statusFieldId:"status",sourceEntityTypeId:"people",dateFieldId:"day",personFieldId:"person"});
 c.api.getAttendanceWorkflow.mockReturnValue(held.promise);
 const reading=actual("selectRepeatedPerson",c)({person:{id:"person"}});await tick();
 const change=actualObservationInput(c);change("temporary text");change("");
 expect(c.observation).toBe("");expect(c.draftRevisionRef.current).toBeGreaterThan(1);
 held.resolve({...c.response(),items:[{person:{id:"person"},attendance:{recordId:"remote",updatedAt:"2026-11-26T11:00:00.000Z",statusOptionId:"present",observation:"server",contextValues:{}}}],dailyRecords:[]});
 await reading;
 expect(c.saveEntry).not.toHaveBeenCalled();
 expect(c.observation).toBe("");
});


describe("observation intervention belongs to the exact person-read ticket", () => {
 it.each(["ONE_PER_DAY", "default"])("loads an untouched observation for %s without treating context edits as observation edits", async policy => {
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-26T12:00:00Z"));
  const {c}=fixture("ONE_PER_DAY"),held=deferred<any>();c.observation="";
  if(policy==="default")delete c.appView.config.repetitionPolicy;
  c.api.getAttendanceWorkflow.mockReturnValue(held.promise);
  const reading=actual("selectRepeatedPerson",c)({person:{id:"person"}});await tick();
  c.contextValues={lot:"changed independently"};c.draftRevisionRef.current++;
  held.resolve({...c.response(),items:[{person:{id:"person"},attendance:{recordId:"remote",observation:"server",contextValues:{}}}],dailyRecords:[]});await reading;
  expect(c.observation).toBe("server");expect(c.contextValues).toEqual({lot:"changed independently"});
  expect(c.registrationReadDateRef.current).toBe("2026-11-26");expect(c.personReadPending).toBe(false);expect(c.saveEntry).not.toHaveBeenCalled();
 });
 it.each(["", "initial", "different"])("preserves an explicit edit ending in %j and still completes the identity/date read",async final=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-26T12:00:00Z"));
  const{c}=fixture("ONE_PER_DAY"),held=deferred<any>();c.observation="initial";
  c.api.getAttendanceWorkflow.mockReturnValue(held.promise);const reading=actual("selectRepeatedPerson",c)({person:{id:"person"}});await tick();
  const change=actualObservationInput(c);change("temporary");change(final);
  held.resolve({...c.response(),items:[{person:{id:"person"},attendance:{recordId:"remote",observation:"server",contextValues:{}}}],dailyRecords:[]});await reading;
  expect(c.observation).toBe(final);expect(c.registrationReadDateRef.current).toBe("2026-11-26");expect(c.personReadPending).toBe(false);expect(c.saveEntry).not.toHaveBeenCalled();
 });
 it.each(["MULTIPLE", "MULTIPLE_WITH_WARNING"])("does not preload another record's observation for %s",async policy=>{
  const{c}=fixture(policy);c.observation="";c.api.getAttendanceWorkflow.mockResolvedValue(c.response());
  await actual("selectRepeatedPerson",c)({person:{id:"person"}});
  expect(c.observation).toBe("");expect(c.selectedItem.attendance).toBeNull();expect(c.personRecords?.length??c.setPersonRecords.mock.calls.at(-1)?.[0]?.length).toBe(1);
  expect(c.saveEntry).not.toHaveBeenCalled();
 });
 it("a replacement person gets a fresh intervention marker and the old response cannot replace it",async()=>{
  const{c}=fixture("ONE_PER_DAY"),old=deferred<any>(),next=deferred<any>();c.observation="";
  c.api.getAttendanceWorkflow.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const first=actual("selectRepeatedPerson",c)({person:{id:"old"}});await tick();actualObservationInput(c)("");
  const second=actual("selectRepeatedPerson",c)({person:{id:"new"}});await tick();
  old.resolve({...c.response("old"),items:[{person:{id:"old"},attendance:{recordId:"old-record",observation:"old text"}}]});await first;
  expect(c.selectedItem.person.id).toBe("new");expect(c.observation).toBe("");expect(c.personReadPending).toBe(true);
  next.resolve({...c.response("new"),items:[{person:{id:"new"},attendance:{recordId:"new-record",observation:"new text"}}]});await second;
  expect(c.observation).toBe("new text");expect(c.personReadPending).toBe(false);expect(c.saveEntry).not.toHaveBeenCalled();
 });
 it("entering exact-record editing retires a pending person read and loads only the chosen record",async()=>{
  const{c}=fixture("ONE_PER_DAY"),held=deferred<any>();c.observation="";c.saveInFlightRef={current:null};
  c.definitionCache.getCachedRecord=vi.fn(async()=>({localId:"local-selected",serverId:"selected",syncStatus:"synced"}));
  c.api.getAttendanceWorkflow.mockReturnValueOnce(held.promise).mockResolvedValue({...c.response(),items:[{person:{id:"person"},attendance:{recordId:"selected",updatedAt:"exact-version",observation:"chosen record"}}]});
  const reading=actual("selectRepeatedPerson",c)({person:{id:"person"}});await tick();
  await actual("editRepeatedRecord",c)({person:{id:"person"},attendance:{recordId:"selected",updatedAt:"exact-version"}});
  held.resolve({...c.response(),items:[{person:{id:"person"},attendance:{recordId:"other",observation:"wrong old read"}}]});await reading;
  expect(c.observation).toBe("chosen record");expect(c.selectedItem.attendance.recordId).toBe("selected");expect(c.selectedItem.attendance.updatedAt).toBe("exact-version");expect(c.saveEntry).not.toHaveBeenCalled();
 });
 it.each(["session", "contract", "unmount"])("does not publish late successful observation after %s retires the read",async change=>{
  const{c,retire}=fixture("ONE_PER_DAY"),held=deferred<any>();c.observation="";
  c.api.getAttendanceWorkflow.mockReturnValue(held.promise);const reading=actual("selectRepeatedPerson",c)({person:{id:"person"}});await tick();
  if(change==="session")retire();else if(change==="contract")c.resolutionScopeRef.current="new-scope";else c.resolutionMountedRef.current=false;
  c.observation="new scope draft";c.selectedItem={person:{id:"new-scope-person"}};
  const writes=c.setObservation.mock.calls.length,pendingCalls=c.setPersonReadPending.mock.calls.length;
  held.resolve({...c.response(),items:[{person:{id:"person"},attendance:{recordId:"old",observation:"stale text"}}]});await reading;
  expect(c.observation).toBe("new scope draft");expect(c.selectedItem.person.id).toBe("new-scope-person");expect(c.setObservation).toHaveBeenCalledTimes(writes);expect(c.setPersonReadPending).toHaveBeenCalledTimes(pendingCalls);expect(c.saveEntry).not.toHaveBeenCalled();
 });
});
