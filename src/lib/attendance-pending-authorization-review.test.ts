import {captureWorkflowWriteCommand,workflowWriteMetadata,type WorkflowWriteContract} from "./workflow-write-contract";
import {attendanceAttemptKey,attendanceCommandKey,attendanceContentChanged,attendanceEditContextValues,copyAttendanceEntry} from "../renderers/workflows/attendance/attendance-edit-command";
import {OpcoApiError, OpcoNetworkError} from "./opco-api";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";
import ts from "typescript";
import type {OpcoApi} from "./opco-api";
import {buildOfflineStateValues,stateUpdateIntentsEqual,type OfflineStateUpdatePayload} from "./state-update-offline";
import { stateUpdateItemToAttendanceItem, stateUpdateConflictToAttendanceRecord, attendanceStateFields } from "./attendance-offline";
import { attendanceContextFieldsFromPreparedDefinition, attendanceEntryToStateUpdateEntry, attendanceEntryExtraValues } from "../renderers/workflows/attendance/attendance-workflow-logic";
import { stateUpdateResolutionFeedback } from "../renderers/workflows/state-update/state-update-workflow-logic";
import { syncPendingStateUpdatesOnce } from "../sync/state-update-sync";
const sqlite = vi.hoisted(() => ({
  openDatabaseAsync: vi.fn()
}));
vi.mock("expo-sqlite", () => sqlite);
function sqliteHarness(databasePath = ":memory:") {
  const worker = spawn("python3", ["-u", "-c", `
import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1], isolation_level=None)
c.row_factory=sqlite3.Row
for line in sys.stdin:
 try:
  q=json.loads(line); sql=q['sql']; args=q.get('args',[])
  if q['kind']=='exec':
   if sql.strip() in ('BEGIN','COMMIT','ROLLBACK'): c.execute(sql)
   else: c.executescript(sql)
   result=None
  else:
   cur=c.execute(sql,args)
   result=[dict(r) for r in cur.fetchall()] if q['kind']=='read' else {'changes':cur.rowcount}
  print(json.dumps({'result':result}))
 except Exception as e: print(json.dumps({'error':str(e),'sqliteCode':getattr(e,'sqlite_errorcode',None),'sqliteName':getattr(e,'sqlite_errorname',None)}))
`, databasePath]);
  let buffer = "";
  const queue: {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }[] = [];
  worker.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      const reply = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const task = queue.shift()!;
      if (reply.error) task.reject(Object.assign(new Error(reply.error), {
        sqliteCode: reply.sqliteCode,
        sqliteName: reply.sqliteName
      }));else task.resolve(reply.result);
    }
  });
  const query = (kind: string, sql: string, args: unknown[] = []) => new Promise<any>((resolve, reject) => {
    queue.push({
      resolve,
      reject
    });
    worker.stdin.write(JSON.stringify({
      kind,
      sql,
      args
    }) + "\n");
  });
  const db = {
    execAsync: (sql: string) => query("exec", sql),
    getAllAsync: (sql: string, ...args: unknown[]) => query("read", sql, args),
    getFirstAsync: async (sql: string, ...args: unknown[]) => (await query("read", sql, args))[0] ?? null,
    runAsync: vi.fn((sql: string, ...args: unknown[]) => query("write", sql, args)),
    withTransactionAsync: async (task: () => Promise<void>) => {
      await query("exec", "BEGIN");
      try {
        await task();
        await query("exec", "COMMIT");
      } catch (error) {
        await query("exec", "ROLLBACK");
        throw error;
      }
    },
    closeAsync: async () => {
      worker.kill();
    }
  };
  return {
    db,
    stop: () => worker.kill()
  };
}


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

const scope={ownerKey:"synthetic:user",contractId:"contract",appViewId:"attendance",targetEntityTypeId:"attendance-entity",date:"2026-10-09"};
const base="2026-10-09T10:00:00.000Z";
const fields=[{fieldId:"status",label:"Status",type:"SELECT" as const,required:true,options:[{optionId:"training",label:"Training",value:"TRAINING"},{optionId:"present",label:"Present",value:"PRESENT"}]}];
let directory:string,harness:ReturnType<typeof sqliteHarness>,store:ReturnType<typeof getLocalDatabase>;
beforeEach(async()=>{__resetLocalDatabaseForTests();directory=mkdtempSync("/tmp/opco-attendance-confirm-");harness=sqliteHarness(directory+"/db.sqlite");sqlite.openDatabaseAsync.mockResolvedValue(harness.db);store=getLocalDatabase();await store.getSelectedContractId();await store.upsertStateUpdateSnapshot({...scope,historyMode:"update-current",uniqueness:"subject-date",complete:false,latest:[],items:[{subject:{id:"person",displayName:"Synthetic"},current:{recordId:"remote",updatedAt:base,stateValues:[{fieldId:"status",optionId:"training",label:"Training"}]}}]});});
afterEach(()=>{harness.stop();__resetLocalDatabaseForTests();rmSync(directory,{recursive:true,force:true});});
async function reopen(){await harness.db.closeAsync();__resetLocalDatabaseForTests();harness=sqliteHarness(directory+"/db.sqlite");sqlite.openDatabaseAsync.mockResolvedValue(harness.db);store=getLocalDatabase();await store.getSelectedContractId();}
function input(overwrite?:boolean){return {...scope,subjectRecordId:"person",subjectDisplayName:"Synthetic",historyMode:"update-current" as const,uniqueness:"subject-date" as const,stateFields:fields,stateValues:[{fieldId:"status",optionId:"present"}],expectedUpdatedAt:base,overwrite};}
function rendererContext(before:any){
  const c:any={captureWorkflowWriteCommand,workflowWriteMetadata,writeContract:undefined,writeContractRequiredRef:{current:false},attendanceAttemptKey,attendanceCommandKey,attendanceContentChanged,copyAttendanceEntry,OpcoApiError,draftRevisionRef:{current:0},saveInFlightRef:{current:false},onlineAttemptsRef:{current:new Map()},setConfirmationError:vi.fn(),conflict:null,buildOfflineStateValues,stateUpdateIntentsEqual,resolutionMountedRef:{current:true},requestSequenceRef:{current:0},confirmationSequenceRef:{current:0},resolutionScope:"scope",resolutionScopeRef:{current:"scope"},selectedContractId:scope.contractId,selectedItem:{person:{id:"person",displayName:"Synthetic"},attendance:{recordId:before.localRecordId,statusOptionId:"present",statusLabel:"Present",updatedAt:base}},ownerKey:scope.ownerKey,isSaving:false,isOnline:false,date:scope.date,appView:{id:scope.appViewId,config:{statusFieldId:"status",targetEntityTypeId:scope.targetEntityTypeId}},contextFields:[],contextValues:{},supportsObservation:false,observation:"",statuses:fields[0].options,definitionCache:store,attendanceContextValidationErrors:()=>[],attendanceStateFields,attendanceEntryExtraValues,attendanceEntryToStateUpdateEntry};
  for(const name of ["setContextErrors","setIsSaving","setError","setRefreshError","setSuccessMessage","clearPersonFlow","refreshLocalDayState","refreshRecordsSyncSummary","clearVisibleError","reportWriteFeedback","recordVisibleError","setConflict"]) c[name]=vi.fn();
  c.saveEntry=handler("saveEntry",c);return c;
}
describe("review of already-confirmed pending Attendance",()=>{
 it("saving the same pending value must keep the confirmed immutable intention",async()=>{
  await store.saveStateUpdateLocally(input(true));await reopen();const before=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
  const c=rendererContext(before);
  c.saveEntry=handler("saveEntry",c);
  await handler("saveStatus",c)({optionId:"present",label:"Present"});
  expect(c.recordVisibleError).not.toHaveBeenCalled();expect(c.setConflict).not.toHaveBeenCalled();await reopen();const after=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
  expect(after.localRecordId).toBe(before.localRecordId);expect(after.serverRecordId).toBe(before.serverRecordId);
  expect(after.payload).toMatchObject({overwrite:true,expectedUpdatedAt:base});expect(after.clientRequestId).toBe(before.clientRequestId);expect(after).toEqual(before);
 });
 it("does not reset an in-flight confirmed intent",async()=>{
  await store.saveStateUpdateLocally(input(true));const op=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];await store.markStateUpdateOperationSyncing(op.id);await reopen();const before=await harness.db.getAllAsync("SELECT * FROM pending_operations");const records=await harness.db.getAllAsync("SELECT * FROM entity_records");await handler("saveStatus",rendererContext(op))({optionId:"present",label:"Present"});await reopen();expect(await harness.db.getAllAsync("SELECT * FROM pending_operations")).toEqual(before);expect(await harness.db.getAllAsync("SELECT * FROM entity_records")).toEqual(records);
 });
 it.each(["status","extras"])("changed %s requires confirmation; cancelling leaves both tables intact",async(kind)=>{
  await store.saveStateUpdateLocally(input(true));await reopen();const op=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];const c=rendererContext(op);if(kind==="extras"){c.supportsObservation=true;c.observation="synthetic changed";c.appView.config.observationFieldId="observation";}
  const before=await harness.db.getAllAsync("SELECT * FROM pending_operations");const records=await harness.db.getAllAsync("SELECT * FROM entity_records");await handler("saveStatus",c)({optionId:kind==="status"?"training":"present",label:"Synthetic"});expect(c.setConflict).toHaveBeenCalledTimes(1);await handler("cancelConflict",c)();await reopen();expect(await harness.db.getAllAsync("SELECT * FROM pending_operations")).toEqual(before);expect(await harness.db.getAllAsync("SELECT * FROM entity_records")).toEqual(records);
 });
 it("accepts different content only with a new explicit confirmation and the original base",async()=>{
  await store.saveStateUpdateLocally(input(true));const before=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];const c=rendererContext(before);await handler("saveStatus",c)({optionId:"training",label:"Training"});const conflict=c.setConflict.mock.calls[0][0];await handler("confirmConflict",{...c,conflict})();await reopen();const after=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];expect(after.clientRequestId).not.toBe(before.clientRequestId);expect(after.payload).toMatchObject({overwrite:true,expectedUpdatedAt:base,stateValues:[{optionId:"training"}]});
 });
 it.each([false,true])("repeated confirmed intent syncs with original base; later remote change=%s",async(changed)=>{
  await store.saveStateUpdateLocally(input(true));await reopen();const original=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];await handler("saveStatus",rendererContext(original))({optionId:"present",label:"Present"});await reopen();
  const result=changed?{result:"CONFLICT" as const,subjectRecordId:"person",existing:{recordId:"remote",updatedAt:"2026-10-11T12:00:00.000Z",stateValues:[{fieldId:"status",optionId:"training",label:"Training"}]},requested:{stateValues:[{fieldId:"status",optionId:"present",label:"Present"}]}}:{result:"UPDATED" as const,subjectRecordId:"person",recordId:"remote",updatedAt:"2026-10-11T12:00:00.000Z"};
  const api={saveStateUpdateWorkflow:vi.fn<OpcoApi["saveStateUpdateWorkflow"]>(async()=>({appView:{id:scope.appViewId,name:"Synthetic",slug:"synthetic"},results:[result]}))};await syncPendingStateUpdatesOnce({api,store,ownerKey:scope.ownerKey,token:"test-only"});expect(api.saveStateUpdateWorkflow.mock.calls[0][3]).toMatchObject({overwrite:true,expectedUpdatedAt:base,clientRequestId:original.clientRequestId});await reopen();if(changed){expect(await store.listStateUpdateConflicts(scope)).toHaveLength(1);expect(JSON.parse((await harness.db.getAllAsync("SELECT payload_json FROM pending_operations"))[0].payload_json)).toMatchObject({overwrite:true,expectedUpdatedAt:base});}else{expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toEqual([]);expect(await harness.db.getAllAsync("SELECT server_id FROM entity_records")).toEqual([{server_id:null}]);}
 });
 it("repeating old unconfirmed content does not grant authorization",async()=>{
  await store.saveStateUpdateLocally(input());const op=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];await handler("saveStatus",rendererContext(op))({optionId:"present",label:"Present"});await reopen();expect((await store.listPendingStateUpdateOperations(scope.ownerKey))[0].payload).not.toMatchObject({overwrite:true});
 });

});


describe("observation-only confirmed replacement across SQLite reopen",()=>{
 it("preserves untouched context, base, state and authorization without changing the reopened intent",async()=>{
  await store.upsertStateUpdateSnapshot({...scope,historyMode:"update-current",uniqueness:"subject-date",complete:false,latest:[],items:[{subject:{id:"person",displayName:"Synthetic"},current:{recordId:"remote",updatedAt:base,stateValues:[{fieldId:"status",optionId:"training",label:"Training"}],extraValues:{note:"Original",shift:"FIRST"}}}]});
  const c=rendererContext({localRecordId:"remote"});c.appView.config.observationFieldId="note";c.appView.config.contextFieldIds=["shift"];c.contextFields=[{id:"shift",name:"Context",type:"SELECT",required:true,options:[{optionId:"a",value:"FIRST",label:"First"}]}];c.contextValues={shift:"a"};c.supportsObservation=true;c.observation="Edited";c.selectedItem.attendance={recordId:"remote",statusOptionId:"training",statusLabel:"Training",updatedAt:base,observation:"Original",contextValues:{shift:"a"}};
  c.saveEntry=handler("saveEntry",c);await handler("saveStatus",c)({optionId:"training",label:"Training"});expect(c.setConflict).toHaveBeenCalledOnce();const conflict=c.setConflict.mock.calls[0][0];await handler("confirmConflict",{...c,conflict})();expect(c.recordVisibleError).not.toHaveBeenCalled();
  const before=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];expect(before.payload).toMatchObject({overwrite:true,expectedUpdatedAt:base,stateValues:[{optionId:"training"}],extraValues:{note:"Edited",shift:"FIRST"}});await reopen();expect((await store.listPendingStateUpdateOperations(scope.ownerKey))[0]).toEqual(before);
  const reopened=rendererContext(before);Object.assign(reopened,{contextFields:c.contextFields,contextValues:c.contextValues,supportsObservation:true,observation:"Edited",appView:c.appView,selectedItem:{...c.selectedItem,attendance:{...c.selectedItem.attendance,statusOptionId:"training",observation:"Edited"}}});reopened.saveEntry=handler("saveEntry",reopened);await handler("saveStatus",reopened)({optionId:"training",label:"Training"});expect(reopened.setConflict).not.toHaveBeenCalled();await reopen();expect((await store.listPendingStateUpdateOperations(scope.ownerKey))[0]).toEqual(before);
 });
});


describe("Attendance relation context durability and sync", () => {
 const contextFields = [{ id: "related", name: "Related", type: "RELATION" as const, required: true, config: { relation: { targetEntityTypeId: "catalog", relationKind: "ONE" } } },
  { id: "shift", name: "Choice", type: "SELECT" as const, required: true, options: [{ optionId: "a", label: "A", value: "FIRST" }] }];
 it("remembers one context across consecutive captures, reopens and sends each exact ID once", async () => {
  await store.setAttendanceContextSelection(scope.ownerKey, scope.contractId, scope.appViewId, "related", "catalog-one");
  for (const subjectRecordId of ["new-person-one", "new-person-two"]) {
   const related = await store.getAttendanceContextSelection(scope.ownerKey, scope.contractId, scope.appViewId, "related");
   const c = rendererContext({ localRecordId: subjectRecordId });
   Object.assign(c, { contextFields, contextValues: { related, shift: "a" }, selectedItem: { person: { id: subjectRecordId, displayName: "Synthetic subject" }, attendance: null } });
   c.appView.config.contextFieldIds = ["related", "shift"]; c.saveEntry = handler("saveEntry", c);
   await handler("saveStatus", c)({ optionId: "present", label: "Present" });
   expect(c.clearPersonFlow).toHaveBeenCalledOnce(); expect(c.recordVisibleError).not.toHaveBeenCalled();
   expect(await store.getAttendanceContextSelection(scope.ownerKey, scope.contractId, scope.appViewId, "related")).toBe(related);
  }
  const pending = await store.listPendingStateUpdateOperations(scope.ownerKey); expect(pending).toHaveLength(2);
  await reopen(); expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toEqual(pending); expect(await store.getAttendanceContextSelection(scope.ownerKey, scope.contractId, scope.appViewId, "related")).toBe("catalog-one");
  expect(await store.getAttendanceContextSelection("another:user", scope.contractId, scope.appViewId, "related")).toBeNull();
  const api = { saveStateUpdateWorkflow: vi.fn<OpcoApi["saveStateUpdateWorkflow"]>(async (_token, _contract, _view, request) => ({ appView: { id: scope.appViewId, name: "Synthetic", slug: "synthetic" }, results: [{ result: "CREATED", subjectRecordId: request.subjectRecordId!, recordId: "remote-" + request.subjectRecordId, updatedAt: "2026-11-03T12:00:00.000Z" }] })) };
  await syncPendingStateUpdatesOnce({ api, store, ownerKey: scope.ownerKey, token: "synthetic" }); expect(api.saveStateUpdateWorkflow).toHaveBeenCalledTimes(2);
  for (const call of api.saveStateUpdateWorkflow.mock.calls) expect(call[3]).toMatchObject({ extraValues: { related: "catalog-one", shift: "FIRST" }, clientRequestId: expect.any(String) });
  await reopen(); expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toEqual([]); expect(await harness.db.getFirstAsync("PRAGMA integrity_check")).toEqual({ integrity_check: "ok" });
 });
 it("editing only the content preserves the existing relation, base and authorization after reopen", async () => {
  await store.upsertStateUpdateSnapshot({ ...scope, historyMode: "update-current", uniqueness: "subject-date", complete: false, latest: [], items: [{ subject: { id: "person", displayName: "Synthetic" }, current: { recordId: "remote", updatedAt: base, stateValues: [{ fieldId: "status", optionId: "training", label: "Training" }], extraValues: { related: { id: "catalog-existing", displayName: "Existing label" }, shift: "FIRST" } } }] });
  const c = rendererContext({ localRecordId: "remote" }); Object.assign(c, { contextFields, contextValues: { related: "catalog-existing", shift: "a" } }); c.appView.config.contextFieldIds = ["related", "shift"];
  c.selectedItem.attendance = { recordId: "remote", statusOptionId: "training", statusLabel: "Training", updatedAt: base, contextValues: { related: { id: "catalog-existing", displayName: "Existing label" }, shift: "a" } };
  c.saveEntry = handler("saveEntry", c); await handler("saveStatus", c)({ optionId: "present", label: "Present" }); const conflict = c.setConflict.mock.calls[0][0]; await handler("confirmConflict", { ...c, conflict })();
  const before = (await store.listPendingStateUpdateOperations(scope.ownerKey))[0]; expect(before.payload).toMatchObject({ overwrite: true, expectedUpdatedAt: base, extraValues: { related: "catalog-existing", shift: "FIRST" } }); await reopen(); expect((await store.listPendingStateUpdateOperations(scope.ownerKey))[0]).toEqual(before);
  const api = { saveStateUpdateWorkflow: vi.fn<OpcoApi["saveStateUpdateWorkflow"]>().mockRejectedValueOnce(new OpcoNetworkError("Synthetic lost response")).mockResolvedValueOnce({ appView: { id: scope.appViewId, name: "Synthetic", slug: "synthetic" }, results: [{ result: "UPDATED", subjectRecordId: "person", recordId: "remote", updatedAt: "2026-11-03T12:00:00.000Z" }] }) };
  await syncPendingStateUpdatesOnce({ api, store, ownerKey: scope.ownerKey, token: "synthetic" }); await reopen(); expect((await store.listPendingStateUpdateOperations(scope.ownerKey))[0].clientRequestId).toBe(before.clientRequestId);
  await syncPendingStateUpdatesOnce({ api, store, ownerKey: scope.ownerKey, token: "synthetic" }); expect(api.saveStateUpdateWorkflow.mock.calls[1][3]).toEqual(api.saveStateUpdateWorkflow.mock.calls[0][3]); await reopen(); expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toEqual([]);
 });
});

it("offline relation catalog stays paginated while a remembered selection label survives outside the page", async () => {
 await store.upsertRemoteRecords({ ownerKey: scope.ownerKey, contractId: scope.contractId, entityTypeId: "catalog", records: Array.from({ length: 26 }, (_, i) => ({ id: "catalog-" + i, displayName: "Synthetic " + String(i).padStart(2, "0"), values: {}, updatedAt: "2026-11-03T10:00:00.000Z" })) });
 await store.setAttendanceContextSelection(scope.ownerKey, scope.contractId, scope.appViewId, "related", "catalog-25"); await reopen();
 const { loadStateUpdateRelationPage } = await import("./state-update-relations");
 const api = { getEntityRecords: vi.fn() }; const result = await loadStateUpdateRelationPage({ api, store, token: "synthetic", ownerKey: scope.ownerKey, contractId: scope.contractId, online: false, field: { id: "related", key: "related", name: "Related", type: "RELATION", required: true, config: { relation: { targetEntityTypeId: "catalog", relationKind: "ONE" } } } });
 expect(result.options).toHaveLength(25); expect(result.hasMore).toBe(true); expect(result.options.some(option => option.id === "catalog-25")).toBe(false); expect(api.getEntityRecords).not.toHaveBeenCalled(); expect(result).not.toHaveProperty("complete");
 expect(await store.getAttendanceContextSelection(scope.ownerKey, scope.contractId, scope.appViewId, "related")).toBe("catalog-25"); expect(await store.getCachedRecord({ ownerKey: scope.ownerKey, contractId: scope.contractId, entityTypeId: "catalog", recordId: "catalog-25" })).toMatchObject({ serverId: "catalog-25", displayName: "Synthetic 25" });
});


describe("opt-in command capability in real Attendance handlers",()=>{
 const contract:WorkflowWriteContract={version:1,configurationFingerprint:"d".repeat(64),requiredCapabilities:["relation-context-v1"],authorized:true,acceptNewCommands:true};
 it("captures the relation capability once and keeps the exact offline command after reopen",async()=>{
  const c=rendererContext({localRecordId:"unused"});c.selectedItem={person:{id:"another-person",displayName:"Synthetic"},attendance:null};c.writeContract=contract;c.writeContractRequiredRef.current=true;
  c.contextFields=[{id:"related",name:"Context",type:"RELATION",required:true,config:{relation:{targetEntityTypeId:"catalog",relationKind:"ONE"}}}];c.appView.config.contextFieldIds=["related"];c.contextValues={related:"synthetic-catalog"};c.saveEntry=handler("saveEntry",c);
  await handler("saveStatus",c)({optionId:"present",label:"Present"});expect(c.clearPersonFlow).toHaveBeenCalledOnce();expect(c.recordVisibleError).not.toHaveBeenCalled();
  const original=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];expect(original.payload).toMatchObject({writeCommand:{version:1,configurationFingerprint:contract.configurationFingerprint,capabilities:["relation-context-v1"]},extraValues:{related:"synthetic-catalog"}});await reopen();expect((await store.listPendingStateUpdateOperations(scope.ownerKey))[0]).toEqual(original);
 });
 it("does not silently capture when a known protected experience loses its capability metadata",async()=>{
  const c=rendererContext({localRecordId:"unused"});c.selectedItem={person:{id:"another-person",displayName:"Synthetic"},attendance:null};c.writeContractRequiredRef.current=true;
  const before=await harness.db.getAllAsync("SELECT * FROM pending_operations");await handler("saveStatus",c)({optionId:"present",label:"Present"});expect(c.setError).toHaveBeenCalledWith(expect.stringContaining("revisión explícita"));expect(c.clearPersonFlow).not.toHaveBeenCalled();expect(await harness.db.getAllAsync("SELECT * FROM pending_operations")).toEqual(before);
 });
});

describe("historical ONE/true Attendance restoration on real SQLite",()=>{
 const relationField={id:"related",key:"related",name:"Related",type:"RELATION" as const,required:true,multiple:true,config:{relation:{relationKind:"ONE",targetEntityTypeId:"catalog"}}};
 const selectField={id:"shift",key:"shift",name:"Shift",type:"SELECT" as const,required:true,options:[{id:"a",value:"FIRST",label:"A",active:true,order:0}]};
 const config={workflowKey:"attendance" as const,sourceEntityTypeId:"people",targetEntityTypeId:scope.targetEntityTypeId,personFieldId:"subject",dateFieldId:"date",statusFieldId:"status",observationFieldId:"note",contextFieldIds:["related","shift"]};
 const related={id:"catalog-existing",displayName:"Existing synthetic label",entityTypeId:"catalog"};
 async function prepare(){
  await store.upsertAppViewDefinition({...scope,appViewType:"WORKFLOW",workflowKey:"attendance",status:"ready",lastPreparedAt:base,definition:{kind:"state-update",appView:{id:scope.appViewId,name:"Synthetic",slug:"synthetic",type:"WORKFLOW",icon:null,sortOrder:0,config},sourceEntityTypeId:"people",subjectFieldId:"subject",dateFieldId:"date",targetEntityTypeId:scope.targetEntityTypeId,extraFields:[relationField,selectField],stateFields:fields,historyMode:"update-current",uniqueness:"subject-date"}});
  await store.upsertRemoteRecords({ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:"people",records:[{id:"person",displayName:"Synthetic",values:{},updatedAt:base}]});
  await store.upsertStateUpdateSnapshot({...scope,historyMode:"update-current",uniqueness:"subject-date",complete:false,latest:[],items:[{subject:{id:"person",displayName:"Synthetic"},current:{recordId:"remote",updatedAt:base,stateValues:[{fieldId:"status",optionId:"training",label:"Training"}],extraValues:{related:[related],shift:"FIRST",note:"Original"}}}]});
 }
 async function restore(){
  const prepared=await store.getAppViewDefinition(scope.ownerKey,scope.contractId,scope.appViewId);
  if(!prepared || prepared.definition.kind!=="state-update")throw Error("Synthetic metadata missing");
  expect(prepared.definition.extraFields[0]).toMatchObject({multiple:true,config:{relation:{relationKind:"ONE"}}});
  const contextFields=attendanceContextFieldsFromPreparedDefinition(prepared.definition.extraFields,config.contextFieldIds);
  const rows=await store.searchStateUpdateSubjects({...scope,sourceEntityTypeId:"people",search:""});
  const selectedItem=stateUpdateItemToAttendanceItem(rows[0],"status","note",contextFields);
  expect(selectedItem.attendance?.contextValues?.related).toEqual(related);
  return {contextFields,selectedItem,contextValues:attendanceEditContextValues(contextFields,selectedItem,{related:"remembered-other",shift:"a"})};
 }
 it.each([false,true])("restores labels offline, explicitly edits and preserves base/auth on reopen and sync; conflict=%s",async(changed)=>{
  await prepare();await reopen();const restored=await restore();expect(restored.contextValues).toEqual({related:related.id,shift:"a"});
  const c=rendererContext({localRecordId:"remote"});Object.assign(c,restored);c.appView.config=config;c.supportsObservation=true;c.observation="Edited synthetic";
  c.saveEntry=handler("saveEntry",c);await handler("saveStatus",c)({optionId:"training",label:"Training"});
  const conflict=c.setConflict.mock.calls[0][0];await handler("confirmConflict",{...c,conflict})();
  const before=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
  expect(before.payload).toMatchObject({overwrite:true,expectedUpdatedAt:base,extraValues:{related:related.id,shift:"FIRST",note:"Edited synthetic"}});
  await reopen();expect((await store.listPendingStateUpdateOperations(scope.ownerKey))[0]).toEqual(before);
  const result=changed?{result:"CONFLICT" as const,subjectRecordId:"person",existing:{recordId:"remote",updatedAt:"2026-11-06T11:00:00.000Z",stateValues:[{fieldId:"status",optionId:"present",label:"Present"}],extraValues:{related:[{...related,id:"remote-related"}],shift:"FIRST",note:"Remote synthetic"}},requested:{stateValues:[{fieldId:"status",optionId:"training",label:"Training"}]}}:{result:"UPDATED" as const,subjectRecordId:"person",recordId:"remote",updatedAt:"2026-11-06T11:00:00.000Z"};
  const api={saveStateUpdateWorkflow:vi.fn<OpcoApi["saveStateUpdateWorkflow"]>(async()=>({appView:{id:scope.appViewId,name:"Synthetic",slug:"synthetic"},results:[result]}))};
  await syncPendingStateUpdatesOnce({api,store,ownerKey:scope.ownerKey,token:"synthetic"});
  expect(api.saveStateUpdateWorkflow.mock.calls[0][3]).toMatchObject({clientRequestId:before.clientRequestId,expectedUpdatedAt:base,overwrite:true,extraValues:(before.payload as OfflineStateUpdatePayload).extraValues});
  await reopen();if(changed){const conflicts=await store.listStateUpdateConflicts(scope);expect(conflicts).toHaveLength(1);const adapted=stateUpdateConflictToAttendanceRecord(conflicts[0],"status","note",restored.contextFields);expect(adapted.contextValues?.related).toBe(related.id);expect(adapted.expectedUpdatedAt).toBe(base);expect(adapted.conflictRemoteUpdatedAt).toBe("2026-11-06T11:00:00.000Z");const retained=await harness.db.getFirstAsync("SELECT client_request_id,payload_json FROM pending_operations WHERE id=?",before.id);expect(retained.client_request_id).toBe(before.clientRequestId);expect(JSON.parse(retained.payload_json)).toMatchObject({overwrite:true,expectedUpdatedAt:base,extraValues:(before.payload as OfflineStateUpdatePayload).extraValues});
   const resolution={...c,isOnline:false,resolutionInFlightRef:{current:false},setResolutionFeedback:vi.fn(),stateUpdateResolutionFeedback};
   await handler("handleUseLocalConflictChange",resolution)(adapted);
   expect(resolution.setError).toHaveBeenLastCalledWith(null);expect(resolution.setResolutionFeedback).toHaveBeenCalledWith(expect.objectContaining({outcome:"pending"}));
   const explicit=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];expect(explicit.clientRequestId).not.toBe(before.clientRequestId);expect(explicit.payload).toMatchObject({overwrite:true,expectedUpdatedAt:"2026-11-06T11:00:00.000Z",extraValues:{related:related.id,shift:"FIRST",note:"Edited synthetic"}});await reopen();expect((await store.listPendingStateUpdateOperations(scope.ownerKey))[0]).toEqual(explicit);
  }
  else expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toEqual([]);
  expect(await harness.db.getFirstAsync("PRAGMA integrity_check")).toEqual({integrity_check:"ok"});
 });
 it("reading and reopening never rewrites an old pending array, its capability, authorization, base or idempotency key",async()=>{
  await prepare();const writeCommand={version:1 as const,configurationFingerprint:"f".repeat(64),capabilities:["relation-context-v1"] as ["relation-context-v1"]};
  await store.saveStateUpdateLocally({...input(true),...workflowWriteMetadata({writeCommand}),extraValues:{related:[related.id],shift:"FIRST"}});
  const before=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];await reopen();
  const metadata=attendanceContextFieldsFromPreparedDefinition([relationField,selectField],config.contextFieldIds);
  const rows=await store.searchStateUpdateSubjects({...scope,sourceEntityTypeId:"people",search:""});
  expect(stateUpdateItemToAttendanceItem(rows[0],"status","note",metadata).attendance?.contextValues?.related).toBe(related.id);
  expect((await store.listPendingStateUpdateOperations(scope.ownerKey))[0]).toEqual(before);
  const api={saveStateUpdateWorkflow:vi.fn<OpcoApi["saveStateUpdateWorkflow"]>(async()=>({appView:{id:scope.appViewId,name:"Synthetic",slug:"synthetic"},results:[{result:"UPDATED",subjectRecordId:"person",recordId:"remote",updatedAt:"2026-11-06T11:00:00.000Z",writeCommand}]}))};
  await syncPendingStateUpdatesOnce({api,store,ownerKey:scope.ownerKey,token:"synthetic"});
  expect(api.saveStateUpdateWorkflow.mock.calls[0][3]).toMatchObject({clientRequestId:before.clientRequestId,expectedUpdatedAt:base,overwrite:true,writeCommand,extraValues:{related:[related.id],shift:"FIRST"}});
  expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toEqual([]);await reopen();expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toEqual([]);
  expect(await harness.db.getFirstAsync("PRAGMA integrity_check")).toEqual({integrity_check:"ok"});
 });
});
