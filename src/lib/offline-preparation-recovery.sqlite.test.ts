// Runtime regressions: synthetic API streams and real sqlite3 file, including close/reopen.
// @ts-expect-error Node types intentionally absent from Expo application config.
import {spawn} from "node:child_process";
// @ts-expect-error Node types intentionally absent from Expo application config.
import {mkdtempSync,rmSync} from "node:fs";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {getLocalDatabase,__resetLocalDatabaseForTests} from "./local-db";
import {prewarmAssignedAppViewsOnce,offlinePreparationScopeKey,reconcileOfflinePreparation,subscribeOfflinePreparationExecution,getOfflinePreparationExecution,type OfflinePreparationDiagnostics,type OfflinePreparationExecution} from "./app-view-prewarm";
import {createOpcoApi,type AppView} from "./opco-api";
let store:ReturnType<typeof getLocalDatabase>;
const stats={sql:0,byKind:{} as Record<string,number>,queuePeak:0};
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

let directory:string,db:ReturnType<typeof sqliteFile>;
const ownerKey="diagnostic-owner",contractId="diagnostic-contract",token="synthetic";
async function open(){__resetLocalDatabaseForTests();db=sqliteFile(directory+"/opco-client-v10-epoch2.db");sqlite.openDatabaseAsync.mockResolvedValue(db);store=getLocalDatabase();await store.getSelectedContractId();}
const sqlite=vi.hoisted(()=>({openDatabaseAsync:vi.fn()}));vi.mock("expo-sqlite",()=>sqlite);
beforeEach(async()=>{directory=mkdtempSync("/tmp/opco-preparation-interruption-");await open();});
afterEach(async()=>{vi.useRealTimers();await db.closeAsync();__resetLocalDatabaseForTests();rmSync(directory,{recursive:true,force:true});});


function fixture(hold=true){
 const views=Array.from({length:13},(_,i)=>({id:"diagnostic-view-"+i,name:"Synthetic experience "+i,slug:"diagnostic-"+i,type:"RECORDS",icon:null,sortOrder:i,config:{entityTypeId:"diagnostic-entity-"+i}} as AppView));
 const bodies=new Map<number,ReadableStreamDefaultController<Uint8Array>>();const requests:string[]=[];const diagnostics:unknown[]=[];let stopped=!hold,failViews=false;
 const entity=(n:number)=>({id:"diagnostic-entity-"+n,name:"Synthetic source "+n,slug:"source-"+n,active:true,icon:null,fields:[]});
 const api=createOpcoApi({apiUrl:"https://synthetic.invalid",timeoutMs:1000,onRequestDiagnostics:d=>{diagnostics.push(d);},fetcher:async(input)=>{const path=new URL(String(input)).pathname;requests.push(path);if(path.endsWith("/views"))return Response.json(failViews?{ok:false,error:{code:"SYNTHETIC_FAILURE",message:"Controlled failure"}}:{ok:true,data:{views}},{status:failViews?500:200});const n=Number(path.split("diagnostic-entity-")[1]);if(!Number.isInteger(n))throw Error("Unexpected request");if(n<11||stopped)return Response.json({ok:true,data:{entity:entity(n)}});return new Response(new ReadableStream<Uint8Array>({start(c){bodies.set(n,c);c.enqueue(new TextEncoder().encode('{"ok":true,"data":'));}}),{status:200});}});
 const finish=()=>{stopped=true;for(const[n,c]of bodies){c.enqueue(new TextEncoder().encode(JSON.stringify({entity:entity(n)})+"}"));c.close();}bodies.clear();};
 const start=(overrides={})=>prewarmAssignedAppViewsOnce({api,appViews:views,ownerKey,contractId,store,token,trigger:"home",...overrides});
 return{views,api,requests,diagnostics,finish,start,failViews:()=>{failViews=true;}};
}
const wait=async(check:()=>boolean)=>{await vi.waitFor(()=>expect(check()).toBe(true),{timeout:2000,interval:2});};
const scope=()=>({store,ownerKey,contractId,token});
const watch=()=>{let state:OfflinePreparationExecution={active:false,diagnostics:null};const stop=subscribeOfflinePreparationExecution({...scope(),onChange:value=>{state=value;}});return{state:()=>state,stop};};
const orphan=():OfflinePreparationDiagnostics=>({status:"running",runId:"prewarm-100-1",scopeKey:offlinePreparationScopeKey(ownerKey,contractId),prewarmStartedAt:"2026-10-30T10:00:00.000Z",prewarmCompletedAt:null,prewarmDurationMs:null,trigger:"home",slow:false,slowestStages:[],lastAppView:null,failedAppViews:[],homeList:{status:"persisted",count:13,syncedAt:"2026-10-30T10:00:00.000Z",errorCode:null,requestId:null},appViews:{completed:11,failed:0,running:2,total:13}});
async function seedOrphan(){await store.setOfflinePreparationDiagnostics(ownerKey,orphan());}
const reconcile=(f:ReturnType<typeof fixture>,extra={})=>reconcileOfflinePreparation({...scope(),api:f.api,online:true,isCurrent:()=>true,beforeRecovery:async()=>true,...extra});

it("replays live progress across recreated API/store facades without starting another preparation",async()=>{
 const f=fixture(),first=watch(),flight=f.start();await wait(()=>first.state().diagnostics?.appViews.completed===11);first.stop();
 await wait(()=>f.requests.length===13);const facade=getLocalDatabase();let state:OfflinePreparationExecution|undefined;const stop=subscribeOfflinePreparationExecution({...scope(),store:facade,onChange:d=>{state=d;}});
 expect(state).toMatchObject({active:true,diagnostics:{status:"running",appViews:{completed:11}}});
 const callback=vi.fn();expect(f.start({store:facade,api:{...f.api},onTelemetry:callback})).toBe(flight);await Promise.resolve();expect(callback).toHaveBeenCalled();await reconcile(f);expect(f.requests).toHaveLength(13);
 f.finish();await flight;expect(state).toMatchObject({active:false,diagnostics:{status:"completed",appViews:{completed:13}}});stop();
});
it("body deadline terminates preparation, releases activity and records safe body-phase timeout; late bodies cannot overwrite",async()=>{
 const f=fixture(),s=watch(),flight=f.start();await wait(()=>s.state().diagnostics?.appViews.completed===11);
 vi.useFakeTimers();await vi.advanceTimersByTimeAsync(1001);vi.useRealTimers();await flight;
 expect(s.state()).toMatchObject({active:false,diagnostics:{status:"failed",appViews:{completed:13,failed:2}}});expect(f.diagnostics.filter((d:any)=>d.operationResult==="transport_timeout")).toHaveLength(2);
 for(const d of f.diagnostics.filter((d:any)=>d.operationResult==="transport_timeout"))expect(d).toMatchObject({responseStarted:true,httpStatus:200,responseParsedAt:null,abortControllerTriggered:true});
 const terminal=await store.getOfflinePreparationDiagnostics(ownerKey);f.finish();await Promise.resolve();expect(await store.getOfflinePreparationDiagnostics(ownerKey)).toEqual(terminal);expect(store.getSQLiteCoordinatorDiagnostics()).toMatchObject({active:null,waitingTotal:0});s.stop();
});
it("terminal diagnostic failure is explicit and repairs from durable receipt after SQLite reopen without GETs",async()=>{
 const f=fixture(false),s=watch(),write=store.setOfflinePreparationDiagnostics.bind(store);vi.spyOn(store,"setOfflinePreparationDiagnostics").mockImplementation(async(owner,d)=>{if(d.status!=="running")throw Error("synthetic telemetry failure");return write(owner,d);});await f.start();
 expect(s.state()).toMatchObject({active:false,diagnostics:{status:"completed",diagnosticWrite:"failed"}});expect(await store.getOfflinePreparationRunReceipt(ownerKey,contractId)).toMatchObject({diagnostics:{status:"completed",diagnosticWrite:"failed"}});
 const count=f.requests.length;s.stop();await db.closeAsync();await open();const next=watch();await reconcile(f,{online:false});expect(f.requests).toHaveLength(count);expect(next.state()).toMatchObject({active:false,diagnostics:{status:"completed",diagnosticWrite:"stored"}});expect((await store.getOfflinePreparationDiagnostics(ownerKey))?.status).toBe("completed");expect(await db.getFirstAsync("PRAGMA integrity_check")).toEqual({integrity_check:"ok"});next.stop();
});
it("orphan with zero writes recovers once, persists completion and survives reopen with no further downloads",async()=>{
 await seedOrphan();expect(await store.countPendingOperations(ownerKey)).toBe(0);const f=fixture(false),s=watch(),before=vi.fn(async()=>true);
 await Promise.all([reconcile(f,{beforeRecovery:before}),reconcile(f,{beforeRecovery:before}),reconcile(f,{beforeRecovery:before})]);expect(before).toHaveBeenCalledOnce();expect(f.requests).toHaveLength(14);expect(s.state()).toMatchObject({active:false,diagnostics:{status:"completed",recoveryOf:"prewarm-100-1",appViews:{completed:13}}});
 expect(await store.getOfflinePreparationRunReceipt(ownerKey,contractId)).toMatchObject({recoveryAttemptOf:"prewarm-100-1",diagnostics:{status:"completed"}});s.stop();await db.closeAsync();await open();await reconcile(f);expect(f.requests).toHaveLength(14);expect((await store.getAppViews(ownerKey,contractId))?.views).toHaveLength(13);
});
it("a failed recovery is terminal and the durable claim prevents loops across SQLite reopen",async()=>{
 await seedOrphan();const f=fixture(false);f.failViews();await reconcile(f);expect(f.requests).toHaveLength(1);expect(await store.getOfflinePreparationDiagnostics(ownerKey)).toMatchObject({status:"failed",runErrorCode:"RECOVERY_FAILED",recoveryOf:"prewarm-100-1"});await reconcile(f);await db.closeAsync();await open();await reconcile(f);expect(f.requests).toHaveLength(1);
});
it("offline reads never download; going online while hydration is pending preserves the recovery demand",async()=>{
 await seedOrphan();const f=fixture(false);await reconcile(f,{online:false});expect(f.requests).toHaveLength(0);const read=store.getOfflinePreparationRunReceipt.bind(store);let resolve!:()=>void;const held=new Promise<void>(r=>{resolve=r;});vi.spyOn(store,"getOfflinePreparationRunReceipt").mockImplementationOnce(async(...args)=>{await held;return read(...args);});const offline=reconcile(f,{online:false});const online=reconcile(f);resolve();await Promise.all([offline,online]);expect(f.requests).toHaveLength(14);
});
it("scope change during preflight prevents old downloads and cannot publish into another user's scope",async()=>{
 await seedOrphan();const f=fixture(false);let current=true,release!:()=>void;const preflight=new Promise<void>(r=>{release=r;});const before=vi.fn(async()=>{await preflight;return true;});const flight=reconcile(f,{isCurrent:()=>current,beforeRecovery:before});await wait(()=>before.mock.calls.length===1);current=false;release();await flight;expect(f.requests).toHaveLength(0);expect(getOfflinePreparationExecution({...scope(),ownerKey:"another-owner"})).toEqual({active:false,diagnostics:null});expect(await store.getOfflinePreparationRunReceipt("another-owner",contractId)).toBeNull();expect(await store.listPendingStateUpdateOperations(ownerKey)).toEqual([]);
});
it("an unpersistable recovery claim fails explicitly before any GET",async()=>{
 await seedOrphan();const f=fixture(false);vi.spyOn(store,"setOfflinePreparationRunReceipt").mockRejectedValue(Error("synthetic receipt failure"));await reconcile(f);expect(f.requests).toHaveLength(0);expect((await store.getOfflinePreparationDiagnostics(ownerKey))?.status).toBe("failed");
});


it("a new session token waits for the prior writer and never receives its diagnostics",async()=>{
 const f=fixture(),flight=f.start();await wait(()=>f.requests.length===13);let state:OfflinePreparationExecution|undefined;const stop=subscribeOfflinePreparationExecution({...scope(),token:"new-session",onChange:d=>{state=d;}});expect(state).toEqual({active:true,diagnostics:null});
 expect(f.start({token:"new-session"})).toBe(flight);f.finish();await flight;expect(f.requests).toHaveLength(26);expect(state).toMatchObject({active:false,diagnostics:{status:"completed"}});stop();
});
it("normal Home reentry after completion still prepares every assigned experience",async()=>{
 const f=fixture(false);await f.start();const first=(await store.getOfflinePreparationDiagnostics(ownerKey))!.runId;await f.start();expect(f.requests).toHaveLength(26);expect((await store.getOfflinePreparationDiagnostics(ownerKey))!.runId).not.toBe(first);
});
it("a stale receipt cannot hide a newer legacy run and no absent registry is inferred from a listener alone",async()=>{
 const f=fixture(false);await f.start();const legacy={...orphan(),runId:"prewarm-9999999999999-2",prewarmStartedAt:"2286-11-20T17:46:39.999Z"};await store.setOfflinePreparationDiagnostics(ownerKey,legacy);await reconcile(f);expect(f.requests).toHaveLength(27);expect((await store.getOfflinePreparationDiagnostics(ownerKey))?.recoveryOf).toBe(legacy.runId);
});
it("if both diagnostic paths fail, the live runtime repairs its known terminal without downloading again",async()=>{
 const f=fixture(false),write=store.setOfflinePreparationDiagnostics.bind(store),receipt=store.setOfflinePreparationRunReceipt.bind(store);
 const primarySpy=vi.spyOn(store,"setOfflinePreparationDiagnostics").mockImplementation(async(owner,d)=>{if(d.status!=="running")throw Error("synthetic primary failure");return write(owner,d);});
 const receiptSpy=vi.spyOn(store,"setOfflinePreparationRunReceipt").mockImplementation(async(owner,contract,r)=>{if(r.diagnostics.status!=="running")throw Error("synthetic receipt failure");return receipt(owner,contract,r);});await f.start();expect(getOfflinePreparationExecution(scope()).diagnostics).toMatchObject({status:"completed",diagnosticWrite:"failed"});primarySpy.mockRestore();receiptSpy.mockRestore();await reconcile(f);expect(f.requests).toHaveLength(13);expect((await store.getOfflinePreparationDiagnostics(ownerKey))?.status).toBe("completed");
});

it("a late /views response after scope change cannot cache assignments or start the old recovery", async () => {
  await seedOrphan(); const f = fixture(false);
  let current = true, release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const getAppViews = vi.fn(async (...args: Parameters<typeof f.api.getAppViews>) => {
    const result = await f.api.getAppViews(...args); await held; return result;
  });
  const flight = reconcile(f, { api: { ...f.api, getAppViews }, isCurrent: () => current });
  await wait(() => getAppViews.mock.calls.length === 1); current = false; release(); await flight;
  expect(f.requests).toHaveLength(1);
  expect(await store.getAppViews(ownerKey, contractId)).toBeNull();
  expect(await store.getAppViews("new-owner", "new-contract")).toBeNull();
  expect(getOfflinePreparationExecution({ ...scope(), ownerKey: "new-owner", contractId: "new-contract" }))
    .toEqual({ active: false, diagnostics: null });
});

it("reads a legacy running diagnostic and preserves a claimed recovery across repeated SQLite reopens", async () => {
  // Old diagnostics have no receipt, diagnosticWrite, recoveryOf, homeList or per-view failures.
  const legacy = orphan(); delete legacy.homeList; delete legacy.failedAppViews;
  await store.setOfflinePreparationDiagnostics(ownerKey, legacy);
  expect(await store.getOfflinePreparationRunReceipt(ownerKey, contractId)).toBeNull();
  expect(await store.getOfflinePreparationDiagnostics(ownerKey)).toMatchObject({ runId: legacy.runId, status: "running", appViews: { completed: 11 } });
  const f = fixture(false); let current = true;
  const api = { ...f.api, getAppViews: async (...args: Parameters<typeof f.api.getAppViews>) => {
    const result = await f.api.getAppViews(...args);
    // Scope exits after the durable claim, leaving exactly the persisted state of an interrupted recovery.
    current = false; return result;
  } };
  await reconcile(f, { api, isCurrent: () => current });
  expect(f.requests).toHaveLength(1);
  expect(await store.getOfflinePreparationRunReceipt(ownerKey, contractId))
    .toMatchObject({ recoveryAttemptOf: legacy.runId, diagnostics: { runId: legacy.runId, status: "running" } });
  for (let reopen = 0; reopen < 3; reopen++) {
    await db.closeAsync(); await open(); const preflight = vi.fn(async () => true);
    await reconcile(f, { beforeRecovery: preflight });
    expect(preflight).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(1);
    expect(getOfflinePreparationExecution(scope())).toMatchObject({ active: false, diagnostics: { status: "running", runId: legacy.runId } });
    expect(await store.getOfflinePreparationRunReceipt(ownerKey, contractId)).toMatchObject({ recoveryAttemptOf: legacy.runId });
    expect(await db.getFirstAsync("PRAGMA integrity_check")).toEqual({ integrity_check: "ok" });
  }
});
