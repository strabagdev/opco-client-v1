// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";
import ts from "typescript";
import type {OpcoApi} from "./opco-api";
import {buildOfflineStateValues,stateUpdateIntentsEqual} from "./state-update-offline";
import { attendanceStateFields } from "./attendance-offline";
import { attendanceEntryExtraValues } from "../renderers/workflows/attendance/attendance-workflow-logic";
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
  const c:any={buildOfflineStateValues,stateUpdateIntentsEqual,resolutionMountedRef:{current:true},requestSequenceRef:{current:0},resolutionScope:"scope",resolutionScopeRef:{current:"scope"},selectedContractId:scope.contractId,selectedItem:{person:{id:"person",displayName:"Synthetic"},attendance:{recordId:before.localRecordId,statusOptionId:"present",statusLabel:"Present",updatedAt:base}},ownerKey:scope.ownerKey,isSaving:false,isOnline:false,date:scope.date,appView:{id:scope.appViewId,config:{statusFieldId:"status",targetEntityTypeId:scope.targetEntityTypeId}},contextFields:[],contextValues:{},supportsObservation:false,observation:"",statuses:fields[0].options,definitionCache:store,attendanceContextValidationErrors:()=>[],attendanceStateFields,attendanceEntryExtraValues};
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
