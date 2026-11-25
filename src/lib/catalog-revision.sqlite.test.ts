// Real SQLite-file transport reused from the stage-3 receipt harness.
// @ts-expect-error Node types are intentionally absent from Expo config.
import {spawn, execFileSync} from "node:child_process";
// @ts-expect-error Node types are intentionally absent from Expo config.
import {mkdtempSync, rmSync, readFileSync} from "node:fs";
import {beforeEach, afterEach, describe, it, expect, vi} from "vitest";
import {getLocalDatabase, __resetLocalDatabaseForTests} from "./local-db";
import {createOpcoApi} from "./opco-api";
import {prewarmAssignedAppViews} from "./app-view-prewarm";
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


const realSuite=process.env.CATALOG_HTTP==="1"?describe.sequential:describe.skip;
realSuite("catalog receipts with real Core and SQLite",()=>{
 async function setup(){const f=JSON.parse(readFileSync(process.env.REVISION_RECEIPT_FIXTURE!,"utf8")),traffic:{path:string;query:string;status:number}[]=[];
  const api=createOpcoApi({apiUrl:"http://127.0.0.1:19564",fetcher:async(url,init)=>{const response=await fetch(url,init),u=new URL(String(url));traffic.push({path:u.pathname,query:u.search,status:response.status});return response;}});
  const login=await api.login(f.credentials.email,f.credentials.password);if(!("accessToken"in login))throw Error("Synthetic login failed");
  const m=await api.getOfflineRevisionManifest(login.accessToken,f.contract),scope={...m.scope,ownerKey:m.scope.organizationId+":"+m.scope.userId},views=(await api.getAppViews(login.accessToken,f.contract)).views;
  await store.upsertAppViews(scope.ownerKey,f.contract,views,new Date().toISOString());return{f,api,scope,views,token:login.accessToken,traffic};
 }
 const control=(op:string)=>execFileSync("node",[process.env.REVISION_RECEIPT_CONTROL!,op],{env:{...process.env,DATABASE_URL:"postgresql://receipt_owner@127.0.0.1:19563/receipt_shadow?schema=public"},stdio:"pipe"});
 async function prepare(x:Awaited<ReturnType<typeof setup>>,ids=[x.f.records]){await prewarmAssignedAppViews({api:x.api,store,token:x.token,ownerKey:x.scope.ownerKey,contractId:x.f.contract,appViews:x.views,prepareAppViewIds:ids});}
 const inspect=(x:Awaited<ReturnType<typeof setup>>)=>store.inspectCatalogRevisionReceipts({scope:x.scope,isCurrent:()=>true});
 it("shares complete source/catalog data across RECORDS, Attendance and STATE_UPDATE and reopens offline",async()=>{
  const x=await setup();await prepare(x,[x.f.records,x.f.attendancePlain,x.f.state]);const receipts=await inspect(x);
  expect(receipts.length,JSON.stringify(await store.getPreparationRevisionStatus(x.scope.ownerKey,x.f.contract))).toBe(3);
  expect(receipts.every(r=>r.status==="remote_unchecked"&&r.reuseAllowed===false)).toBe(true);
  expect(x.traffic.filter(t=>t.path.endsWith("/entities/"+x.f.catalog+"/records"))).toHaveLength(2);
  expect(x.traffic.filter(t=>t.path.endsWith("/entities/"+x.f.source+"/records"))).toHaveLength(3);
  expect(x.traffic.filter(t=>t.path.endsWith("/entities/"+x.f.empty+"/records"))).toHaveLength(1);
  expect(x.traffic.filter(t=>t.path.endsWith("/entities/"+x.f.small+"/records"))).toHaveLength(1);
  expect((await store.listCachedRecords({ownerKey:x.scope.ownerKey,contractId:x.f.contract,entityTypeId:x.f.small})).pagination.total).toBe(2);
  const recordReceipt=receipts.find(r=>r.receipt?.appViewId===x.f.records)!.receipt!;
  expect(recordReceipt.dependencies.some(d=>d.cardinality==="ONE")).toBe(true);expect(recordReceipt.dependencies.some(d=>d.cardinality==="MANY")).toBe(true);
  expect(recordReceipt.parts.some(p=>p.artifact.kind==="records"&&p.artifact.entityTypeId===x.f.empty&&p.artifact.total===0)).toBe(true);
  expect(x.traffic.some(t=>t.path.endsWith("/entities/"+x.f.nested+"/records"))).toBe(false);
  const ids=receipts.map(r=>r.receipt!.snapshotId).sort(),before=x.traffic.length;await db.closeAsync();await open();
  expect((await inspect(x)).map(r=>r.receipt!.snapshotId).sort()).toEqual(ids);expect(x.traffic.length).toBe(before);
  const m=await x.api.getOfflineRevisionManifest(x.token,x.f.contract);expect((await store.inspectCatalogRevisionReceipts({scope:x.scope,manifest:m,isCurrent:()=>true})).every(r=>r.status==="match_shadow")).toBe(true);
 });
 it.each(["option","nested","relation","catalog"])("invalidates durable receipts after remote %s change",async op=>{
  const x=await setup();await prepare(x);control(op);const m=await x.api.getOfflineRevisionManifest(x.token,x.f.contract);
  const invalid=await store.inspectCatalogRevisionReceipts({scope:x.scope,manifest:m,isCurrent:()=>true});expect(invalid).toHaveLength(1);expect(invalid[0]).toMatchObject({status:"invalid",reason:"REVISION_REMOTE_CHANGED",reuseAllowed:false});
  expect((await store.listCachedRecords({ownerKey:x.scope.ownerKey,contractId:x.f.contract,entityTypeId:x.f.catalog,pageSize:200})).pagination.total).toBe(137);
  await prepare(x);expect((await inspect(x))[0].status).toBe("remote_unchecked");
 });
 it("rejects a real revision change between catalog pages without replacing prior complete data",async()=>{
  const x=await setup();await prepare(x);const original=(await inspect(x))[0].receipt!,before=await db.getAllAsync("SELECT local_id,values_json,display_name FROM entity_records ORDER BY local_id"),read=x.api.getRevisionRead;let changed=false;
  x.api.getRevisionRead=async(...args)=>{const d=await read(...args);if(!changed&&args[2].kind==="records"&&args[2].entityTypeId===x.f.catalog&&args[2].query?.page==="1"){changed=true;control("catalog");}return d;};
  await prepare(x);expect(changed).toBe(true);expect(x.traffic.some(t=>t.status===409)).toBe(true);
  const retained=(await inspect(x))[0];expect(retained).toMatchObject({status:"remote_unchecked",receipt:{snapshotId:original.snapshotId,localHash:original.localHash},reuseAllowed:false});
  const fresh=await x.api.getOfflineRevisionManifest(x.token,x.f.contract);
  expect(fresh.readBindingVector.revision).not.toBe(original.remote.vector);
  expect(await store.inspectCatalogRevisionReceipts({scope:x.scope,manifest:fresh,isCurrent:()=>true})).toMatchObject([{status:"invalid",reason:"REVISION_REMOTE_CHANGED",receipt:null,reuseAllowed:false}]);
  expect(await db.getAllAsync("SELECT local_id,values_json,display_name FROM entity_records ORDER BY local_id")).toEqual(before);
 });
 it("keeps incomplete/interrupted catalogs unaccredited and revalidates after reconnect",async()=>{
  const x=await setup();await prepare(x);const original=(await inspect(x))[0].receipt!,read=x.api.getRevisionRead;x.api.getRevisionRead=async(...args)=>{if(args[2].kind==="records"&&args[2].entityTypeId===x.f.catalog&&args[2].query?.page==="2")throw Error("Synthetic interrupted catalog");return read(...args);};
  await prepare(x);await db.closeAsync();await open();
  expect((await inspect(x))[0]).toMatchObject({status:"remote_unchecked",receipt:{snapshotId:original.snapshotId,localHash:original.localHash},reuseAllowed:false});
  const fresh=await x.api.getOfflineRevisionManifest(x.token,x.f.contract);
  expect(fresh.readBindingVector.revision).toBe(original.remote.vector);
  expect((await store.inspectCatalogRevisionReceipts({scope:x.scope,manifest:fresh,isCurrent:()=>true}))[0]).toMatchObject({status:"match_shadow",receipt:{snapshotId:original.snapshotId},reuseAllowed:false});
  expect((await store.listCachedRecords({ownerKey:x.scope.ownerKey,contractId:x.f.contract,entityTypeId:x.f.catalog,pageSize:200})).pagination.total).toBe(137);
  x.api.getRevisionRead=read;await prepare(x);const refreshed=(await inspect(x))[0];expect(refreshed.status).toBe("remote_unchecked");expect(refreshed.receipt!.snapshotId).not.toBe(original.snapshotId);
 });
 it("isolates permissions, owners, contracts and apps",async()=>{
  const x=await setup();await prepare(x);
  for(const scope of[{...x.scope,userId:"other",ownerKey:x.scope.organizationId+":other"},{...x.scope,contractId:x.f.foreignContract},{...x.scope,applicationId:"other"}])expect(await store.inspectCatalogRevisionReceipts({scope,isCurrent:()=>true})).toEqual([]);
  try{control("role-member");const m=await x.api.getOfflineRevisionManifest(x.token,x.f.contract);expect((await store.inspectCatalogRevisionReceipts({scope:{...m.scope,ownerKey:x.scope.ownerKey},manifest:m,isCurrent:()=>true}))[0]).toMatchObject({status:"invalid",reason:"REVISION_AUTHORIZATION_CHANGED"});}finally{control("role-admin");}
 });
 it("preserves pending/conflict data through catalog refresh",async()=>{
  const x=await setup();await prepare(x);
  for(const conflict of[false,true]){const row=await store.createLocalRecord({ownerKey:x.scope.ownerKey,contractId:x.f.contract,entityTypeId:x.f.catalog,values:{name:"Synthetic protected choice"}});if(conflict)await db.runAsync("UPDATE entity_records SET sync_status='conflict' WHERE local_id=?",row.localId);}
  const hash=async()=>revisionHash({rows:await db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced' ORDER BY local_id"),outbox:await db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")});const before=await hash();await prepare(x);expect(await hash()).toBe(before);expect((await inspect(x)).every(r=>r.status==="invalid")).toBe(true);
  await db.closeAsync();await open();expect(await hash()).toBe(before);
 });
 it("never publishes a receipt after failed final persistence",async()=>{
  const x=await setup(),writer=db.runAsync;db.runAsync=async(sql,...args)=>{if(sql.includes("INSERT INTO app_metadata")&&String(args[0]).startsWith("catalog_revision_receipt:v1:"))throw Error("Synthetic catalog receipt failure");return writer(sql,...args);};await prepare(x);db.runAsync=writer;expect(await inspect(x)).toEqual([]);
  const result=await store.listCachedRecords({ownerKey:x.scope.ownerKey,contractId:x.f.contract,entityTypeId:x.f.catalog,pageSize:200});expect(result.pagination.total).toBe(137);
 });
 it("does not accredit a catalog after its session/scope is retired",async()=>{
  const x=await setup(),read=x.api.getRevisionRead;const controller=new AbortController();let retired=false;
  x.api.getRevisionRead=async(...args)=>{const data=await read(...args);if(args[2].kind==="records"&&args[2].entityTypeId===x.f.catalog){controller.abort();retired=true;}return data;};
  await prewarmAssignedAppViews({api:x.api,store,token:x.token,ownerKey:x.scope.ownerKey,contractId:x.f.contract,appViews:x.views,prepareAppViewIds:[x.f.records],signal:controller.signal});
  expect(retired).toBe(true);expect(await inspect(x)).toEqual([]);
 });
 it("rejects changed local definitions after SQLite reopen without changing records",async()=>{
  const x=await setup();await prepare(x);const rows=await db.getAllAsync("SELECT local_id,values_json FROM entity_records ORDER BY local_id");
  const definition=await store.getEntityDefinition(x.f.contract,x.f.source);expect(definition).toBeTruthy();
  definition!.definition.fields.find(f=>f.id===x.f.sourceChoice)!.options![0].label="Synthetic local metadata change";
  await store.upsertEntityDefinition(x.f.contract,x.f.source,definition!.definition,new Date().toISOString());await db.closeAsync();await open();
  expect((await inspect(x)).every(r=>r.status==="invalid")).toBe(true);expect(await db.getAllAsync("SELECT local_id,values_json FROM entity_records ORDER BY local_id")).toEqual(rows);
 });
 it("rejects unsupported receipt versions and missing proof parts",async()=>{
  const x=await setup();await prepare(x);const row=(await db.getAllAsync("SELECT key,value FROM app_metadata WHERE key LIKE 'catalog_revision_receipt:v1:%'") as {key:string;value:string}[])[0];
  for(const mutate of[(r:Record<string,unknown>)=>r.version=2,(r:Record<string,unknown>)=>r.parts=[]]){
   const receipt=JSON.parse(row.value);mutate(receipt);await db.runAsync("UPDATE app_metadata SET value=? WHERE key=?",JSON.stringify(receipt),row.key);
   expect((await inspect(x))[0].status).toBe("invalid");
  }
 });
 it("binds SELECT context labels to their workflow definition revision",async()=>{
  const x=await setup();await prepare(x,[x.f.attendancePlain]);control("group-option");const m=await x.api.getOfflineRevisionManifest(x.token,x.f.contract);
  expect((await store.inspectCatalogRevisionReceipts({scope:x.scope,manifest:m,isCurrent:()=>true}))[0].status).toBe("invalid");await prepare(x,[x.f.attendancePlain]);expect((await inspect(x))[0].status).toBe("remote_unchecked");
 });

});

// C-09: these cases exercise the real SQLite facade; no HTTP/auth integration is implied.
describe("C09 catalog coverage read without attestation or mutation",()=>{
 const scope={ownerKey:"org:user",contractId:"contract",userId:"user",organizationId:"org",applicationId:"app",authorizationFingerprint:"a".repeat(64)};
 async function seed(count:number){
  const field={id:"required-related",key:"related",name:"Required related",type:"RELATION"as const,active:true,required:true,config:{relationKind:"ONE",targetEntityTypeId:"catalog"}};
  const source={id:"source",name:"Source",slug:"source",active:true,icon:null,fields:[field]},target={id:"catalog",name:"Choices",slug:"choices",active:true,icon:null,fields:[]};
  const view={id:"c09-view",name:"Synthetic",slug:"synthetic",icon:null,sortOrder:0,type:"RECORDS"as const,active:true,config:{entityTypeId:"source"}},prepared={kind:"records"as const,appView:view,entityDefinition:source};
  await store.upsertEntityDefinition(scope.contractId,source.id,source,"old");await store.upsertEntityDefinition(scope.contractId,target.id,target,"old");await store.upsertAppViews(scope.ownerKey,scope.contractId,[view],"old");await store.upsertAppViewDefinition({...scope,appViewId:view.id,appViewType:view.type,definition:prepared,status:"ready",lastPreparedAt:"old"});
  const records=Array.from({length:count},(_,i)=>({id:"choice-"+i,displayName:"Synthetic choice "+i,values:{},updatedAt:"2026-11-24T00:00:00Z"}));await store.upsertRemoteRecords({...scope,entityTypeId:target.id,records});
  return{view,prepared,source,target,records};
 }
 const read=(x:Awaited<ReturnType<typeof seed>>,ownerKey=scope.ownerKey)=>store.getLocalCatalogCoverage({ownerKey,contractId:scope.contractId,appViews:[x.view],isCurrent:()=>true});
 const snapshot=async()=>({metadata:await db.getAllAsync("SELECT * FROM app_metadata ORDER BY key"),records:await db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id"),outbox:await db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")});
 it.each([[0,"unprepared"],[137,"partial"]])("keeps %s local rows uncredited without a full proof",async(count,status)=>{const x=await seed(Number(count)),before=await snapshot();expect((await read(x))[x.view.id]).toMatchObject([{count,coverage:status,required:true}]);expect(await snapshot()).toEqual(before);});
 it.each([[0,"empty"],[137,"complete"]])("distinguishes confirmed empty from complete legacy hydration: %s",async(count,status)=>{const x=await seed(Number(count));await store.markSyncPhaseCompleted({...scope,entityTypeId:x.target.id,phase:"refreshing"});const before=await snapshot();expect((await read(x))[x.view.id]).toMatchObject([{count,coverage:status}]);await db.closeAsync();await open();expect((await read(x))[x.view.id]).toMatchObject([{count,coverage:status}]);expect(await snapshot()).toEqual(before);});
 it("cannot borrow another owner's options or turn a retired read into a certificate",async()=>{const x=await seed(137);await store.markSyncPhaseCompleted({...scope,entityTypeId:x.target.id,phase:"refreshing"});expect((await read(x,"org:other"))[x.view.id]).toEqual([]);await expect(store.getLocalCatalogCoverage({...scope,appViews:[x.view],isCurrent:()=>false})).rejects.toMatchObject({code:"REVISION_SCOPE_RETIRED"});});
 it("checks the same durable receipt hash when telemetry was suppressed, without invalidating it",async()=>{
  const x=await seed(2),hash="b".repeat(64);const manifest={version:1 as const,representationVersion:1 as const,mode:"shadow"as const,reuseAllowed:false as const,epoch:"synthetic-epoch",readDefinitionsRevision:hash,scope,readBindingVector:{version:1 as const,representationVersion:1 as const,available:true,revision:hash}};
  const seal={version:1 as const,representationVersion:1 as const,mode:"shadow"as const,reuseAllowed:false as const,clientMaySkipReads:false as const,coverageCertified:false as const,revision:hash,manifestVectorRevision:hash,epoch:manifest.epoch,authorizationFingerprint:scope.authorizationFingerprint,selectionFingerprint:hash,requestFingerprint:hash,contentHash:hash,snapshot:{isolation:"repeatable-read"as const,at:"2026-11-24T00:00:00Z"}};
  const context={scope,manifest,sessionId:"synthetic-session",isCurrent:()=>true};await store.beginRevisionReceiptSession(context);
  const dependencies=[{entityTypeId:x.source.id,fieldId:x.source.fields[0].id,type:"RELATION",roles:["record-field"],targetEntityTypeId:x.target.id,cardinality:"ONE"as const}];
  const parts:import("./preparation-revision-contract").PreparationPart[]=[...([x.source,x.target].map(entity=>({resource:{kind:"definition"as const,entityTypeId:entity.id},artifact:{kind:"definition"as const,entityTypeId:entity.id},reads:[seal],expected:{json:entity}}))),{resource:{kind:"records",entityTypeId:x.target.id},artifact:{kind:"records",entityTypeId:x.target.id,total:2},reads:[seal],expected:{records:x.records}},{resource:{kind:"views"},artifact:{kind:"views"},reads:[seal],expected:{json:[x.view]}}];
  await store.commitCatalogRevisionReceipt(context,{appView:x.view,prepared:x.prepared,dependencies,parts});expect(await store.getSyncTelemetry({...scope,entityTypeId:x.target.id})).toBeNull();let before=await snapshot();expect((await read(x))[x.view.id]).toMatchObject([{coverage:"complete",count:2}]);expect(await snapshot()).toEqual(before);
  await db.runAsync("UPDATE entity_records SET display_name='Synthetic changed content' WHERE server_id='choice-0'");before=await snapshot();expect((await read(x))[x.view.id]).toMatchObject([{coverage:"partial",count:2}]);expect(await snapshot()).toEqual(before);const row=await db.getFirstAsync("SELECT value FROM app_metadata WHERE key LIKE 'catalog_revision_receipt:v1:%'");expect(JSON.parse(String(row!.value)).status).toBe("verified");
 });
 it("counts only identities selectable by each existing renderer, without changing the pending catalog row",async()=>{
  const x=await seed(0);await store.markSyncPhaseCompleted({...scope,entityTypeId:x.target.id,phase:"refreshing"});
  const pending=await store.createLocalRecord({...scope,entityTypeId:x.target.id,values:{}});
  const workflow={id:"workflow-local-selection",name:"Synthetic workflow",slug:"workflow",icon:null,sortOrder:0,type:"WORKFLOW"as const,config:{workflowKey:"state-update",sourceEntityTypeId:x.target.id,targetEntityTypeId:x.source.id,subjectFieldId:x.source.fields[0].id,stateFields:[],extraFieldIds:[],uniqueness:"subject",historyMode:"append"}};
  const prepared={kind:"state-update"as const,appView:workflow,sourceEntityTypeId:x.target.id,targetEntityTypeId:x.source.id,subjectFieldId:x.source.fields[0].id,stateFields:[],extraFields:[],uniqueness:"subject"as const,historyMode:"append"as const};
  await store.upsertAppViewDefinition({...scope,appViewId:workflow.id,appViewType:workflow.type,status:"ready",lastPreparedAt:"old",definition:prepared});
  const before=await snapshot(),facts=await store.getLocalCatalogCoverage({...scope,appViews:[x.view,workflow]});
  expect(facts[x.view.id]).toMatchObject([{coverage:"complete",count:1}]);expect(facts[workflow.id]).toMatchObject([{coverage:"empty",count:0}]);
  expect(await snapshot()).toEqual(before);expect((await store.getCachedRecord({...scope,entityTypeId:x.target.id,recordId:pending.localId}))?.syncStatus).toBe("pending_create");
 });

});
