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
const list = () => store.getAttendanceDailyRecords({ ...scope, subjectRecordId: "subject" });
describe("Attendance independent events in real SQLite", () => {
    it("persists two intentional events and contexts across offline reopening", async () => {
        const a = await store.saveStateUpdateLocally(input()), b = await store.saveStateUpdateLocally({ ...input(), extraValues: { relation: "lot-2", choice: "two" } });
        expect(a.localRecordId).not.toBe(b.localRecordId);
        expect(a.clientRequestId).not.toBe(b.clientRequestId);
        await reopen();
        expect(await list()).toHaveLength(2);
        expect((await list())[0].eventOccurredAt).toBe("2026-11-16T10:00:00.000Z");
        const pending = await store.listPendingStateUpdateOperations(scope.ownerKey);
        expect(pending).toHaveLength(2);
        expect(pending.map(p => (p.payload as OfflineStateUpdatePayload).extraValues?.relation).sort()).toEqual(["lot-1", "lot-2"]);
    });
    it("retries delivery with the same key after an unknown transport outcome and ACKs without duplicate events", async () => {
        await store.saveStateUpdateLocally(input());
        await store.saveStateUpdateLocally(input());
        await reopen();
        const server = new Map<string, {
            recordId: string;
        }>(), keys: string[] = [];
        let loseResponse = true;
        const api = { getStateUpdateWorkflow: vi.fn(async () => ({ appView: { id: scope.appViewId }, date: scope.date, repetitionPolicy: "MULTIPLE", historyMode: "append", uniqueness: "subject-date" })), saveStateUpdateWorkflow: vi.fn(async (_token: string, _contract: string, _view: string, body: {
                clientRequestId?: string;
                repetitionPolicy?: string;
            }) => {
                expect(body.repetitionPolicy).toBe("MULTIPLE");
                const key = body.clientRequestId!;
                keys.push(key);
                if (!server.has(key))
                    server.set(key, { recordId: "remote-" + server.size });
                if (loseResponse) {
                    loseResponse = false;
                    throw new OpcoNetworkError("Simulated response lost after server commit");
                }
                return { appView: { id: scope.appViewId }, results: [{ ...server.get(key)!, result: "CREATED" as const, subjectRecordId: "subject", updatedAt: "2026-11-16T10:00:00.000Z" }] };
            }) };
        await syncPendingStateUpdatesOnce({ api: api as unknown as OpcoApi, store, ownerKey: scope.ownerKey, token: "synthetic" });
        await reopen();
        await syncPendingStateUpdatesOnce({ api: api as unknown as OpcoApi, store, ownerKey: scope.ownerKey, token: "synthetic" });
        expect(server.size).toBe(2);
        expect(new Set(keys).size).toBe(2);
        expect(keys.length).toBeGreaterThan(2);
        expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toHaveLength(0);
        await reopen();
        expect(await list()).toHaveLength(2);
        expect((await list()).every(record => record.eventOccurredAt === "2026-11-16T10:00:00.000Z")).toBe(true);
    });
    it("does not POST an offline event to an older or incompatible Core", async () => {
        await store.saveStateUpdateLocally(input());
        const api = { getStateUpdateWorkflow: vi.fn(async () => ({ appView: { id: scope.appViewId }, date: scope.date, historyMode: "update-current", uniqueness: "subject-date" })), saveStateUpdateWorkflow: vi.fn() };
        const result = await syncPendingStateUpdatesOnce({ api: api as unknown as OpcoApi, store, ownerKey: scope.ownerKey, token: "synthetic" });
        expect(result.failed).toBe(1);
        expect(api.saveStateUpdateWorkflow).not.toHaveBeenCalled();
        expect(await list()).toHaveLength(1);
        const rows = await harness.db.getAllAsync("SELECT payload_json,last_error_code FROM pending_operations");
        expect(rows).toHaveLength(1);
        expect(rows[0].last_error_code).toBe("ATTENDANCE_POLICY_UNVERIFIED");
        await reopen();
        expect(await list()).toHaveLength(1);
    });
    it("edits exactly one synced record rather than the newest matching person/day", async () => {
        await store.upsertStateUpdateSnapshot({ ...scope, historyMode: "append", uniqueness: "subject-date", complete: false, items: [], latest: ["old", "new"].map(recordId => ({ recordId, eventOccurredAt: recordId === "old" ? "2026-11-16T10:00:00.000Z" : "2026-11-16T11:00:00.000Z", date: scope.date, subject: { id: "subject", displayName: "Synthetic" }, updatedAt: "2026-11-16T10:00:00.000Z", stateValues: [{ fieldId: "state", optionId: "a", label: "A" }], extraValues: { relation: "lot-1" } })) });
        const before = await list();
        expect(before).toHaveLength(2);
        const old = before.find(r => r.serverRecordId === "old")!;
        await store.saveStateUpdateLocally({ ...input(), targetLocalRecordId: old.localRecordId, targetRecordId: "old", overwrite: true, expectedUpdatedAt: old.updatedAt, stateValues: [{ fieldId: "state", optionId: "b" }], extraValues: { relation: "lot-2" } });
        await reopen();
        const after = await list();
        expect(after).toHaveLength(2);
        expect(after.find(r => r.serverRecordId === "new")).toMatchObject({ stateValues: [{ fieldId: "state", optionId: "a" }], extraValues: { relation: "lot-1" } });
        const pending = await store.listPendingStateUpdateOperations(scope.ownerKey);
        expect(pending).toHaveLength(1);
        expect(pending[0].payload).toMatchObject({ targetRecordId: "old", expectedRecordId: "old", repetitionPolicy: "MULTIPLE", overwrite: true });
        await store.completeStateUpdateOperation(pending[0], { result: "UPDATED", recordId: "old", subjectRecordId: "subject", updatedAt: "2026-11-16T12:00:00.000Z" });
        await reopen();
        expect((await list()).find(r => r.serverRecordId === "old")?.eventOccurredAt).toBe("2026-11-16T10:00:00.000Z");
        expect((await list()).find(r => r.serverRecordId === "new")?.eventOccurredAt).toBe("2026-11-16T11:00:00.000Z");
    });
    it("edits an ACKed local intent through its scoped projection after reopening", async () => {
        await store.upsertAppViewDefinition({ ...scope, appViewType:"WORKFLOW",workflowKey:"attendance",status:"ready",lastPreparedAt:"2026-11-16T10:00:00.000Z",definition:{kind:"state-update",appView:{id:scope.appViewId,type:"WORKFLOW",config:{workflowKey:"attendance",repetitionPolicy:"MULTIPLE"}},sourceEntityTypeId:"source",targetEntityTypeId:scope.targetEntityTypeId,subjectFieldId:"subject",dateFieldId:"date",historyMode:"append",uniqueness:"subject-date",stateFields:fields,extraFields:[]} } as never);
        const original = await store.saveStateUpdateLocally(input());
        const op = (await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
        await store.completeStateUpdateOperation(op, { result: "CREATED", recordId: "acked-event", subjectRecordId: "subject", updatedAt: "2026-11-16T10:00:00.000Z" });
        await reopen();
        const selected = await store.getCachedRecord({ ...scope, entityTypeId: scope.targetEntityTypeId, recordId: "acked-event" });
        expect(selected?.localId).toBe(original.localRecordId);
        expect(selected?.serverId).toBe("acked-event");
        await store.saveStateUpdateLocally({ ...input(), targetLocalRecordId: selected!.localId, targetRecordId: selected!.serverId!, overwrite: true, expectedUpdatedAt: selected!.remoteUpdatedAt, stateValues: [{ fieldId: "state", optionId: "b" }] });
        const pending = await store.listPendingStateUpdateOperations(scope.ownerKey);
        expect(pending).toHaveLength(1);
        expect(pending[0].payload).toMatchObject({ targetRecordId: "acked-event", expectedRecordId: "acked-event" });
        expect(await list()).toHaveLength(1);
    });
    it("consolidates an explicitly selected never-dispatched local edit and refuses an uncertain create edit", async () => {
        const original = await store.saveStateUpdateLocally(input());
        await store.saveStateUpdateLocally({ ...input(), targetLocalRecordId: original.localRecordId, extraValues: { relation: "lot-2" } });
        expect(await list()).toHaveLength(1);
        const ops = await store.listPendingStateUpdateOperations(scope.ownerKey);
        expect(ops).toHaveLength(1);
        await store.markStateUpdateOperationSyncing(ops[0].id, ops[0].clientRequestId);
        await expect(store.saveStateUpdateLocally({ ...input(), targetLocalRecordId: original.localRecordId, extraValues: { relation: "lot-1" } })).rejects.toThrow("debe resolverse");
        expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toHaveLength(1);
    });
    it("requires explicit acknowledgment to revise a proven rejected warning intent and retains its local identity", async () => {
        const request = { ...input(), repetitionPolicy: "MULTIPLE_WITH_WARNING" as const };
        const first = await store.saveStateUpdateLocally(request);
        const op = (await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
        await store.markStateUpdateOperationSyncing(op.id, op.clientRequestId);
        await store.failStateUpdateOperation(op, "ATTENDANCE_REPEAT_CONFIRMATION_REQUIRED", "Explicit repeat confirmation required");
        await expect(store.saveStateUpdateLocally({ ...request, targetLocalRecordId: first.localRecordId })).rejects.toThrow();
        const revised = await store.saveStateUpdateLocally({ ...request, targetLocalRecordId: first.localRecordId, repetitionAcknowledged: true });
        expect(revised.localRecordId).toBe(first.localRecordId);
        expect(revised.clientRequestId).not.toBe(first.clientRequestId);
        await reopen();
        expect(await list()).toHaveLength(1);
        expect((await store.listPendingStateUpdateOperations(scope.ownerKey))[0].payload).toMatchObject({ repetitionAcknowledged: true });
    });
    it.each(["workflowKey","workflow"])("preserves a legacy pending command and its key when an offline definition upgrades to multiple (%s)", async selector => {
        const {repetitionPolicy:_,eventOccurredAt:__,...legacy}=input();void _;void __;
        await store.saveStateUpdateLocally({...legacy,historyMode:"update-current"});
        const original=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
        await store.upsertAppViewDefinition({...scope,appViewType:"WORKFLOW",workflowKey:"attendance",status:"ready",lastPreparedAt:"2026-11-17T10:00:00.000Z",definition:{kind:"state-update",appView:{id:scope.appViewId,type:"WORKFLOW",config:{[selector]:"attendance",repetitionPolicy:"MULTIPLE"}},targetEntityTypeId:scope.targetEntityTypeId,historyMode:"append",uniqueness:"subject-date",stateFields:fields,extraFields:[]}} as never);
        await reopen();
        const api={saveStateUpdateWorkflow:vi.fn(async()=>({appView:{id:scope.appViewId},results:[{result:"UNCHANGED",recordId:"unrelated-current",subjectRecordId:"subject",updatedAt:"2026-11-17T10:00:00.000Z"}]}))};
        const result=await syncPendingStateUpdatesOnce({api:api as unknown as OpcoApi,store,ownerKey:scope.ownerKey,token:"synthetic"});
        expect(api.saveStateUpdateWorkflow).not.toHaveBeenCalled();expect(result.failed).toBe(1);
        const rows=await harness.db.getAllAsync("SELECT client_request_id,payload_json,last_error_code FROM pending_operations");
        expect(rows).toHaveLength(1);expect(rows[0].client_request_id).toBe(original.clientRequestId);const {lastErrorDetails,lastErrorHttpStatus,...retained}=JSON.parse(rows[0].payload_json);expect(retained).toEqual(original.payload);expect(lastErrorHttpStatus).toBe(409);expect(lastErrorDetails).toBeNull();
        expect(rows[0].last_error_code).toBe("ATTENDANCE_POLICY_CHANGED");
    });
    it("does not reinterpret a multiple pending command after the cached policy returns to ONE", async () => {
        await store.saveStateUpdateLocally(input());
        const original=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
        await store.upsertAppViewDefinition({...scope,appViewType:"WORKFLOW",workflowKey:"attendance",status:"ready",lastPreparedAt:"2026-11-17T10:00:00.000Z",definition:{kind:"attendance",appView:{id:scope.appViewId,type:"WORKFLOW",config:{workflowKey:"attendance"}},statuses:[]}} as never);
        await reopen();const api={getStateUpdateWorkflow:vi.fn(),saveStateUpdateWorkflow:vi.fn()};
        const result=await syncPendingStateUpdatesOnce({api:api as unknown as OpcoApi,store,ownerKey:scope.ownerKey,token:"synthetic"});
        expect(result.failed).toBe(1);expect(api.getStateUpdateWorkflow).not.toHaveBeenCalled();expect(api.saveStateUpdateWorkflow).not.toHaveBeenCalled();
        const rows=await harness.db.getAllAsync("SELECT client_request_id,payload_json,last_error_code FROM pending_operations");expect(rows).toHaveLength(1);expect(rows[0].client_request_id).toBe(original.clientRequestId);
        const {lastErrorDetails,lastErrorHttpStatus,...retained}=JSON.parse(rows[0].payload_json);expect(retained).toEqual(original.payload);expect(lastErrorDetails).toBeNull();expect(lastErrorHttpStatus).toBe(409);
    });
    it("never overwrites an earlier event even if the local UUID generator collides", async () => {
        const spy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");
        try {
            const original = await store.saveStateUpdateLocally(input());
            await expect(store.saveStateUpdateLocally({ ...input(), extraValues: { relation: "lot-2" } })).rejects.toThrow("identidad local ya existe");
            expect(await list()).toHaveLength(1);
            expect((await list())[0].localRecordId).toBe(original.localRecordId);
            expect((await list())[0].extraValues).toMatchObject({ relation: "lot-1" });
            expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toHaveLength(1);
        }
        finally {
            spy.mockRestore();
        }
    });
    it("rejects a selected row from a different scope atomically", async () => {
        const original = await store.saveStateUpdateLocally(input());
        await expect(store.saveStateUpdateLocally({ ...input(), ownerKey: "different-user", targetLocalRecordId: original.localRecordId })).rejects.toThrow();
        expect(await list()).toHaveLength(1);
        expect(await store.listPendingStateUpdateOperations("different-user")).toHaveLength(0);
    });
});
