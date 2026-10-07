// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { mkdtempSync, rmSync } from "node:fs";
import { createOpcoApi } from "./opco-api";
import { prewarmAssignedAppViewsOnce } from "./app-view-prewarm";
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
const scope = {
  ownerKey: "diagnostic:user",
  contractId: "diagnostic-contract",
  targetEntityTypeId: "diagnostic-versions",
  appViewId: "diagnostic-view"
};
const subject = {
  id: "diagnostic-subject",
  displayName: "Inspección de tolva sintética"
};
const latest = [{
  recordId: "diagnostic-new",
  date: "2026-10-04",
  updatedAt: "2026-10-04T08:00:00.000Z",
  subject,
  stateValues: [{
    fieldId: "revision",
    value: "R1"
  }, {
    fieldId: "status",
    optionId: "valid"
  }, {
    fieldId: "date",
    value: "2026-10-04"
  }]
}, {
  recordId: "diagnostic-old",
  date: "2026-10-03",
  updatedAt: "2026-10-04T09:00:00.000Z",
  subject,
  stateValues: [{
    fieldId: "revision",
    value: "R99"
  }, {
    fieldId: "status",
    optionId: "valid"
  }, {
    fieldId: "date",
    value: "2026-10-03"
  }]
}].map(event => ({
  ...event,
  stateValues: event.stateValues.map(value => ({
    label: null,
    optionId: null,
    ...value
  }))
}));
let temporaryDirectory: string | undefined;
let harness: ReturnType<typeof sqliteHarness>, store: ReturnType<typeof getLocalDatabase>;
beforeEach(async () => {
  __resetLocalDatabaseForTests();
  harness = sqliteHarness();
  sqlite.openDatabaseAsync.mockResolvedValue(harness.db);
  store = getLocalDatabase();
  await store.getSelectedContractId();
  vi.useFakeTimers({
    toFake: ["Date"]
  });
  vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
});
afterEach(() => {
  harness.stop();
  __resetLocalDatabaseForTests();
  vi.useRealTimers();
  if (temporaryDirectory) {
    rmSync(temporaryDirectory, {
      recursive: true,
      force: true
    });
    temporaryDirectory = undefined;
  }
});
const datedScope = { ...scope, date: "2026-10-06", dateFieldId: "date", historyMode: "append" as const, uniqueness: "subject" as const };
const tied = latest.map((event, index) => ({ ...event, recordId: index === 0 ? "tie-a" : "tie-b", date: "2026-10-04", stateValues: event.stateValues.map(value => value.fieldId === "date" ? { ...value, value: "2026-10-04" } : value) }));
async function hydrate(events = tied) {
 return store.upsertStateUpdateSnapshot({ ...datedScope, items: [{ subject, current: { ...events[0] } }], latest: events, complete: true });
}
async function cacheSubject() {
 await store.upsertRemoteRecords({ contractId: scope.contractId, entityTypeId: "diagnostic-procedures", ownerKey: scope.ownerKey, records: [{ id: subject.id, displayName: subject.displayName, updatedAt: "2026-10-04T00:00:00Z", values: {} }] });
}
describe("v10 remote event identity and dated subject current", () => {
 it("preserves distinct IDs with equal subject/date and deduplicates current/latest", async () => {
  await hydrate(); await hydrate();
  const rows = await harness.db.getAllAsync("SELECT server_id FROM entity_records WHERE entity_type_id = ? ORDER BY server_id", scope.targetEntityTypeId);
  expect(rows.map((row: {server_id: string}) => row.server_id)).toEqual(["tie-a", "tie-b"]);
 });
 it("selects the configured date then remote ID, independent of query/cache dates", async () => {
  await cacheSubject(); await hydrate();
  const result = await store.searchStateUpdateSubjects({ ...datedScope, sourceEntityTypeId: "diagnostic-procedures", search: "tolva" });
  expect(result[0].current?.stateValues.find(value => value.fieldId === "revision")?.value).toBe("R1");
  await hydrate(latest);
  const differentDates = await store.searchStateUpdateSubjects({ ...datedScope, sourceEntityTypeId: "diagnostic-procedures", search: "tolva" });
  expect(differentDates[0].current?.stateValues.find(value => value.fieldId === "revision")?.value).toBe("R1");
  expect((await store.listStateUpdateLatest(datedScope)).pagination.total).toBe(2);
 });
 it("repairs a legacy row without reset and preserves its local alias", async () => {
  await store.upsertStateUpdateSnapshot({ ...scope, date: "2026-10-06", items: [], latest: tied });
  const before = await harness.db.getFirstAsync("SELECT local_id FROM entity_records WHERE server_id='tie-b'");
  await hydrate(); await hydrate();
  expect(await harness.db.getFirstAsync("SELECT local_id FROM entity_records WHERE server_id='tie-b'")).toEqual(before);
  expect((await store.listStateUpdateLatest(datedScope)).pagination.total).toBe(2);
 });
 it("requires verified unique content for complete; legacy coverage is partial", async () => {
  const pagination = { page: 1, pageSize: 20, total: 2, hasMore: false };
  await store.markStateUpdateSnapshotCoverage({ ...scope, date: datedScope.date, pagination });
  expect((await store.getStateUpdateSnapshotCoverage(datedScope))?.status).toBe("partial");
  const snapshotResult = await hydrate();
  await store.markStateUpdateSnapshotCoverage({ ...datedScope, pagination, snapshotResult });
  expect((await store.getStateUpdateSnapshotCoverage(datedScope))?.status).toBe("complete");
  await store.markStateUpdateSnapshotCoverage({ ...datedScope, pagination: { ...pagination, total: 3 }, snapshotResult });
  expect((await store.getStateUpdateSnapshotCoverage(datedScope))?.status).toBe("partial");
 });
 it("does not infer current from an absent configured event date or query date", async () => {
  await cacheSubject();
  const undated = [{ ...tied[0], date: null, stateValues: tied[0].stateValues.filter(value => value.fieldId !== "date") }];
  await store.upsertStateUpdateSnapshot({ ...datedScope, items: [{ subject, current: undated[0] }], latest: undated });
  const result = await store.searchStateUpdateSubjects({ ...datedScope, sourceEntityTypeId: "diagnostic-procedures", search: "tolva" });
  expect(result[0].current).toBeNull();
  expect(await store.getStateUpdateSnapshotCoverage(datedScope)).toBeNull();
 });
 it("preserves append intentions and conflicts, keeps their query-scoped overlay", async () => {
  await cacheSubject(); await hydrate();
  const input = { ...datedScope, subjectRecordId: subject.id, subjectDisplayName: subject.displayName, stateFields: [], stateValues: [{ fieldId: "revision", value: "pending" }] };
  const first = await store.saveStateUpdateLocally(input), second = await store.saveStateUpdateLocally(input);
  await harness.db.runAsync("UPDATE entity_records SET sync_status='conflict' WHERE local_id=?", first.localRecordId);
  const rows = await harness.db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced' ORDER BY local_id");
  const outbox = await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id");
  await hydrate();
  expect(await harness.db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced' ORDER BY local_id")).toEqual(rows);
  expect(await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")).toEqual(outbox);
  expect(first.localRecordId).not.toBe(second.localRecordId);
  expect((await store.searchStateUpdateSubjects({ ...datedScope, sourceEntityTypeId: "diagnostic-procedures", search: "tolva" }))[0].current?.stateValues[0].value).toBe("pending");
 });
 it("protects an unsynced row carrying a remote ID and refuses complete coverage", async () => {
  await hydrate();
  await harness.db.runAsync("UPDATE entity_records SET sync_status='conflict' WHERE server_id='tie-a'");
  const before = await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE server_id='tie-a'");
  const snapshotResult = await hydrate();
  expect(snapshotResult.contentVerified).toBe(false);
  expect(await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE server_id='tie-a'")).toEqual(before);
 });
 it("rolls back snapshot failure without losing pending rows", async () => {
  await store.saveStateUpdateLocally({ ...datedScope, subjectRecordId: subject.id, subjectDisplayName: subject.displayName, stateFields: [], stateValues: [] });
  const before = await harness.db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id");
  const pending = await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id");
  const run = harness.db.runAsync.getMockImplementation()!;
  let count = 0;
  harness.db.runAsync.mockImplementation((sql: string, ...args: unknown[]) => {
   if (sql.includes("INSERT INTO entity_records") && ++count === 2) throw new Error("synthetic snapshot failure");
   return run(sql, ...args);
  });
  await expect(hydrate()).rejects.toThrow("synthetic snapshot failure");
  expect(await harness.db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id")).toEqual(before);
  expect(await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")).toEqual(pending);
 });
 it("reopens a persisted v10 snapshot with both events and the same winner", async () => {
  harness.stop(); __resetLocalDatabaseForTests(); temporaryDirectory = mkdtempSync("/tmp/opco-remote-snapshot-test-");
  const path = temporaryDirectory + "/local.sqlite";
  harness = sqliteHarness(path); sqlite.openDatabaseAsync.mockResolvedValue(harness.db); store = getLocalDatabase();
  await cacheSubject(); await hydrate();
  harness.stop(); __resetLocalDatabaseForTests();
  harness = sqliteHarness(path); sqlite.openDatabaseAsync.mockResolvedValue(harness.db); store = getLocalDatabase();
  expect((await store.listStateUpdateLatest(datedScope)).pagination.total).toBe(2);
  expect((await store.searchStateUpdateSubjects({ ...datedScope, sourceEntityTypeId: "diagnostic-procedures", search: "tolva" }))[0].current?.stateValues.find(value => value.fieldId === "revision")?.value).toBe("R1");
 });
});

const rawView = { id: scope.appViewId, type: "WORKFLOW", name: "Versionado", slug: "versions", icon: null, sortOrder: 0, config: { workflowKey: "state-update", sourceEntityTypeId: "diagnostic-procedures", targetEntityTypeId: scope.targetEntityTypeId } };
function rawResponse(uniqueness: unknown = { mode: "subject" }) {
 return { appView: { id: rawView.id, name: rawView.name, slug: rawView.slug }, workflow: { historyMode: "append", uniqueness, dateFieldId: "date", subjectFieldId: "subject-field" }, date: datedScope.date,
  subjectEntityType: { id: "diagnostic-procedures", name: "Procedimientos" }, targetEntityType: { id: scope.targetEntityTypeId, name: "Versionado" },
  stateFields: [], extraFields: [], subjects: [{ subject, current: tied[0] }], latest: { items: tied, pagination: { page: 1, pageSize: 20, total: 2, hasMore: false } }, summary: { totalRegistered: 2 } };
}
function realAdapter(uniqueness?: unknown) {
 return createOpcoApi({ apiUrl: "https://synthetic.test", fetcher: async () => new Response(JSON.stringify({ ok: true, data: rawResponse(uniqueness) }), { status: 200 }) });
}
describe("real Core uniqueness representation at API and SQLite cache boundaries", () => {
 it("normalizes the raw Core object through API, prewarm and cache into snapshot hydration", async () => {
  const api = realAdapter();
  const response = await api.getStateUpdateWorkflow("synthetic", scope.contractId, scope.appViewId);
  expect(response.uniqueness).toBe("subject");
  await prewarmAssignedAppViewsOnce({ api: { ...api, getEntityDefinition: async () => ({ entity: { id: "diagnostic-procedures", name: "Procedimientos", slug: "procedures", active: true, icon: null, fields: [] } }), getEntityRecords: async () => ({ records: [{ ...subject, updatedAt: "2026-10-04T00:00:00Z", values: {} }], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } }) } as any, appViews: [rawView] as any, contractId: scope.contractId, ownerKey: scope.ownerKey, store, token: "synthetic" });
  const prepared = await store.getAppViewDefinition(scope.ownerKey, scope.contractId, scope.appViewId);
  expect(prepared?.status).toBe("ready");
  expect(prepared?.definition).toMatchObject({ kind: "state-update", uniqueness: "subject" });
  expect((await store.listStateUpdateLatest(datedScope)).pagination.total).toBe(2);
  expect((await store.searchStateUpdateSubjects({ ...datedScope, sourceEntityTypeId: "diagnostic-procedures", search: "tolva" }))[0].current?.stateValues.find(value => value.fieldId === "revision")?.value).toBe("R1");
  expect((await store.getStateUpdateSnapshotCoverage(datedScope))?.status).toBe("complete");
 });
 it.each(["none", "subject", "subject-date"])("accepts historical string and Core object %s without inventing a mode", async mode => {
  expect((await realAdapter(mode).getStateUpdateWorkflow("synthetic", scope.contractId, scope.appViewId)).uniqueness).toBe(mode);
  expect((await realAdapter({ mode }).getStateUpdateWorkflow("synthetic", scope.contractId, scope.appViewId)).uniqueness).toBe(mode);
 });
 it.each([{ mode: "unknown" }, "unknown", {}, null, { mode: { mode: "subject" } }])("rejects invalid API uniqueness %j", async input => {
  await expect(realAdapter(input).getStateUpdateWorkflow("synthetic", scope.contractId, scope.appViewId)).rejects.toMatchObject({ code: "INVALID_STATE_UPDATE_UNIQUENESS" });
 });
 it("reads legacy cached object definitions without rewriting stored data, then hydrates separate events", async () => {
  await cacheSubject();
  const definition = { kind: "state-update", appView: rawView, dateFieldId: "date", historyMode: "append", uniqueness: { mode: "subject" }, sourceEntityTypeId: "diagnostic-procedures", targetEntityTypeId: scope.targetEntityTypeId, subjectFieldId: "subject-field", stateFields: [], extraFields: [] };
  await harness.db.runAsync("INSERT INTO app_view_definitions(owner_key,contract_id,app_view_id,app_view_type,workflow_key,definition_json,last_prepared_at,status) VALUES (?,?,?,'WORKFLOW','state-update',?,?,'ready')", scope.ownerKey, scope.contractId, scope.appViewId, JSON.stringify(definition), "2026-10-06T00:00:00Z");
  const before = await harness.db.getFirstAsync("SELECT definition_json FROM app_view_definitions");
  const prepared = await store.getAppViewDefinition(scope.ownerKey, scope.contractId, scope.appViewId);
  expect(prepared?.definition).toMatchObject({ uniqueness: "subject" });
  expect((await store.listAppViewDefinitions(scope.ownerKey, scope.contractId))[0].definition).toMatchObject({ uniqueness: "subject" });
  if (prepared?.definition.kind !== "state-update") throw new Error("Expected workflow definition");
  await store.upsertStateUpdateSnapshot({ ...scope, date: datedScope.date, dateFieldId: prepared.definition.dateFieldId, historyMode: prepared.definition.historyMode, uniqueness: prepared.definition.uniqueness, items: [{ subject, current: tied[0] }], latest: tied });
  expect((await store.listStateUpdateLatest(datedScope)).pagination.total).toBe(2);
  expect(await harness.db.getFirstAsync("SELECT definition_json FROM app_view_definitions")).toEqual(before);
 });
 it("returns a controlled cached configuration error for an unknown mode", async () => {
  const definition = { kind: "state-update", appView: rawView, uniqueness: { mode: "unknown" } };
  await harness.db.runAsync("INSERT INTO app_view_definitions(owner_key,contract_id,app_view_id,app_view_type,workflow_key,definition_json,last_prepared_at,status) VALUES (?,?,?,'WORKFLOW','state-update',?,?,'ready')", scope.ownerKey, scope.contractId, scope.appViewId, JSON.stringify(definition), "2026-10-06T00:00:00Z");
  expect(await store.getAppViewDefinition(scope.ownerKey, scope.contractId, scope.appViewId)).toMatchObject({ status: "error", definition: { kind: "error", errorCode: "INVALID_STATE_UPDATE_UNIQUENESS" } });
 });
});

describe("normalization and required snapshot content guards", () => {
 it.each(["none", "subject", "subject-date"])("normalizes the historical cached string and object %s on write/read", async mode => {
  for (const uniqueness of [mode, { mode }]) {
   await store.upsertAppViewDefinition({ appViewId: scope.appViewId, appViewType: "WORKFLOW", contractId: scope.contractId, ownerKey: scope.ownerKey, lastPreparedAt: "2026-10-06T00:00:00Z", status: "ready", definition: { kind: "state-update", appView: rawView, uniqueness, historyMode: "append", stateFields: [], extraFields: [], sourceEntityTypeId: "diagnostic-procedures", targetEntityTypeId: scope.targetEntityTypeId, subjectFieldId: "subject-field" } as any });
   expect((await store.getAppViewDefinition(scope.ownerKey, scope.contractId, scope.appViewId))?.definition).toMatchObject({ uniqueness: mode });
   const stored = await harness.db.getFirstAsync("SELECT definition_json FROM app_view_definitions");
   expect(JSON.parse(stored.definition_json).uniqueness).toBe(mode);
  }
 });
 it("normalizes a top-level historical object and rejects an invalid top-level mode despite valid workflow fallback", async () => {
  const read = (uniqueness: unknown) => createOpcoApi({ apiUrl: "https://synthetic.test", fetcher: async () => new Response(JSON.stringify({ ok: true, data: { ...rawResponse(), uniqueness } }), { status: 200 }) }).getStateUpdateWorkflow("synthetic", scope.contractId, scope.appViewId);
  expect((await read({ mode: "subject" })).uniqueness).toBe("subject");
  await expect(read({ mode: "unknown" })).rejects.toMatchObject({ code: "INVALID_STATE_UPDATE_UNIQUENESS" });
 });
 it("does not reconcile a claimed complete snapshot that is missing required remote events", async () => {
  await hydrate();
  const snapshotResult = await store.upsertStateUpdateSnapshot({ ...datedScope, complete: true, expectedRemoteEventCount: 2, items: [{ subject, current: tied[0] }], latest: [tied[0]] });
  expect(snapshotResult.contentVerified).toBe(false);
  expect((await store.listStateUpdateLatest(datedScope)).pagination.total).toBe(2);
  await store.markStateUpdateSnapshotCoverage({ ...datedScope, snapshotResult, pagination: { page: 1, pageSize: 20, total: 2, hasMore: false } });
  expect((await store.getStateUpdateSnapshotCoverage(datedScope))?.status).toBe("partial");
 });
 it("retains current's full state when latest repeats a sparse representation of the same event", async () => {
  await store.upsertStateUpdateSnapshot({ ...datedScope, items: [{ subject, current: { ...tied[0], extraValues: { detail: "synthetic-current-content" } } }], latest: [{ ...tied[0], stateValues: [] }, tied[1]] });
  const row = await harness.db.getFirstAsync("SELECT values_json FROM entity_records WHERE server_id='tie-a'");
  expect(JSON.parse(row.values_json)).toMatchObject({ extraValues: { detail: "synthetic-current-content" }, stateValues: tied[0].stateValues });
  expect((await store.listStateUpdateLatest(datedScope)).pagination.total).toBe(2);
 });
});
