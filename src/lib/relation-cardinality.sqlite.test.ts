// @ts-expect-error Node types absent from Expo config.
import {spawn} from "node:child_process";
// @ts-expect-error Node types absent from Expo config.
import {mkdtempSync,rmSync} from "node:fs";
import {it,expect,vi,beforeEach,afterEach} from "vitest";
import {getLocalDatabase,__resetLocalDatabaseForTests} from "./local-db";
import {OpcoApiError,type EntityField,type EntityRecordValue} from "./opco-api";
import {syncPendingRecordsOnce} from "../sync/records-sync";
import {isRelationFieldMultiple,buildInitialFormValues,validateFormFields} from "./record-form";
const sqlite=vi.hoisted(()=>({openDatabaseAsync:vi.fn()}));vi.mock("expo-sqlite",()=>sqlite);
function sqliteFile(path: string) {
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
    queue.push({ resolve, reject });
    worker.stdin.write(JSON.stringify({ kind, sql, args }) + "\n");
  });
  let closing = false;
  return {
    withTransactionAsync: async (task:()=>Promise<void>) => { await query("exec","BEGIN");try{await task();await query("exec","COMMIT");}catch(error){await query("exec","ROLLBACK");throw error;} },
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


const scope={ownerKey:"synthetic-owner",contractId:"synthetic-contract",entityTypeId:"synthetic-source"};
const relation=(kind:"ONE"|"MANY",multiple:boolean):EntityField=>({id:"related",key:"related",name:"Synthetic relation",type:"RELATION",required:false,multiple,config:{relation:{relationKind:kind,targetEntityTypeId:"synthetic-catalog"}}});
const definition=(field:EntityField)=>({id:scope.entityTypeId,name:"Synthetic source",slug:"synthetic-source",active:true,icon:null,fields:[field]});
let directory:string,db:ReturnType<typeof sqliteFile>,store:ReturnType<typeof getLocalDatabase>;
async function open(){__resetLocalDatabaseForTests();db=sqliteFile(directory+"/opco-client-v10-epoch2.db");sqlite.openDatabaseAsync.mockResolvedValue(db);store=getLocalDatabase();await store.getSelectedContractId();}
async function reopen(){await db.closeAsync();await open();}
beforeEach(async()=>{directory=mkdtempSync("/tmp/opco-cardinality-sqlite-");await open();});
afterEach(async()=>{await db.closeAsync();__resetLocalDatabaseForTests();rmSync(directory,{recursive:true,force:true});});
const pending=async()=>await db.getAllAsync("SELECT * FROM pending_operations ORDER BY id") as {client_request_id:string;payload_json:string}[];
it("preserves an old scalar/array command through metadata refresh, SQLite reopen and exact transmission",async()=>{
 const field=relation("ONE",true);await store.upsertEntityDefinition(scope.contractId,scope.entityTypeId,definition(field),"2026-11-05T12:00:00Z");
 await store.createLocalRecord({...scope,fields:[field],clientRequestId:"synthetic-original-request",values:{related:["synthetic-a"]}});
 const before=await pending();expect(before).toHaveLength(1);await store.upsertEntityDefinition(scope.contractId,scope.entityTypeId,definition(relation("ONE",false)),"2026-11-05T13:00:00Z");await reopen();expect(await pending()).toEqual(before);
 const read=await store.getEntityDefinition(scope.contractId,scope.entityTypeId);expect(isRelationFieldMultiple(read!.definition.fields[0])).toBe(false);
 const send=vi.fn(async(_token:string,_contract:string,_entity:string,body:{clientRequestId:string;values:Record<string,EntityRecordValue>})=>{expect(body).toMatchObject({clientRequestId:"synthetic-original-request",values:{related:["synthetic-a"]}});return {record:{id:"synthetic-remote",displayName:"Synthetic",values:{related:{id:"synthetic-a",displayName:"Synthetic A",entityTypeId:"synthetic-catalog"}},updatedAt:"2026-11-05T14:00:00.000Z"}};});
 const result=await syncPendingRecordsOnce({api:{createEntityRecord:send,getEntityRecord:vi.fn(),updateEntityRecord:vi.fn()},ownerKey:scope.ownerKey,store,token:"synthetic"});expect(result.completed).toBe(1);expect(send).toHaveBeenCalledOnce();expect(await pending()).toHaveLength(0);await reopen();
 const cached=await store.listCachedRecords(scope);expect(cached.records).toHaveLength(1);expect(cached.records[0].serverId).toBe("synthetic-remote");expect(cached.records[0].values.related).toMatchObject({id:"synthetic-a"});expect(await db.getFirstAsync("PRAGMA integrity_check")).toEqual({integrity_check:"ok"});
});
it("retains all values and the original request when an incompatible old command is rejected",async()=>{
 const field=relation("ONE",true);const values={related:["synthetic-a","synthetic-b"]};await store.createLocalRecord({...scope,fields:[field],clientRequestId:"synthetic-incompatible-request",values});const before=await store.listPendingOperations(scope.ownerKey);
 await store.upsertEntityDefinition(scope.contractId,scope.entityTypeId,definition(relation("ONE",false)),"2026-11-05T13:00:00Z");await reopen();expect(await store.listPendingOperations(scope.ownerKey)).toEqual(before);
 const form=buildInitialFormValues(definition(field),values);expect(form.related).toEqual(values.related);expect(validateFormFields([field],form).related).toBeTruthy();
 const api={createEntityRecord:vi.fn(async()=>{throw new OpcoApiError("Synthetic cardinality rejection","VALIDATION_ERROR",400)}),getEntityRecord:vi.fn(),updateEntityRecord:vi.fn()};await syncPendingRecordsOnce({api,ownerKey:scope.ownerKey,store,token:"synthetic"});await reopen();const after=await pending();
 expect(after).toHaveLength(1);expect(after[0].client_request_id).toBe(before[0].clientRequestId);const payload=JSON.parse(String(after[0].payload_json));expect(payload.lastErrorHttpStatus).toBe(400);delete payload.lastErrorHttpStatus;delete payload.lastErrorDetails;expect(payload).toEqual(before[0].payload);expect(await db.getFirstAsync("PRAGMA integrity_check")).toEqual({integrity_check:"ok"});
});
it("prepares MANY with a stale false mirror, keeps its IDs after reopen, and leaves SELECT metadata alone",async()=>{
 const field=relation("MANY",false);expect(isRelationFieldMultiple(field)).toBe(true);await store.upsertEntityDefinition(scope.contractId,scope.entityTypeId,definition(field),"2026-11-05T12:00:00Z");await store.createLocalRecord({...scope,fields:[field],clientRequestId:"synthetic-many-request",values:{related:["synthetic-a","synthetic-b"]}});const before=await pending();await reopen();expect(await pending()).toEqual(before);expect((await store.getEntityDefinition(scope.contractId,scope.entityTypeId))?.definition.fields[0].multiple).toBe(false);
});
