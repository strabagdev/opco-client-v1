// @ts-expect-error Node types absent from Expo config.
import {spawn} from "node:child_process";
// @ts-expect-error Node types absent from Expo config.
import {mkdtempSync,rmSync} from "node:fs";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {getLocalDatabase,__resetLocalDatabaseForTests} from "./local-db";
import {createOpcoApi, type StateUpdateBatchResult} from "./opco-api";
import {captureWorkflowWriteCommand, type WorkflowWriteCommand} from "./workflow-write-contract";
import {stateUpdateIntentsEqual,type OfflineStateUpdatePayload} from "./state-update-offline";
import {syncPendingStateUpdatesOnce} from "../sync/state-update-sync";
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

const scope={ownerKey:"synthetic-owner",contractId:"synthetic-contract",appViewId:"synthetic-view",targetEntityTypeId:"synthetic-target",date:"2026-11-04"};
const command:WorkflowWriteCommand={version:1,configurationFingerprint:"a".repeat(64),capabilities:["relation-context-v1"]};
const contract={version:1 as const,configurationFingerprint:command.configurationFingerprint,requiredCapabilities:["relation-context-v1"] as ["relation-context-v1"],authorized:true,acceptNewCommands:true};
const input=()=>({...scope,writeCommand:command,subjectRecordId:"synthetic-person",subjectDisplayName:"Synthetic subject",stateFields:[{fieldId:"state",label:"State",options:[{optionId:"a",label:"A"}],required:true}],stateValues:[{fieldId:"state",optionId:"a"}],extraValues:{relation:"synthetic-lot"},historyMode:"update-current" as const,uniqueness:"subject-date" as const,expectedUpdatedAt:"2026-11-04T10:00:00.000Z",overwrite:true});
let directory:string,db:ReturnType<typeof sqliteFile>,store:ReturnType<typeof getLocalDatabase>;
async function open(){__resetLocalDatabaseForTests();db=sqliteFile(directory+"/opco-client-v10-epoch2.db");sqlite.openDatabaseAsync.mockResolvedValue(db);store=getLocalDatabase();await store.getSelectedContractId();}
async function reopen(){await db.closeAsync();await open();}
beforeEach(async()=>{directory=mkdtempSync("/tmp/opco-write-command-");await open();});
afterEach(async()=>{await db.closeAsync();__resetLocalDatabaseForTests();rmSync(directory,{recursive:true,force:true});});
const operations=()=>store.listPendingStateUpdateOperations(scope.ownerKey);
const pending=()=>db.getAllAsync("SELECT * FROM pending_operations ORDER BY id");
const ack=(writeCommand:WorkflowWriteCommand|null=command):Extract<StateUpdateBatchResult,{result:"CREATED"|"UNCHANGED"|"UPDATED"}>=>({result:"CREATED",recordId:"synthetic-remote",subjectRecordId:input().subjectRecordId,updatedAt:"2026-11-04T11:00:00.000Z",...(writeCommand?{writeCommand}:{})});
it("captures capability, persists the same command and idempotent identity across real SQLite reopen",async()=>{
 expect(captureWorkflowWriteCommand(contract)).toEqual({writeCommand:command});const saved=await store.saveStateUpdateLocally(input());const first=(await operations())[0];
 expect(first.payload).toMatchObject({writeCommand:command,overwrite:true,expectedUpdatedAt:input().expectedUpdatedAt,extraValues:input().extraValues});
 await store.saveStateUpdateLocally(input());expect((await operations())[0].clientRequestId).toBe(first.clientRequestId);
 const before=await pending();await reopen();expect(await pending()).toEqual(before);expect((await operations())[0].localRecordId).toBe(saved.localRecordId);expect(await db.getFirstAsync("PRAGMA integrity_check")).toEqual({integrity_check:"ok"});
});
it("does not add a capability to an older pending command or change its authorization/base/request key",async()=>{
 const legacy={...input()};delete (legacy as {writeCommand?:WorkflowWriteCommand}).writeCommand;await store.saveStateUpdateLocally(legacy);const before=await pending();
 await expect(store.saveStateUpdateLocally(input())).rejects.toThrow("revisión explícita");expect(await pending()).toEqual(before);await reopen();expect(await pending()).toEqual(before);
});
it("rejects silent policy or base replacement and distinguishes semantic capability changes",async()=>{
 await store.saveStateUpdateLocally(input());const before=await pending(),first=(await operations())[0].payload as OfflineStateUpdatePayload;
 const next={...first,writeCommand:{...command,configurationFingerprint:"b".repeat(64)}};expect(stateUpdateIntentsEqual(first,next)).toBe(false);
 await expect(store.saveStateUpdateLocally({...input(),writeCommand:next.writeCommand})).rejects.toThrow("revisión explícita");
 await expect(store.saveStateUpdateLocally({...input(),expectedUpdatedAt:"2026-11-04T12:00:00.000Z"})).rejects.toThrow("versión base");expect(await pending()).toEqual(before);
});
it("transmits the pinned command and accepts one matching receipt, without losing its durable trace",async()=>{
 await store.saveStateUpdateLocally(input());const operation=(await operations())[0];let wire:Record<string,unknown>|null=null;
 const api=createOpcoApi({apiUrl:"https://synthetic.invalid",fetcher:async(_url,init)=>{wire=JSON.parse(String(init?.body));return new Response(JSON.stringify({ok:true,data:{appView:{id:scope.appViewId,name:"Synthetic",slug:"synthetic"},result:ack()}}),{status:200});}});
 const result=await syncPendingStateUpdatesOnce({api,token:"synthetic",ownerKey:scope.ownerKey,store});expect(result.completed).toBe(1);expect(wire).toMatchObject({writeCommand:command,clientRequestId:operation.clientRequestId,expectedUpdatedAt:input().expectedUpdatedAt,overwrite:true,extraValues:input().extraValues});
 expect(await operations()).toHaveLength(0);await reopen();const row=await db.getFirstAsync("SELECT values_json,sync_status FROM entity_records WHERE local_id=?",operation.localRecordId);expect(row.sync_status).toBe("synced");expect(JSON.parse(String(row.values_json)).writeCommand).toEqual(command);expect(JSON.parse(String(row.values_json)).clientRequestId).toBe(operation.clientRequestId);
});
it("keeps a failed old-runtime intention explicit without a read-reconcile fallback or repeated automatic sends",async()=>{
 const legacy={...input()};delete (legacy as {writeCommand?:WorkflowWriteCommand}).writeCommand;await store.saveStateUpdateLocally(legacy);const operation=(await operations())[0],original=JSON.stringify(operation.payload);
 const save=vi.fn(async()=>({appView:{id:scope.appViewId,name:"Synthetic",slug:"synthetic"},results:[{result:"ERROR" as const,subjectRecordId:input().subjectRecordId,code:"WORKFLOW_COMMAND_INCOMPATIBLE",message:"Synthetic incompatible command"}]}));
 const get=vi.fn();const api={saveStateUpdateWorkflow:save,getStateUpdateWorkflow:get};const result=await syncPendingStateUpdatesOnce({api,token:"synthetic",ownerKey:scope.ownerKey,store});expect(result.failed).toBe(1);expect(get).not.toHaveBeenCalled();
 const row=await db.getFirstAsync("SELECT payload_json,client_request_id FROM pending_operations WHERE id=?",operation.id);expect(row.client_request_id).toBe(operation.clientRequestId);const preserved=JSON.parse(String(row.payload_json));delete preserved.lastErrorDetails;delete preserved.lastErrorHttpStatus;expect(JSON.stringify(preserved)).toBe(original);
 await syncPendingStateUpdatesOnce({api,token:"synthetic",ownerKey:scope.ownerKey,store});expect(save).toHaveBeenCalledTimes(1);await reopen();expect((await db.getFirstAsync("SELECT client_request_id FROM pending_operations WHERE id=?",operation.id)).client_request_id).toBe(operation.clientRequestId);
});
it("does not consume an intention on an old Core receipt or a late ACK after a newer edit",async()=>{
 await store.saveStateUpdateLocally(input());const original=(await operations())[0],before=await pending();
 await expect(store.completeStateUpdateOperation(original,ack(null))).rejects.toMatchObject({code:"WORKFLOW_COMMAND_RECEIPT_INCOMPATIBLE"});expect(await pending()).toEqual(before);
 await store.saveStateUpdateLocally({...input(),extraValues:{relation:"another-synthetic-lot"}});const newer=(await operations())[0];expect(newer.clientRequestId).not.toBe(original.clientRequestId);await store.completeStateUpdateOperation(original,ack());expect((await operations())[0].clientRequestId).toBe(newer.clientRequestId);
});
it("preserves legacy payloads and field comparison when no policy is configured",async()=>{
 expect(captureWorkflowWriteCommand(null)).toEqual({});expect(captureWorkflowWriteCommand(undefined)).toEqual({});expect(()=>captureWorkflowWriteCommand(undefined,true)).toThrow("revisión explícita");
 const legacy={...input()};delete (legacy as {writeCommand?:WorkflowWriteCommand}).writeCommand;await store.saveStateUpdateLocally(legacy);expect((await operations())[0].payload).not.toHaveProperty("writeCommand");
});

it("keeps capability through conflict, explicit resolution and a late response after reopen",async()=>{
 const saved=await store.saveStateUpdateLocally(input()),original=(await operations())[0];
 await store.markStateUpdateOperationConflict(original,{result:"CONFLICT",subjectRecordId:input().subjectRecordId,existing:{recordId:"synthetic-remote",updatedAt:"2026-11-04T12:00:00.000Z",stateValues:[{fieldId:"state",optionId:"remote",label:"Remote"}],extraValues:{relation:"remote-synthetic-lot"}},requested:{stateValues:[{fieldId:"state",optionId:"a",label:"A"}]}});
 await reopen();const conflict=(await store.listStateUpdateConflicts(scope))[0];expect(conflict.writeCommand).toEqual(command);expect(conflict.extraValues).toEqual(input().extraValues);
 await store.resolveStateUpdateConflictWithLocal({...input(),localRecordId:saved.localRecordId,conflictIdentity:conflict.conflictIdentity!,expectedUpdatedAt:conflict.conflictRemoteUpdatedAt,overwrite:true});
 const resolved=(await operations())[0];expect(resolved.clientRequestId).not.toBe(original.clientRequestId);expect(resolved.payload).toMatchObject({writeCommand:command,expectedUpdatedAt:"2026-11-04T12:00:00.000Z",overwrite:true,extraValues:input().extraValues});
 await store.completeStateUpdateOperation(original,ack());expect((await operations())[0].clientRequestId).toBe(resolved.clientRequestId);expect(await store.listStateUpdateConflicts({...scope,ownerKey:"another-owner"})).toEqual([]);await reopen();expect((await operations())[0]).toEqual(resolved);
});
it("prepares the effective capability in the scoped definition and restores it offline without another scope",async()=>{
 const view={id:scope.appViewId,name:"Synthetic",slug:"synthetic",icon:null,sortOrder:0,type:"WORKFLOW" as const,config:{workflowKey:"attendance" as const,sourceEntityTypeId:"synthetic-source",targetEntityTypeId:scope.targetEntityTypeId,personFieldId:"subject",dateFieldId:"date",statusFieldId:"state",defaultCheckInOptionId:"a",contextFieldIds:["relation"]}};
 await store.upsertAppViewDefinition({ownerKey:scope.ownerKey,contractId:scope.contractId,appViewId:scope.appViewId,appViewType:"WORKFLOW",workflowKey:"attendance",status:"ready",lastPreparedAt:"2026-11-04T10:00:00.000Z",definition:{kind:"attendance",appView:view,workflowWriteContract:contract,statuses:[{isDefaultCheckIn:true,label:"A",optionId:"a"}]}});
 await reopen();const definition=await store.getAppViewDefinition(scope.ownerKey,scope.contractId,scope.appViewId);expect(definition?.definition.kind).toBe("attendance");if(definition?.definition.kind!=="attendance")throw Error("No prepared definition");expect(captureWorkflowWriteCommand(definition.definition.workflowWriteContract)).toEqual({writeCommand:command});
 expect(await store.getAppViewDefinition("other-owner",scope.contractId,scope.appViewId)).toBeNull();expect(await store.getAppViewDefinition(scope.ownerKey,"other-contract",scope.appViewId)).toBeNull();expect(await store.getAppViewDefinition(scope.ownerKey,scope.contractId,"other-view")).toBeNull();expect(await db.getFirstAsync("SELECT value FROM app_metadata WHERE key=?","schema_version")).toEqual({value:"10"});expect(sqlite.openDatabaseAsync.mock.calls.at(-1)?.[0]).toBe("opco-client-v10-epoch2.db");
});
