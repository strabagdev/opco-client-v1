import { createReconnectSyncController } from "../state/reconnect-sync";
import { shouldRevalidateAssignedPreparation } from "../state/pending-work-lifecycle-logic";
// @ts-expect-error Node types are intentionally absent from Expo config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from Expo config.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { loadAppViewsWithCache } from "./app-navigation-cache";
import { invalidateHomePreparation, prewarmAssignedAppViewsOnce } from "./app-view-prewarm";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";
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
    getStateUpdateWorkflow: async (_t: string, _c: string, _v: string, q?: { subjectRecordId?: string; subjectRecordIds?: string[] }) => {
      requests.workflow++; if (q?.subjectRecordId || q?.subjectRecordIds) requests.current++;
      const captured = revision;
      if ((q?.subjectRecordId === subjects[0].id || q?.subjectRecordIds?.includes(subjects[0].id)) && hold) { const gate = hold; hold = null; gate.started(); await gate.wait; }
      const selected = subjects.filter(s => q?.subjectRecordIds?.includes(s.id) || s.id === q?.subjectRecordId);
      return { appView: stateView, date, dateFieldId: scope.dateFieldId, sourceEntityType: { id: scope.sourceEntityTypeId, name: "Synthetic source" }, targetEntityType: { id: scope.targetEntityTypeId, name: "Synthetic events" }, subjectFieldId: "subject", uniqueness: "subject", historyMode: "append", stateFields, extraFields: [],
        contractId:_c, currentBatchCapabilities: { version:1,maxSubjects:20,configurationFingerprint:"1".repeat(64) },
        ...(q?.subjectRecordIds ? { currentBatch: {version:1,requestedSubjectIds:q.subjectRecordIds,results:q.subjectRecordIds.map(subjectRecordId=>({subjectRecordId,status:"resolved"}))} } : {}),
        items: selected.map(s => ({ subject: s, current: event(subjects.indexOf(s), captured) })),
        latest: subjects.slice(0,20).map((s,n) => ({ ...event(n,captured), date, subject:s })), latestPagination: { page:1,pageSize:20,total:subjects.length,hasMore:true } } as StateUpdateResponse;
    },
    getAttendanceWorkflow: async (_t: string, _c: string, _v: string, q: { date: string }) => { requests.attendance++; return { date:q.date, items:[], latest:[], sourceEntityType:{id:scope.sourceEntityTypeId,name:"Synthetic source"},targetEntityType:{id:"synthetic-attendance-records",name:"Synthetic attendance"},statuses:[{optionId:"present",label:"Present",isDefaultCheckIn:true}],summary:{totalRegistered:0} }; },
  };
  return { api, requests, setRevision: (value: string) => { revision = value; }, holdFirst() { let release!: () => void, started!: () => void; const wait = new Promise<void>(resolve => { release=resolve; }); const entered = new Promise<void>(resolve => { started=resolve; }); hold={wait,started}; return { release, entered }; } };
}
async function drain() { for (let n=0;n<6;n++) { await store.getAppViews(ownerKey,contractId); await new Promise(resolve=>setTimeout(resolve,0)); if (!store.getSQLiteCoordinatorDiagnostics().waitingTotal && !store.getSQLiteCoordinatorDiagnostics().active) return; } throw new Error("SQLite did not drain"); }
async function protectIntent() {
 const input={...scope,subjectRecordId:subjects[1].id,subjectDisplayName:subjects[1].displayName,stateFields:[],stateValues:[{fieldId:"revision",value:"LOCAL"}],overwrite:true,expectedUpdatedAt:"2026-10-28T10:00:00Z"};
 const saved=await store.saveStateUpdateLocally(input);
 await db.runAsync("UPDATE entity_records SET sync_status='conflict' WHERE local_id=?",saved.localRecordId);
 return async()=>({ rows:await db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced' ORDER BY local_id"),outbox:await db.getAllAsync("SELECT * FROM pending_operations ORDER BY id") });
}

const runHome = async (f: ReturnType<typeof fixture>, extra = {}) => {
  const result = await loadAppViewsWithCache({ api:f.api, cache:store, ownerKey, contractId, token });
  await prewarmAssignedAppViewsOnce({ api:f.api as never, appViews:result.views, ownerKey, contractId, store, token,
    trigger:"home", homeListWrite:result.cacheWrite ?? undefined, reuseCompleted:true, ...extra });
};
function metric(name: string, value: unknown) {
  const output = (globalThis as {process?: {env?: Record<string,string|undefined>}}).process?.env?.OPCO_HOME_REUSE_METRICS_DIR;
  if (output) writeFileSync(output+"/"+name+".json",JSON.stringify(value,null,2));
}
async function measure(f: ReturnType<typeof fixture>, action: () => Promise<unknown>) {
  stats={sql:0,byKind:{},queuePeak:0};const before={...f.requests};const start=performance.now();
  await action();await drain();
  return {durationMs:performance.now()-start,requests:Object.fromEntries(Object.entries(f.requests).map(([k,v])=>[k,v-before[k as keyof typeof before]])),sqlite:{...stats,byKind:{...stats.byKind}},queueAfter:store.getSQLiteCoordinatorDiagnostics().waitingTotal};
}
it("compares entry, three unchanged reentries, live join and reconnect with batch current and offline reopen",async()=>{
  const f=fixture();const metrics: Record<string,Awaited<ReturnType<typeof measure>>> = {};
  metrics.entry=await measure(f,()=>runHome(f));const runId=(await store.getOfflinePreparationDiagnostics(ownerKey))?.runId;
  const pending=await protectIntent(),prior=await pending();
  metrics.reentries=await measure(f,async()=>{for(let n=0;n<3;n++)await runHome(f);});
  // A remote change has no push signal. A real reconnect/explicit invalidation must still revalidate it.
  f.setRevision("R2");metrics.reconnect=await measure(f,()=>runHome(f,{trigger:"reconnect",invalidationKey:"real-reconnect",reuseCompleted:false}));
  const value=async()=> (await store.searchStateUpdateSubjects({...scope,search:"Synthetic 000"}))[0].current?.stateValues.find(v=>v.fieldId==="revision")?.value;
  expect(await value()).toBe("R2");expect(await pending()).toEqual(prior);
  const coverage=await store.getStateUpdateCurrentCoverage(scope);expect(coverage?.status).toBe("complete");
  await reopen();expect(await value()).toBe("R2");expect(await store.getStateUpdateCurrentCoverage(scope)).toEqual(coverage);expect(await pending()).toEqual(prior);
  expect((await store.getAppViews(ownerKey,contractId))?.views).toHaveLength(2);expect(await db.getFirstAsync("PRAGMA integrity_check")).toEqual({integrity_check:"ok"});
  metric("navigation",{metrics,offlineReopen:true,pendingIntact:true,currentValue:"R2",coverage:"complete",latestCoverage:(await store.getStateUpdateSnapshotCoverage(scope))?.status,initialRunId:runId});
  expect(metrics.reentries.requests.current).toBe(0);expect(metrics.reentries.requests.attendance).toBe(0);expect(metrics.reentries.requests.views).toBe(3);
});
it("shares a live Home run and retains one trailing revalidation while invalidated",async()=>{
  const f=fixture(),held=f.holdFirst();const first=runHome(f);await held.entered;
  const joined=runHome(f);f.setRevision("R2");const again=runHome(f,{invalidationKey:"during-live",trigger:"reconnect"});
  held.release();await Promise.all([first,joined,again]);expect(f.requests.current).toBe(6);
  expect((await store.searchStateUpdateSubjects({...scope,search:"Synthetic 000"}))[0].current?.stateValues.find(v=>v.fieldId==="revision")?.value).toBe("R2");
});
it("reuses only the same day and session and does not reuse across users or contracts",async()=>{
  const f=fixture();await runHome(f);const before=f.requests.workflow;
  await prewarmAssignedAppViewsOnce({api:f.api as never,appViews:views,ownerKey:"other-owner",contractId,store,token,trigger:"home",reuseCompleted:true});
  await prewarmAssignedAppViewsOnce({api:f.api as never,appViews:views,ownerKey,contractId:"other-contract",store,token,trigger:"home",reuseCompleted:true});
  expect(f.requests.workflow).toBeGreaterThan(before);expect(await store.getAppViews("other-owner",contractId)).not.toBeNull();
});
it("a changed assignment definition refreshes only that experience and retains the other definition",async()=>{
  const f=fixture();await runHome(f);const before={...f.requests};const changed={...attendanceView,name:"Changed visible title"};
  await prewarmAssignedAppViewsOnce({api:f.api as never,appViews:[stateView,changed],ownerKey,contractId,store,token,trigger:"home",reuseCompleted:true});
  metric("definition",{current:f.requests.current-before.current,attendance:f.requests.attendance-before.attendance});
  expect(f.requests.current-before.current).toBe(0);expect(f.requests.attendance-before.attendance).toBeGreaterThan(0);
  expect((await store.getAppViewDefinition(ownerKey,contractId,stateView.id))?.status).toBe("ready");
  expect((await store.getAppViewDefinition(ownerKey,contractId,attendanceView.id))?.definition.appView.name).toBe(changed.name);
});
it("missing day coverage refreshes only Attendance without certifying absence as complete",async()=>{
  const f=fixture();await runHome(f);const before={...f.requests};
  await db.runAsync("DELETE FROM app_metadata WHERE key LIKE 'attendance_day_snapshot_hydration:%'");
  await runHome(f);metric("missing-day",{current:f.requests.current-before.current,attendance:f.requests.attendance-before.attendance});expect(f.requests.current-before.current).toBe(0);expect(f.requests.attendance-before.attendance).toBeGreaterThan(0);
});
it("a failure reading persisted proof cannot authorize reuse, and failed Home list writes stay explicit",async()=>{
  const f=fixture();await runHome(f);const before=f.requests.current;
  vi.spyOn(store,"getAppViewDefinition").mockRejectedValueOnce(Error("synthetic read failure"));await runHome(f);expect(f.requests.current).toBeGreaterThan(before);
  vi.spyOn(store,"upsertAppViews").mockRejectedValueOnce(Error("synthetic write failure"));await runHome(f);
  expect(await store.getOfflinePreparationDiagnostics(ownerKey)).toMatchObject({status:"failed",homeList:{status:"error"}});
});

it("a reconnect invalidation during work is retained without an artificial TTL or duplicate event keys",async()=>{
  const f=fixture(),held=f.holdFirst();const first=runHome(f);await held.entered;f.setRevision("R2");
  invalidateHomePreparation({store,ownerKey,contractId,token});
  const a=runHome(f),b=runHome(f);held.release();await Promise.all([first,a,b]);
  expect(f.requests.current).toBe(6);
  const before=f.requests.current;await runHome(f);expect(f.requests.current).toBe(before);
  expect((await store.searchStateUpdateSubjects({...scope,search:"Synthetic 000"}))[0].current?.stateValues.find(v=>v.fieldId==="revision")?.value).toBe("R2");
});
it("a local calendar rollover invalidates preparation and an offline reopen still reads the last complete copy",async()=>{
  const f=fixture();await runHome(f);const before=f.requests.attendance;
  const now=new Date(),next=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1,12);
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(next);
  try { await runHome(f);expect(f.requests.attendance).toBeGreaterThan(before); } finally {vi.useRealTimers();}
  await reopen();const cached=await store.getAppViews(ownerKey,contractId);expect(cached?.views).toHaveLength(2);
  const counts={...f.requests};let shown=false;
  const offline={...f.api,getAppViews:async()=>{throw new TypeError("synthetic offline");}};
  const result=await loadAppViewsWithCache({api:offline,cache:store,ownerKey,contractId,token,onCached:()=>{shown=true;}});
  expect(result.offline).toBe(true);expect(shown).toBe(true);expect(f.requests).toEqual(counts);
});
it("a new runtime never treats a persisted completed diagnostic as a freshness certificate",async()=>{
  const f=fixture();await runHome(f);await reopen();const before=f.requests.current;
  expect((await store.getOfflinePreparationDiagnostics(ownerKey))?.status).toBe("completed");
  f.setRevision("R2");await runHome(f);expect(f.requests.current).toBeGreaterThan(before);
  expect((await store.searchStateUpdateSubjects({...scope,search:"Synthetic 000"}))[0].current?.stateValues.find(v=>v.fieldId==="revision")?.value).toBe("R2");
});
it("an incomplete month retries only the affected experience and never upgrades its absent day proof",async()=>{
  const f=fixture(),get=f.api.getAttendanceWorkflow;
  f.api.getAttendanceWorkflow=async(...args)=>{if(args[3].date===date)throw new TypeError("synthetic day unavailable");return get(...args);};
  await runHome(f);const dayScope={ownerKey,contractId,appViewId:attendanceView.id,targetEntityTypeId:"synthetic-attendance-records",date};
  expect(await store.getAttendanceDaySnapshotHydration(dayScope)).toBeNull();const before={...f.requests};
  f.api.getAttendanceWorkflow=get;await runHome(f);expect(f.requests.current-before.current).toBe(0);expect(f.requests.attendance-before.attendance).toBeGreaterThan(0);
  expect((await store.getAttendanceDaySnapshotHydration(dayScope))?.lastSuccessfulRefreshAt).toBeTruthy();
});

it("does not confuse retained coverage with knowledge of an external write lacking a change signal",async()=>{
  const f=fixture();await runHome(f);f.setRevision("R2");const before=f.requests.current;
  await runHome(f);expect(f.requests.current).toBe(before);
  const value=async()=>(await store.searchStateUpdateSubjects({...scope,search:"Synthetic 000"}))[0].current?.stateValues.find(v=>v.fieldId==="revision")?.value;
  expect(await value()).toBe("R1"); // Valid offline copy, explicitly not a guarantee of current remote data.
  invalidateHomePreparation({store,ownerKey,contractId,token});await runHome(f);expect(await value()).toBe("R2");
});

it("removing an assignment reconciles definitions without consuming its conflict or outbox",async()=>{
  const f=fixture();await runHome(f);const pending=await protectIntent(),prior=await pending(),before=f.requests.current;
  await prewarmAssignedAppViewsOnce({api:f.api as never,appViews:[attendanceView],ownerKey,contractId,store,token,trigger:"home",reuseCompleted:true});
  expect(f.requests.current).toBe(before);expect(await pending()).toEqual(prior);
  expect((await store.getAppViews(ownerKey,contractId))?.views.map(view=>view.id)).toEqual([attendanceView.id]);
});

it("the existing reconnect controller refreshes once with zero writes and shares its work with Home",async()=>{
  const f=fixture();await runHome(f);expect(await store.countPendingOperations(ownerKey)).toBe(0);f.setRevision("R2");const before=f.requests.current;
  let complete!:()=>void,fail!:(error:unknown)=>void;const finished=new Promise<void>((resolve,reject)=>{complete=resolve;fail=reject;});let runs=0;
  const controller=createReconnectSyncController({debounceMs:1,
    shouldSync:async()=>shouldRevalidateAssignedPreparation("reconnect",false),
    runSync:async()=>{try{runs++;invalidateHomePreparation({store,ownerKey,contractId,token});
      await Promise.all([runHome(f,{trigger:"reconnect",invalidationKey:"real-controller",reuseCompleted:false}),runHome(f)]);complete();
    }catch(error){fail(error);throw error;}}
  });
  controller.handleConnectivityStatus("offline");controller.handleConnectivityStatus("online");await finished;
  controller.handleConnectivityStatus("online");await new Promise(resolve=>setTimeout(resolve,5));controller.dispose();
  expect(runs).toBe(1);expect(f.requests.current-before).toBe(3);expect(f.requests.writes).toBe(0);
  expect((await store.searchStateUpdateSubjects({...scope,search:"Synthetic 000"}))[0].current?.stateValues.find(v=>v.fieldId==="revision")?.value).toBe("R2");
  expect(shouldRevalidateAssignedPreparation("foreground/resume",false)).toBe(true);
  expect(shouldRevalidateAssignedPreparation("unknown-to-online",false)).toBe(false);
});
