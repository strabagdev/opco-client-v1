// Real SQLite-file transport reused from the stage-3 receipt harness.
// @ts-expect-error Node types are intentionally absent from Expo config.
import {spawn, execFileSync} from "node:child_process";
// @ts-expect-error Node types are intentionally absent from Expo config.
import {mkdtempSync, rmSync, readFileSync} from "node:fs";
import {beforeEach, afterEach, describe, it, expect, vi} from "vitest";
import {getLocalDatabase, __resetLocalDatabaseForTests} from "./local-db";
import {OpcoApiError,createOpcoApi} from "./opco-api";
import {loadPanelDatasetWithOfflineCache} from "./offline-panels";
import {consultationQuery,consultationPlan} from "./consultation-revision-contract";
import {createConsultationRevisionRead} from "./consultation-revision-read";
import {genericNegotiationFixture} from "../test/generic-negotiation-fixture";
import {buildReportMatrixModel,buildReportTableModel} from "../renderers/reports/report-renderer-logic";
import {OpcoNetworkError,type PanelQuery,type ReportQuery} from "./opco-api";
import {loadReportWithOfflineCache} from "./offline-reports";

import {revisionHash} from "./revision-receipts";
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
beforeEach(async()=>{directory=mkdtempSync("/tmp/preparation-revision-sqlite-");await open();});
afterEach(async()=>{await db.closeAsync();__resetLocalDatabaseForTests();rmSync(directory,{recursive:true,force:true});vi.restoreAllMocks();});

describe("exact consultation consumption under real SQLite inspection",()=>{
 async function seed(kind:"panel"|"report"="panel",total=21,mode:"TABLE"|"MATRIX"="TABLE"){
  const f=await genericNegotiationFixture(["exact-query-window"],{type:kind==="panel"?"PANEL":"REPORT"});
  const config=kind==="panel"?{schemaVersion:1,datasets:[]}:{entityTypeId:"entity",presentationMode:mode,timeFilter:"RANGE",valueDisplay:"LABEL"};
  const view={id:"view",type:kind==="panel"?"PANEL":"REPORT",name:"Synthetic",configRevision:"a".repeat(64),config};
  const query=kind==="panel"?{datasetId:"rows",page:1,pageSize:10}:{from:"2026-11-01",to:"2026-11-30"};
  const response=kind==="panel"?{appView:{id:"view",name:"Synthetic",slug:"synthetic"},schemaVersion:1,configRevision:view.configRevision,calculatedAt:"2026-11-15T00:00:00Z",filters:[],modules:[],datasets:[{id:"rows",schema:{fields:[]},pagination:{page:1,pageSize:10,total,hasMore:total>10},rows:Array.from({length:Math.min(10,total)},(_,i)=>({id:"row"+i,values:{text:"Full synthetic text"}}))}]}:
   {appView:{id:"view",name:"Synthetic",slug:"synthetic"},config,from:query.from,to:query.to,fields:[],records:Array.from({length:total},(_,i)=>({id:"row"+i,values:{}}))};
  await store.upsertAppViews(f.scope.ownerKey,"contract",[view] as never,"2026-11-15T00:00:00Z");
  const request={appView:view as never,resource:{kind,appViewId:"view",query:consultationQuery(kind,query)}};
  const read=async(value:unknown)=>({version:1 as const,representationVersion:1 as const,mode:"shadow" as const,reuseAllowed:false as const,clientMaySkipReads:false as const,coverageCertified:false as const,revision:"1".repeat(64),manifestVectorRevision:f.manifest.readBindingVector.revision,epoch:f.manifest.epoch,authorizationFingerprint:f.scope.authorizationFingerprint,selectionFingerprint:"2".repeat(64),requestFingerprint:"3".repeat(64),contentHash:await revisionHash(value),snapshot:{isolation:"repeatable-read" as const,at:"2026-11-15T00:00:00Z"}});
  const assignment={views:[view]},assignmentRead=await read(assignment),download={resource:request.resource,data:response,normalized:response,readRevision:await read(response)};
  if(kind==="panel")await store.upsertPanelSnapshot({ownerKey:f.scope.ownerKey,contractId:"contract",appViewId:"view",configRevision:view.configRevision,datasetId:"rows",page:1,pageSize:10,panel:response as never,definition:view as never});
  else await store.upsertReportSnapshot({ownerKey:f.scope.ownerKey,contractId:"contract",appViewId:"view",from:query.from,to:query.to,report:response as never});
  const context={scope:f.scope,manifest:f.manifest,sessionId:"session",request,isCurrent:()=>true};await store.beginConsultationRevision(context);const receipt=await store.commitConsultationRevision(context,consultationPlan(request,f.scope,download,assignmentRead));
  const api={genericReuseEnabled:true,getOfflineRevisionManifest:vi.fn(async()=>f.manifest),getRevisionRead:vi.fn(async()=>({resource:{kind:"views" as const},data:assignment,normalized:assignment,readRevision:assignmentRead})),getPanel:vi.fn(),getReport:vi.fn()};
  return{f,view,query,response,request,receipt,api,input:{api,store,appView:view as never,appViewId:"view",kind,query,ownerKey:f.scope.ownerKey,contractId:"contract",token:"synthetic",isCurrent:()=>true}};
 }
 it.each([0,1,21])("consumes a complete PANEL page of %s rows without claiming the whole dataset",async total=>{
  const x=await seed("panel",total),before=await store.inspectConsultationRevision({scope:x.f.scope,request:x.request,isCurrent:()=>true});
  expect(before.windowPrepared).toBe(true);expect(before.coverage).toBe(total>10?"partial":"complete");
  const write=vi.spyOn(store,"upsertPanelSnapshot"),result=await loadPanelDatasetWithOfflineCache({...x.input,query:{datasetId:"rows",page:1,pageSize:10},configRevision:x.view.configRevision});
  expect(result).toMatchObject({fromCache:true,offline:false,panel:x.response});expect(x.api.getPanel).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
  expect((await store.inspectConsultationRevision({scope:x.f.scope,request:x.request,isCurrent:()=>true})).receipt?.snapshotId).toBe(x.receipt.snapshotId);
 });
 it.each(["TABLE","MATRIX"] as const)("reuses exact %s inputs and never rewrites the snapshot",async mode=>{
  const x=await seed("report",2,mode),write=vi.spyOn(store,"upsertReportSnapshot");const result=await loadReportWithOfflineCache(x.input);
  expect(result).toMatchObject({fromCache:true,offline:false,report:x.response});expect(x.api.getReport).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
 });
 it.each([{page:2},{pageSize:20},{datasetId:"other"},{filters:{ref:"stable-other-id"}},{search:"other"}])("does not reuse another PANEL query %j",async change=>{
  const x=await seed();expect((await createConsultationRevisionRead({...x.input,query:{...x.query,...change}})).reused).toBeUndefined();
 });
 it("does not reuse another period and rejects a new storage handle after reopen",async()=>{
  const x=await seed("report",0);expect((await createConsultationRevisionRead({...x.input,query:{from:"2026-12-01",to:"2026-12-31"}})).reused).toBeUndefined();
  await db.closeAsync();await open();expect((await createConsultationRevisionRead({...x.input,store})).reused).toBeUndefined();
  expect((await store.getReportSnapshot({ownerKey:x.f.scope.ownerKey,contractId:"contract",appViewId:"view",from:x.query.from,to:x.query.to}))?.report).toEqual(x.response);
 });
});


const scope={ownerKey:"synthetic:actor",contractId:"synthetic-contract",appViewId:"synthetic-report",from:"2026-11-01",to:"2026-11-30"};
const report=(name:string)=>({appView:{id:scope.appViewId,name,slug:"synthetic"},config:{entityTypeId:"entity",presentationMode:"TABLE" as const,dateFieldId:"date",timeFilter:{mode:"RANGE" as const,defaultPeriod:"CURRENT_MONTH" as const,allowChange:true},table:{visibleFieldIds:[],defaultSortDirection:"asc" as const}},entity:{id:"entity",name:"Synthetic",slug:"synthetic"},fields:[],records:[],from:scope.from,to:scope.to});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return{resolve,promise};}
it("RED retired REPORT write rolls back even when cancellation occurs after INSERT",async()=>{await store.upsertReportSnapshot({...scope,report:report("R0")});const write=db.runAsync,entered=deferred(),release=deferred();let active=true;
 db.runAsync=async(sql,...args)=>{const value=await write(sql,...args);if(sql.includes("INSERT INTO report_snapshots")&&args.some(a=>typeof a==="string"&&a.includes('"name":"R1"'))){entered.resolve();await release.promise;}return value;};
 const guarded={...scope,report:report("R1"),assertActive(){if(!active)throw Error("Synthetic retired read");}};const pending=store.upsertReportSnapshot(guarded);const observed=pending.then(()=>false,()=>true);await entered.promise;active=false;release.resolve();expect(await observed).toBe(true);db.runAsync=write;expect((await store.getReportSnapshot(scope))?.report.appView.name).toBe("R0");await store.upsertReportSnapshot({...scope,report:report("R2")});await db.closeAsync();await open();expect((await store.getReportSnapshot(scope))?.report.appView.name).toBe("R2");});
it("RED known offline REPORT reads only SQLite",async()=>{await store.upsertReportSnapshot({...scope,report:report("Cached")});const api={getReport:vi.fn(async()=>{throw new OpcoApiError("Synthetic no connection","NETWORK",0);})};const input={...scope,api,store,query:{from:scope.from,to:scope.to},token:"synthetic",knownOffline:true};await loadReportWithOfflineCache(input).catch(()=>null);expect(api.getReport).not.toHaveBeenCalled();});
const realSuite=process.env.CONSULTATION_HTTP==="1"?describe.sequential:describe.skip;
realSuite("exact consultation receipts with real Core/PostgreSQL and SQLite",()=>{
 async function setup(){const f=JSON.parse(readFileSync(process.env.REVISION_RECEIPT_FIXTURE!,"utf8")),traffic:{path:string;query:string;status:number}[]=[];const api=createOpcoApi({apiUrl:"http://127.0.0.1:19764",fetcher:async(url,init)=>{const res=await fetch(url,init),u=new URL(String(url));traffic.push({path:u.pathname,query:u.search,status:res.status});return res;}});const login=await api.login(f.credentials.email,f.credentials.password);if(!("accessToken"in login))throw Error("Synthetic login failed");const token=login.accessToken,m=await api.getOfflineRevisionManifest(token,f.contract),scope={...m.scope,ownerKey:m.scope.organizationId+":"+m.scope.userId},views=(await api.getAppViews(token,f.contract)).views;await store.upsertAppViews(scope.ownerKey,f.contract,views,new Date().toISOString());return{f,api,token,scope,views};}
 const control=(op:string)=>execFileSync("node",[process.env.REVISION_RECEIPT_CONTROL!,op],{env:{...process.env,DATABASE_URL:"postgresql://receipt_owner@127.0.0.1:19763/consultation_coverage?schema=public"},stdio:"pipe"});
 const view=(x:Awaited<ReturnType<typeof setup>>,k="panel")=>x.views.find(v=>v.id===x.f[k])!;
 async function panel(x:Awaited<ReturnType<typeof setup>>,query:PanelQuery={datasetId:"rows",page:1,pageSize:10},knownOffline=false,appView=view(x)){if(appView.type!=="PANEL")throw Error("fixture");return loadPanelDatasetWithOfflineCache({api:x.api,store,token:x.token,ownerKey:x.scope.ownerKey,contractId:x.f.contract,appViewId:appView.id,appView,configRevision:appView.configRevision,query:{page:1,pageSize:10,...query},knownOffline});}
 async function reportRead(x:Awaited<ReturnType<typeof setup>>,k="report",query:ReportQuery=x.f.query,knownOffline=false){const appView=view(x,k);if(appView.type!=="REPORT")throw Error("fixture");return loadReportWithOfflineCache({api:x.api,store,token:x.token,ownerKey:x.scope.ownerKey,contractId:x.f.contract,appViewId:appView.id,appView,query,knownOffline});}
 const request=(x:Awaited<ReturnType<typeof setup>>,kind:"panel"|"report",query:PanelQuery&ReportQuery,k:string=kind)=>({appView:view(x,k),resource:{kind,appViewId:x.f[k],query:consultationQuery(kind,query)}});
 const inspect=(x:Awaited<ReturnType<typeof setup>>,kind:"panel"|"report",query:PanelQuery&ReportQuery,k:string=kind)=>store.inspectConsultationRevision({scope:x.scope,request:request(x,kind,query,k),isCurrent:()=>true});
 it("certifies visited PANEL pages, only then the whole exact dataset result",async()=>{const x=await setup(),q={datasetId:"rows",page:1,pageSize:10};await panel(x,q);expect(await inspect(x,"panel",q)).toMatchObject({coverage:"partial",windowPrepared:true,reuseAllowed:false});for(let page=2;page<=4;page++)await panel(x,{...q,page});const complete=await inspect(x,"panel",q);expect(complete).toMatchObject({coverage:"complete",windowPrepared:true,status:"remote_unchecked"});const id=complete.receipt!.snapshotId;await db.closeAsync();await open();expect((await inspect(x,"panel",q)).receipt?.snapshotId).toBe(id);});
 it.each(["report","matrix"])("preserves full %s values, grouping and summaries across reopen",async k=>{const x=await setup(),read=await reportRead(x,k),plain=await x.api.getReport(x.token,x.f.contract,x.f[k],x.f.query);expect(read.report).toEqual(plain);expect(read.report.records).toHaveLength(31);const before=k==="matrix"?buildReportMatrixModel(read.report):buildReportTableModel(read.report);expect(before).toBeTruthy();if(k==="matrix")expect(buildReportMatrixModel(read.report)?.rows.some(r=>!!r.summary)).toBe(true);expect(await inspect(x,"report",x.f.query,k),JSON.stringify(await db.getAllAsync("SELECT value FROM app_metadata WHERE key LIKE 'consultation_revision_status:%'"))).toMatchObject({coverage:"complete",status:"remote_unchecked"});await db.closeAsync();await open();const offline=await reportRead(x,k,x.f.query,true);expect(k==="matrix"?buildReportMatrixModel(offline.report):buildReportTableModel(offline.report)).toEqual(before);});
 it("keeps filters, datasets, searches, page sizes and periods isolated, including empty",async()=>{const x=await setup();const queries=[{datasetId:"rows",page:1,pageSize:10,filters:{lot:x.f.lot1}},{datasetId:"rows",page:1,pageSize:10,filters:{lot:x.f.lot2}},{datasetId:"secondary",page:1,pageSize:10},{datasetId:"rows",page:1,pageSize:10,search:"No matching synthetic text"}];for(const q of queries){await panel(x,q);expect((await inspect(x,"panel",q)).windowPrepared).toBe(true);}expect((await inspect(x,"panel",queries[3])).coverage).toBe("complete");expect((await inspect(x,"panel",{datasetId:"rows",page:1,pageSize:25})).coverage).toBe("unprepared");const empty={from:"2024-01-01",to:"2024-01-31"};expect((await reportRead(x,"report",empty)).report.records).toEqual([]);expect((await inspect(x,"report",empty)).coverage).toBe("complete");expect((await inspect(x,"report",x.f.query)).coverage).toBe("unprepared");});
 it("returns real HTTP409 across changed pages without merging revisions",async()=>{const x=await setup(),q={datasetId:"rows",page:1,pageSize:10};await panel(x,q);await panel(x,{...q,page:2});control("source");await expect(panel(x,{...q,page:3})).rejects.toMatchObject({status:409});await panel(x,q);expect((await inspect(x,"panel",q)).coverage).toBe("partial");for(let page=2;page<=4;page++)await panel(x,{...q,page});expect((await inspect(x,"panel",q)).coverage).toBe("complete");});
 it("anchors a directly opened page without inventing cached page1",async()=>{const x=await setup(),q={datasetId:"rows",page:2,pageSize:10};await panel(x,q);expect(await inspect(x,"panel",q)).toMatchObject({coverage:"partial",windowPrepared:true});expect((await inspect(x,"panel",{...q,page:1})).coverage).toBe("unprepared");});
 it("preserves an older compatible snapshot during network interruption without emitting a new proof",async()=>{const x=await setup(),q={datasetId:"rows",page:1,pageSize:10};await panel(x,q);await reportRead(x);const before=(await inspect(x,"panel",q)).receipt!.snapshotId,read=x.api.getRevisionRead;x.api.getRevisionRead=async(...args)=>{if(["panel","report"].includes(args[2].kind))throw new OpcoNetworkError("Synthetic interrupted response");return read(...args);};expect((await panel(x,q)).fromCache).toBe(true);expect((await reportRead(x)).fromCache).toBe(true);expect((await inspect(x,"panel",q)).receipt!.snapshotId).toBe(before);x.api.getRevisionRead=read;await panel(x,q);expect((await inspect(x,"panel",q)).receipt!.snapshotId).not.toBe(before);});
 it.each(["option","catalog","relation"])("invalidates a prepared query after %s dependency changes",async op=>{const x=await setup();await reportRead(x);control(op);const manifest=await x.api.getOfflineRevisionManifest(x.token,x.f.contract);expect(await store.inspectConsultationRevision({scope:x.scope,request:request(x,"report",x.f.query),manifest,isCurrent:()=>true})).toMatchObject({status:"invalid",coverage:"partial"});await reportRead(x);expect((await inspect(x,"report",x.f.query)).coverage).toBe("complete");});
 it("preserves PANEL R1/R2 under their own keys during compatible definition adoption",async()=>{const x=await setup(),q={datasetId:"rows",page:1,pageSize:10},old=view(x);await panel(x,q);control("layout");const next=await panel(x,q),updated=next.definition!;expect(updated.configRevision).not.toBe(old.type==="PANEL"?old.configRevision:undefined);expect((await store.inspectConsultationRevision({scope:x.scope,request:{appView:updated,resource:{kind:"panel",appViewId:updated.id,query:consultationQuery("panel",q)}},isCurrent:()=>true})).windowPrepared).toBe(true);expect((await panel(x,q,true,old)).panel.configRevision).not.toBe(next.panel.configRevision);});
 it("isolates users, contracts and permissions without touching snapshots",async()=>{const x=await setup();await reportRead(x);for(const scope of[{...x.scope,ownerKey:"other"},{...x.scope,contractId:x.f.foreignContract}])expect((await store.inspectConsultationRevision({scope,request:request(x,"report",x.f.query),isCurrent:()=>true})).coverage).toBe("unprepared");try{control("role-member");const m=await x.api.getOfflineRevisionManifest(x.token,x.f.contract);expect((await store.inspectConsultationRevision({scope:{...m.scope,ownerKey:x.scope.ownerKey},request:request(x,"report",x.f.query),manifest:m,isCurrent:()=>true})).status).toBe("invalid");}finally{control("role-admin");}});
 it("keeps pending/conflicts byte-identical while preparing and reopening consultation snapshots",async()=>{const x=await setup();for(const conflict of[false,true]){const row=await store.createLocalRecord({ownerKey:x.scope.ownerKey,contractId:x.f.contract,entityTypeId:x.f.aux,values:{name:"Synthetic protected"}});if(conflict)await db.runAsync("UPDATE entity_records SET sync_status='conflict' WHERE local_id=?",row.localId);}const hash=async()=>revisionHash({rows:await db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced' ORDER BY local_id"),outbox:await db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")}),before=await hash();await panel(x);await reportRead(x);await reportRead(x,"matrix");await db.closeAsync();await open();expect(await hash()).toBe(before);expect((await inspect(x,"report",x.f.query)).coverage).toBe("complete");});
 it("does not certify unsupported/missing receipt metadata or absent snapshots as empty",async()=>{const x=await setup();expect((await inspect(x,"report",x.f.query)).coverage).toBe("unprepared");await reportRead(x);await db.runAsync("UPDATE app_metadata SET value=json_set(value,'$.version',2) WHERE key LIKE 'consultation_revision_receipt:v1:%'");expect((await inspect(x,"report",x.f.query)).status).toBe("invalid");await reportRead(x);await db.runAsync("DELETE FROM report_snapshots");expect((await inspect(x,"report",x.f.query)).coverage).toBe("unprepared");});
 it("fences a late REPORT response after a newer read persists",async()=>{const x=await setup(),read=x.api.getRevisionRead,entered=deferred(),release=deferred();let held=false;
  x.api.getRevisionRead=async(...args)=>{const result=await read(...args);if(args[2].kind==="report"&&!held){held=true;entered.resolve();await release.promise;}return result;};
  const old=reportRead(x),observed=old.then(()=>null,error=>error);await entered.promise;control("source");const newer=await reportRead(x),recent=(await inspect(x,"report",x.f.query)).receipt!.snapshotId;release.resolve();expect(await observed).toMatchObject({code:"REVISION_SCOPE_RETIRED"});expect((await reportRead(x,"report",x.f.query,true)).report).toEqual(newer.report);expect((await inspect(x,"report",x.f.query)).receipt!.snapshotId).toBe(recent);
 });
 it("leaves a usable snapshot without proof after final receipt persistence fails",async()=>{const x=await setup(),write=db.runAsync;db.runAsync=async(sql,...args)=>{if(sql.includes("INSERT INTO app_metadata")&&String(args[0]).startsWith("consultation_revision_receipt:v1:"))throw Error("Synthetic receipt persistence failed");return write(sql,...args);};await reportRead(x);db.runAsync=write;expect(await inspect(x,"report",x.f.query)).toMatchObject({coverage:"partial",receipt:null});expect((await reportRead(x,"report",x.f.query,true)).report.records).toHaveLength(31);});

 it("does not promote a discovery snapshot alias to an explicit dataset receipt",async()=>{const x=await setup(),q={page:1,pageSize:10};await panel(x,q);expect((await inspect(x,"panel",q)).windowPrepared).toBe(true);expect(await inspect(x,"panel",{...q,datasetId:"rows"})).toMatchObject({coverage:"partial",windowPrepared:false,receipt:null});await panel(x,{...q,datasetId:"rows"});expect((await inspect(x,"panel",{...q,datasetId:"rows"})).windowPrepared).toBe(true);});

 it("never completes a query using a sibling receipt without supported coverage metadata",async()=>{const x=await setup(),q={datasetId:"rows",page:1,pageSize:10};for(let page=1;page<=4;page++)await panel(x,{...q,page});expect((await inspect(x,"panel",q)).coverage).toBe("complete");await db.runAsync("UPDATE app_metadata SET value=json_remove(value,'$.coverage') WHERE key LIKE 'consultation_revision_receipt:v1:%' AND json_extract(value,'$.plan.resource.query.page')='2'");expect(await inspect(x,"panel",q)).toMatchObject({coverage:"partial",windowPrepared:true});});

 it("preserves requested sizes when Core applies its existing cap",async()=>{const x=await setup(),q={datasetId:"rows",page:1,pageSize:150};const result=await panel(x,q);expect(result.panel.datasets[0].pagination.pageSize).toBe(100);expect((await inspect(x,"panel",q)).coverage).toBe("complete");expect((await inspect(x,"panel",{...q,pageSize:100})).windowPrepared).toBe(false);});

 it("binds TABLE with an existing STATE_UPDATE CURRENT source without changing projection semantics",async()=>{const x=await setup(),read=await reportRead(x,"projectionReport"),plain=await x.api.getReport(x.token,x.f.contract,x.f.projectionReport,x.f.query);expect(read.report).toEqual(plain);expect(read.report.records).toHaveLength(201);expect(await inspect(x,"report",x.f.query,"projectionReport")).toMatchObject({coverage:"complete",windowPrepared:true});await db.closeAsync();await open();expect((await reportRead(x,"projectionReport",x.f.query,true)).report).toEqual(plain);});

});
