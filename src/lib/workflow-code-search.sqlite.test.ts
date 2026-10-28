// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";
import type { AppView } from "./opco-api";
const sqlite = vi.hoisted(() => ({ openDatabaseAsync: vi.fn() }));
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
const scope = { ownerKey: "code-owner", contractId: "code-contract", appViewId: "code-view", targetEntityTypeId: "target", sourceEntityTypeId: "source", date: "2026-10-27", historyMode: "update-current" as const, uniqueness: "subject-date" as const };
const descriptor = { id: "stable-identifier", key: "identifier", name: "Identificador", type: "TEXT" as const };
const view: AppView = { id: scope.appViewId, type: "WORKFLOW", name: "Lectura ficticia", slug: "code", icon: null, sortOrder: 0, config: { workflowKey: "state-update", codeSearch: { fieldId: descriptor.id }, sourceEntityTypeId: "source", targetEntityTypeId: "target", subjectFieldId: "subject", dateFieldId: "date", stateFields: [], uniqueness: "subject-date", historyMode: "update-current" } };
let dir: string, harness: ReturnType<typeof sqliteHarness>, store: ReturnType<typeof getLocalDatabase>;
beforeEach(async () => { dir = mkdtempSync("/tmp/opco-code-field-"); __resetLocalDatabaseForTests(); harness = sqliteHarness(dir + "/db.sqlite"); sqlite.openDatabaseAsync.mockResolvedValue(harness.db); store = getLocalDatabase(); await store.getSelectedContractId(); await definition(); });
afterEach(() => { harness.stop(); __resetLocalDatabaseForTests(); rmSync(dir, { recursive: true, force: true }); });
async function reopen() { harness.stop(); __resetLocalDatabaseForTests(); harness = sqliteHarness(dir + "/db.sqlite"); sqlite.openDatabaseAsync.mockResolvedValue(harness.db); store = getLocalDatabase(); await store.getSelectedContractId(); }
async function definition(metadata = true, appView = view) { await store.upsertAppViewDefinition({ appViewId: appView.id, ownerKey: scope.ownerKey, contractId: scope.contractId, appViewType: "WORKFLOW", workflowKey: "state-update", status: "ready", lastPreparedAt: "2026-10-27T10:00:00Z", definition: { appView, kind: "state-update", sourceEntityTypeId: "source", targetEntityTypeId: "target", subjectFieldId: "subject", dateFieldId: "date", stateFields: [], extraFields: [], historyMode: "update-current", uniqueness: "subject-date", ...(metadata ? { codeSearchField: descriptor } : {}) } }); }
async function seed() {
 await store.upsertRemoteRecords({ ...scope, entityTypeId: "source", records: [
  { id: "a", displayName: "Nombre de persona ficticia A", updatedAt: "2026-10-27T10:00:00Z", values: { identifier: "00.123.450-K", another: "not-used" } },
  { id: "b", displayName: "Nombre de persona ficticia B", updatedAt: "2026-10-27T10:00:00Z", values: { identifier: "00.123.450-k" } },
  { id: "c", displayName: "00.123.450-K", updatedAt: "2026-10-27T10:00:00Z", values: { identifier: "different", another: "00.123.450-K" } },
  { id: "d", displayName: "Sin dato", updatedAt: "2026-10-27T10:00:00Z", values: { identifier: null } },
 ] });
}
const search = (query: string, overrides = {}) => store.searchStateUpdateSubjects({ ...scope, search: query, searchFieldId: descriptor.id, ...overrides });
it("uses only the configured field with insensitive literal substring after reopening, returning multiple results", async () => {
 await seed(); await reopen(); expect((await search(" 00.123.450-k ")).map(item => item.subject.id).sort()).toEqual(["a", "b"]);
 expect(await search("00123450K")).toEqual([]); expect(await search("nonexistent")).toEqual([]);
 expect((await store.searchStateUpdateSubjects({ ...scope, search: "00.123.450-k" })).map(item => item.subject.id)).toContain("c");
});
it("does not silently use global search with old metadata, another view, user, contract or unconfigured field", async () => {
 await seed();
 for (const overrides of [{ appViewId: "other-view" }, { ownerKey: "other-owner" }, { contractId: "other-contract" }, { searchFieldId: "foreign" }]) await expect(search("00.123.450-K", overrides)).rejects.toMatchObject({ code: "CODE_SEARCH_CACHE_UNAVAILABLE" });
 await definition(false); await reopen(); await expect(search("00.123.450-K")).rejects.toMatchObject({ code: "CODE_SEARCH_CACHE_UNAVAILABLE" });
 expect(await store.searchStateUpdateSubjects({ ...scope, search: "Nombre" })).toHaveLength(2);
});
it("reports absent cached field values instead of pretending no matches", async () => {
 await store.upsertRemoteRecords({ ...scope, entityTypeId: "source", records: [{ id: "old", displayName: "Old cache", values: {}, updatedAt: "2026-10-27T10:00:00Z" }] });
 await expect(search("Old")).rejects.toMatchObject({ code: "CODE_SEARCH_CACHE_UNAVAILABLE" });
});
it("filters latest by the same source field and leaves durable intent, authorization and conflicts untouched after reopen", async () => {
 await seed(); const created = await store.saveStateUpdateLocally({ ...scope, subjectRecordId: "a", subjectDisplayName: "Nombre de persona ficticia A", stateFields: [], stateValues: [{ fieldId: "status", optionId: "local" }], extraValues: {}, overwrite: true, expectedUpdatedAt: "2026-10-27T08:00:00Z" });
 const operation = (await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
 await store.markStateUpdateOperationConflict(operation, { result: "CONFLICT", subjectRecordId: "a", requested: { stateValues: [] }, existing: { recordId: "remote-a", updatedAt: "2026-10-27T11:00:00Z", stateValues: [{ fieldId: "status", optionId: "remote", label: "Remoto" }] } });
 const before = await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id"); await reopen();
 const items = await search("00.123.450-K"); expect(items.find(item => item.subject.id === "a")?.current).not.toBeNull();
 const latest = await store.listStateUpdateLatest({ ...scope, search: "00.123.450-K", searchFieldId: descriptor.id }); expect(latest.items.map(item => item.subject?.id)).toContain("a");
 expect(await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")).toEqual(before);
 expect((await store.listStateUpdateConflicts(scope))[0].localRecordId).toBe(created.localRecordId);
 expect(JSON.parse(before[0].payload_json)).toMatchObject({ overwrite: true, expectedUpdatedAt: "2026-10-27T08:00:00Z" });
});
it("keeps compound contexts and another context's pending command independent during a field search", async () => {
 await seed();
 const identity = { version: 1 as const, definitionId: "code-definition", values: { context: "A" } };
 const identityB = { ...identity, values: { context: "B" } };
 const compound = { ...scope, dateFieldId: "date", uniqueness: "subject-date-fields" as const, identity };
 const compoundB = { ...compound, identity: identityB };
 const compoundView = { ...view, config: { ...view.config, uniqueness: { mode: "subject-date-fields", definitionId: identity.definitionId, identityVersion: 1, fieldIds: ["context"] } } } as AppView;
 await definition(true, compoundView);
 const subject = { id: "a", displayName: "Persona ficticia A" };
 for (const [input, id] of [[compound, "report-A"], [compoundB, "report-B"]] as const) {
  const current = { recordId: id, updatedAt: "2026-10-27T08:00:00.000Z", stateValues: [] };
  await store.upsertStateUpdateSnapshot({ ...input, items: [{ subject, current }], latest: [{ ...current, subject, date: scope.date }] });
 }
 await store.saveStateUpdateLocally({ ...compoundB, subjectRecordId: "b", subjectDisplayName: "Persona ficticia B", stateFields: [], stateValues: [], extraValues: {}, overwrite: true, expectedUpdatedAt: "2026-10-27T08:00:00.000Z" });
 const before = await store.listPendingStateUpdateOperations(scope.ownerKey); await reopen();
 for (const [input, id] of [[compound, "report-A"], [compoundB, "report-B"]] as const) {
  const found = await store.searchStateUpdateSubjects({ ...input, search: "00.123.450-K", searchFieldId: descriptor.id });
  const current = found.find(item => item.subject.id === "a")?.current;
  expect(current).toBeTruthy();
  const record = await store.getCachedRecord({ ...input, entityTypeId: "target", recordId: current!.recordId });
  expect(record?.serverId).toBe(id);
 }
 expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toEqual(before);
});
