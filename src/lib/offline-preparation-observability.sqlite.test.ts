import {offlinePreparationFailureRows} from "./offline-preparation-diagnostic";
import { PYTHON_SQLITE_SCRIPT_EXECUTOR } from "../test/sqlite-script";
// Runtime regressions: synthetic API streams and real sqlite3 file, including close/reopen.
// @ts-expect-error Node types intentionally absent from Expo application config.
import {spawn} from "node:child_process";
// @ts-expect-error Node types intentionally absent from Expo application config.
import {mkdtempSync,rmSync} from "node:fs";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {getLocalDatabase,__resetLocalDatabaseForTests} from "./local-db";
import {prewarmAssignedAppViews} from "./app-view-prewarm";
let store:ReturnType<typeof getLocalDatabase>;
const stats={sql:0,byKind:{} as Record<string,number>,queuePeak:0};
function sqliteFile(path: string) {
  const worker = spawn("python3", ["-u", "-c", `
import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1], isolation_level=None)
c.row_factory=sqlite3.Row
${PYTHON_SQLITE_SCRIPT_EXECUTOR}
for line in sys.stdin:
 try:
  q=json.loads(line); sql=q['sql']; args=q.get('args',[])
  if q['kind']=='exec':
   if sql.strip() in ('BEGIN','COMMIT','ROLLBACK'): c.execute(sql)
   else: exec_sqlite_script(sql)
   result=None
  else:
   cur=c.execute(sql,args)
   result=[dict(r) for r in cur.fetchall()] if q['kind']=='read' else {'changes':cur.rowcount}
  print(json.dumps({'result':result}))
 except Exception as e: print(json.dumps({'error':str(e)}))
c.close()
`, path]);
  const queue: { resolve(value: unknown): void; reject(error: Error): void }[] = [];
  let buffer = "";
  worker.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      const reply = JSON.parse(buffer.slice(0, end)) as { result: unknown; error?: string };
      buffer = buffer.slice(end + 1);
      const task = queue.shift()!;
      if (reply.error) task.reject(new Error(reply.error));
      else task.resolve(reply.result);
    }
  });
  const exit = new Promise<void>((resolve, reject) => {
    worker.on("exit", (code: number) => code === 0 ? resolve() : reject(new Error(`sqlite test worker exit ${code}`)));
    worker.on("error", reject);
  });
  const query = (kind: string, sql: string, args: unknown[] = []) => new Promise<unknown>((resolve, reject) => {
    stats.sql++; stats.byKind[kind] = (stats.byKind[kind] ?? 0) + 1;
    const diagnostics = store?.getSQLiteCoordinatorDiagnostics();
    stats.queuePeak = Math.max(stats.queuePeak, diagnostics?.waitingTotal ?? 0);
    queue.push({ resolve, reject });
    worker.stdin.write(JSON.stringify({ kind, sql, args }) + "\n");
  });
  let closing = false;
  return {
    withTransactionAsync: async (task: () => Promise<void>) => {
      await query("exec", "BEGIN");
      try { await task(); await query("exec", "COMMIT"); }
      catch (error) { await query("exec", "ROLLBACK"); throw error; }
    },
    execAsync: (sql: string) => query("exec", sql),
    getAllAsync: (sql: string, ...args: unknown[]) => query("read", sql, args),
    getFirstAsync: async (sql: string, ...args: unknown[]) => (await query("read", sql, args) as Record<string, unknown>[])[0] ?? null,
    runAsync: (sql: string, ...args: unknown[]) => query("write", sql, args),
    closeAsync: () => {
      if (!closing) { closing = true; worker.stdin.end(); }
      return exit;
    },
  };
}

let directory:string,db:ReturnType<typeof sqliteFile>;
const ownerKey="diagnostic-owner",contractId="diagnostic-contract",token="synthetic";
async function open(){__resetLocalDatabaseForTests();db=sqliteFile(directory+"/opco-client-v10-epoch2.db");sqlite.openDatabaseAsync.mockResolvedValue(db);store=getLocalDatabase();await store.getSelectedContractId();}
const sqlite=vi.hoisted(()=>({openDatabaseAsync:vi.fn()}));vi.mock("expo-sqlite",()=>sqlite);
beforeEach(async()=>{directory=mkdtempSync("/tmp/opco-preparation-interruption-");await open();});
afterEach(async()=>{vi.useRealTimers();await db.closeAsync();__resetLocalDatabaseForTests();rmSync(directory,{recursive:true,force:true});});



async function prepareEmpty(owner=ownerKey,contract=contractId){await prewarmAssignedAppViews({api:{}as never,store,ownerKey:owner,contractId:contract,token,appViews:[],homeListWrite:Promise.resolve({status:"persisted",count:0,syncedAt:"2026-11-27T02:00:00.000Z",requestId:"home-views-1-1",scope:{ownerKey:owner,contractId:contract,appViewIds:[]},errorCode:null})as never});}
it("preserves a safe global cause and the last failure across a later run and SQLite reopen",async()=>{
 vi.spyOn(store,"reconcileAppViewDefinitions").mockRejectedValueOnce(Error("SQL contains sensitive-value and secret-token"));await prepareEmpty();const failed=(await store.getOfflinePreparationDiagnostics(ownerKey))!;
 expect(failed).toMatchObject({status:"failed",failedAppViews:[],globalFailure:{stage:"definition_reconciliation",code:"Error",httpStatus:null}});expect(JSON.stringify(failed)).not.toMatch(/secret-token|sensitive-value|SQL contains/);
 await db.closeAsync();await open();await prepareEmpty();const next=(await store.getOfflinePreparationDiagnostics(ownerKey))!;expect(next.status).toBe("completed");expect(next.runId).not.toBe(failed.runId);expect(next.requestContext?.previous).toMatchObject({runId:failed.runId,status:"failed"});expect(next.lastFailure).toMatchObject({runId:failed.runId,scopeKey:failed.scopeKey,globalFailure:failed.globalFailure});
 await db.closeAsync();await open();const reopened=(await store.getOfflinePreparationRunReceipt(ownerKey,contractId))!.diagnostics;expect(reopened.lastFailure).toEqual(next.lastFailure);const text=offlinePreparationFailureRows(reopened).flat().join(" ");expect(text).toContain("Último fallo conservado");expect(text).toContain(failed.runId!);expect(text).toContain("definition_reconciliation");expect(await store.listPendingStateUpdateOperations(ownerKey)).toEqual([]);
});
it("never imports failure details from a different owner or contract",async()=>{
 vi.spyOn(store,"reconcileAppViewDefinitions").mockRejectedValueOnce(Error("controlled"));await prepareEmpty();await prepareEmpty("another-owner",contractId);expect((await store.getOfflinePreparationDiagnostics("another-owner"))?.lastFailure).toBeUndefined();await prepareEmpty(ownerKey,"another-contract");expect((await store.getOfflinePreparationDiagnostics(ownerKey))?.lastFailure).toBeUndefined();expect((await store.getOfflinePreparationRunReceipt(ownerKey,contractId))?.diagnostics.status).toBe("failed");expect(await store.listPendingStateUpdateOperations(ownerKey)).toEqual([]);
});
