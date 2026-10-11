// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";
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
describe("sync attention local read model",()=>{
 async function conflict(subjectRecordId="person",extra={}){
  await store.saveStateUpdateLocally({...input(),subjectRecordId,...extra});const operation=(await store.listPendingStateUpdateOperations(scope.ownerKey)).find(o=>(o.payload as Record<string,unknown>).subjectRecordId===subjectRecordId)!;
  await store.markStateUpdateOperationConflict(operation,{result:"CONFLICT",subjectRecordId,existing:{recordId:"remote",updatedAt:base,stateValues:[{fieldId:"status",optionId:"training",label:"Training"}]},requested:{stateValues:[{fieldId:"status",optionId:"present",label:"Present"}]}});return operation;
 }
 it("reproduces old double count but presents linked row/outbox as one problem without writing",async()=>{
  await conflict();await reopen();const records=await store.getRecordsSyncSummary(scope);const diagnosis=await store.getStateUpdateOutboxDiagnostics(scope.ownerKey);expect(records.conflictCount+Math.max(diagnosis.summary.conflict,diagnosis.summary.localConflict)).toBe(2);const before=await harness.db.getAllAsync("SELECT * FROM pending_operations");const rows=await harness.db.getAllAsync("SELECT * FROM entity_records");const problems=await store.getSyncAttentionProblems(scope);expect(problems).toHaveLength(1);expect(problems[0]).toMatchObject({state:"conflict",recordName:"Synthetic",date:scope.date});expect(await harness.db.getAllAsync("SELECT * FROM pending_operations")).toEqual(before);expect(await harness.db.getAllAsync("SELECT * FROM entity_records")).toEqual(rows);
 });
 it("two distinct changes remain two and other owner/contract are isolated",async()=>{
  await conflict();await conflict("second");expect(await store.getSyncAttentionProblems(scope)).toHaveLength(2);expect(await store.getSyncAttentionProblems({...scope,ownerKey:"other"})).toEqual([]);expect(await store.getSyncAttentionProblems({...scope,contractId:"other"})).toEqual([]);
 });
 it("uses cached definition for exact navigation date/row and drops the notice when resolved",async()=>{
  const op=await conflict();await store.upsertAppViewDefinition({...scope,appViewType:"WORKFLOW",workflowKey:"attendance",status:"ready",lastPreparedAt:base,definition:{kind:"attendance",appView:{id:scope.appViewId,name:"Attendance synthetic",slug:"synthetic",type:"WORKFLOW",config:{workflowKey:"attendance",sourceEntityTypeId:"people",targetEntityTypeId:scope.targetEntityTypeId,personFieldId:"person",statusFieldId:"status",dateFieldId:"date"}} as any,statuses:[]}});
  const problems=await store.getSyncAttentionProblems(scope);expect(problems[0].href).toEqual({pathname:"/view/[appViewId]",params:{appViewId:scope.appViewId,attentionDate:scope.date,attentionRecordId:op.localRecordId}});
  await harness.db.runAsync("UPDATE entity_records SET sync_status='synced' WHERE local_id=?",op.localRecordId);await harness.db.runAsync("DELETE FROM pending_operations WHERE id=?",op.id);expect(await store.getSyncAttentionProblems(scope)).toEqual([]);
 });
});