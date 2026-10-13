// Runtime regression against real SQLite v10 storage and the shared functions.
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";
import { cacheAttendanceRemoteSnapshot } from "./attendance-snapshot-cache";
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

const scope = { ownerKey: "synthetic-owner", contractId: "synthetic-contract", targetEntityTypeId: "synthetic-target", date: "2026-10-12" };
const subject = { id: "synthetic-subject", displayName: "Synthetic subject" };
const event = { recordId: "shared-remote-event", updatedAt: "2026-10-12T12:00:00Z", date: scope.date, subject, stateValues: [{ fieldId: "date", value: scope.date, label: null, optionId: null }] };
let temporaryDirectory: string | undefined;
let harness: ReturnType<typeof sqliteHarness>, store: ReturnType<typeof getLocalDatabase>;
beforeEach(async () => { __resetLocalDatabaseForTests(); harness = sqliteHarness(); sqlite.openDatabaseAsync.mockResolvedValue(harness.db); store = getLocalDatabase(); await store.getSelectedContractId(); });
afterEach(() => { harness.stop(); __resetLocalDatabaseForTests(); if (temporaryDirectory) { rmSync(temporaryDirectory, { recursive: true, force: true }); temporaryDirectory = undefined; } });
const attendanceScope = { ...scope, appViewId: "attendance-view", historyMode: "update-current" as const, uniqueness: "subject-date" as const };
const genericScope = { ...scope, appViewId: "generic-view", dateFieldId: "date", historyMode: "append" as const, uniqueness: "subject" as const };
async function snapshot(view: typeof attendanceScope | typeof genericScope, status = "present") {
 const configuredEvent = { ...event, stateValues: [{ fieldId: "status", optionId: status, label: status === "present" ? "PRESENTE" : "AUSENTE" }] };
 return store.upsertStateUpdateSnapshot({ ...view, items: [{ subject, current: configuredEvent }], latest: [configuredEvent] });
}
const inputFor = (view = attendanceScope) => ({ ...view, subjectRecordId: subject.id,
  subjectDisplayName: subject.displayName, stateFields: [], stateValues: [{ fieldId: "status", optionId: "absent" }], extraValues: {} });
async function projections() {
 return harness.db.getAllAsync("SELECT key,value FROM app_metadata WHERE substr(key,1,26)='state_update_v10_snapshot:' ORDER BY key");
}
async function reopenFile() {
 harness.stop(); __resetLocalDatabaseForTests();
 harness = sqliteHarness(temporaryDirectory + "/db.sqlite"); sqlite.openDatabaseAsync.mockResolvedValue(harness.db);
 store = getLocalDatabase(); await store.getSelectedContractId();
}
async function fileDatabase() {
 harness.stop(); __resetLocalDatabaseForTests(); temporaryDirectory = mkdtempSync("/tmp/opco-v10-runtime-");
 harness = sqliteHarness(temporaryDirectory + "/db.sqlite"); sqlite.openDatabaseAsync.mockResolvedValue(harness.db);
 store = getLocalDatabase(); await store.getSelectedContractId();
}
async function seedSubject() {
 await store.upsertRemoteRecords({ ownerKey: scope.ownerKey, contractId: scope.contractId, entityTypeId: "source",
   records: [{ id: subject.id, displayName: subject.displayName, updatedAt: event.updatedAt, values: {} }] });
}
async function search(view: typeof attendanceScope | typeof genericScope) {
 return store.searchStateUpdateSubjects({ ...view, sourceEntityTypeId: "source", search: "Synthetic" });
}
async function seedLegacy(view = genericScope) {
 const row = { ...scope, appViewId: view.appViewId, subjectRecordId: subject.id, subjectDisplayName: subject.displayName,
   stateValues: [{ fieldId: "status", optionId: "present" }, { fieldId: "date", value: scope.date }], expectedUpdatedAt: event.updatedAt };
 await harness.db.runAsync(`INSERT INTO entity_records(local_id,server_id,owner_key,contract_id,entity_type_id,display_name,values_json,remote_updated_at,cached_at,sync_status)
   VALUES (?,?,?,?,?,?,?,?,?,'synced')`, "legacy-row", event.recordId, scope.ownerKey, scope.contractId, scope.targetEntityTypeId,
   subject.displayName, JSON.stringify(row), event.updatedAt, event.updatedAt);
}
it.each(["attendance-first", "generic-first"])("persists shared remote identity and isolated snapshots in either order: %s", async order => {
 await fileDatabase(); await seedSubject();
 const views = order === "attendance-first" ? [attendanceScope, genericScope] : [genericScope, attendanceScope];
 const schema = await harness.db.getAllAsync("SELECT name,sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY name");
 for (const view of views) { expect((await snapshot(view)).contentVerified).toBe(true); await snapshot(view); }
 expect((await store.listStateUpdateLatest(attendanceScope)).pagination.total).toBe(1);
 expect((await store.listStateUpdateLatest(genericScope)).pagination.total).toBe(1);
 expect(await harness.db.getFirstAsync("SELECT COUNT(*) n FROM app_metadata WHERE key LIKE 'state_update_v10_remote:%'")).toEqual({ n: 1 });
 const before = await projections(); expect(before).toHaveLength(2);
 await reopenFile(); expect(await projections()).toEqual(before);
 for (const view of views) expect((await search(view))[0].current?.stateValues[0].optionId).toBe("present");
 expect(await harness.db.getAllAsync("SELECT name,sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY name")).toEqual(schema);
});
it("keeps legacy rows and RECORDS source identity while hydrating both AppViews", async () => {
 await seedSubject(); await seedLegacy(); const before = await harness.db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id");
 await snapshot(attendanceScope); await snapshot(genericScope);
 expect(await harness.db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id")).toEqual(before);
 expect((await search(genericScope))[0].current?.recordId).toBe("legacy-row");
 const records = await store.listCachedRecords({ ownerKey: scope.ownerKey, contractId: scope.contractId, entityTypeId: "source" });
 expect(records.records[0].serverId).toBe(subject.id);
});
it("preserves equal-date distinct events, current/latest reuse, historical dates and confirmed null", async () => {
 await fileDatabase(); await seedSubject();
 const a = { ...event, recordId: "A", date: "2026-08-13", stateValues: [{ fieldId: "date", value: "2026-08-13", label: null, optionId: null }] };
 const b = { ...a, recordId: "B" };
 const r = await store.upsertStateUpdateSnapshot({ ...genericScope, items: [{ subject, current: a }], latest: [a, b], complete: true, expectedRemoteEventCount: 2 });
 expect(r).toMatchObject({ contentVerified: true, persistedRemoteEventCount: 2 });
 const latest = await store.listStateUpdateLatest(genericScope); expect(latest.pagination.total).toBe(2);
 expect((await search(genericScope))[0].current?.stateValues[0].value).toBe("2026-08-13");
 const selected = latest.items[0].recordId;
 expect((await store.getCachedRecord({ ownerKey: scope.ownerKey, contractId: scope.contractId, entityTypeId: scope.targetEntityTypeId, recordId: selected }))?.serverId).toBe("A");
 expect(await store.getCachedRecord({ ownerKey: "another-owner", contractId: scope.contractId, entityTypeId: scope.targetEntityTypeId, recordId: selected })).toBeNull();
 await store.upsertStateUpdateSnapshot({ ...genericScope, items: [{ subject, current: null }], latest: [] });
 await reopenFile(); expect((await search(genericScope))[0].current).toBeNull();
 expect((await store.listStateUpdateLatest(genericScope)).pagination.total).toBe(2);
});
it("completes only the selected intention against a foreign legacy binding, retaining append and authorization", async () => {
 await fileDatabase(); await seedLegacy(); await snapshot(attendanceScope);
 const own = await store.saveStateUpdateLocally({ ...inputFor(), overwrite: true, expectedUpdatedAt: event.updatedAt });
 const one = await store.saveStateUpdateLocally({ ...inputFor(), ...genericScope });
 const two = await store.saveStateUpdateLocally({ ...inputFor(), ...genericScope });
 expect(one.localRecordId).not.toBe(two.localRecordId);
 const op = (await store.listPendingStateUpdateOperations(scope.ownerKey)).find(p => p.localRecordId === own.localRecordId)!;
 const before = await harness.db.getAllAsync("SELECT * FROM pending_operations WHERE id!=? ORDER BY id", op.id);
 const physical = await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id='legacy-row'");
 await store.saveStateUpdateLocally({ ...inputFor(), preserveIdenticalConfirmedIntent: true });
 expect((await store.listPendingStateUpdateOperations(scope.ownerKey)).find(p => p.id === op.id)).toEqual(op);
 await store.completeStateUpdateOperation(op, { result: "UPDATED", recordId: event.recordId, subjectRecordId: subject.id, updatedAt: "2026-10-12T13:00:00Z" });
 expect(await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")).toEqual(before);
 expect(await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id='legacy-row'")).toEqual(physical);
 expect(await store.getStateUpdateResolutionOutcome({ ...attendanceScope, localRecordId: own.localRecordId, clientRequestId: own.clientRequestId! })).toBe("confirmed");
 await reopenFile();
 const receipt = await store.getCachedRecord({ ownerKey: scope.ownerKey, contractId: scope.contractId, entityTypeId: scope.targetEntityTypeId, recordId: own.localRecordId });
 expect(receipt?.serverId).toBe(event.recordId);
 expect(await harness.db.getFirstAsync("SELECT server_id FROM entity_records WHERE local_id=?", own.localRecordId)).toEqual({ server_id: null });
});
it("Use Opco restores only one durable conflict after reopen, without consuming another AppView", async () => {
 await fileDatabase(); await seedLegacy(); await snapshot(attendanceScope);
 const own = await store.saveStateUpdateLocally(inputFor());
 const other = await store.saveStateUpdateLocally({ ...inputFor(), ...genericScope });
 const ops = await store.listPendingStateUpdateOperations(scope.ownerKey);
 for (const op of ops) await store.markStateUpdateOperationConflict(op, { result: "CONFLICT", subjectRecordId: subject.id,
   requested: { stateValues: [] }, existing: { recordId: event.recordId, updatedAt: event.updatedAt, stateValues: [{ fieldId: "status", optionId: "present", label: null }] } });
 const beforeRow = await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id=?", other.localRecordId);
 const beforeOp = await harness.db.getFirstAsync("SELECT * FROM pending_operations WHERE local_record_id=?", other.localRecordId);
 const selected = (await store.listStateUpdateConflicts(attendanceScope))[0]; await reopenFile();
 await store.discardStateUpdateLocalChange({ ...attendanceScope, subjectRecordId: subject.id, localRecordId: own.localRecordId, conflictIdentity: selected.conflictIdentity! });
 expect(await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id=?", other.localRecordId)).toEqual(beforeRow);
 expect(await harness.db.getFirstAsync("SELECT * FROM pending_operations WHERE local_record_id=?", other.localRecordId)).toEqual(beforeOp);
 expect(await store.listStateUpdateConflicts(attendanceScope)).toEqual([]);
 expect((await store.listStateUpdateConflicts(genericScope))[0].localRecordId).toBe(other.localRecordId);
});
it("rollback preserves receipts, metadata and outbox, and the shared queue continues", async () => {
 await snapshot(attendanceScope);
 const own = await store.saveStateUpdateLocally(inputFor()); const op = (await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
 const rows = await harness.db.getAllAsync("SELECT * FROM entity_records"), outbox = await harness.db.getAllAsync("SELECT * FROM pending_operations"), meta = await harness.db.getAllAsync("SELECT * FROM app_metadata ORDER BY key");
 const run = harness.db.runAsync.getMockImplementation()!;
 harness.db.runAsync.mockImplementation((sql, ...args) => { if (sql.startsWith("INSERT INTO app_metadata") && String(args[0]).startsWith("state_update_v10_snapshot:")) throw Error("injected projection failure"); return run(sql, ...args); });
 await expect(store.completeStateUpdateOperation(op, { result: "UPDATED", recordId: event.recordId, subjectRecordId: subject.id, updatedAt: "2026-10-12T13:00:00Z" })).rejects.toThrow("injected projection failure");
 harness.db.runAsync.mockImplementation(run);
 expect(await harness.db.getAllAsync("SELECT * FROM entity_records")).toEqual(rows);
 expect(await harness.db.getAllAsync("SELECT * FROM pending_operations")).toEqual(outbox);
 expect(await harness.db.getAllAsync("SELECT * FROM app_metadata ORDER BY key")).toEqual(meta);
 await store.completeStateUpdateOperation(op, { result: "UPDATED", recordId: event.recordId, subjectRecordId: subject.id, updatedAt: "2026-10-12T13:00:00Z" });
 expect(await store.getStateUpdateResolutionOutcome({ ...attendanceScope, localRecordId: own.localRecordId, clientRequestId: own.clientRequestId! })).toBe("confirmed");
});
it("late responses cannot consume a new edit or mutate another scope", async () => {
 await snapshot(attendanceScope); const saved = await store.saveStateUpdateLocally(inputFor());
 const old = (await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
 await store.saveStateUpdateLocally({ ...inputFor(), extraValues: { changed: "synthetic" } });
 const before = { rows: await harness.db.getAllAsync("SELECT * FROM entity_records"), outbox: await harness.db.getAllAsync("SELECT * FROM pending_operations"), meta: await projections() };
 await store.completeStateUpdateOperation(old, { result: "UPDATED", recordId: event.recordId, subjectRecordId: subject.id, updatedAt: "2026-10-12T13:00:00Z" });
 expect(await harness.db.getAllAsync("SELECT * FROM entity_records")).toEqual(before.rows);
 expect(await harness.db.getAllAsync("SELECT * FROM pending_operations")).toEqual(before.outbox);
 expect(await projections()).toEqual(before.meta);
 expect(await store.getStateUpdateResolutionOutcome({ ...attendanceScope, localRecordId: saved.localRecordId, clientRequestId: saved.clientRequestId! })).toBe("superseded");
});
it("an ACK does not certify full snapshot/current coverage", async () => {
 await seedSubject(); await snapshot(genericScope);
 await store.setStateUpdateCurrentCoverage({ ...genericScope, sourceEntityTypeId: "source", coverage: {
   status: "complete", sourceComplete: true, totalSubjects: 1, subjects: { [subject.id]: { status: "verified", remoteRecordId: event.recordId } }, requestCount: 1, durationMs: 1, refreshedAt: event.updatedAt } });
 expect((await store.getStateUpdateCurrentCoverage({ ...genericScope, sourceEntityTypeId: "source" }))?.status).toBe("complete");
 const own = await store.saveStateUpdateLocally({ ...inputFor(), ...genericScope });
 const op = (await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
 await store.completeStateUpdateOperation(op, { result: "CREATED", recordId: "new-event", subjectRecordId: subject.id, updatedAt: "2026-10-12T13:00:00Z" });
 expect((await store.getStateUpdateCurrentCoverage({ ...genericScope, sourceEntityTypeId: "source" }))?.status).toBe("partial");
 expect(await store.getStateUpdateResolutionOutcome({ ...genericScope, localRecordId: own.localRecordId, clientRequestId: own.clientRequestId! })).toBe("confirmed");
});
it("resolves a scoped remote ID without borrowing another AppView's physical row", async () => {
 await seedLegacy(); await snapshot(attendanceScope);
 const cached = await store.getCachedRecord({ ownerKey: scope.ownerKey, contractId: scope.contractId, entityTypeId: scope.targetEntityTypeId,
   recordId: event.recordId, appViewId: attendanceScope.appViewId, date: scope.date });
 expect(cached?.values.appViewId).toBe(attendanceScope.appViewId);
 const saved = await store.saveStateUpdateLocally({ ...inputFor(), overwrite: true, expectedUpdatedAt: event.updatedAt });
 const pending = await store.getCachedRecord({ ownerKey: scope.ownerKey, contractId: scope.contractId, entityTypeId: scope.targetEntityTypeId,
   recordId: event.recordId, appViewId: attendanceScope.appViewId, date: scope.date });
 expect(pending?.localId).toBe(saved.localRecordId); expect(pending?.serverId).toBe(event.recordId);
});
it("isolates new intentions sharing legacy keys across owners without changing existing IDs", async () => {
 const first = await store.saveStateUpdateLocally(inputFor());
 const before = await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id=?", first.localRecordId);
 const second = await store.saveStateUpdateLocally({ ...inputFor(), ownerKey: "second-owner" });
 expect(second.localRecordId).not.toBe(first.localRecordId);
 await store.saveStateUpdateLocally({ ...inputFor(), ownerKey: "second-owner" });
 expect((await store.listPendingStateUpdateOperations("second-owner"))[0].localRecordId).toBe(second.localRecordId);
 expect(await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id=?", first.localRecordId)).toEqual(before);
 expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toHaveLength(1);
});
it("does not expose workflow receipts as RECORDS and preserves a canonical RECORDS identity", async () => {
 await store.upsertRemoteRecords({ ownerKey: scope.ownerKey, contractId: scope.contractId, entityTypeId: scope.targetEntityTypeId,
   records: [{ id: event.recordId, displayName: "Canonical synthetic", values: { status: "canonical" }, updatedAt: event.updatedAt }] });
 const before = await harness.db.getAllAsync("SELECT * FROM entity_records"); await snapshot(attendanceScope);
 const saved = await store.saveStateUpdateLocally(inputFor());
 const op = (await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
 await store.completeStateUpdateOperation(op, { result: "UPDATED", recordId: event.recordId, subjectRecordId: subject.id, updatedAt: "2026-10-12T13:00:00Z" });
 expect(await harness.db.getAllAsync("SELECT * FROM entity_records WHERE local_id<>?", saved.localRecordId)).toEqual(before);
 const records = await store.listCachedRecords({ ownerKey: scope.ownerKey, contractId: scope.contractId, entityTypeId: scope.targetEntityTypeId });
 expect(records.records).toHaveLength(1); expect(records.records[0].serverId).toBe(event.recordId);
});

it("confirmed null never revives an old accepted receipt when creating the next intention", async () => {
 await fileDatabase(); await snapshot(attendanceScope);
 const saved = await store.saveStateUpdateLocally(inputFor());
 const op = (await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
 await store.completeStateUpdateOperation(op, { result: "UPDATED", recordId: event.recordId, subjectRecordId: subject.id, updatedAt: event.updatedAt });
 await store.upsertStateUpdateSnapshot({ ...attendanceScope, items: [{ subject, current: null }], latest: [] });
 await reopenFile(); await store.saveStateUpdateLocally(inputFor());
 const next = (await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
 expect(next.localRecordId).toBe(saved.localRecordId); expect(next.serverRecordId).toBeNull();
 expect((next.payload as Record<string, unknown>).expectedUpdatedAt).toBeNull();
});
it("hydrates the same real remote event in both AppViews without a physical UNIQUE collision", async () => {
 await snapshot(attendanceScope); await snapshot(genericScope);
 expect(await projections()).toHaveLength(2);
});
it("a pending overlay for another query date does not hide the remote event in this date", async () => {
 await seedSubject(); await snapshot(attendanceScope); await store.saveStateUpdateLocally(inputFor());
 const next = { ...attendanceScope, date: "2026-10-13" };
 const remote = { ...event, updatedAt: "2026-10-13T12:00:00Z", stateValues: [{ fieldId: "status", optionId: "present", label: null, value: null }] };
 await store.upsertStateUpdateSnapshot({ ...next, items: [{ subject, current: remote }], latest: [] });
 expect((await store.searchStateUpdateSubjects({ ...next, sourceEntityTypeId: "source", search: "Synthetic" }))[0].current?.stateValues[0].optionId).toBe("present");
 expect((await search(attendanceScope))[0].current?.stateValues[0].optionId).toBe("absent");
 expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toHaveLength(1);
});

it("refuses to claim or complete an outbox whose durable row belongs to a different owner", async () => {
 await store.saveStateUpdateLocally(inputFor()); const op = (await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
 await harness.db.runAsync("UPDATE entity_records SET owner_key=? WHERE local_id=?", "other-owner", op.localRecordId);
 const before = { row: await harness.db.getAllAsync("SELECT * FROM entity_records"), operations: await harness.db.getAllAsync("SELECT * FROM pending_operations") };
 expect(await store.markStateUpdateOperationSyncing(op.id, op.clientRequestId)).toBe(false);
 await store.completeStateUpdateOperation(op, { result: "UPDATED", recordId: event.recordId, subjectRecordId: subject.id, updatedAt: event.updatedAt });
 expect(await harness.db.getAllAsync("SELECT * FROM entity_records")).toEqual(before.row);
 expect(await harness.db.getAllAsync("SELECT * FROM pending_operations")).toEqual(before.operations);
});

async function cacheAttendanceDefinition() {
 await store.upsertAppViewDefinition({ ownerKey: scope.ownerKey, contractId: scope.contractId,
  appViewId: attendanceScope.appViewId, appViewType: "WORKFLOW", workflowKey: "attendance", status: "ready", lastPreparedAt: event.updatedAt,
  definition: { kind: "state-update", appView: { id: attendanceScope.appViewId, name: "Attendance", slug: "attendance", icon: null, sortOrder: 0, type: "WORKFLOW",
    config: { workflowKey: "attendance", personFieldId: "subject-field", dateFieldId: "date", statusFieldId: "status", sourceEntityTypeId: "source", targetEntityTypeId: scope.targetEntityTypeId } },
    historyMode: "update-current", uniqueness: "subject-date", sourceEntityTypeId: "source", sourceEntityTypeName: "Synthetic", targetEntityTypeId: scope.targetEntityTypeId, targetEntityTypeName: "States",
    subjectFieldId: "subject-field", dateFieldId: "date", stateFields: [{ fieldId: "status", label: "Status", required: true, options: [] }], extraFields: [] } });
}
it("Attendance hydration retains distinct latest IDs and the authoritative current for the same person/day", async () => {
 await fileDatabase(); await seedSubject();
 await cacheAttendanceDefinition();
 const current = { recordId: "B", statusOptionId: "absent", statusLabel: "Absent", observation: null, updatedAt: "2026-10-12T14:00:00Z" };
 const result = await cacheAttendanceRemoteSnapshot({ appViewId: attendanceScope.appViewId, contractId: scope.contractId,
  ownerKey: scope.ownerKey, config: { statusFieldId: "status", personFieldId: "subject-field", dateFieldId: "date" }, store,
  response: { appView: { id: attendanceScope.appViewId, name: "Attendance", slug: "attendance" }, date: scope.date,
    sourceEntityType: { id: "source", name: "Synthetic" }, targetEntityType: { id: scope.targetEntityTypeId, name: "States" },
    statuses: [{ optionId: "present", label: "Present", isDefaultCheckIn: true }, { optionId: "absent", label: "Absent", isDefaultCheckIn: false }],
    items: [{ person: subject, attendance: current }], summary: { totalRegistered: 2 },
    latest: [{ attendanceRecordId: "B", person: subject, statusOptionId: "absent", statusLabel: "Absent", updatedAt: current.updatedAt },
      { attendanceRecordId: "A", person: subject, statusOptionId: "present", statusLabel: "Present", updatedAt: event.updatedAt }] } });
 expect(result.complete).toBe(true); expect((await store.listStateUpdateLatest(attendanceScope)).pagination.total).toBe(2);
 await reopenFile(); expect((await search(attendanceScope))[0].current?.stateValues[0].optionId).toBe("absent");
});

it("normalizes historical cached uniqueness at the SQL reader boundary after SQLite reopen", async () => {
 await fileDatabase(); await cacheAttendanceDefinition(); await snapshot(attendanceScope);
 const cached = await harness.db.getFirstAsync("SELECT definition_json FROM app_view_definitions WHERE app_view_id=?", attendanceScope.appViewId);
 const definition = JSON.parse(cached.definition_json); definition.uniqueness = { mode: "subject-date" };
 await harness.db.runAsync("UPDATE app_view_definitions SET definition_json=? WHERE app_view_id=?", JSON.stringify(definition), attendanceScope.appViewId);
 const before = await projections(); await reopenFile();
 const input = { ownerKey: scope.ownerKey, contractId: scope.contractId, entityTypeId: scope.targetEntityTypeId,
   recordId: event.recordId, appViewId: attendanceScope.appViewId, date: scope.date };
 expect((await store.getAppViewDefinition(scope.ownerKey, scope.contractId, attendanceScope.appViewId))?.definition.kind).toBe("state-update");
 expect((await store.getCachedRecord(input))?.serverId).toBe(event.recordId);
 expect(await store.getCachedRecord({ ...input, date: "2026-10-13" })).toBeNull();
 expect(await projections()).toEqual(before);
 definition.uniqueness = { mode: "unsupported" };
 await harness.db.runAsync("UPDATE app_view_definitions SET definition_json=? WHERE app_view_id=?", JSON.stringify(definition), attendanceScope.appViewId);
 expect((await store.getAppViewDefinition(scope.ownerKey, scope.contractId, attendanceScope.appViewId))?.definition.kind).toBe("error");
 expect(await store.getCachedRecord(input)).toBeNull();
});

it("snapshot recovery consumes only the matching update-current intention and preserves append and foreign conflicts", async()=>{
 await fileDatabase();await snapshot(attendanceScope);await snapshot(genericScope);
 const input={...inputFor(),stateValues:[{fieldId:"status",optionId:"absent"}]};
 const own=await store.saveStateUpdateLocally(input);
 const foreign=await store.saveStateUpdateLocally({...input,...genericScope});
 const ops=await store.listPendingStateUpdateOperations(scope.ownerKey),ownOp=ops.find(op=>op.localRecordId===own.localRecordId)!,foreignOp=ops.find(op=>op.localRecordId===foreign.localRecordId)!;
 await store.failStateUpdateOperation(ownOp,"OpcoNetworkError","Synthetic timeout");
 await store.markStateUpdateOperationConflict(foreignOp,{result:"CONFLICT",subjectRecordId:subject.id,existing:{recordId:event.recordId,updatedAt:event.updatedAt,stateValues:[]},requested:{stateValues:[]},extraValues:[]});
 const foreignBefore=await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id=?",foreign.localRecordId),outboxBefore=await harness.db.getFirstAsync("SELECT * FROM pending_operations WHERE id=?",foreignOp.id);
 await snapshot(attendanceScope,"absent");await snapshot(genericScope,"absent");
 expect(await store.getStateUpdateResolutionOutcome({...attendanceScope,localRecordId:own.localRecordId,clientRequestId:own.clientRequestId!})).toBe("confirmed");
 expect(await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id=?",foreign.localRecordId)).toEqual(foreignBefore);expect(await harness.db.getFirstAsync("SELECT * FROM pending_operations WHERE id=?",foreignOp.id)).toEqual(outboxBefore);
 await reopenFile();expect((await harness.db.getAllAsync("SELECT id FROM pending_operations")).map((op:{id:string})=>op.id)).toEqual([foreignOp.id]);
});
it("snapshot equality cannot consume an append intention or a known different remote identity",async()=>{
 await snapshot(attendanceScope);await snapshot(genericScope);
 const stateValues=[{fieldId:"status",optionId:"absent",label:null}],own=await store.saveStateUpdateLocally({...inputFor(),stateValues}),append=await store.saveStateUpdateLocally({...inputFor(),...genericScope,stateValues});
 const before=await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id");
 await store.upsertStateUpdateSnapshot({...attendanceScope,items:[{subject,current:{...event,recordId:"different-event",stateValues}}]});await snapshot(genericScope,"absent");
 expect(await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")).toEqual(before);
 expect((await store.getCachedRecord({ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:scope.targetEntityTypeId,recordId:own.localRecordId}))?.syncStatus).not.toBe("synced");expect(append.clientRequestId).toBeTruthy();
});
it("a receipt failure rolls back snapshot reconciliation and retains the exact authorized intention",async()=>{
 await fileDatabase();await snapshot(attendanceScope);
 const saved=await store.saveStateUpdateLocally({...inputFor(),overwrite:true,expectedUpdatedAt:event.updatedAt,stateValues:[{fieldId:"status",optionId:"absent"}]});
 const beforeRows=await harness.db.getAllAsync("SELECT * FROM entity_records"),beforeOps=await harness.db.getAllAsync("SELECT * FROM pending_operations"),beforeMeta=await harness.db.getAllAsync("SELECT * FROM app_metadata ORDER BY key");
 const run=harness.db.runAsync.getMockImplementation()!;
 harness.db.runAsync.mockImplementation((sql,...args)=>{if(sql.includes("sync_status='synced'"))throw Error("injected receipt failure");return run(sql,...args);});
 await expect(snapshot(attendanceScope,"absent")).rejects.toThrow("injected receipt failure");harness.db.runAsync.mockImplementation(run);
 expect(await harness.db.getAllAsync("SELECT * FROM entity_records")).toEqual(beforeRows);expect(await harness.db.getAllAsync("SELECT * FROM pending_operations")).toEqual(beforeOps);expect(await harness.db.getAllAsync("SELECT * FROM app_metadata ORDER BY key")).toEqual(beforeMeta);
 await reopenFile();expect((await store.listPendingStateUpdateOperations(scope.ownerKey))[0].clientRequestId).toBe(saved.clientRequestId);await snapshot(attendanceScope,"absent");expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toEqual([]);
});

it("an exact current snapshot does not silently resolve an update-current conflict",async()=>{
 await fileDatabase();await snapshot(attendanceScope);
 const saved=await store.saveStateUpdateLocally({...inputFor(),stateValues:[{fieldId:"status",optionId:"absent"}]});const op=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
 await store.markStateUpdateOperationConflict(op,{result:"CONFLICT",subjectRecordId:subject.id,existing:{recordId:event.recordId,updatedAt:event.updatedAt,stateValues:[]},requested:{stateValues:[]},extraValues:[]});
 const beforeRow=await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id=?",saved.localRecordId),beforeOp=await harness.db.getFirstAsync("SELECT * FROM pending_operations WHERE id=?",op.id);
 await snapshot(attendanceScope,"absent");await reopenFile();
 expect(await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id=?",saved.localRecordId)).toEqual(beforeRow);expect(await harness.db.getFirstAsync("SELECT * FROM pending_operations WHERE id=?",op.id)).toEqual(beforeOp);expect((await store.listStateUpdateConflicts(attendanceScope)).length).toBe(1);
});
