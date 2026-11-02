// Execute actual RECORDS handlers with real SQLite file/reopen; API transport is synthetic.
// @ts-expect-error Node types are intentionally absent from Expo config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from Expo config.
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import ts from "typescript";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";
import { prewarmAssignedAppViewsOnce } from "./app-view-prewarm";
import { RecordsLocalReadError, recordsLocalCoverage, recordsLocalCoverageMessage, loadRecordsCacheFirst, selectPresentableLocalRecords, shouldStartRecordsOpeningMeasurement, activateRecordsOpeningHistoryOwner, hydrateRecordsOpeningHistory, recordRecordsOpeningMeasurement } from "../renderers/records/records-opening";
import { getEntityDefinitionWithCache } from "./definition-cache";
import { assertRecordsReadActive, RecordsReadCancelledError, loadRecordsWithOfflineCache, refreshEntityRecordsCache } from "./offline-records";
import { buildRecordListItem } from "./entity-record-display";
import { classifySyncTelemetryError } from "./sync-telemetry";
import { getRecordsListErrorMessage, getRecordsReadErrorCode } from "../renderers/records/records-renderer-state";
import { activateExperienceActivityScope, reportExperienceActivity, getExperienceActivitySnapshot, resetExperienceActivityForTests } from "./experience-activity";
import { OpcoNetworkError, type AppView, type EntityDefinition } from "./opco-api";
const sqlite = vi.hoisted(() => ({ openDatabaseAsync: vi.fn() }));
vi.mock("expo-sqlite", () => sqlite);
let store:ReturnType<typeof getLocalDatabase>;
let stats={sql:0,byKind:{} as Record<string,number>,queuePeak:0};
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
async function open(){__resetLocalDatabaseForTests();db=sqliteFile(directory+"/opco-client-v10-epoch2.db");sqlite.openDatabaseAsync.mockResolvedValue(db);store=getLocalDatabase();await store.getSelectedContractId();}
beforeEach(async()=>{directory=mkdtempSync("/tmp/protocols-read-diagnosis-");await open();resetExperienceActivityForTests();});
afterEach(async()=>{for(let n=0;n<200;n++){const d=store.getSQLiteCoordinatorDiagnostics();if(!d.active&&!d.waitingTotal)break;await new Promise(r=>setTimeout(r,2));}await db.closeAsync();__resetLocalDatabaseForTests();rmSync(directory,{recursive:true,force:true});});
const raw=readFileSync(process.env.RECORDS_READ_SOURCE ?? process.cwd()+"/src/renderers/records/RecordsRenderer.tsx","utf8");
const file=ts.createSourceFile("renderer.tsx",raw,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let readEffect:ts.Expression|undefined,activity:ts.Expression|undefined;
const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)){
 if(node.expression.text==="useEffect"&&node.arguments[0]?.getText(file).includes("async function loadEntityRecords"))readEffect=node.arguments[0];
 if(node.expression.text==="useExperienceActivityReporter")activity=node.arguments[1];
 }ts.forEachChild(node,visit);};visit(file);
if(!readEffect||!activity)throw Error("real renderer effect/report not found");
const effectText=ts.transpileModule(readEffect.getText(file).replace("void loadEntityRecords();","captureTask(loadEntityRecords());"),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText.trim().replace(/^"use strict";\s*/, "").replace(/;$/,"");
const reportText=activity.getText(file);
const ownerKey="synthetic-org:synthetic-user",contractId="synthetic-contract",entityTypeId="synthetic-protocols";
const scope={ownerKey,contractId,entityTypeId};
const view={id:"synthetic-protocols-view",type:"RECORDS",name:"Registro sintético",slug:"synthetic-protocols",sortOrder:0,icon:null,config:{entityTypeId}} as AppView;
const entity={id:entityTypeId,name:"Protocolos sintéticos",slug:"synthetic-protocols",active:true,icon:null,fields:[
 {id:"code",key:"code",name:"Código",type:"TEXT",active:true,required:false,order:0,searchable:true,config:{display:{showInClient:true}},options:[]},
 {id:"related",key:"related",name:"Responsable",type:"RELATION",active:true,required:false,order:1,config:{display:{showInClient:true}},options:[]}
]} as EntityDefinition;
const records=[{id:"synthetic-protocol-1",displayName:"Protocolo ficticio",updatedAt:"2026-11-02T00:00:00Z",values:{code:"SYN-001",related:{id:"synthetic-person-1",displayName:"Responsable ficticio"}}}];
function deferred<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r});return{promise,resolve};}
let measurementSequence=0;
function fixture(){
 let online=true;let remoteRecords=records.map(r=>({...r}));const events:{endpoint:string;online:boolean}[]=[];
 const api={getEntityDefinition:vi.fn(async()=>{events.push({endpoint:"definition",online});if(!online)throw new OpcoNetworkError("synthetic offline definition");return{entity};}),
 getEntityRecords:vi.fn(async(_token:string,_contract:string,_entity:string,query:{page?:number;pageSize?:number;search?:string}={})=>{events.push({endpoint:"records",online});if(!online)throw new OpcoNetworkError("synthetic offline records");const page=query.page??1,pageSize=query.pageSize??100;const filtered=query.search?remoteRecords.filter(r=>r.displayName.toLowerCase().includes(query.search!.toLowerCase())):remoteRecords;return{records:filtered.slice((page-1)*pageSize,page*pageSize),pagination:{page,pageSize,total:filtered.length,totalPages:Math.max(1,Math.ceil(filtered.length/pageSize))}};}),getAttendanceWorkflow:vi.fn(),getStateUpdateWorkflow:vi.fn()};
 const model:Record<string,unknown>={error:null,isLoading:true,isRefreshing:false,isLoadingMore:false,localCoverage:null,readErrorCode:null,definition:null,records:[],listItems:[],pagination:null,loadedScope:null};
 const dataScopeKey=ownerKey+":"+contractId+":"+entityTypeId+':""';
 const ctx:Record<string,unknown>={api,appView:view,entityTypeId,token:"synthetic",selectedContractId:contractId,ownerKey,definitionCache:store,dataScopeKey,
 sharedOpening:null,debouncedSearch:"",loadedScopeRef:{current:null},measuredOpeningScopeRef:{current:dataScopeKey+":"+view.id},
 readGenerationRef:{current:0},loadMoreFlightRef:{current:null},
 PAGE_SIZE:25,loadRecordsCacheFirst,selectPresentableLocalRecords,shouldStartRecordsOpeningMeasurement,activateRecordsOpeningHistoryOwner,hydrateRecordsOpeningHistory,recordRecordsOpeningMeasurement,
 RecordsLocalReadError, recordsLocalCoverage, recordsLocalCoverageMessage, assertRecordsReadActive, RecordsReadCancelledError, getRecordsReadErrorCode,
 getEntityDefinitionWithCache,loadRecordsWithOfflineCache,refreshEntityRecordsCache,buildRecordListItem,classifySyncTelemetryError,getRecordsListErrorMessage,
 monotonicNow:()=>performance.now(),elapsedMs:(start:number,end=performance.now())=>Math.max(0,Math.round(end-start)),createOpeningMeasurementId:()=>"test-read-"+(++measurementSequence),
 syncPendingRecords:vi.fn(async()=>undefined),
 refreshRecordsSyncSummary:vi.fn(async()=>store.getRecordsSyncSummary({ownerKey,contractId})),refreshCurrentSyncTelemetry:vi.fn(async()=>store.getSyncTelemetry(scope))};
 for(const name of ["Error","ReadErrorCode","LocalCoverage","IsLoading","IsRefreshing","IsLoadingMore","LastReadScope","Definition","Records","ListItems","Pagination","IsOfflineData","LoadedScope","SyncedAt","RecordsSyncTelemetry","RetryCount"]){const key=name[0].toLowerCase()+name.slice(1);ctx["set"+name]=(value:unknown)=>{model[key]=typeof value==="function"?(value as (v:unknown)=>unknown)(model[key]):value;};}
 function run(extra:Record<string,unknown>={}){let done!:Promise<void>;const env={...ctx,...model,connectivityStatus:online?"online":"offline",status:online?"authenticated":"offline",knownOffline:!online,...extra,captureTask:(p:Promise<void>)=>{done=p;}};
 const cleanup=new Function(...Object.keys(env),"return ("+effectText+")();")(...Object.values(env)) as ()=>void;
 return{cleanup,done};}
 function report(reporterId="renderer"){const env={...model,scopePending:model.lastReadScope!==dataScopeKey,localCoverageNotice:recordsLocalCoverageMessage(model.localCoverage as never,Boolean(model.definition)),hasCompatibleRecords:model.loadedScope===dataScopeKey};const report=new Function(...Object.keys(env),"return ("+reportText+");")(...Object.values(env));reportExperienceActivity({...report,scopeKey:"scope",reporterId});return getExperienceActivitySnapshot();}
 function synchronize(){let declaration:ts.FunctionDeclaration|undefined;const find=(n:ts.Node)=>{if(ts.isFunctionDeclaration(n)&&n.name?.text==="synchronizeRecords")declaration=n;ts.forEachChild(n,find);};find(file);if(!declaration)throw Error("sync handler missing");const code=ts.transpileModule(declaration.getText(file),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;const env={...ctx,...model};return(new Function(...Object.keys(env),code+"; return synchronizeRecords;")(...Object.values(env))as()=>Promise<void>)();}
 function more(){let declaration:ts.FunctionDeclaration|undefined;const find=(n:ts.Node)=>{if(ts.isFunctionDeclaration(n)&&n.name?.text==="loadMoreRecords")declaration=n;ts.forEachChild(n,find);};find(file);if(!declaration)throw Error("load-more handler missing");const code=ts.transpileModule(declaration.getText(file),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;const env={...ctx,...model,scopePending:model.lastReadScope!==dataScopeKey,knownOffline:!online};return(new Function(...Object.keys(env),code+"; return loadMoreRecords;")(...Object.values(env))as()=>Promise<void>)();}
 return{api,events,model,ctx,run,more,synchronize,report,setRemote:(rows:typeof records)=>{remoteRecords=rows;},online:(value:boolean)=>{online=value;},prepare:()=>prewarmAssignedAppViewsOnce({api,appViews:[view],store,ownerKey,contractId,token:"synthetic"})};
}

it("metadata-only preparation stays unprepared offline without API calls, then reconnects successfully",async()=>{
 const f=fixture();await f.prepare();const before=f.events.length;f.online(false);const first=f.run();await first.done;
 expect(f.model.error).toBeNull();expect(f.model.localCoverage).toBe("unprepared");expect(f.events).toHaveLength(before);expect((await store.getOfflinePreparationDiagnostics(ownerKey))?.status).toBe("completed");expect((await store.getSyncTelemetry(scope))?.lastFullRefreshCompletedAt??null).toBeNull();first.cleanup();
 f.online(true);const next=f.run();await next.done;expect(f.model.error).toBeNull();expect(f.model.records).toHaveLength(1);expect(f.model.localCoverage).toBe("complete");next.cleanup();
});
it("complete and empty collections remain distinct from an unprepared collection after offline reopen",async()=>{
 const f=fixture();f.setRemote([]);await f.prepare();let current=f.run();await current.done;current.cleanup();expect(f.model.localCoverage).toBe("complete");await db.closeAsync();await open();f.ctx.definitionCache=store;f.ctx.loadedScopeRef={current:null};f.model.records=[];f.model.loadedScope=null;f.online(false);const before=f.events.length;current=f.run();await current.done;
 expect(f.model.error).toBeNull();expect(f.model.records).toEqual([]);expect(f.model.localCoverage).toBe("complete");expect(f.model.isOfflineData).toBe(true);expect(f.events).toHaveLength(before);current.cleanup();
});
it("a cached page is visible as partial, never complete, including related labels",async()=>{
 const f=fixture();await f.prepare();await store.upsertRemoteRecords({...scope,records});f.online(false);const before=f.events.length;const current=f.run();await current.done;
 expect(f.model.records).toHaveLength(1);expect(JSON.stringify(f.model.listItems)).toContain("Responsable ficticio");expect(f.model.localCoverage).toBe("partial");expect((await store.getSyncTelemetry(scope))?.lastFullRefreshCompletedAt??null).toBeNull();expect(f.events).toHaveLength(before);current.cleanup();
});
it("a local SQLite read failure is explicit and retains compatible visible data and its marker",async()=>{
 const f=fixture();await f.prepare();let current=f.run();await current.done;current.cleanup();f.online(false);const original=store.getEntityDefinition;store.getEntityDefinition=vi.fn(async()=>{throw new Error("synthetic SQLite fault");});
 try{current=f.run();await current.done;expect(f.model.error).toContain("leer los registros guardados");expect(f.model.readErrorCode).toBe("RECORDS_LOCAL_READ_FAILED");expect(f.model.records).toHaveLength(1);expect((await store.listCachedRecords(scope)).records).toHaveLength(1);}finally{store.getEntityDefinition=original;current!.cleanup();}
 f.online(true);const recovered=f.run();await recovered.done;expect(f.model.error).toBeNull();expect(f.model.records).toHaveLength(1);recovered.cleanup();
});
it("archived RED to GREEN: a retired catch waiting for SQLite cannot restore its error after reconnect succeeds",async()=>{
 const f=fixture();await f.prepare();f.online(false);const entered=deferred(),release=deferred();const original=store.listCachedRecords.bind(store);let calls=0;store.listCachedRecords=async input=>{calls++;if(calls===3){entered.resolve();await release.promise;}return original(input);};
 // Transport fails before connectivity has established offline: preserve the archived catch race.
 const old=f.run({knownOffline:false,status:"authenticated",connectivityStatus:"unknown"});await entered.promise;old.cleanup();f.online(true);const next=f.run();await next.done;expect(f.model.error).toBeNull();expect(f.model.records).toHaveLength(1);release.resolve();await old.done;
 expect(f.model.error).toBeNull();expect(f.model.localCoverage).toBe("complete");next.cleanup();store.listCachedRecords=original;
});
it("a slow remote response cannot replace newer visible or persisted results",async()=>{
 const f=fixture();await f.prepare();const held=deferred<Awaited<ReturnType<typeof f.api.getEntityRecords>>>(),entered=deferred();f.api.getEntityRecords.mockImplementationOnce(async()=>{entered.resolve();return held.promise;});const old=f.run();await entered.promise;old.cleanup();const fresh={...records[0],displayName:"Versión nueva",updatedAt:"2026-11-02T00:00:02Z"};f.setRemote([fresh]);const next=f.run();await next.done;
 held.resolve({records,pagination:{page:1,pageSize:100,total:1,totalPages:1}});await old.done;expect(f.model.error).toBeNull();expect((f.model.records as typeof records)[0].displayName).toBe("Versión nueva");expect((await store.listCachedRecords(scope)).records[0].displayName).toBe("Versión nueva");next.cleanup();
});
it("a SQLite response from another owner/contract cannot publish definition, rows or error",async()=>{
 const f=fixture();await f.prepare();let current=f.run();await current.done;current.cleanup();f.online(false);const original=store.getEntityDefinition.bind(store);const entered=deferred(),held=deferred<Awaited<ReturnType<typeof original>>>();let count=0;store.getEntityDefinition=async(...args)=>{if(++count===1){entered.resolve();return held.promise;}return original(...args);};const old=f.run();await entered.promise;
 // A newer generation also invalidates the old attempt even before its cleanup is observed.
 const next=f.run({ownerKey:"other-user",selectedContractId:"other-contract",dataScopeKey:"other-scope"});await next.done;held.resolve(await original(contractId,entityTypeId));await old.done;expect(f.model.error).toBeNull();expect(f.model.records).toEqual([]);expect(f.model.definition).toBeNull();expect(f.model.localCoverage).toBe("unprepared");expect((await store.listCachedRecords(scope)).records).toHaveLength(1);old.cleanup();next.cleanup();store.getEntityDefinition=original;
});
it("a failed remote refresh keeps the local copy, exposes failure, and retries without loops",async()=>{
 const f=fixture();await f.prepare();let current=f.run();await current.done;current.cleanup();f.api.getEntityRecords.mockRejectedValueOnce(new OpcoNetworkError("synthetic failed update"));current=f.run();await current.done;expect(f.model.error).toContain("Conservamos los datos");expect(f.model.records).toHaveLength(1);expect(f.model.localCoverage).toBe("complete");expect((await store.listCachedRecords(scope)).records).toHaveLength(1);current.cleanup();
 const next=f.run();await next.done;expect(f.model.error).toBeNull();expect(f.model.records).toHaveLength(1);next.cleanup();
});
it("offline pagination and search use SQLite only without upgrading a cached page to complete",async()=>{
 const f=fixture();const rows=Array.from({length:31},(_,i)=>({...records[0],id:"row-"+i,displayName:"Fila "+String(i).padStart(2,"0")}));f.setRemote(rows);await f.prepare();let current=f.run();await current.done;current.cleanup();await db.closeAsync();await open();f.ctx.definitionCache=store;f.online(false);const before=f.events.length;current=f.run();await current.done;expect(f.model.records).toHaveLength(25);await f.more();expect(f.model.records).toHaveLength(31);expect(f.events).toHaveLength(before);current.cleanup();
 const searched=f.run({debouncedSearch:"Fila 30",dataScopeKey:"searched-scope"});await searched.done;expect(f.model.records).toHaveLength(1);expect(f.model.localCoverage).toBe("complete");expect(f.events).toHaveLength(before);searched.cleanup();
});
it("late load-more results do not append to a replacement search or clear its error",async()=>{
 const f=fixture();const rows=Array.from({length:31},(_,i)=>({...records[0],id:"row-"+i,displayName:"Fila "+String(i).padStart(2,"0")}));f.setRemote(rows);await f.prepare();const current=f.run();await current.done;const held=deferred<Awaited<ReturnType<typeof f.api.getEntityRecords>>>(),entered=deferred();f.api.getEntityRecords.mockImplementationOnce(async()=>{entered.resolve();return held.promise;});const more=f.more();await entered.promise;current.cleanup();const next=f.run({debouncedSearch:"Fila 30",dataScopeKey:"searched-scope"});await next.done;held.resolve({records:rows.slice(25),pagination:{page:2,pageSize:25,total:31,totalPages:2}});await more;expect(f.model.error).toBeNull();expect(f.model.records).toHaveLength(1);expect(f.model.isLoadingMore).toBe(false);next.cleanup();
});
it("pending records, conflicts and durable payloads remain byte-identical across refresh and offline reads",async()=>{
 const f=fixture();await f.prepare();const local=await store.createLocalRecord({...scope,values:{code:"LOCAL"}});await db.runAsync("UPDATE entity_records SET sync_status='conflict' WHERE local_id=?",local.localId);const before={rows:await db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced'"),outbox:await db.getAllAsync("SELECT * FROM pending_operations")};let current=f.run();await current.done;current.cleanup();f.online(false);current=f.run();await current.done;expect(f.model.records).toHaveLength(2);expect({rows:await db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced'"),outbox:await db.getAllAsync("SELECT * FROM pending_operations")}).toEqual(before);current.cleanup();
});
it("screen activity and durable opening result agree and summary failures do not replace list success",async()=>{
 const f=fixture();await f.prepare();f.online(false);activateExperienceActivityScope({scopeKey:"scope",reporterId:"renderer",appViewId:view.id,appViewTitle:view.name,appViewType:"RECORDS"});let current=f.run();expect(f.report().activeRuns).toHaveLength(1);await current.done;expect(f.report()).toMatchObject({result:"partial",errorCode:null});current.cleanup();f.online(true);f.ctx.refreshRecordsSyncSummary=vi.fn(async()=>{throw new Error("synthetic summary failure");});current=f.run();await current.done;expect(f.model.error).toBeNull();expect(f.report()).toMatchObject({result:"success",errorCode:null,activeRuns:[]});expect((await store.getRecordsOpeningHistory(ownerKey,contractId))[0]).toMatchObject({result:"completed",errorCode:null,coverage:"complete"});current.cleanup();
});

it("a late post-sync read cannot refresh telemetry or retry a replacement scope",async()=>{
 const f=fixture();await f.prepare();const initial=f.run();await initial.done;
 const held=deferred(),entered=deferred();f.ctx.syncPendingRecords=vi.fn(async()=>{entered.resolve();await held.promise;});
 const telemetry=f.ctx.refreshCurrentSyncTelemetry as ReturnType<typeof vi.fn>;telemetry.mockClear();const pending=f.synchronize();await entered.promise;
 initial.cleanup();(f.ctx.readGenerationRef as {current:number}).current+=1;held.resolve();await pending;
 expect(f.ctx.syncPendingRecords).toHaveBeenCalledOnce();expect(telemetry).not.toHaveBeenCalled();expect(f.model.retryCount).toBeUndefined();
});
