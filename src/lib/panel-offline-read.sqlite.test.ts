// Real PANEL reader/effect and SQLite file with reopen; transport is synthetic.
// @ts-expect-error Node types are intentionally absent from Expo config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from Expo config.
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ts from "typescript";
import { PanelDefinitionError, coherentCachedPanelViews } from "./panel-definition";
import { getPanelReadEvents, panelReadRows } from "./panel-read-diagnostics";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";
import { loadPanelDatasetWithOfflineCache, PANEL_DISCOVERY_SNAPSHOT_DATASET_ID, PanelReadCancelledError, PanelLocalReadError, PanelSnapshotMissingError } from "./offline-panels";
import { prewarmAssignedAppViewsOnce } from "./app-view-prewarm";
import { OpcoNetworkError, OpcoApiError, type PanelResponse, type PanelAppView } from "./opco-api";
import { panelDatasetQueryKey, missingRequiredPanelFilters } from "../renderers/panels/panel-renderer-logic";
// Test-only legacy source override demonstrates the public regression against HEAD.
let reconciliationReader = loadPanelDatasetWithOfflineCache;
if (process.env.PANEL_RECONCILIATION_LEGACY) {
 const source = readFileSync(process.env.PANEL_RECONCILIATION_LEGACY, "utf8");
 const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
 const exports: Record<string, unknown> = {};
 new Function("require", "exports", code)((id: string) => { if (id === "./opco-api") return { OpcoNetworkError }; throw Error("Unexpected legacy dependency " + id); }, exports);
 reconciliationReader = exports.loadPanelDatasetWithOfflineCache as typeof reconciliationReader;
}
const sqlite=vi.hoisted(()=>({openDatabaseAsync:vi.fn()}));vi.mock("expo-sqlite",()=>sqlite);
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
let directory:string,db:ReturnType<typeof sqliteFile>,store:ReturnType<typeof getLocalDatabase>;
async function open(){__resetLocalDatabaseForTests();db=sqliteFile(directory+"/opco-client-v10-epoch2.db");sqlite.openDatabaseAsync.mockResolvedValue(db);store=getLocalDatabase();await store.getSelectedContractId();}
beforeEach(async()=>{directory=mkdtempSync("/tmp/panel-read-diag-");await open();});
afterEach(async()=>{await db.closeAsync();__resetLocalDatabaseForTests();rmSync(directory,{recursive:true,force:true});});
const scope={ownerKey:"synthetic-tenant:user",contractId:"synthetic-contract",appViewId:"synthetic-panel",datasetId:"reportes"};
const query={datasetId:scope.datasetId,filters:{equipo:"synthetic-equipment"} as Record<string,unknown>,page:1,pageSize:25,search:""};
const view={id:scope.appViewId,name:"Consulta sintética",slug:"synthetic",type:"PANEL",active:true,sortOrder:1,icon:null,configRevision:"r1",config:{schemaVersion:1,datasets:[{id:"reportes",source:{type:"ENTITY",entityTypeId:"synthetic-target"},filters:[{type:"PANEL_FILTER",fieldId:"equipment",filterId:"equipo",operator:"EQ"}],transformation:{type:"RECORDS",fieldIds:["code"],pagination:{pageSize:25}}}],filters:[{id:"equipo",label:"Equipo",valueType:"RECORD",required:false}],modules:[{id:"table",datasetId:"reportes",visualization:{type:"TABLE",config:{columns:[{fieldId:"code"}],paginated:true}},layout:{x:0,y:0,w:12,h:6}}]}} as PanelAppView;
function panel(version="new",rows=1,hasMore=false):PanelResponse{return{appView:{id:scope.appViewId,name:"Sintético",slug:"synthetic"},configRevision:"r1",schemaVersion:1,calculatedAt:"2026-11-02T00:00:00Z",datasets:[{id:scope.datasetId,schema:{fields:[{id:"code",name:"Código",type:"TEXT"}]},rows:Array.from({length:rows},(_,i)=>({id:"synthetic-row-"+i,values:{code:version}})),pagination:{page:1,pageSize:25,total:hasMore?30:rows,hasMore}}],filters:view.config.filters??[],modules:view.config.modules??[],metrics:[]};}
const deferred=<T=void>()=>{let resolve!:(v:T)=>void,reject!:(e:Error)=>void;const promise=new Promise<T>((r,j)=>{resolve=r;reject=j});return{promise,resolve,reject};};
function options(api:any,extra:any={}){return{...scope,api,configRevision:"r1",store,token:"synthetic",query,...extra};}
async function seed(p=panel(),q=query){const api={getPanel:vi.fn().mockResolvedValue(p)};await loadPanelDatasetWithOfflineCache(options(api,{query:q}));return api;}
async function reopen(){await db.closeAsync();await open();}
const renderer=readFileSync(process.env.PANEL_READ_SOURCE ?? "src/renderers/panels/PanelRenderer.tsx","utf8");
const ast=ts.createSourceFile("PanelRenderer.tsx",renderer,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let effect:ts.Expression|undefined,deps:ts.Expression|undefined,pageFn:ts.FunctionDeclaration|undefined;
function visit(n:ts.Node){if(ts.isCallExpression(n)&&n.expression.getText(ast)==="useEffect"&&n.arguments[0]?.getText(ast).includes("async function loadDatasets")){effect=n.arguments[0];deps=n.arguments[1];}if(ts.isFunctionDeclaration(n)&&n.name?.text==="configuredPageSize")pageFn=n;ts.forEachChild(n,visit);}visit(ast);if(!effect||!deps||!pageFn)throw Error("actual effect not found");
const effectCode=ts.transpileModule(effect.getText(ast).replace("void loadDatasets();","captureTask(loadDatasets());"),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText.trim().replace(/^"use strict";\s*/, "").replace(/;$/,"");
const pageCode=ts.transpileModule(pageFn.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const configuredPageSize=new Function(pageCode+";return configuredPageSize;")();
function rendererFixture(api:any){const model={datasetStates:{} as Record<string,any>,reconciled:null as any},refs={datasetStatesRef:{current:model.datasetStates},requestSeq:{current:0}};const env:any={...refs,api,appView:view,ownerKey:scope.ownerKey,selectedContractId:scope.contractId,token:"synthetic",definitionCache:store,configuredFilters:view.config.filters,hasComposedKpi:false,datasetIdsKey:scope.datasetId,normalizedFiltersKey:JSON.stringify(query.filters),pages:{[scope.datasetId]:1},searchByDataset:{},retryVersion:0,connectivityStatus:"online",DATASET_KEY_SEPARATOR:"\u0000",PANEL_DISCOVERY_SNAPSHOT_DATASET_ID,panelDatasetQueryKey,configuredPageSize,missingRequiredPanelFilters,loadPanelDatasetWithOfflineCache,PanelLocalReadError,PanelSnapshotMissingError,PanelDefinitionError,adoptedScopeRef:{current:null},setReconciled:(value:any)=>{model.reconciled=value;},assignedScopeKey:JSON.stringify([scope.ownerKey,scope.contractId,view.id,view.configRevision]),
setDatasetStates:(next:any)=>{model.datasetStates=typeof next==="function"?next(model.datasetStates):next;refs.datasetStatesRef.current=model.datasetStates;}};
function run(changes:any={}){Object.assign(env,changes);env.knownOffline=env.connectivityStatus==="offline";env.datasetScopeKey=JSON.stringify([env.ownerKey,env.selectedContractId,env.appView.id,env.appView.configRevision??JSON.stringify(env.appView.config)]);let done!:Promise<void>;const active={...env,captureTask:(p:Promise<void>)=>{done=p;}};const cleanup=new Function(...Object.keys(active),"return ("+effectCode+")();")(...Object.values(active));return{done,cleanup};}
function dependencies(){return new Function(...Object.keys(env),"return "+deps!.getText(ast))(...Object.values(env));}
return{model,refs,env,run,dependencies};}

it("visited exact query survives real close/reopen; fallback still starts API first",async()=>{await seed();await reopen();const api={getPanel:vi.fn().mockRejectedValue(new OpcoNetworkError())};const result=await loadPanelDatasetWithOfflineCache(options(api));expect(result).toMatchObject({fromCache:true,offline:true,panel:panel()});expect(api.getPanel).toHaveBeenCalledOnce();});
it("a never visited equipment combination is not inferred from an unfiltered snapshot",async()=>{await seed(panel(),{...query,filters:{}});await reopen();const error=new OpcoNetworkError();const api={getPanel:vi.fn().mockRejectedValue(error)};expect(await store.getPanelSnapshot({...scope,...query,configRevision:"r1"})).toBeNull();await expect(loadPanelDatasetWithOfflineCache(options(api))).rejects.toBe(error);});
it("cache identity includes owner/contract/AppView/dataset/revision/filter/search/page/size",async()=>{await seed();await reopen();const base={...scope,...query,configRevision:"r1"};for(const change of [{ownerKey:"another:user"},{contractId:"other"},{appViewId:"other"},{datasetId:"other"},{configRevision:"r2"},{filters:{equipo:"other"}},{search:"other"},{page:2},{pageSize:50}])expect(await store.getPanelSnapshot({...base,...change})).toBeNull();expect(await store.getPanelSnapshot({...base,search:"  "})).not.toBeNull();});
it("unknown revision uses latest snapshot of exact query; known different revision rejects",async()=>{await seed();await reopen();expect(await store.getPanelSnapshot({...scope,...query})).not.toBeNull();expect(await store.getPanelSnapshot({...scope,...query,configRevision:"r2"})).toBeNull();});
it("empty visited result survives reopen as valid; absent cache still throws network error",async()=>{await seed(panel("empty",0));await reopen();const api={getPanel:vi.fn().mockRejectedValue(new OpcoNetworkError())};const result=await loadPanelDatasetWithOfflineCache(options(api));expect(result.panel.datasets[0].rows).toEqual([]);expect(result.panel.datasets[0].pagination.total).toBe(0);await expect(loadPanelDatasetWithOfflineCache(options(api,{query:{...query,page:2}}))).rejects.toBeInstanceOf(OpcoNetworkError);});
it("a partial page keeps its authoritative pagination, without making another page available",async()=>{await seed(panel("page",25,true));await reopen();const api={getPanel:vi.fn().mockRejectedValue(new OpcoNetworkError())};const result=await loadPanelDatasetWithOfflineCache(options(api));expect(result.panel.datasets[0].pagination).toMatchObject({total:30,hasMore:true});expect(await store.getPanelSnapshot({...scope,...query,page:2,configRevision:"r1"})).toBeNull();});
it("cached result is visible offline without waiting for retained transport",async()=>{await seed();const held=deferred<PanelResponse>(),entered=deferred();const api={getPanel:vi.fn(async()=>{entered.resolve();return held.promise})};const get=vi.spyOn(store,"getPanelSnapshot");const f=rendererFixture(api);const attempt=f.run({connectivityStatus:"offline"});await attempt.done;expect(api.getPanel).not.toHaveBeenCalled();expect(get).toHaveBeenCalledOnce();expect(f.model.datasetStates.reportes).toMatchObject({isLoading:false,fromCache:true,error:null});attempt.cleanup();});
it("cache miss and SQLite read failure have different safe codes and messages",async()=>{const api={getPanel:vi.fn().mockRejectedValue(new OpcoNetworkError())};const f=rendererFixture(api);let a=f.run({connectivityStatus:"offline"});await a.done;expect(f.model.datasetStates.reportes.error).toContain("Esta consulta no está disponible sin conexión");expect(f.model.datasetStates.reportes.errorCode).toBe("PANEL_SNAPSHOT_MISSING");a.cleanup();const original=store.getPanelSnapshot;store.getPanelSnapshot=vi.fn(async()=>{throw new Error("synthetic SQLite read fault")});a=f.run({retryVersion:1});await a.done;expect(f.model.datasetStates.reportes.error).toContain("No pudimos leer la consulta guardada");expect(f.model.datasetStates.reportes.errorCode).toBe("PANEL_LOCAL_READ_FAILED");expect(f.model.datasetStates.reportes.error).not.toContain("synthetic SQLite");expect(f.model.datasetStates.reportes.fromCache).toBe(false);a.cleanup();store.getPanelSnapshot=original;});
it("HTTP validation/auth errors are not hidden with a compatible snapshot",async()=>{await seed();const error=new OpcoApiError("synthetic forbidden","FORBIDDEN",403);const api={getPanel:vi.fn().mockRejectedValue(error)};await expect(loadPanelDatasetWithOfflineCache(options(api))).rejects.toBe(error);});
it("offline to online changes the dataset effect dependency; an absent query recovers",async()=>{const api={getPanel:vi.fn().mockResolvedValue(panel())};const f=rendererFixture(api);const a=f.run({connectivityStatus:"offline"});await a.done;const before=f.dependencies();f.env.connectivityStatus="online";f.env.knownOffline=false;expect(f.dependencies()).not.toEqual(before);expect(f.model.datasetStates.reportes.error).not.toBeNull();a.cleanup();const b=f.run({retryVersion:1});await b.done;expect(f.model.datasetStates.reportes.error).toBeNull();expect(api.getPanel).toHaveBeenCalledOnce();b.cleanup();});
it("retry of an already loaded exact query is skipped instead of refreshing",async()=>{const api={getPanel:vi.fn().mockResolvedValue(panel())};const f=rendererFixture(api);const a=f.run();await a.done;a.cleanup();const b=f.run({retryVersion:1});await b.done;expect(api.getPanel).toHaveBeenCalledOnce();b.cleanup();});
it("late result of a different query and late error waiting SQLite cannot replace current display",async()=>{const held=deferred<PanelResponse>(),entered=deferred();const api={getPanel:vi.fn(async()=>{entered.resolve();return held.promise})};const f=rendererFixture(api);const a=f.run();await entered.promise;a.cleanup();api.getPanel.mockResolvedValueOnce(panel("current"));const b=f.run({normalizedFiltersKey:JSON.stringify({equipo:"other-equipment"})});await b.done;held.resolve(panel("old"));await a.done;expect(f.model.datasetStates.reportes.panel.datasets[0].rows[0].values.code).toBe("current");b.cleanup();
 const localHeld=deferred<Awaited<ReturnType<typeof store.getPanelSnapshot>>>(),localEntered=deferred();const original=store.getPanelSnapshot;store.getPanelSnapshot=async()=>{localEntered.resolve();return localHeld.promise;};api.getPanel.mockRejectedValueOnce(new OpcoNetworkError());const c=f.run({normalizedFiltersKey:"{}"});await localEntered.promise;c.cleanup();store.getPanelSnapshot=original;api.getPanel.mockResolvedValueOnce(panel("fresh"));const d=f.run({normalizedFiltersKey:JSON.stringify(query.filters)});await d.done;localHeld.reject(new Error("retired SQLite failure"));await c.done;expect(f.model.datasetStates.reportes.error).toBeNull();expect(f.model.datasetStates.reportes.panel.datasets[0].rows[0].values.code).toBe("fresh");d.cleanup();});
it("retired same-query success cannot overwrite the durable newer snapshot",async()=>{const held=deferred<PanelResponse>(),entered=deferred();const api={getPanel:vi.fn(async()=>{entered.resolve();return held.promise})};const f=rendererFixture(api);const a=f.run();await entered.promise;a.cleanup();api.getPanel.mockResolvedValueOnce(panel("R2"));const b=f.run({normalizedFiltersKey:JSON.stringify({equipo:"other-equipment"})});await b.done;b.cleanup();api.getPanel.mockResolvedValueOnce(panel("R2"));const c=f.run({normalizedFiltersKey:JSON.stringify(query.filters)});await c.done;held.resolve(panel("R1"));await a.done;expect(f.model.datasetStates.reportes.panel.datasets[0].rows[0].values.code).toBe("R2");await reopen();const cached=await store.getPanelSnapshot({...scope,...query,configRevision:"r1"});expect(cached?.panel.datasets[0].rows[0].values.code).toBe("R2");c.cleanup();});
it("an old scope writes only to its own cache and cannot publish after scope cleanup",async()=>{const held=deferred<PanelResponse>(),entered=deferred();const api={getPanel:vi.fn(async()=>{entered.resolve();return held.promise})};const f=rendererFixture(api);const a=f.run();await entered.promise;a.cleanup();api.getPanel.mockResolvedValueOnce(panel("other-scope"));const b=f.run({ownerKey:"other:user",selectedContractId:"other-contract"});await b.done;held.resolve(panel("old-owner"));await a.done;expect(f.model.datasetStates.reportes.panel.datasets[0].rows[0].values.code).toBe("other-scope");expect(await store.getPanelSnapshot({...scope,...query,configRevision:"r1"})).toBeNull();expect((await store.getPanelSnapshot({...scope,...query,ownerKey:"other:user",contractId:"other-contract",configRevision:"r1"}))?.panel.datasets[0].rows[0].values.code).toBe("other-scope");b.cleanup();});
it("PANEL is metadata-only in global preparation and does not obtain dataset snapshots",async()=>{const api={getPanel:vi.fn(),getEntityDefinition:vi.fn(),getEntityRecords:vi.fn(),getStateUpdateWorkflow:vi.fn(),getAttendanceWorkflow:vi.fn()};await prewarmAssignedAppViewsOnce({api,appViews:[view],ownerKey:scope.ownerKey,contractId:scope.contractId,store,token:"synthetic"});expect(api.getPanel).not.toHaveBeenCalled();expect(await store.getPanelSnapshot({...scope,...query,configRevision:"r1"})).toBeNull();expect((await store.getOfflinePreparationDiagnostics(scope.ownerKey))?.status).toBe("completed");});
it("panel reads and reopen preserve pending/conflict rows and durable outbox byte-for-byte",async()=>{const local=await store.createLocalRecord({ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:"synthetic-target",values:{code:"synthetic-pending"}});await db.runAsync("UPDATE entity_records SET sync_status='conflict' WHERE local_id=?",local.localId);const before={rows:await db.getAllAsync("SELECT * FROM entity_records"),outbox:await db.getAllAsync("SELECT * FROM pending_operations")};await seed();await reopen();const api={getPanel:vi.fn().mockRejectedValue(new OpcoNetworkError())};await loadPanelDatasetWithOfflineCache(options(api));expect({rows:await db.getAllAsync("SELECT * FROM entity_records"),outbox:await db.getAllAsync("SELECT * FROM pending_operations")}).toEqual(before);expect(await db.getFirstAsync("PRAGMA integrity_check")).toEqual({integrity_check:"ok"});});

it("required regression: known offline must read compatible snapshot without starting API",async()=>{await seed();await reopen();const api={getPanel:vi.fn().mockRejectedValue(new OpcoNetworkError())};const f=rendererFixture(api);const attempt=f.run({connectivityStatus:"offline"});await attempt.done;attempt.cleanup();expect(f.model.datasetStates.reportes.fromCache).toBe(true);expect(api.getPanel).not.toHaveBeenCalled();});

async function waitFor(check:()=>boolean){for(let n=0;n<200;n++){if(check())return;await new Promise(r=>setTimeout(r,1));}throw Error("test scheduling barrier not reached");}
it("retires a queued snapshot inside the coordinator, before it can overwrite R2",async()=>{
 await seed(panel("R0"));const original=db.runAsync;const entered=deferred(),release=deferred();let oldInserts=0;
 db.runAsync=async(sql:string,...args:unknown[])=>{if(sql.includes("app_metadata")&&args.includes("barrier")){entered.resolve();await release.promise;}if(sql.includes("INSERT INTO panel_snapshots")&&args.includes(JSON.stringify(panel("R1"))))oldInserts++;return original(sql,...args);};
 const blocker=store.setSelectedContractId("barrier");await entered.promise;let active=true;
 const old=store.upsertPanelSnapshot({...scope,...query,configRevision:"r1",panel:panel("R1"),assertActive:()=>{if(!active)throw new PanelReadCancelledError();}});const rejected=expect(old).rejects.toBeInstanceOf(PanelReadCancelledError);await waitFor(()=>store.getSQLiteCoordinatorDiagnostics().waitingTotal>0);active=false;
 const fresh=store.upsertPanelSnapshot({...scope,...query,configRevision:"r1",panel:panel("R2")});release.resolve();await blocker;await rejected;await fresh;db.runAsync=original;
 expect(oldInserts).toBe(0);await reopen();expect((await store.getPanelSnapshot({...scope,...query,configRevision:"r1"}))?.panel.datasets[0].rows[0].values.code).toBe("R2");
});
it("rolls back an INSERT retired during execution, then commits the queued R2 writer",async()=>{
 await seed(panel("R0"));const original=db.runAsync,entered=deferred(),release=deferred();let active=true;
 db.runAsync=async(sql:string,...args:unknown[])=>{const result=await original(sql,...args);if(sql.includes("INSERT INTO panel_snapshots")&&args.includes(JSON.stringify(panel("R1")))){entered.resolve();await release.promise;}return result;};
 const old=store.upsertPanelSnapshot({...scope,...query,configRevision:"r1",panel:panel("R1"),assertActive:()=>{if(!active)throw new PanelReadCancelledError();}});const rejected=expect(old).rejects.toBeInstanceOf(PanelReadCancelledError);await entered.promise;active=false;
 const fresh=store.upsertPanelSnapshot({...scope,...query,configRevision:"r1",panel:panel("R2")});await waitFor(()=>store.getSQLiteCoordinatorDiagnostics().waitingTotal>0);release.resolve();await rejected;await fresh;db.runAsync=original;
 await reopen();expect((await store.getPanelSnapshot({...scope,...query,configRevision:"r1"}))?.panel.datasets[0].rows[0].values.code).toBe("R2");expect(await db.getFirstAsync("PRAGMA integrity_check")).toEqual({integrity_check:"ok"});
});
it("a retired discovery response cannot write its executed dataset alias after R2",async()=>{
 const original=store.upsertPanelSnapshot.bind(store),entered=deferred(),release=deferred();let active=true;
 store.upsertPanelSnapshot=async input=>{await original(input);if(input.datasetId===PANEL_DISCOVERY_SNAPSHOT_DATASET_ID&&input.panel.datasets[0].rows[0].values.code==="R1"){entered.resolve();await release.promise;}};
 const q={page:1,pageSize:25,filters:query.filters,search:""};const old=loadPanelDatasetWithOfflineCache(options({getPanel:vi.fn().mockResolvedValue(panel("R1"))},{query:q,isActive:()=>active}));const rejected=expect(old).rejects.toBeInstanceOf(PanelReadCancelledError);await entered.promise;active=false;
 await loadPanelDatasetWithOfflineCache(options({getPanel:vi.fn().mockResolvedValue(panel("R2"))},{query:q}));release.resolve();await rejected;store.upsertPanelSnapshot=original;await reopen();
 for(const datasetId of [PANEL_DISCOVERY_SNAPSHOT_DATASET_ID,scope.datasetId])expect((await store.getPanelSnapshot({...scope,...query,datasetId,configRevision:"r1"}))?.panel.datasets[0].rows[0].values.code).toBe("R2");
});
it("transaction failure retains the prior snapshot and the queue continues",async()=>{
 await seed(panel("R0"));const original=db.runAsync;db.runAsync=async(sql:string,...args:unknown[])=>{const result=await original(sql,...args);if(sql.includes("INSERT INTO panel_snapshots")&&args.includes(JSON.stringify(panel("R1"))))throw Error("synthetic write failure");return result;};
 await expect(store.upsertPanelSnapshot({...scope,...query,configRevision:"r1",panel:panel("R1")})).rejects.toThrow("synthetic write failure");db.runAsync=original;
 expect((await store.getPanelSnapshot({...scope,...query,configRevision:"r1"}))?.panel.datasets[0].rows[0].values.code).toBe("R0");await seed(panel("R2"));await reopen();expect((await store.getPanelSnapshot({...scope,...query,configRevision:"r1"}))?.panel.datasets[0].rows[0].values.code).toBe("R2");
});
it("a failed online update retains the exact valid copy; never borrows other filters",async()=>{
 await seed(panel("R2"));const api={getPanel:vi.fn().mockRejectedValue(new OpcoNetworkError())};expect((await loadPanelDatasetWithOfflineCache(options(api))).panel).toEqual(panel("R2"));await expect(loadPanelDatasetWithOfflineCache(options(api,{knownOffline:true,query:{...query,filters:{equipo:"never-visited"}}}))).rejects.toBeInstanceOf(PanelSnapshotMissingError);await reopen();expect((await store.getPanelSnapshot({...scope,...query,configRevision:"r1"}))?.panel).toEqual(panel("R2"));
});
it("cached empty and paginated results are usable known-offline without API",async()=>{
 await seed(panel("empty",0));await reopen();const api={getPanel:vi.fn()};const empty=await loadPanelDatasetWithOfflineCache(options(api,{knownOffline:true}));expect(empty.panel.datasets[0]).toMatchObject({rows:[],pagination:{total:0,hasMore:false}});
 await seed(panel("partial",25,true));await reopen();const partial=await loadPanelDatasetWithOfflineCache(options(api,{knownOffline:true}));expect(partial.panel.datasets[0].pagination).toMatchObject({total:30,hasMore:true});expect(api.getPanel).not.toHaveBeenCalled();
 await expect(loadPanelDatasetWithOfflineCache(options(api,{knownOffline:true,query:{...query,page:2}}))).rejects.toBeInstanceOf(PanelSnapshotMissingError);
});

it("malformed persisted JSON is a safe local read failure, never an empty query",async()=>{
 await seed();await db.runAsync("UPDATE panel_snapshots SET panel_json=?", "{synthetic-invalid-json");const api={getPanel:vi.fn()};
 await expect(loadPanelDatasetWithOfflineCache(options(api,{knownOffline:true}))).rejects.toBeInstanceOf(PanelLocalReadError);expect(api.getPanel).not.toHaveBeenCalled();
 expect((await db.getFirstAsync("SELECT COUNT(*) AS n FROM panel_snapshots") as {n:number}).n).toBe(1);await seed(panel("R2"));await reopen();expect((await loadPanelDatasetWithOfflineCache(options(api,{knownOffline:true}))).panel.datasets[0].rows[0].values.code).toBe("R2");
});
it("changing owner or definition never retains the previous query as compatible",async()=>{
 const api={getPanel:vi.fn().mockResolvedValue(panel("R2"))},f=rendererFixture(api);let attempt=f.run();await attempt.done;attempt.cleanup();
 attempt=f.run({ownerKey:"another:user",connectivityStatus:"offline"});await attempt.done;expect(f.model.datasetStates.reportes.panel).toBeNull();expect(f.model.datasetStates.reportes.errorCode).toBe("PANEL_SNAPSHOT_MISSING");attempt.cleanup();
 attempt=f.run({ownerKey:scope.ownerKey,appView:{...view,configRevision:"r2"}});await attempt.done;expect(f.model.datasetStates.reportes.panel).toBeNull();expect(f.model.datasetStates.reportes.errorCode).toBe("PANEL_SNAPSHOT_MISSING");attempt.cleanup();expect(api.getPanel).toHaveBeenCalledOnce();
 expect((await store.getPanelSnapshot({...scope,...query,configRevision:"r1"}))?.panel.datasets[0].rows[0].values.code).toBe("R2");
});

it("RED to GREEN: reconciled R2 definition and query survive reopen despite old R1 navigation metadata",async()=>{
 const next={...view,configRevision:"r2",config:{...view.config,layout:{columns:12,rowHeight:96}}};const api={getPanel:vi.fn().mockResolvedValue({...panel("R2"),configRevision:"r2"}),getAppViews:vi.fn().mockResolvedValue({views:[next]})};
 await store.upsertPanelSnapshot({...scope,...query,configRevision:"r1",panel:panel("R1")});await store.upsertAppViews(scope.ownerKey,scope.contractId,[view],"2026-11-02T00:00:00.000Z");
 const result=await reconciliationReader(options(api,{appView:view}));expect(result.definition).toEqual(next);expect(api.getAppViews).toHaveBeenCalledOnce();
 await reopen();const cached=await store.getAppViews(scope.ownerKey,scope.contractId);expect(cached!.views[0]).toMatchObject({type:"PANEL",configRevision:"r1"});const coherent=await coherentCachedPanelViews(store,scope,cached!.views,view.id);expect(coherent[0]).toMatchObject({type:"PANEL",configRevision:"r2"});
 const restored=await loadPanelDatasetWithOfflineCache(options(api,{appView:next,configRevision:next.configRevision,knownOffline:true}));expect(restored.panel.datasets[0].rows[0].values.code).toBe("R2");expect((await store.getPanelSnapshot({...scope,...query,configRevision:"r1"}))?.panel.datasets[0].rows[0].values.code).toBe("R1");expect(api.getPanel).toHaveBeenCalledOnce();
});
it("a failed reconciliation preserves R1 and raw R2 without accrediting R2 or retrying automatically",async()=>{
 const api={getPanel:vi.fn().mockResolvedValue({...panel("R2"),configRevision:"r2"}),getAppViews:vi.fn().mockResolvedValue({views:[view]})};await seed(panel("R1"));await expect(loadPanelDatasetWithOfflineCache(options(api,{appView:view}))).rejects.toMatchObject({code:"PANEL_DEFINITION_UNAVAILABLE"});
 expect(api.getPanel).toHaveBeenCalledOnce();expect(api.getAppViews).toHaveBeenCalledOnce();expect(await store.getCoherentPanelDefinition(scope)).toBeNull();expect(await store.getPanelSnapshot({...scope,...query,configRevision:"r1"})).not.toBeNull();expect(await store.getPanelSnapshot({...scope,...query,configRevision:"r2"})).not.toBeNull();
});
it("coherent definition receipt rolls back atomically with a retired snapshot and preserves the older definition",async()=>{
 const api={getPanel:vi.fn().mockResolvedValue(panel("R1"))};await loadPanelDatasetWithOfflineCache(options(api,{appView:view}));const original=db.runAsync,entered=deferred(),release=deferred();let active=true;
 db.runAsync=async(sql:string,...args:unknown[])=>{const result=await original(sql,...args);if(sql.includes("app_metadata")&&args.some(a=>typeof a==="string"&&a.includes('"configRevision":"r2"'))){entered.resolve();await release.promise;}return result;};
 const next={...view,configRevision:"r2"};const pending=store.upsertPanelSnapshot({...scope,...query,configRevision:"r2",panel:{...panel("R2"),configRevision:"r2"},definition:next,assertActive(){if(!active)throw new PanelReadCancelledError();}});const rejected=expect(pending).rejects.toBeInstanceOf(PanelReadCancelledError);await entered.promise;active=false;release.resolve();await rejected;db.runAsync=original;await reopen();expect((await store.getCoherentPanelDefinition(scope))?.configRevision).toBe("r1");expect(await store.getPanelSnapshot({...scope,...query,configRevision:"r2"})).toBeNull();
});
it("coherent receipts stay scoped and do not survive missing snapshot content as authority",async()=>{
 await loadPanelDatasetWithOfflineCache(options({getPanel:vi.fn().mockResolvedValue(panel())},{appView:view}));expect(await store.getCoherentPanelDefinition({...scope,ownerKey:"other"})).toBeNull();expect(await store.getCoherentPanelDefinition({...scope,contractId:"other"})).toBeNull();expect(await store.getCoherentPanelDefinition({...scope,appViewId:"other"})).toBeNull();await db.runAsync("DELETE FROM panel_snapshots");expect(await store.getCoherentPanelDefinition(scope)).toBeNull();
});
it("diagnostics distinguish R1 response expectation from R2 committed/read keys without query values",async()=>{
 const next={...view,configRevision:"r2"};const api={getPanel:vi.fn().mockResolvedValue({...panel("R2"),configRevision:"r2"}),getAppViews:vi.fn().mockResolvedValue({views:[next]})};await loadPanelDatasetWithOfflineCache(options(api,{appView:view}));await loadPanelDatasetWithOfflineCache(options(api,{knownOffline:true,configRevision:"r2"}));
 const events=getPanelReadEvents();const write=[...events].reverse().find(e=>e.phase==="snapshot_write"&&e.result==="persisted")!,read=events.at(-1)!;expect(read.result).toBe("hit");expect(read.keyFingerprint).toBe(write.keyFingerprint);expect(write.expectedRevision).not.toBe(write.actualRevision);const copy=JSON.stringify(panelReadRows(events,scope.ownerKey,scope.contractId));expect(copy).not.toContain("synthetic-equipment");expect(copy).not.toContain(scope.ownerKey);
});
it("a retired cached read is diagnosed as cancellation, not a storage failure",async()=>{
 await seed();const original=store.getPanelSnapshot.bind(store),entered=deferred(),release=deferred();let active=true;store.getPanelSnapshot=async input=>{entered.resolve();await release.promise;return original(input);};
 const pending=loadPanelDatasetWithOfflineCache(options({getPanel:vi.fn()},{knownOffline:true,isActive:()=>active}));const rejected=expect(pending).rejects.toBeInstanceOf(PanelReadCancelledError);await entered.promise;active=false;release.resolve();await rejected;store.getPanelSnapshot=original;
 const last=getPanelReadEvents().at(-1)!;expect(last).toMatchObject({phase:"snapshot_read",result:"cancelled",errorCode:"PANEL_READ_CANCELLED"});expect(last.errorCode).not.toBe("PANEL_LOCAL_READ_FAILED");
});
