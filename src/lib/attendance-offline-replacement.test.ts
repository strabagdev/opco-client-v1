// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";
import type { OpcoApi } from "./opco-api";
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


const scope={ownerKey:"synthetic:user",contractId:"contract",appViewId:"attendance",targetEntityTypeId:"attendance-entity",date:"2026-10-09"};
const base="2026-10-09T10:00:00.000Z";
const fields=[{fieldId:"status",label:"Status",type:"SELECT" as const,required:true,options:[{optionId:"training",label:"Training",value:"TRAINING"},{optionId:"present",label:"Present",value:"PRESENT"}]}];
let directory:string,harness:ReturnType<typeof sqliteHarness>,store:ReturnType<typeof getLocalDatabase>;
beforeEach(async()=>{__resetLocalDatabaseForTests();directory=mkdtempSync("/tmp/opco-attendance-confirm-");harness=sqliteHarness(directory+"/db.sqlite");sqlite.openDatabaseAsync.mockResolvedValue(harness.db);store=getLocalDatabase();await store.getSelectedContractId();await store.upsertStateUpdateSnapshot({...scope,historyMode:"update-current",uniqueness:"subject-date",complete:false,latest:[],items:[{subject:{id:"person",displayName:"Synthetic"},current:{recordId:"remote",updatedAt:base,stateValues:[{fieldId:"status",optionId:"training",label:"Training"}]}}]});});
afterEach(()=>{harness.stop();__resetLocalDatabaseForTests();rmSync(directory,{recursive:true,force:true});});
async function reopen(){await harness.db.closeAsync();__resetLocalDatabaseForTests();harness=sqliteHarness(directory+"/db.sqlite");sqlite.openDatabaseAsync.mockResolvedValue(harness.db);store=getLocalDatabase();await store.getSelectedContractId();}
function input(overwrite?:boolean){return {...scope,subjectRecordId:"person",subjectDisplayName:"Synthetic",historyMode:"update-current" as const,uniqueness:"subject-date" as const,stateFields:fields,stateValues:[{fieldId:"status",optionId:"present"}],expectedUpdatedAt:base,overwrite};}
describe("Attendance confirmed offline replacement persistence",()=>{
 it("persists authorization/base atomically and sends unchanged after reopen",async()=>{
  const saved=await store.saveStateUpdateLocally(input(true));const before=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];await reopen();const after=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];expect(after).toEqual(before);expect(after.serverRecordId).toBe("remote");expect(after.payload).toMatchObject({overwrite:true,expectedUpdatedAt:base});
  const api={saveStateUpdateWorkflow:vi.fn<OpcoApi["saveStateUpdateWorkflow"]>(async()=>({appView:{id:scope.appViewId,name:"Synthetic",slug:"synthetic"},results:[{recordId:"remote",subjectRecordId:"person",updatedAt:"2026-10-09T11:00:00.000Z",result:"UPDATED" as const}]}))};const result=await syncPendingStateUpdatesOnce({api,store,ownerKey:scope.ownerKey,token:"test-only"});expect(api.saveStateUpdateWorkflow.mock.calls[0][3]).toMatchObject({overwrite:true,expectedUpdatedAt:base,clientRequestId:before.clientRequestId});expect(result.completed).toBe(1);expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toEqual([]);const records=await harness.db.getAllAsync("SELECT local_id,server_id,sync_status FROM entity_records");expect(records).toEqual([{local_id:saved.localRecordId,server_id:"remote",sync_status:"synced"}]);
 });
 it("remote change keeps confirmed base and both conflict versions after reopen",async()=>{
  await store.saveStateUpdateLocally(input(true));await reopen();const api={saveStateUpdateWorkflow:vi.fn<OpcoApi["saveStateUpdateWorkflow"]>(async()=>({appView:{id:scope.appViewId,name:"Synthetic",slug:"synthetic"},results:[{result:"CONFLICT" as const,subjectRecordId:"person",existing:{recordId:"remote",updatedAt:"2026-10-09T12:00:00.000Z",stateValues:[{fieldId:"status",optionId:"training",label:"Training"}]},requested:{stateValues:[{fieldId:"status",optionId:"present",label:"Present"}]}}]}))};const result=await syncPendingStateUpdatesOnce({api,store,ownerKey:scope.ownerKey,token:"test-only"});expect(result.conflicts).toBe(1);expect(api.saveStateUpdateWorkflow.mock.calls[0][3]).toMatchObject({overwrite:true,expectedUpdatedAt:base});await reopen();const conflicts=await store.listStateUpdateConflicts(scope);expect(conflicts).toHaveLength(1);expect(conflicts[0]).toMatchObject({expectedUpdatedAt:base,conflictRemoteUpdatedAt:"2026-10-09T12:00:00.000Z",stateValues:[{fieldId:"status",optionId:"present",label:"Present"}]});const rows=await harness.db.getAllAsync("SELECT payload_json FROM pending_operations");expect(JSON.parse(rows[0].payload_json)).toMatchObject({overwrite:true,expectedUpdatedAt:base});
 });
 it("old unconfirmed operation remains unconfirmed after reopen and sends no overwrite",async()=>{
  await store.saveStateUpdateLocally(input());await reopen();const api={saveStateUpdateWorkflow:vi.fn<OpcoApi["saveStateUpdateWorkflow"]>(async()=>({appView:{id:scope.appViewId,name:"Synthetic",slug:"synthetic"},results:[{result:"CONFLICT" as const,subjectRecordId:"person",existing:{recordId:"remote",updatedAt:base,stateValues:[{fieldId:"status",optionId:"training",label:"Training"}]},requested:{stateValues:[{fieldId:"status",optionId:"present",label:"Present"}]}}]}))};await syncPendingStateUpdatesOnce({api,store,ownerKey:scope.ownerKey,token:"test-only"});expect(api.saveStateUpdateWorkflow.mock.calls[0][3].overwrite).toBeUndefined();expect(await store.listStateUpdateConflicts(scope)).toHaveLength(1);
 });
 it("pending creation edits consolidate without granting old operations authorization",async()=>{
  const creation={...input(),subjectRecordId:"new-person",expectedUpdatedAt:undefined};const first=await store.saveStateUpdateLocally(creation);const original=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];const second=await store.saveStateUpdateLocally({...creation,stateValues:[{fieldId:"status",optionId:"training"}]});await reopen();const ops=await store.listPendingStateUpdateOperations(scope.ownerKey);expect(ops).toHaveLength(1);expect(second.localRecordId).toBe(first.localRecordId);expect(ops[0].id).toBe(original.id);expect(ops[0].clientRequestId).not.toBe(original.clientRequestId);expect((ops[0].payload as Record<string, unknown>).overwrite).toBeUndefined();expect(ops[0].serverRecordId).toBeNull();
 });
 it("another person/date/AppView intention is unchanged by the confirmed replacement",async()=>{
  for(const other of [{subjectRecordId:"other-person"},{date:"2026-10-10"},{appViewId:"other-view"}])await store.saveStateUpdateLocally({...input(),...other});const prior=await store.listPendingStateUpdateOperations(scope.ownerKey);await store.saveStateUpdateLocally(input(true));await reopen();const all=await store.listPendingStateUpdateOperations(scope.ownerKey);expect(all).toHaveLength(4);for(const old of prior)expect(all.find(op=>op.id===old.id)).toEqual(old);
 });
 it("outbox failure rolls back authorization and local row together",async()=>{
  const before=await harness.db.getAllAsync("SELECT * FROM entity_records");const run=harness.db.runAsync.getMockImplementation()!;harness.db.runAsync.mockImplementation((sql,...args)=>{if(sql.includes("INSERT INTO pending_operations"))throw Error("outbox failure");return run(sql,...args)});await expect(store.saveStateUpdateLocally(input(true))).rejects.toThrow("outbox failure");await reopen();expect(await harness.db.getAllAsync("SELECT * FROM entity_records")).toEqual(before);expect(await harness.db.getAllAsync("SELECT * FROM pending_operations")).toEqual([]);
 });
});