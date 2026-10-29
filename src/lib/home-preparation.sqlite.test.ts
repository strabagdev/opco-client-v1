// @ts-expect-error Node types are intentionally absent from Expo config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from Expo config.
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import ts from "typescript";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { loadAppViewsWithCache } from "./app-navigation-cache";
import { prewarmAssignedAppViewsOnce } from "./app-view-prewarm";
import { subscribeHomeOfflineAvailabilityRefresh } from "./home-offline-availability-refresh";
import { getLocalDatabase, __resetLocalDatabaseForTests, subscribeLocalDatabaseCacheChanges } from "./local-db";
import { buildStateUpdateCoverageScope, deriveOfflineAvailability } from "./app-view-definitions-cache";
import { currentMonthDateKeys, deriveAttendanceMonthStatus } from "./attendance-snapshot-cache";
import type { AppView, StateUpdateResponse, EntityDefinition } from "./opco-api";
const sqlite = vi.hoisted(() => ({ openDatabaseAsync: vi.fn() }));
vi.mock("expo-sqlite", () => sqlite);
let store: ReturnType<typeof getLocalDatabase>;
let stats = { sql: 0, byKind: {} as Record<string, number>, queuePeak: 0 };
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

let directory: string, db: ReturnType<typeof sqliteFile>;
const ownerKey = "synthetic-org:synthetic-user", contractId = "synthetic-contract", token = "synthetic";
function localDate() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
const date = localDate();
const stateView = { id: "synthetic-versions", name: "Synthetic versions", slug: "synthetic-versions", type: "WORKFLOW", icon: null, sortOrder: 0, config: { workflowKey: "state-update", dateFieldId: "event-date" } } as AppView;
const attendanceView = { id: "synthetic-attendance", name: "Synthetic attendance", slug: "synthetic-attendance", type: "WORKFLOW", icon: null, sortOrder: 1, config: { workflowKey: "attendance", personFieldId: "person", dateFieldId: "day", statusFieldId: "status" } } as AppView;
const views = [stateView, attendanceView];
const scope = { ownerKey, contractId, appViewId: stateView.id, sourceEntityTypeId: "synthetic-source", targetEntityTypeId: "synthetic-events", date, dateFieldId: "event-date", uniqueness: "subject" as const, historyMode: "append" as const };
const subjects = Array.from({ length: 48 }, (_, n) => ({ id: `synthetic-${String(n).padStart(3,"0")}`, displayName: `Synthetic ${String(n).padStart(3,"0")}` }));
const stateFields = [{ fieldId: "revision", label: "Revision", type: "TEXT", required: false, options: [] }, { fieldId: "event-date", label: "Date", type: "DATE", required: false, options: [] }] as StateUpdateResponse["stateFields"];
async function open() { __resetLocalDatabaseForTests(); db = sqliteFile(directory + "/opco-client-v10-epoch2.db"); sqlite.openDatabaseAsync.mockResolvedValue(db); store = getLocalDatabase(); await store.getSelectedContractId(); }
async function reopen() { await db.closeAsync(); await open(); }
beforeEach(async () => { directory = mkdtempSync("/tmp/opco-home-flight-"); await open(); stats = { sql: 0, byKind: {}, queuePeak: 0 }; });
afterEach(async () => { await db.closeAsync(); __resetLocalDatabaseForTests(); rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  let revision = "R1", hold: { started(): void; wait: Promise<void> } | null = null;
  const requests = { views: 0, definition: 0, source: 0, workflow: 0, current: 0, attendance: 0, writes: 0 };
  const event = (n: number, rev: string) => ({ recordId: `event-${n}`, updatedAt: "2026-10-28T10:00:00Z", stateValues: [{ fieldId: "revision", value: rev, label: rev, optionId: null }, { fieldId: "event-date", value: date, label: date, optionId: null }] });
  const api = {
    getAppViews: async () => { requests.views++; await new Promise(resolve => setTimeout(resolve, 0)); return { views }; },
    getEntityDefinition: async () => { requests.definition++; return { entity: { id: scope.sourceEntityTypeId, name: "Synthetic source", slug: "synthetic-source", active: true, icon: null, fields: [] } as EntityDefinition }; },
    getEntityRecords: async (_t: string, _c: string, _e: string, q: { page: number; pageSize: number }) => { requests.source++; return { records: subjects.slice((q.page-1)*q.pageSize, q.page*q.pageSize).map(s => ({ ...s, updatedAt: "2026-10-28T09:00:00Z", values: {} })), pagination: { ...q, total: subjects.length, totalPages: Math.ceil(subjects.length / q.pageSize) } }; },
    getStateUpdateWorkflow: async (_t: string, _c: string, _v: string, q?: { subjectRecordId?: string }) => {
      requests.workflow++; if (q?.subjectRecordId) requests.current++;
      const captured = revision;
      if (q?.subjectRecordId === subjects[0].id && hold) { const gate = hold; hold = null; gate.started(); await gate.wait; }
      const selected = q?.subjectRecordId ? subjects.filter(s => s.id === q.subjectRecordId) : [];
      return { appView: stateView, date, dateFieldId: scope.dateFieldId, sourceEntityType: { id: scope.sourceEntityTypeId, name: "Synthetic source" }, targetEntityType: { id: scope.targetEntityTypeId, name: "Synthetic events" }, subjectFieldId: "subject", uniqueness: "subject", historyMode: "append", stateFields, extraFields: [],
        items: selected.map(s => ({ subject: s, current: event(subjects.indexOf(s), captured) })),
        latest: subjects.slice(0,20).map((s,n) => ({ ...event(n,captured), date, subject:s })), latestPagination: { page:1,pageSize:20,total:subjects.length,hasMore:true } } as StateUpdateResponse;
    },
    getAttendanceWorkflow: async (_t: string, _c: string, _v: string, q: { date: string }) => { requests.attendance++; return { date:q.date, items:[], latest:[], sourceEntityType:{id:scope.sourceEntityTypeId,name:"Synthetic source"},targetEntityType:{id:"synthetic-attendance-records",name:"Synthetic attendance"},statuses:[{optionId:"present",label:"Present",isDefaultCheckIn:true}],summary:{totalRegistered:0} }; },
  };
  return { api, requests, setRevision: (value: string) => { revision = value; }, holdFirst() { let release!: () => void, started!: () => void; const wait = new Promise<void>(resolve => { release=resolve; }); const entered = new Promise<void>(resolve => { started=resolve; }); hold={wait,started}; return { release, entered }; } };
}
// Execute the real Home availability callback, not a reduced copy of its SQL reads.
function availabilityReader() {
  const source = ts.createSourceFile("Home.tsx", readFileSync("app/(app)/index.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = "";
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === "refreshOfflineAvailability" && node.initializer && ts.isCallExpression(node.initializer)) expression=node.initializer.arguments[0].getText(source); ts.forEachChild(node, visit); }; visit(source);
  expect(expression).toBeTruthy();
  const js = ts.transpile("const read = " + expression, { target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.None });
  let readCount = 0;
  const read = new Function("definitionCache","selectedContractId","ownerKey","today","currentMonthDates","deriveAttendanceMonthStatus","buildStateUpdateCoverageScope","deriveOfflineAvailability","setOfflineAvailabilityByViewId",js+";return read;")(store,contractId,ownerKey,date,currentMonthDateKeys(new Date()),deriveAttendanceMonthStatus,buildStateUpdateCoverageScope,deriveOfflineAvailability,()=>{}) as (views:AppView[], canUpdate:()=>boolean)=>Promise<void>;
  return { count:()=>readCount, refresh: async (canUpdate:()=>boolean) => { readCount++; await read(views,canUpdate); } };
}
async function drain() { for (let n=0;n<6;n++) { await store.getAppViews(ownerKey,contractId); await new Promise(resolve=>setTimeout(resolve,0)); if (!store.getSQLiteCoordinatorDiagnostics().waitingTotal && !store.getSQLiteCoordinatorDiagnostics().active) return; } throw new Error("SQLite did not drain"); }
async function protectIntent() {
 const input={...scope,subjectRecordId:subjects[1].id,subjectDisplayName:subjects[1].displayName,stateFields:[],stateValues:[{fieldId:"revision",value:"LOCAL"}],overwrite:true,expectedUpdatedAt:"2026-10-28T10:00:00Z"};
 const saved=await store.saveStateUpdateLocally(input);
 await db.runAsync("UPDATE entity_records SET sync_status='conflict' WHERE local_id=?",saved.localRecordId);
 return async()=>({ rows:await db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced' ORDER BY local_id"),outbox:await db.getAllAsync("SELECT * FROM pending_operations ORDER BY id") });
}
function saveMetric(name: string, metric: unknown) {
 const output = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.OPCO_HOME_PREPARATION_METRICS_DIR;
 if (!output) return;
 const file = output + "/" + (readFileSync("src/lib/app-view-prewarm.ts","utf8").includes("seenInvalidations") ? "candidate" : "head") + "-metrics.json";
 const previous = existsSync(file) ? JSON.parse(readFileSync(file,"utf8")) : {}; previous[name]=metric; writeFileSync(file,JSON.stringify(previous,null,2)+"\n");
}
it.each(["entry", "reentry", "reconnect", "invalidation-during-preparation"])("compares %s with real SQLite, pending protection and offline reopen", async scenario => {
 const f=fixture();
 const run=(extra={})=>prewarmAssignedAppViewsOnce({api:f.api as any,appViews:views,ownerKey,contractId,store,token,trigger:"home",...extra});
 if (scenario!=="entry") await run();
 const pending=await protectIntent(),before=await pending();
 const reader=availabilityReader(); const stop=subscribeHomeOfflineAvailabilityRefresh({refresh:reader.refresh,subscribe:subscribeLocalDatabaseCacheChanges});
 stats={sql:0,byKind:{},queuePeak:0}; const countsBefore={...f.requests}; const started=performance.now();
 if(scenario==="entry") {
   const reads=await Promise.all([loadAppViewsWithCache({api:f.api,cache:store,ownerKey,contractId,token}),loadAppViewsWithCache({api:f.api,cache:store,ownerKey,contractId,token})]);
   await Promise.all(reads.map(r=>prewarmAssignedAppViewsOnce({api:f.api as any,appViews:r.views,ownerKey,contractId,store,token,homeListWrite:r.cacheWrite??undefined,trigger:"home"})));
 } else if(scenario==="invalidation-during-preparation") {
   const initial = await loadAppViewsWithCache({api:f.api,cache:store,ownerKey,contractId,token});
   const held=f.holdFirst(),first=run({homeListWrite:initial.cacheWrite??undefined}); await held.entered; f.setRevision("R2");
   const repeated = await Promise.all([0,1].map(() => loadAppViewsWithCache({api:f.api,cache:store,ownerKey,contractId,token,invalidationKey:"synthetic-real-event"})));
   const next = repeated.map(result => run({trigger:"reconnect",invalidationKey:"synthetic-real-event",homeListWrite:result.cacheWrite??undefined}));
   held.release(); await Promise.all([first,...next]);
 } else {
   f.setRevision("R2");
   const invalidationKey = scenario === "reconnect" ? "synthetic-reconnect" : undefined;
   const result = await loadAppViewsWithCache({api:f.api,cache:store,ownerKey,contractId,token,invalidationKey});
   await run({trigger: scenario === "reconnect" ? "reconnect" : "home",invalidationKey,homeListWrite:result.cacheWrite??undefined});
 }
 await drain(); stop(); await drain(); const elapsed=performance.now()-started;
 const afterRequests=Object.fromEntries(Object.entries(f.requests).map(([k,v])=>[k,v-countsBefore[k as keyof typeof countsBefore]]));
 const measured={durationMs:Math.round(elapsed*1000)/1000,requests:afterRequests,sqlite:{...stats,byKind:{...stats.byKind}},availabilityPasses:reader.count(),queueAfter:store.getSQLiteCoordinatorDiagnostics().waitingTotal};
 expect(await pending()).toEqual(before);
 const coverage=await store.getStateUpdateCurrentCoverage(scope); expect(coverage).toMatchObject({status:"complete",sourceComplete:true,totalSubjects:48,requestCount:48});
 expect(await store.getStateUpdateSnapshotCoverage(scope)).toMatchObject({status:"partial",pageSize:20,total:48});
 expect((await store.getAttendanceDaySnapshotHydration({ownerKey,contractId,appViewId:attendanceView.id,targetEntityTypeId:"synthetic-attendance-records",date}))?.lastSuccessfulRefreshAt).toBeTruthy();
 const find=async()=> (await store.searchStateUpdateSubjects({...scope,search:"Synthetic 000"}))[0].current?.stateValues.find(v=>v.fieldId==="revision")?.value;
 const value=await find(); await reopen(); expect(await find()).toBe(value); expect(await pending()).toEqual(before); expect(await store.getStateUpdateCurrentCoverage(scope)).toEqual(coverage); expect((await store.getAppViews(ownerKey,contractId))?.views.map(v=>v.id)).toEqual(views.map(v=>v.id));
 expect(await db.getFirstAsync("PRAGMA integrity_check")).toEqual({integrity_check:"ok"});
 saveMetric(scenario,{...measured,offlineReopen:true,pendingRowsAndOutboxIntact:true,currentValueAfterReopen:value,currentCoverage:coverage?.status,latestCoverage:"partial",integrity:"ok"});
 if (scenario !== "entry") expect(value).toBe("R2");
 expect(measured.queueAfter).toBe(0);
});
