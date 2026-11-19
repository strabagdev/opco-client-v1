import { loadAttendanceRecordPresentation } from "../renderers/workflows/attendance/attendance-record-presentation";
import { OpcoNetworkError } from "./opco-api";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";
import { type OpcoApi } from "./opco-api";
import { type OfflineStateUpdatePayload } from "./state-update-offline";
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
            if (reply.error)
                task.reject(Object.assign(new Error(reply.error), {
                    sqliteCode: reply.sqliteCode,
                    sqliteName: reply.sqliteName
                }));
            else
                task.resolve(reply.result);
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
            }
            catch (error) {
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
const scope = { ownerKey: "synthetic:repeat", contractId: "repeat-contract", appViewId: "repeat-view", targetEntityTypeId: "repeat-target", date: "2026-11-16" };
const fields = [{ fieldId: "state", label: "State", required: true, options: [{ optionId: "a", label: "A" }, { optionId: "b", label: "B" }] }];
const input = () => ({ ...scope, subjectRecordId: "subject", subjectDisplayName: "Synthetic", historyMode: "append" as const, uniqueness: "subject-date" as const, repetitionPolicy: "MULTIPLE" as const, eventOccurredAt: "2026-11-16T10:00:00.000Z", stateFields: fields, stateValues: [{ fieldId: "state", optionId: "a" }], extraValues: { relation: "lot-1", choice: "one" } });
let directory: string, harness: ReturnType<typeof sqliteHarness>, store: ReturnType<typeof getLocalDatabase>;
beforeEach(async () => { __resetLocalDatabaseForTests(); directory = mkdtempSync("/tmp/opco-repeat-"); harness = sqliteHarness(directory + "/db.sqlite"); sqlite.openDatabaseAsync.mockResolvedValue(harness.db); store = getLocalDatabase(); await store.getSelectedContractId(); });
afterEach(() => { harness.stop(); __resetLocalDatabaseForTests(); rmSync(directory, { recursive: true, force: true }); });
async function reopen() { await harness.db.closeAsync(); __resetLocalDatabaseForTests(); harness = sqliteHarness(directory + "/db.sqlite"); sqlite.openDatabaseAsync.mockResolvedValue(harness.db); store = getLocalDatabase(); await store.getSelectedContractId(); }


const captureConfig={fieldId:"capture",timeZone:"America/Santiago"};
const capture={version:1 as const,...captureConfig};
const captured=()=>({...input(),captureTime:capture});
const ack=(value:string|null)=>({...capture,value,source:value?"DEVICE_CONFIRMATION" as const:null});
async function prepared(policy:"ONE_PER_DAY"|"MULTIPLE"|"MULTIPLE_WITH_WARNING"="MULTIPLE"){
 await store.upsertAppViewDefinition({ownerKey:scope.ownerKey,contractId:scope.contractId,appViewId:scope.appViewId,appViewType:"WORKFLOW",workflowKey:"attendance",status:"ready",definition:{kind:"attendance",captureTime:capture,appView:{id:scope.appViewId,type:"WORKFLOW",name:"Captura sintética",slug:"capture",icon:null,sortOrder:0,config:{workflowKey:"attendance",sourceEntityTypeId:"source",targetEntityTypeId:scope.targetEntityTypeId,personFieldId:"subject",dateFieldId:"day",statusFieldId:"state",captureTime:captureConfig,repetitionPolicy:policy}},statuses:[{optionId:"a",label:"A",isDefaultCheckIn:true}]},lastPreparedAt:"2026-11-16T10:00:00.000Z"});
}
describe("automatic capture through real SQLite, existing outbox and reopen",()=>{
 it.each(["ONE_PER_DAY","MULTIPLE_WITH_WARNING","MULTIPLE"] as const)("persists the original UTC value and capability for %s through ACK and reopen",async policy=>{
  await prepared(policy);const command={...captured(),repetitionPolicy:policy,repetitionAcknowledged:policy==="MULTIPLE_WITH_WARNING",historyMode:policy==="ONE_PER_DAY"?"update-current" as const:"append" as const};const saved=await store.saveStateUpdateLocally(command);await reopen();let ops=await store.listPendingStateUpdateOperations(scope.ownerKey);expect(ops).toHaveLength(1);expect(ops[0].payload).toMatchObject({captureTime:capture,eventOccurredAt:command.eventOccurredAt});expect((await store.getCachedRecord({ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:scope.targetEntityTypeId,recordId:saved.localRecordId}))?.values.captureTime).toEqual(ack(command.eventOccurredAt));
  await store.completeStateUpdateOperation(ops[0],{recordId:"remote",subjectRecordId:"subject",result:"CREATED",updatedAt:"2026-11-18T12:00:00.000Z",captureTime:ack(command.eventOccurredAt)});await reopen();ops=await store.listPendingStateUpdateOperations(scope.ownerKey);expect(ops).toHaveLength(0);const row=await store.getCachedRecord({ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:scope.targetEntityTypeId,recordId:saved.localRecordId});expect(row?.values.captureTime).toEqual(ack(command.eventOccurredAt));expect(row?.values.eventOccurredAt).toBe(command.eventOccurredAt);
 });
 it("preserves a pending creation's initial capture when changing its state before dispatch",async()=>{await prepared();const saved=await store.saveStateUpdateLocally(captured());await store.saveStateUpdateLocally({...captured(),targetLocalRecordId:saved.localRecordId,eventOccurredAt:"2026-11-17T23:59:00.000Z",stateValues:[{fieldId:"state",optionId:"b"}]});await reopen();const ops=await store.listPendingStateUpdateOperations(scope.ownerKey);expect(ops).toHaveLength(1);expect(ops[0].payload).toMatchObject({eventOccurredAt:input().eventOccurredAt});});
 it("keeps legacy pending payload and request key after capture is enabled, without POST or fabricated time",async()=>{const legacy=input();const saved=await store.saveStateUpdateLocally(legacy);await prepared();const before=await harness.db.getFirstAsync("SELECT payload_json,client_request_id FROM pending_operations");const api={saveStateUpdateWorkflow:vi.fn()};const r=await syncPendingStateUpdatesOnce({store,api:api as unknown as OpcoApi,ownerKey:scope.ownerKey,token:"synthetic"});expect(r.failed).toBe(1);expect(api.saveStateUpdateWorkflow).not.toHaveBeenCalled();await reopen();const after=await harness.db.getFirstAsync("SELECT payload_json,client_request_id,last_error_code FROM pending_operations");const afterPayload=JSON.parse(after.payload_json);const {lastErrorDetails,lastErrorHttpStatus,...preserved}=afterPayload;expect(preserved).toEqual(JSON.parse(before.payload_json));expect(lastErrorDetails).toBeNull();expect(lastErrorHttpStatus).toBe(409);expect(after.client_request_id).toBe(before.client_request_id);expect(after.last_error_code).toBe("CAPTURE_TIME_REVIEW_REQUIRED");expect(await store.getCachedRecord({ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:scope.targetEntityTypeId,recordId:saved.localRecordId})).not.toBeNull();});
 it("replays a lost ACK with the same request ID and original instant",async()=>{await prepared();await store.saveStateUpdateLocally(captured());const keys:string[]=[],instants:unknown[]=[],server=new Map<string,string>();let lose=true;const api={getStateUpdateWorkflow:vi.fn(async()=>({appView:{id:scope.appViewId},date:scope.date,repetitionPolicy:"MULTIPLE",historyMode:"append",uniqueness:"subject-date",captureTime:capture,items:[]})),saveStateUpdateWorkflow:vi.fn(async(_t:string,_c:string,_v:string,body:OfflineStateUpdatePayload)=>{keys.push(body.clientRequestId);instants.push(body.eventOccurredAt);if(!server.has(body.clientRequestId))server.set(body.clientRequestId,"remote");if(lose){lose=false;throw new OpcoNetworkError("Synthetic lost ACK");}return{appView:{id:scope.appViewId},results:[{recordId:server.get(body.clientRequestId),subjectRecordId:"subject",result:"CREATED",updatedAt:"2026-11-18T12:00:00.000Z",captureTime:ack(input().eventOccurredAt)}]};})};await syncPendingStateUpdatesOnce({store,api:api as unknown as OpcoApi,ownerKey:scope.ownerKey,token:"synthetic"});await reopen();await syncPendingStateUpdatesOnce({store,api:api as unknown as OpcoApi,ownerKey:scope.ownerKey,token:"synthetic"});expect(server.size).toBe(1);expect(new Set(keys).size).toBe(1);expect(instants.every(x=>x===input().eventOccurredAt)).toBe(true);expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toHaveLength(0);});
 it("uses the server original for UNCHANGED and keeps missing historical capture null",async()=>{await prepared("ONE_PER_DAY");const saved=await store.saveStateUpdateLocally({...captured(),repetitionPolicy:"ONE_PER_DAY",historyMode:"update-current"});const[operation]=await store.listPendingStateUpdateOperations(scope.ownerKey);await store.completeStateUpdateOperation(operation,{result:"UNCHANGED",recordId:"historical",subjectRecordId:"subject",updatedAt:"2026-11-15T12:00:00.000Z",captureTime:ack(null)});await reopen();const record=await store.getCachedRecord({ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:scope.targetEntityTypeId,recordId:saved.localRecordId});expect(record?.values.captureTime).toEqual(ack(null));expect(record?.values.eventOccurredAt).toBeUndefined();const shown=await loadAttendanceRecordPresentation(store,scope,{recordId:"historical",person:{id:"subject",displayName:"Synthetic"},statusLabel:"A",statusOptionId:"a",updatedAt:"2026-11-15T12:00:00.000Z",captureTime:ack(null)},[]);expect(shown.capture?.compact).toBe("Hora de captura no disponible");});
});
