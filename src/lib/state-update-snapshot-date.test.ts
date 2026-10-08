// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";
import { prewarmAssignedAppViewsOnce } from "./app-view-prewarm";
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
const fields = [{
  fieldId: "revision",
  label: "Revisión",
  name: "revision",
  type: "TEXT",
  required: false,
  options: []
}, {
  fieldId: "status",
  label: "Estatus",
  name: "status",
  type: "SELECT",
  required: true,
  options: [{
    optionId: "valid",
    value: "VALID",
    label: "Validado sintético"
  }]
}, {
  fieldId: "date",
  label: "Fecha",
  name: "date",
  type: "DATE",
  required: false,
  options: []
}];
const view = {
  id: scope.appViewId,
  name: "Versionado sintético",
  slug: "diagnostic",
  type: "WORKFLOW",
  icon: null,
  sortOrder: 0,
  config: {
    workflowKey: "state-update",
    sourceEntityTypeId: "diagnostic-procedures",
    targetEntityTypeId: scope.targetEntityTypeId,
    subjectFieldId: "subject",
    dateFieldId: "date",
    uniqueness: "subject",
    historyMode: "append",
    stateFields: fields.map(f => ({
      fieldId: f.fieldId,
      required: f.required
    })),
    extraFieldIds: []
  }
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
const current = {
  recordId: latest[0].recordId,
  updatedAt: latest[0].updatedAt,
  stateValues: latest[0].stateValues
};
const pagination = {
  hasMore: false,
  page: 1,
  pageSize: 20,
  total: 2
};
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
async function priorSnapshot() {
  await store.upsertStateUpdateSnapshot({
    ...scope,
    date: "2026-10-04",
    items: [],
    latest,
    complete: true
  });
}
function response(date: string) {
  return {
    appView: view,
    date,
    dateFieldId: "date",
    extraFields: [],
    historyMode: "append",
    uniqueness: "subject",
    subjectFieldId: "subject",
    sourceEntityType: {
      id: "diagnostic-procedures",
      name: "Procedimientos"
    },
    targetEntityType: {
      id: scope.targetEntityTypeId,
      name: "Versionado"
    },
    stateFields: fields,
    items: [],
    latest,
    latestPagination: pagination,
    summary: {
      totalRegistered: 0
    }
  };
}
async function concurrentSearch(date: string) {
  let release: any, reached: any;
  const gate = new Promise<void>(r => {
    release = r;
  });
  const started = new Promise<void>(r => {
    reached = r;
  });
  const api: any = {
    getAttendanceWorkflow: vi.fn(),
    getStateUpdateWorkflow: vi.fn(async (_t, _c, _v, q) => {
      reached();
      await gate;
      return { ...response(q.date), items: q.subjectRecordId ? [{ subject, current }] : [] };
    }),
    getEntityDefinition: vi.fn(async () => ({
      entity: {
        active: true,
        id: "diagnostic-procedures",
        name: "Procedimientos",
        slug: "procedures",
        icon: null,
        fields: []
      }
    })),
    getEntityRecords: vi.fn(async () => ({
      records: [{
        ...subject,
        updatedAt: "2026-10-04T08:00:00Z",
        values: {}
      }],
      pagination: {
        page: 1,
        pageSize: 100,
        total: 1,
        totalPages: 1
      }
    }))
  };
  const preparation = prewarmAssignedAppViewsOnce({
    api,
    appViews: [view] as any,
    contractId: scope.contractId,
    ownerKey: scope.ownerKey,
    store,
    token: "synthetic"
  });
  await started;
  const active = await store.getOfflinePreparationDiagnostics(scope.ownerKey);
  expect(active?.status).toBe("running");
  let primary: any = null,
    failedStatement: any = null;
  const run = harness.db.runAsync.getMockImplementation()!;
  harness.db.runAsync.mockImplementation(async (sql: string, ...args: unknown[]) => {
    try {
      return await run(sql, ...args);
    } catch (e) {
      failedStatement = {
        insertEntityRecords: sql.includes("INSERT INTO entity_records"),
        conflictLocalId: sql.includes("ON CONFLICT(local_id)")
      };
      throw e;
    }
  });
  try {
    await store.upsertStateUpdateSnapshot({
      ...scope,
      date,
      dateFieldId: "date",
      items: [{
        subject,
        current
      }],
      latest,
      complete: false
    });
  } catch (e) {
    primary = e;
  }
  const failures = store.getSQLiteCoordinatorDiagnostics().recent.filter((o: any) => o.status === "error");
  release();
  await preparation;
  const terminal = await store.getOfflinePreparationDiagnostics(scope.ownerKey);
  return {
    primary,
    terminal,
    failures,
    failedStatement
  };
}
describe("STATE_UPDATE event date snapshot identity", () => {
  it("same logical date: real SQLite succeeds while preparation is active", async () => {
    await priorSnapshot();
    const result = await concurrentSearch("2026-10-04");
    expect(result.primary).toBe(null);
    expect(result.terminal?.status).toBe("completed");
    expect(await harness.db.getFirstAsync("SELECT COUNT(*) AS total FROM entity_records WHERE entity_type_id=?", scope.targetEntityTypeId)).toEqual({
      total: 2
    });
  });
  it("different query date: search reuses the dated event row while preparation succeeds", async () => {
    await priorSnapshot();
    const before = await harness.db.getAllAsync("SELECT local_id,server_id,values_json FROM entity_records ORDER BY local_id");
    const result = await concurrentSearch("2026-10-06");
    expect(result.primary).toBe(null);
    expect(result.terminal?.status).toBe("completed");
    const after = await harness.db.getAllAsync("SELECT local_id,server_id,values_json FROM entity_records WHERE entity_type_id=? ORDER BY local_id", scope.targetEntityTypeId);
    expect(after).toEqual(before);
    expect(result.failures).toEqual([]);
    expect((await store.getStateUpdateSnapshotCoverage({
      ...scope,
      date: "2026-10-06"
    }))?.status).toBe("complete");
    expect((await concurrentSearch("2026-10-06")).primary).toBe(null);
  });
  it("uses configured event date even when current is absent from the latest page", async () => {
    await priorSnapshot();
    await store.upsertStateUpdateSnapshot({
      ...scope,
      date: "2026-10-06",
      dateFieldId: "date",
      items: [{
        subject,
        current
      }],
      latest: [latest[1]]
    });
    const cached = await harness.db.getAllAsync("SELECT server_id, values_json FROM entity_records WHERE entity_type_id=?", scope.targetEntityTypeId);
    expect(cached).toHaveLength(2);
    expect(JSON.parse(cached.find((row: any) => row.server_id === current.recordId).values_json).date).toBe("2026-10-04");
  });
  it("repairs a synced row previously dated by query without changing its local identity", async () => {
    await store.upsertStateUpdateSnapshot({
      ...scope,
      date: "2026-10-06",
      items: [{
        subject,
        current
      }]
    });
    const before = await harness.db.getFirstAsync("SELECT local_id FROM entity_records WHERE server_id=?", current.recordId);
    await store.upsertStateUpdateSnapshot({
      ...scope,
      date: "2026-10-06",
      dateFieldId: "date",
      items: [{
        subject,
        current
      }],
      latest
    });
    const after = await harness.db.getFirstAsync("SELECT local_id,values_json FROM entity_records WHERE server_id=?", current.recordId);
    expect(after.local_id).toBe(before.local_id);
    expect(JSON.parse(after.values_json).date).toBe("2026-10-04");
    expect(await harness.db.getFirstAsync("SELECT COUNT(*) AS total FROM entity_records WHERE entity_type_id=?", scope.targetEntityTypeId)).toEqual({
      total: 2
    });
  });
  it("preserves separate append intentions, conflict and failed rows across repeated snapshots", async () => {
    const input = {
      ...scope,
      date: "2026-10-06",
      subjectRecordId: subject.id,
      subjectDisplayName: subject.displayName,
      historyMode: "append" as const,
      uniqueness: "subject" as const,
      stateFields: [],
      stateValues: [{
        fieldId: "revision",
        value: "pending"
      }]
    };
    const first = await store.saveStateUpdateLocally(input),
      second = await store.saveStateUpdateLocally(input);
    await store.saveStateUpdateLocally(input);
    await harness.db.runAsync("UPDATE entity_records SET sync_status='conflict' WHERE local_id=?", first.localRecordId);
    await harness.db.runAsync("UPDATE entity_records SET sync_status='failed' WHERE local_id=?", second.localRecordId);
    const intentRows = await harness.db.getAllAsync("SELECT * FROM entity_records WHERE sync_status<>'synced' ORDER BY local_id");
    const pending = await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id");
    for (let i = 0; i < 2; i++) await store.upsertStateUpdateSnapshot({
      ...scope,
      date: "2026-10-06",
      dateFieldId: "date",
      items: [{
        subject,
        current
      }],
      latest,
      complete: true
    });
    expect(await harness.db.getAllAsync("SELECT * FROM entity_records WHERE sync_status<>'synced' ORDER BY local_id")).toEqual(intentRows);
    expect(await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")).toEqual(pending);
    expect(first.localRecordId).not.toBe(second.localRecordId);
  });
  it("rolls back a failed snapshot and preserves every pending row", async () => {
    await priorSnapshot();
    await store.saveStateUpdateLocally({
      ...scope,
      date: "2026-10-06",
      subjectRecordId: subject.id,
      subjectDisplayName: subject.displayName,
      historyMode: "append",
      uniqueness: "subject",
      stateFields: [],
      stateValues: []
    });
    const before = await harness.db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id");
    const outbox = await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id");
    const run = harness.db.runAsync.getMockImplementation()!;
    let inserts = 0;
    harness.db.runAsync.mockImplementation((sql: string, ...args: unknown[]) => {
      if (sql.includes("INSERT INTO entity_records") && ++inserts === 2) throw new Error("synthetic second insert failure");
      return run(sql, ...args);
    });
    await expect(store.upsertStateUpdateSnapshot({
      ...scope,
      date: "2026-10-06",
      dateFieldId: "date",
      items: [{
        subject,
        current
      }],
      latest
    })).rejects.toThrow("synthetic second insert failure");
    expect(await harness.db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id")).toEqual(before);
    expect(await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")).toEqual(outbox);
  });
  it("reopens the dated snapshot and searches offline without creating another event row", async () => {
    harness.stop();
    __resetLocalDatabaseForTests();
    temporaryDirectory = mkdtempSync("/tmp/opco-snapshot-test-");
    const path = temporaryDirectory + "/local.sqlite";
    harness = sqliteHarness(path);
    sqlite.openDatabaseAsync.mockResolvedValue(harness.db);
    store = getLocalDatabase();
    await store.getSelectedContractId();
    await priorSnapshot();
    await concurrentSearch("2026-10-06");
    harness.stop();
    __resetLocalDatabaseForTests();
    harness = sqliteHarness(path);
    sqlite.openDatabaseAsync.mockResolvedValue(harness.db);
    store = getLocalDatabase();
    await store.getSelectedContractId();
    const result = await store.searchStateUpdateSubjects({
      ...scope,
      date: "2026-10-04",
      sourceEntityTypeId: "diagnostic-procedures",
      search: "tolva"
    });
    expect(result[0].current?.stateValues.find(value => value.fieldId === "revision")?.value).toBe("R1");
    expect((await store.listStateUpdateLatest({
      ...scope,
      date: "2026-10-04",
      page: 1,
      pageSize: 20,
      search: "tolva"
    })).items).toHaveLength(1);
    expect(await harness.db.getFirstAsync("SELECT COUNT(*) AS total FROM entity_records WHERE entity_type_id=?", scope.targetEntityTypeId)).toEqual({
      total: 2
    });
  });
});
