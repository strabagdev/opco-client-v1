import { PYTHON_SQLITE_SCRIPT_EXECUTOR } from "../test/sqlite-script";
// Real SQLite-file transport reused from the stage-3 receipt harness.
// @ts-expect-error Node types are intentionally absent from Expo config.
import {spawn, execFileSync} from "node:child_process";
// @ts-expect-error Node types are intentionally absent from Expo config.
import {mkdtempSync, rmSync, readFileSync} from "node:fs";
import {beforeEach, afterEach, describe, it, expect, vi} from "vitest";
import {getLocalDatabase, __resetLocalDatabaseForTests} from "./local-db";
import {OpcoApiError,createOpcoApi} from "./opco-api";
import {createRecordsRevisionRead} from "./records-revision-read";
import {refreshEntityRecordsCache,loadRecordsWithOfflineCache} from "./offline-records";
import {revisionHash} from "./revision-receipts";
import {genericNegotiationFixture} from "../test/generic-negotiation-fixture";
const sqlite=vi.hoisted(()=>({openDatabaseAsync:vi.fn()}));vi.mock("expo-sqlite",()=>sqlite);
function sqliteFile(path: string) {
  const worker = spawn("python3", ["-u", "-c", `
import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1], isolation_level=None)
c.row_factory=sqlite3.Row
${PYTHON_SQLITE_SCRIPT_EXECUTOR}
for line in sys.stdin:
 try:
  q=json.loads(line); sql=q['sql']; args=q.get('args',[])
  if q['kind']=='exec':
   if sql.strip() in ('BEGIN','COMMIT','ROLLBACK'): c.execute(sql)
   else: exec_sqlite_script(sql)
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

describe("RECORDS verified consumption uses the original SQLite query",()=>{
 async function seed(total=2){
  const f=await genericNegotiationFixture(["unfiltered-collection"]),view={id:"view",name:"Synthetic",type:"RECORDS" as const,config:{entityTypeId:"entity"}},entity={id:"entity",name:"Synthetic",active:true,fields:[]};
  const rows=Array.from({length:total},(_,i)=>({id:"row"+i,displayName:i%2?"A long label":"Z long label",updatedAt:"2026-11-15T00:00:00Z",values:{}}));
  await store.upsertAppViews(f.scope.ownerKey,"contract",[view] as never,"2026-11-15T00:00:00Z");await store.upsertEntityDefinition("contract","entity",entity as never,"2026-11-15T00:00:00Z");
  await store.upsertRemoteRecords({ownerKey:f.scope.ownerKey,contractId:"contract",entityTypeId:"entity",records:rows as never});
  const read={version:1 as const,representationVersion:1 as const,mode:"shadow" as const,reuseAllowed:false as const,clientMaySkipReads:false as const,coverageCertified:false as const,revision:"1".repeat(64),manifestVectorRevision:f.manifest.readBindingVector.revision,epoch:f.manifest.epoch,authorizationFingerprint:f.scope.authorizationFingerprint,selectionFingerprint:"2".repeat(64),requestFingerprint:"3".repeat(64),contentHash:await revisionHash({views:[view]}),snapshot:{isolation:"repeatable-read" as const,at:"2026-11-15T00:00:00Z"}};
  const context={scope:f.scope,manifest:f.manifest,sessionId:"session",appViewId:"view",isCurrent:()=>true};await store.beginRecordsRevisionRead(context);
  const receipt=await store.commitRecordsRevisionReceipt(context,{appView:view as never,entityTypeId:"entity",parts:[
   {resource:{kind:"views"},artifact:{kind:"views"},expected:{json:[view]},reads:[read]},
   {resource:{kind:"definition",entityTypeId:"entity"},artifact:{kind:"definition",entityTypeId:"entity"},expected:{json:entity},reads:[read]},
   {resource:{kind:"records",entityTypeId:"entity"},artifact:{kind:"records",entityTypeId:"entity",total},expected:{records:rows as never},reads:[read]},
  ]});
  const api={genericReuseEnabled:true,getOfflineRevisionManifest:vi.fn(async()=>f.manifest),getRevisionRead:vi.fn(async()=>({resource:{kind:"views" as const},data:{views:[view]},normalized:{views:[view]},readRevision:read})),getEntityDefinition:vi.fn(),getEntityRecords:vi.fn()};
  return{f,view,api,receipt,input:{api,store,appView:view as never,token:"synthetic",ownerKey:f.scope.ownerKey,contractId:"contract",isCurrent:()=>true}};
 }
 it.each([0,2,101])("consumes %s prepared records with identical ordering, IDs and pagination",async n=>{
  const x=await seed(n),before=await store.listCachedRecords({ownerKey:x.f.scope.ownerKey,contractId:"contract",entityTypeId:"entity",pageSize:25});
  const result=await createRecordsRevisionRead({...x.input,query:{page:1,pageSize:25}});expect(result.reused?.records).toEqual(before);expect(result.reused?.definition).toMatchObject({id:"entity"});
  expect(x.api.getEntityRecords).not.toHaveBeenCalled();expect(x.api.getEntityDefinition).not.toHaveBeenCalled();
  expect((await store.inspectRecordsRevisionCoverage({scope:x.f.scope,appView:x.view as never,isCurrent:()=>true})).receipt?.snapshotId).toBe(x.receipt.snapshotId);
 });
 it.each([{search:"other"},{sort:"displayName" as const},{page:2},{fieldIdHasValue:"field"}])("does not substitute the collection for a different query %j",async query=>{
  const x=await seed();expect((await createRecordsRevisionRead({...x.input,query})).reused).toBeUndefined();
 });
 it("reopens SQLite without trusting an old runtime marker and keeps all cached rows",async()=>{
  const x=await seed();await db.closeAsync();await open();const result=await createRecordsRevisionRead({...x.input,store});expect(result.reused).toBeUndefined();expect((await store.listCachedRecords({ownerKey:x.f.scope.ownerKey,contractId:"contract",entityTypeId:"entity"})).pagination.total).toBe(2);
 });
 it("rejects changed local content without treating it as an empty collection",async()=>{
  const x=await seed();await db.runAsync("UPDATE entity_records SET display_name='Changed synthetic label' WHERE server_id='row0'");
  expect((await createRecordsRevisionRead(x.input)).reused).toBeUndefined();expect((await store.listCachedRecords({ownerKey:x.f.scope.ownerKey,contractId:"contract",entityTypeId:"entity"})).pagination.total).toBe(2);
 });
});


const realSuite=process.env.RECORDS_COVERAGE_HTTP==="1"?describe.sequential:describe.skip;
realSuite("RECORDS revision coverage with real Core/PostgreSQL and SQLite",()=>{
 async function setup(){const f=JSON.parse(readFileSync(process.env.REVISION_RECEIPT_FIXTURE!,"utf8")),traffic:{path:string;query:string;status:number}[]=[];const api=createOpcoApi({apiUrl:"http://127.0.0.1:19664",fetcher:async(url,init)=>{const res=await fetch(url,init),u=new URL(String(url));traffic.push({path:u.pathname,query:u.search,status:res.status});return res;}});const login=await api.login(f.credentials.email,f.credentials.password);if(!("accessToken"in login))throw Error("Synthetic login failed");const token=login.accessToken,m=await api.getOfflineRevisionManifest(token,f.contract),scope={...m.scope,ownerKey:m.scope.organizationId+":"+m.scope.userId},views=(await api.getAppViews(token,f.contract)).views;await store.upsertAppViews(scope.ownerKey,f.contract,views,new Date().toISOString());return{f,api,token,scope,views,view:views.find(v=>v.id===f.records)!,traffic};}
 const control=(op:string)=>execFileSync("node",[process.env.REVISION_RECEIPT_CONTROL!,op],{env:{...process.env,DATABASE_URL:"postgresql://receipt_owner@127.0.0.1:19663/records_coverage?schema=public"},stdio:"pipe"});
 async function prepare(x:Awaited<ReturnType<typeof setup>>,view=x.view){if(view.type!=="RECORDS")throw Error("fixture");const run=await createRecordsRevisionRead({api:x.api,store,token:x.token,ownerKey:x.scope.ownerKey,contractId:x.f.contract,appView:view,isCurrent:()=>true});const [definition,result]=await Promise.all([run.api.getEntityDefinition(x.token,x.f.contract,view.config.entityTypeId).then(async d=>{await store.upsertEntityDefinition(x.f.contract,view.config.entityTypeId,d.entity,new Date().toISOString());return d;}),refreshEntityRecordsCache({api:run.api,store,token:x.token,ownerKey:x.scope.ownerKey,contractId:x.f.contract,entityTypeId:view.config.entityTypeId,suppressNetworkTelemetry:true})]);await run.finish();return{run,definition,result};}
 const inspect=(x:Awaited<ReturnType<typeof setup>>,view=x.view)=>store.inspectRecordsRevisionCoverage({scope:x.scope,appView:view,isCurrent:()=>true});
 it.each([["emptyRecords",0],["smallRecords",2],["catalogRecords",137],["records",201]])("accredits and reopens %s with %s records",async(k,total)=>{const x=await setup(),view=x.views.find(v=>v.id===x.f[k])!;await prepare(x,view);const before=await inspect(x,view);expect(before).toMatchObject({coverage:"complete",status:"remote_unchecked",reuseAllowed:false});expect(before.receipt!.parts[2].artifact).toMatchObject({total});
  if(k==="records"){const row=await store.getCachedRecord({ownerKey:x.scope.ownerKey,contractId:x.f.contract,entityTypeId:x.f.source,recordId:x.f.person});expect(row?.values.choice).toBe("x");expect(row?.values.reference).toMatchObject({id:x.f.lot1,displayName:expect.any(String)});expect(row?.values.references).toHaveLength(2);const definition=await store.getEntityDefinition(x.f.contract,x.f.source);expect(definition!.definition.fields.find(f=>f.id===x.f.sourceChoice)!.options!.some(o=>o.value==="x")).toBe(true);}
  const calls=x.traffic.length;await db.closeAsync();await open();expect((await inspect(x,view)).receipt?.snapshotId).toBe(before.receipt!.snapshotId);expect(x.traffic.length).toBe(calls);});
 it("does not certify a visited search/filter/ordering page as a full collection",async()=>{const x=await setup();expect((await inspect(x)).coverage).toBe("unprepared");
  for(const query of[{search:"Synthetic",sort:"displayName" as const,direction:"asc" as const},{fieldIdHasValue:x.f.sourceChoice,sort:("fieldId:"+x.f.name) as `fieldId:${string}`,direction:"desc" as const},{search:"No synthetic matching record"}]){const run=await createRecordsRevisionRead({api:x.api,store,token:x.token,ownerKey:x.scope.ownerKey,contractId:x.f.contract,appView:x.view,isCurrent:()=>true});const d=await run.api.getEntityDefinition(x.token,x.f.contract,x.f.source);await store.upsertEntityDefinition(x.f.contract,x.f.source,d.entity,new Date().toISOString());await loadRecordsWithOfflineCache({api:run.api,store,token:x.token,ownerKey:x.scope.ownerKey,contractId:x.f.contract,entityTypeId:x.f.source,page:1,pageSize:25,...query});await run.finish();expect(await inspect(x)).toMatchObject({coverage:"partial",receipt:null,reuseAllowed:false});}
 });
 it.each(["source","option","nested","relation"])("invalidates the collection after remote %s change",async op=>{const x=await setup();await prepare(x);control(op);const manifest=await x.api.getOfflineRevisionManifest(x.token,x.f.contract);expect(await store.inspectRecordsRevisionCoverage({scope:x.scope,appView:x.view,manifest,isCurrent:()=>true})).toMatchObject({coverage:"partial",status:"invalid",reason:"REVISION_REMOTE_CHANGED"});await prepare(x);expect((await inspect(x)).coverage).toBe("complete");});
 it("rejects real HTTP409 before reconciling changed pages",async()=>{const x=await setup();await prepare(x);const rows=await db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id"),read=x.api.getRevisionRead;let changed=false;x.api.getRevisionRead=async(...args)=>{const d=await read(...args);if(!changed&&args[2].kind==="records"&&args[2].query?.page==="1"){changed=true;control("source");}return d;};await expect(prepare(x)).rejects.toMatchObject({status:409});expect(x.traffic.some(t=>t.status===409)).toBe(true);expect(await db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id")).toEqual(rows);});
 it("retains complete local rows after interruption and refreshes on reconnect",async()=>{const x=await setup();await prepare(x);const previous=(await inspect(x)).receipt!.snapshotId,read=x.api.getRevisionRead;x.api.getRevisionRead=async(...args)=>{if(args[2].kind==="records"&&args[2].query?.page==="2")throw Error("Synthetic transport interrupted");return read(...args);};const result=await prepare(x);expect(result.result.fromCache).toBe(true);expect((await inspect(x)).receipt!.snapshotId).toBe(previous);await db.closeAsync();await open();expect((await inspect(x)).coverage).toBe("complete");x.api.getRevisionRead=read;await prepare(x);expect((await inspect(x)).receipt!.snapshotId).not.toBe(previous);});
 it("keeps pending and conflicts intact but refuses to certify their overlaid collection",async()=>{const x=await setup();await prepare(x);for(const conflict of[false,true]){const row=await store.createLocalRecord({ownerKey:x.scope.ownerKey,contractId:x.f.contract,entityTypeId:x.f.source,values:{name:"Synthetic protected"}});if(conflict)await db.runAsync("UPDATE entity_records SET sync_status='conflict' WHERE local_id=?",row.localId);}const protectedHash=async()=>revisionHash({rows:await db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced' ORDER BY local_id"),outbox:await db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")}),before=await protectedHash();await prepare(x);expect((await inspect(x)).coverage).toBe("partial");expect(await protectedHash()).toBe(before);await db.closeAsync();await open();expect(await protectedHash()).toBe(before);});
 it("isolates owner, contract, configuration and authorization",async()=>{const x=await setup();await prepare(x);expect((await store.inspectRecordsRevisionCoverage({scope:{...x.scope,ownerKey:"another"},appView:x.view,isCurrent:()=>true})).coverage).toBe("unprepared");expect((await store.inspectRecordsRevisionCoverage({scope:{...x.scope,contractId:x.f.foreignContract},appView:x.view,isCurrent:()=>true})).coverage).toBe("unprepared");expect((await store.inspectRecordsRevisionCoverage({scope:x.scope,appView:{...x.view,name:"New configuration"},isCurrent:()=>true})).status).toBe("invalid");await prepare(x);try{control("role-member");const m=await x.api.getOfflineRevisionManifest(x.token,x.f.contract);expect((await store.inspectRecordsRevisionCoverage({scope:{...m.scope,ownerKey:x.scope.ownerKey},appView:x.view,manifest:m,isCurrent:()=>true})).status).toBe("invalid");}finally{control("role-admin");}});
 it("fences an obsolete receipt after another read and after scope cancellation",async()=>{const x=await setup(),input={api:x.api,store,token:x.token,ownerKey:x.scope.ownerKey,contractId:x.f.contract,appView:x.view};let active=true;const old=await createRecordsRevisionRead({...input,isCurrent:()=>active});await old.api.getEntityDefinition(x.token,x.f.contract,x.f.source).then(d=>store.upsertEntityDefinition(x.f.contract,x.f.source,d.entity,new Date().toISOString()));await refreshEntityRecordsCache({api:old.api,store,token:x.token,ownerKey:x.scope.ownerKey,contractId:x.f.contract,entityTypeId:x.f.source,suppressNetworkTelemetry:true});await prepare(x);const recent=(await inspect(x)).receipt!.snapshotId;await old.finish();expect((await inspect(x)).receipt!.snapshotId).toBe(recent);active=false;await old.finish();expect((await inspect(x)).receipt!.snapshotId).toBe(recent);});
 it("invalidates deleted rows and reaccredits the new complete set",async()=>{const x=await setup();control("create-source");await prepare(x);control("delete-source");const manifest=await x.api.getOfflineRevisionManifest(x.token,x.f.contract);expect((await store.inspectRecordsRevisionCoverage({scope:x.scope,appView:x.view,manifest,isCurrent:()=>true})).status).toBe("invalid");await prepare(x);expect((await inspect(x)).receipt!.parts[2].artifact).toMatchObject({total:201});});
 it("rejects receipt persistence failure and unsupported metadata without inventing an empty collection",async()=>{const x=await setup(),write=db.runAsync;db.runAsync=async(sql,...args)=>{if(sql.includes("INSERT INTO app_metadata")&&String(args[0]).startsWith("records_revision_receipt:v1:"))throw Error("Synthetic receipt persistence error");return write(sql,...args);};await prepare(x);db.runAsync=write;expect(await inspect(x)).toMatchObject({coverage:"partial",receipt:null});await prepare(x);await db.runAsync("UPDATE app_metadata SET value=json_set(value,'$.version',2) WHERE key LIKE 'records_revision_receipt:v1:%'");expect((await inspect(x)).status).toBe("invalid");});
 it("keeps legacy reads explicit when Core does not support revision manifests",async()=>{const x=await setup();x.api.getOfflineRevisionManifest=async()=>{throw new OpcoApiError("Synthetic old Core","NOT_FOUND",404);};await prepare(x);expect(await inspect(x)).toMatchObject({coverage:"partial",receipt:null});const status=await db.getAllAsync("SELECT value FROM app_metadata WHERE key LIKE 'records_revision_status:v1:%'")as{value:string}[];expect(status.some(s=>JSON.parse(s.value).reason==="RECORDS_REVISION_UNAVAILABLE")).toBe(true);});
 it("never downgrades an authorization denial to an unbound remote read",async()=>{const x=await setup(),read=x.api.getEntityRecords;x.api.getOfflineRevisionManifest=async()=>{throw new OpcoApiError("Synthetic denied actor","FORBIDDEN",403);};const spy=vi.spyOn(x.api,"getEntityRecords");await expect(prepare(x)).rejects.toMatchObject({status:403});expect(spy).not.toHaveBeenCalled();x.api.getEntityRecords=read;});
 it("rejects changed local content after SQLite reopen",async()=>{const x=await setup();await prepare(x);await db.runAsync("UPDATE entity_records SET display_name=? WHERE server_id=?","Synthetic locally changed label",x.f.person);await db.closeAsync();await open();expect(await inspect(x)).toMatchObject({coverage:"partial",status:"invalid",reason:"REVISION_LOCAL_CONTENT_MISMATCH"});});

});
