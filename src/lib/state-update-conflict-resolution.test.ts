// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncPendingStateUpdatesOnce } from "../sync/state-update-sync";
import { OpcoNetworkError } from "./opco-api";
import { SaveStateUpdateLocallyInput } from "./state-update-offline";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";

const sqlite = vi.hoisted(() => ({ openDatabaseAsync: vi.fn() }));
vi.mock("expo-sqlite", () => sqlite);

// Actual SQLite SQL/rollback, through the production singleton/coordinator. Expo OPFS is checked separately.
function sqliteHarness() {
  const worker = spawn("python3", ["-u", "-c", `
import sqlite3,json,sys
c=sqlite3.connect(':memory:', isolation_level=None)
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
`]);
  let buffer = "";
  const queue: { resolve: (value: any) => void; reject: (error: Error) => void }[] = [];
  worker.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      const reply = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const task = queue.shift()!;
      if (reply.error) task.reject(new Error(reply.error)); else task.resolve(reply.result);
    }
  });
  const query = (kind: string, sql: string, args: unknown[] = []) => new Promise<any>((resolve, reject) => {
    queue.push({ resolve, reject }); worker.stdin.write(JSON.stringify({ kind, sql, args }) + "\n");
  });
  const db = {
    execAsync: (sql: string) => query("exec", sql),
    getAllAsync: (sql: string, ...args: unknown[]) => query("read", sql, args),
    getFirstAsync: async (sql: string, ...args: unknown[]) => (await query("read", sql, args))[0] ?? null,
    runAsync: vi.fn((sql: string, ...args: unknown[]) => query("write", sql, args)),
    withTransactionAsync: async (task: () => Promise<void>) => {
      await query("exec", "BEGIN");
      try { await task(); await query("exec", "COMMIT"); }
      catch (error) { await query("exec", "ROLLBACK"); throw error; }
    },
    closeAsync: async () => { worker.kill(); },
  };
  return { db, stop: () => worker.kill() };
}
const scope = { ownerKey: "local:user", contractId: "contract", targetEntityTypeId: "target", appViewId: "view" };
const field = { fieldId: "state", label: "Estado", name: "state", type: "SELECT" as const, required: true, options: [
  { optionId: "local", label: "Local", value: "local" }, { optionId: "remote", label: "Remoto", value: "remote" },
] };
const saveInput = { ...scope, subjectRecordId: "subject", subjectDisplayName: "Sujeto", historyMode: "append" as const,
  uniqueness: "none" as const, stateFields: [field], stateValues: [{ fieldId: "state", optionId: "local" }] };
let harness: ReturnType<typeof sqliteHarness>;
let store: ReturnType<typeof getLocalDatabase>;
beforeEach(async () => {
  __resetLocalDatabaseForTests(); harness = sqliteHarness(); sqlite.openDatabaseAsync.mockResolvedValue(harness.db);
  store = getLocalDatabase(); await store.getSelectedContractId();
});
afterEach(() => { harness.stop(); __resetLocalDatabaseForTests(); });
async function conflict(input: SaveStateUpdateLocallyInput = saveInput) {
  const saved = await store.saveStateUpdateLocally(input);
  const op = (await store.listPendingStateUpdateOperations(scope.ownerKey)).find((o) => o.localRecordId === saved.localRecordId)!;
  await store.markStateUpdateOperationConflict(op, { result: "CONFLICT", requested: { stateValues: [{ fieldId: "state", optionId: "local", label: "Local" }] }, subjectRecordId: "subject", existing: {
    recordId: "remote-record", updatedAt: "2026-10-03T12:00:00.000Z", stateValues: [{ fieldId: "state", optionId: "remote", label: "Remoto" }],
  } });
  return (await store.listStateUpdateConflicts(scope)).find((r) => r.localRecordId === saved.localRecordId)!;
}
async function rows() {
  return { records: await harness.db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id"),
    outbox: await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id") };
}
describe("selected STATE_UPDATE conflict resolution", () => {
  it("Use Opco resolves only the selected append row and keeps the other intent", async () => {
    const first = await conflict(); const second = await conflict();
    await store.discardStateUpdateLocalChange({ ...scope, subjectRecordId: "subject", localRecordId: first.localRecordId,
      conflictIdentity: first.conflictIdentity! });
    const state = await rows();
    expect(state.outbox.map((o: any) => o.local_record_id)).toEqual([second.localRecordId]);
    expect(state.records.find((r: any) => r.local_id === first.localRecordId).sync_status).toBe("synced");
    expect(state.records.find((r: any) => r.local_id === second.localRecordId).sync_status).toBe("conflict");
  });
  it("rolls back remote restoration and outbox deletion if the second step fails", async () => {
    const selected = await conflict(); const before = await rows();
    const run = harness.db.runAsync.getMockImplementation()!;
    harness.db.runAsync.mockImplementation((sql, ...args) => {
      if (sql.includes("SET values_json")) throw new Error("injected restoration failure");
      return run(sql, ...args);
    });
    await expect(store.discardStateUpdateLocalChange({ ...scope, subjectRecordId: "subject", localRecordId: selected.localRecordId,
      conflictIdentity: selected.conflictIdentity! })).rejects.toThrow("injected restoration failure");
    expect(await rows()).toEqual(before);
  });
  it("rejects a selection that changed after the conflict was displayed", async () => {
    const selected = await conflict();
    await harness.db.runAsync("UPDATE entity_records SET conflict_remote_updated_at = ?", "new-remote-version");
    const before = await rows();
    await expect(store.discardStateUpdateLocalChange({ ...scope, subjectRecordId: "subject", localRecordId: selected.localRecordId,
      conflictIdentity: selected.conflictIdentity! })).rejects.toThrow();
    expect(await rows()).toEqual(before);
  });
  it.each(["confirmed", "conflict", "failed", "network"] as const)("Use my change verifies selected result: %s", async (scenario) => {
    const selected = await conflict(); const other = await conflict();
    const saved = await store.resolveStateUpdateConflictWithLocal({ ...saveInput, localRecordId: selected.localRecordId,
      conflictIdentity: selected.conflictIdentity!, overwrite: true, expectedUpdatedAt: selected.conflictRemoteUpdatedAt });
    const resultScope = { ...scope, localRecordId: saved.localRecordId, clientRequestId: saved.clientRequestId! };
    expect(await store.getStateUpdateResolutionOutcome(resultScope)).toBe("pending");
    const save = vi.fn(async () => {
      if (scenario === "network") throw new OpcoNetworkError("Red local caida");
      return { appView: { id: "view", name: "Fixture", slug: "fixture" }, results: [scenario === "conflict" ? { result: "CONFLICT" as const, subjectRecordId: "subject",
        existing: { recordId: "remote-record", updatedAt: "2026-10-03T14:00:00.000Z", stateValues: [{ fieldId: "state", optionId: "remote", label: "Remoto" }] },
        requested: { stateValues: [{ fieldId: "state", optionId: "local", label: "Local" }] } } :
        scenario === "failed" ? { result: "ERROR" as const, subjectRecordId: "subject", code: "VALIDATION", message: "Fallo local" } :
        { result: "UPDATED" as const, subjectRecordId: "subject", recordId: "remote-record", updatedAt: "2026-10-03T13:00:00.000Z" }],
        summary: { totalRegistered: 1 } };
    });
    await syncPendingStateUpdatesOnce({ ownerKey: scope.ownerKey, store, token: "fixture", api: { saveStateUpdateWorkflow: save } });
    expect(await store.getStateUpdateResolutionOutcome(resultScope)).toBe(scenario === "network" ? "pending" : scenario);
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]).toEqual(expect.arrayContaining([expect.objectContaining({ clientRequestId: saved.clientRequestId,
      expectedUpdatedAt: selected.conflictRemoteUpdatedAt, overwrite: true, subjectRecordId: "subject" })]));
    const state = await rows();
    expect(state.outbox.some((o: any) => o.local_record_id === other.localRecordId)).toBe(true);
    if (scenario === "confirmed") {
      const confirmed = state.records.find((r: any) => r.local_id === saved.localRecordId);
      expect(confirmed.server_id).toBe("remote-record");
      expect(JSON.parse(confirmed.values_json).stateValues[0].optionId).toBe("local");
    }
  });
  it("rolls back Use my change if the outbox rewrite fails", async () => {
    const selected = await conflict(); const before = await rows();
    const run = harness.db.runAsync.getMockImplementation()!;
    harness.db.runAsync.mockImplementation((sql, ...args) => {
      if (sql.includes("INSERT INTO pending_operations")) throw new Error("outbox rewrite failure");
      return run(sql, ...args);
    });
    await expect(store.resolveStateUpdateConflictWithLocal({ ...saveInput, localRecordId: selected.localRecordId,
      conflictIdentity: selected.conflictIdentity!, overwrite: true })).rejects.toThrow("outbox rewrite failure");
    expect(await rows()).toEqual(before);
  });
  it.each(["complete", "conflict", "failed", "retry"] as const)("late %s response cannot consume a newer edit", async (response) => {
    const input = { ...saveInput, historyMode: "update-current" as const, uniqueness: "subject" as const };
    const selected = await conflict(input);
    const saved = await store.resolveStateUpdateConflictWithLocal({ ...input, localRecordId: selected.localRecordId,
      conflictIdentity: selected.conflictIdentity!, overwrite: true, expectedUpdatedAt: selected.conflictRemoteUpdatedAt });
    const sending = (await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
    await store.saveStateUpdateLocally({ ...input, stateValues: [{ fieldId: "state", optionId: "remote" }] });
    const before = await rows();
    if (response === "complete") await store.completeStateUpdateOperation(sending, { result: "UPDATED", subjectRecordId: "subject", recordId: "remote-record", updatedAt: "2026-10-03T13:00:00.000Z" });
    else if (response === "conflict") await store.markStateUpdateOperationConflict(sending, { result: "CONFLICT", subjectRecordId: "subject",
      existing: { recordId: "remote-record", updatedAt: "later", stateValues: [] }, requested: { stateValues: [] } });
    else if (response === "failed") await store.failStateUpdateOperation(sending, "VALIDATION", "Fallo");
    else await store.retryStateUpdateOperation(sending, "NETWORK", "Red caida");
    expect(await rows()).toEqual(before);
    expect(await store.getStateUpdateResolutionOutcome({ ...scope, localRecordId: saved.localRecordId, clientRequestId: saved.clientRequestId! })).toBe("superseded");
  });
  it.each(["ownerKey", "contractId", "appViewId", "targetEntityTypeId", "date", "subjectRecordId"] as const)("rejects wrong selected scope: %s", async (key) => {
    const selected = await conflict(); const before = await rows();
    await expect(store.discardStateUpdateLocalChange({ ...scope, subjectRecordId: "subject", localRecordId: selected.localRecordId,
      conflictIdentity: selected.conflictIdentity!, [key]: "other" })).rejects.toThrow();
    expect(await rows()).toEqual(before);
  });
  it("rejects stale Use my change before modifying the row or outbox", async () => {
    const selected = await conflict();
    await harness.db.runAsync("UPDATE pending_operations SET client_request_id = ?", "replacement");
    const before = await rows();
    await expect(store.resolveStateUpdateConflictWithLocal({ ...saveInput, localRecordId: selected.localRecordId,
      conflictIdentity: selected.conflictIdentity!, overwrite: true })).rejects.toThrow();
    expect(await rows()).toEqual(before);
  });

  it("keeps the selected append row when its confirmed remote record is read again", async () => {
    const selected = await conflict();
    await store.discardStateUpdateLocalChange({ ...scope, subjectRecordId: "subject", localRecordId: selected.localRecordId, conflictIdentity: selected.conflictIdentity! });
    await store.upsertStateUpdateSnapshot({ ...scope, items: [], latest: [{ recordId: "remote-record", updatedAt: "2026-10-03T12:00:00.000Z",
      subject: { id: "subject", displayName: "Sujeto" }, stateValues: [{ fieldId: "state", optionId: "remote", label: "Remoto" }] }] });
    expect((await rows()).records.map((r: any) => r.local_id)).toEqual([selected.localRecordId]);
  });
  it("keeps verifiable confirmation after refreshing the same remote snapshot", async () => {
    const input = { ...saveInput, historyMode: "update-current" as const, uniqueness: "subject" as const };
    const selected = await conflict(input);
    const saved = await store.resolveStateUpdateConflictWithLocal({ ...input, localRecordId: selected.localRecordId, conflictIdentity: selected.conflictIdentity!, overwrite: true });
    const operation = (await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
    await store.completeStateUpdateOperation(operation, { result: "UPDATED", subjectRecordId: "subject", recordId: "remote-record", updatedAt: "2026-10-03T13:00:00.000Z" });
    await store.upsertStateUpdateSnapshot({ ...scope, items: [{ subject: { id: "subject", displayName: "Sujeto" }, current: {
      recordId: "remote-record", updatedAt: "2026-10-03T13:00:00.000Z", stateValues: saved.stateValues } }] });
    expect(await store.getStateUpdateResolutionOutcome({ ...scope, localRecordId: saved.localRecordId, clientRequestId: saved.clientRequestId! })).toBe("confirmed");
  });

  it("does not confirm a different remote record for the selected overwrite", async () => {
    const selected = await conflict();
    const saved = await store.resolveStateUpdateConflictWithLocal({ ...saveInput, localRecordId: selected.localRecordId,
      conflictIdentity: selected.conflictIdentity!, overwrite: true });
    const operation = (await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
    const before = await rows();
    await expect(store.completeStateUpdateOperation(operation, { result: "UPDATED", subjectRecordId: "subject",
      recordId: "different-remote-record", updatedAt: "2026-10-03T13:00:00.000Z" })).rejects.toThrow();
    expect(await rows()).toEqual(before);
    expect(await store.getStateUpdateResolutionOutcome({ ...scope, localRecordId: saved.localRecordId, clientRequestId: saved.clientRequestId! })).toBe("pending");
  });

  it("allows a durable new edit while the selected overwrite waits on the network", async () => {
    const input = { ...saveInput, historyMode: "update-current" as const, uniqueness: "subject" as const };
    const selected = await conflict(input);
    const saved = await store.resolveStateUpdateConflictWithLocal({ ...input, localRecordId: selected.localRecordId, conflictIdentity: selected.conflictIdentity!, overwrite: true });
    let started!: () => void, release!: () => void;
    const inFlight = new Promise<void>((resolve) => { started = resolve; });
    const response = new Promise<void>((resolve) => { release = resolve; });
    const sync = syncPendingStateUpdatesOnce({ ownerKey: scope.ownerKey, token: "fixture", store, api: {
      saveStateUpdateWorkflow: async () => {
        started(); await response;
        return { appView: { id: "view", name: "Fixture", slug: "fixture" }, results: [{ result: "UPDATED", subjectRecordId: "subject", recordId: "remote-record", updatedAt: "2026-10-03T13:00:00.000Z" }] };
      },
    } });
    try {
      await inFlight;
      await store.saveStateUpdateLocally({ ...input, stateValues: [{ fieldId: "state", optionId: "remote" }] });
    } finally { release(); }
    await sync;
    const state = await rows();
    expect(state.outbox).toHaveLength(1);
    expect(JSON.parse(state.records[0].values_json).stateValues[0].optionId).toBe("remote");
    expect(await store.getStateUpdateResolutionOutcome({ ...scope, localRecordId: saved.localRecordId, clientRequestId: saved.clientRequestId! })).toBe("superseded");
  });

});
