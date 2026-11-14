// Real SQLite-file transport reused from the stage-3 receipt harness.
// @ts-expect-error Node types are intentionally absent from Expo config.
import {spawn, execFileSync} from "node:child_process";
// @ts-expect-error Node types are intentionally absent from Expo config.
import {mkdtempSync, rmSync, readFileSync, writeFileSync} from "node:fs";
import {beforeEach, afterEach, describe, it, expect, vi} from "vitest";
import {getLocalDatabase, __resetLocalDatabaseForTests} from "./local-db";
import {createOpcoApi, type OpcoApi} from "./opco-api";
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

describe("receipt inspection keeps exact proofs and scopes across reopen",()=>{
 const scope={ownerKey:"org:user",organizationId:"org",userId:"user",applicationId:"app",contractId:"contract",authorizationFingerprint:"b".repeat(64)};
 const manifest={version:1 as const,representationVersion:1 as const,mode:"shadow"as const,reuseAllowed:false as const,epoch:"epoch1",readDefinitionsRevision:"a".repeat(64),scope,readBindingVector:{version:1 as const,representationVersion:1 as const,available:true,revision:"c".repeat(64)}};
 const appView={id:"audit-view",name:"Synthetic",type:"BOARD",config:{}} as unknown as import("./opco-api").AppView;
 async function seed(){
  const context={scope,manifest,sessionId:"session",runId:"run",isCurrent:()=>true};
  await store.upsertAppViews(scope.ownerKey,scope.contractId,[appView],"2026-11-12T00:00:00Z");
  const prepared={kind:"unsupported"as const,appView};await store.upsertAppViewDefinition({ownerKey:scope.ownerKey,contractId:scope.contractId,appViewId:appView.id,appViewType:appView.type,workflowKey:null,status:"ready",definition:prepared,lastPreparedAt:"2026-11-12T00:00:00Z"});
  await store.beginRevisionReceiptSession(context);
  const read={version:1 as const,representationVersion:1 as const,mode:"shadow"as const,reuseAllowed:false as const,clientMaySkipReads:false as const,revision:"d".repeat(64),manifestVectorRevision:manifest.readBindingVector.revision,epoch:manifest.epoch,authorizationFingerprint:scope.authorizationFingerprint,selectionFingerprint:"e".repeat(64),requestFingerprint:"f".repeat(64),contentHash:"0".repeat(64),snapshot:{isolation:"repeatable-read"as const,at:"2026-11-12T00:00:00Z"},coverageCertified:false as const};
  return store.commitPreparationRevisionReceipt(context,{appView,prepared,coverage:{version:1,kind:"metadata-only",complete:true,scope:"ordinary-preparation",businessDataIncluded:false,arbitraryQueries:false,relationCatalogs:false,latest:"not-included",dates:[]},parts:[{resource:{kind:"views"},artifact:{kind:"views"},expected:{json:[appView]},reads:[read]}],markers:[]});
 }
 it("denies another requested period without destroying the valid proof for its original coverage",async()=>{const original=await seed();const mismatch=await store.inspectPreparationRevisionReceipts({scope,manifest,request:{appViewId:appView.id,kind:"metadata-only",dates:["2026-12-01"]},isCurrent:()=>true});expect(mismatch).toMatchObject([{status:"invalid",reason:"PREPARATION_REQUEST_COVERAGE_MISMATCH",receipt:null,reuseAllowed:false}]);await db.closeAsync();await open();const valid=await store.inspectPreparationRevisionReceipts({scope,manifest,request:{appViewId:appView.id,kind:"metadata-only",dates:[],snapshotId:original.snapshotId,definition:appView},isCurrent:()=>true});expect(valid[0]).toMatchObject({status:"match_shadow",receipt:{snapshotId:original.snapshotId},reuseAllowed:false});});
 it.each(["epoch","data","metadata"])("invalidates after %s change instead of treating retained proof as fresh",async change=>{await seed();const next={...manifest,...(change==="epoch"?{epoch:"new-epoch"}:change==="metadata"?{readDefinitionsRevision:"1".repeat(64)}:{readBindingVector:{...manifest.readBindingVector,revision:"2".repeat(64)}})};expect((await store.inspectPreparationRevisionReceipts({scope,manifest:next,isCurrent:()=>true}))[0]).toMatchObject({status:"invalid",reason:"REVISION_REMOTE_CHANGED",receipt:null});});
 it("rolls back withdrawal if the generation changes while its transaction is active",async()=>{const old=await seed();let calls=0;await expect(store.retirePreparationRevisionReceipts(scope.ownerKey,scope.contractId,"OLD_DENIAL",()=>++calls===1)).rejects.toMatchObject({code:"REVISION_SCOPE_RETIRED"});const valid=await store.inspectPreparationRevisionReceipts({scope,manifest,isCurrent:()=>true});expect(valid[0]).toMatchObject({status:"match_shadow",receipt:{snapshotId:old.snapshotId}});});
 it("does not share proof with another user or contract",async()=>{await seed();for(const other of[{...scope,ownerKey:"org:other",userId:"other"},{...scope,contractId:"other"}])expect(await store.inspectPreparationRevisionReceipts({scope:other,isCurrent:()=>true})).toEqual([]);});
});

const realSuite = process.env.REVISION_PREPARATION_HTTP === "1" ? describe.sequential : describe.skip;
realSuite("ordinary preparation with bound revision receipts, real HTTP and SQLite", () => {
  type Fixture = {org:string;contract:string;source:string;target:string;attendance:string;attendancePlain:string;state:string;current:string;records:string;panel:string;report:string;matrix:string;note:string;person:string;person2:string;record:string;day:string;subjectCount:number;credentials:{email:string;password:string}};
  const base = "http://127.0.0.1:19564";
  async function setup(fetcher?: typeof fetch) {
    const f = JSON.parse(readFileSync(process.env.REVISION_RECEIPT_FIXTURE!, "utf8")) as Fixture;
    const traffic: {path:string; query:string; status:number; method:string}[] = [];
    const api = createOpcoApi({apiUrl:base, fetcher:async (url,init)=>{const response=await (fetcher??fetch)(url,init);const u=new URL(String(url));traffic.push({path:u.pathname,query:u.search,status:response.status,method:init?.method??"GET"});return response;}});
    const login = await api.login(f.credentials.email,f.credentials.password);if(!("accessToken" in login))throw Error("Synthetic login selection unexpected");
    const manifest = await api.getOfflineRevisionManifest(login.accessToken,f.contract), scope={...manifest.scope,ownerKey:manifest.scope.organizationId+":"+manifest.scope.userId};
    const views=(await api.getAppViews(login.accessToken,f.contract)).views;
    await store.upsertAppViews(scope.ownerKey,f.contract,views,new Date().toISOString());traffic.splice(0);
    return {f,api,scope,token:login.accessToken,views,traffic};
  }
  async function prepare(x: Awaited<ReturnType<typeof setup>>, api: OpcoApi=x.api, signal?:AbortSignal) {
    await prewarmAssignedAppViews({api,store,token:x.token,ownerKey:x.scope.ownerKey,contractId:x.f.contract,appViews:x.views,signal});
  }
  const inspect=(x:Awaited<ReturnType<typeof setup>>)=>store.inspectPreparationRevisionReceipts({scope:x.scope,isCurrent:()=>true});
  const control=(operation:string)=>execFileSync("node",[process.env.REVISION_RECEIPT_CONTROL!,operation],{env:{...process.env,DATABASE_URL:"postgresql://receipt_owner@127.0.0.1:19563/receipt_shadow?schema=public"},stdio:"pipe"});
  const protectedHash=async()=>revisionHash({rows:await db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced' ORDER BY local_id"),outbox:await db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")});
  it("composes month/current/snapshot and metadata-only coverage without redownloading shared entities",async()=>{
    const x=await setup(),operations:{kind:string;operation:string|undefined}[]=[],read=x.api.getRevisionRead;
    x.api.getRevisionRead=async(...args)=>{operations.push({kind:args[2].kind,operation:args[4]?.diagnosticOperation});return read(...args);};
    await prepare(x);const result=await inspect(x),status=await store.getPreparationRevisionStatus(x.scope.ownerKey,x.f.contract);
    expect(operations.filter(o=>o.kind==="attendance").every(o=>o.operation==="DAY_LOAD")).toBe(true);expect(operations.some(o=>o.kind==="state-update"&&o.operation==="RECONCILE")).toBe(true);
    expect(result.length,JSON.stringify(status)).toBe(8);expect(result.every(r=>r.status==="remote_unchecked"&&r.reuseAllowed===false),JSON.stringify(status)).toBe(true);
    const receipts=result.map(r=>r.receipt!);expect(receipts.find(r=>r.appViewId===x.f.attendance)?.coverage).toMatchObject({kind:"attendance-month",businessDataIncluded:true});expect(receipts.find(r=>r.appViewId===x.f.attendancePlain)?.coverage).toMatchObject({kind:"attendance-month",businessDataIncluded:true,relationCatalogs:false,dates:expect.any(Array)});
    expect(receipts.find(r=>r.appViewId===x.f.attendancePlain)?.coverage.dates).toHaveLength(new Date(Number(x.f.day.slice(0,4)),Number(x.f.day.slice(5,7)),0).getDate());
    expect(receipts.find(r=>r.appViewId===x.f.current)?.coverage).toMatchObject({kind:"state-update-current",subjectCount:x.f.subjectCount});
    for(const id of[x.f.records,x.f.panel,x.f.report,x.f.matrix])expect(receipts.find(r=>r.appViewId===id)?.coverage).toMatchObject({kind:"metadata-only",businessDataIncluded:false,arbitraryQueries:false});
    expect(x.traffic.filter(t=>t.path.endsWith("/entities/"+x.f.source+"/records"))).toHaveLength(Math.ceil(x.f.subjectCount/100));
    expect(x.traffic.filter(t=>t.path.endsWith("/entities/"+x.f.source))).toHaveLength(1);
    expect(x.traffic.some(t=>t.query.includes("page=2")&&t.query.includes("expectedReadRevision="))).toBe(true);
    const before=x.traffic.length,ids=receipts.map(r=>r.snapshotId).sort();await db.closeAsync();await open();const reopened=await inspect(x);expect(reopened.map(r=>r.receipt!.snapshotId).sort()).toEqual(ids);expect(x.traffic.length).toBe(before);
    const m=await x.api.getOfflineRevisionManifest(x.token,x.f.contract);expect((await store.inspectPreparationRevisionReceipts({scope:x.scope,manifest:m,isCurrent:()=>true})).every(r=>r.status==="match_shadow")).toBe(true);
    if(process.env.REVISION_PREPARATION_METRICS)writeFileSync(process.env.REVISION_PREPARATION_METRICS,JSON.stringify({receipts:receipts.map(r=>({appViewId:r.appViewId,coverage:r.coverage,parts:r.parts.length})),traffic:x.traffic,namespace:"opco-client-v10-epoch2.db"}));
  });
  it("keeps a signed legacy latest without Observation unaccredited",async()=>{
    const x=await setup(async(url,init)=>{
      const response=await fetch(url,init);
      if(!String(url).includes("/views/"))return response;
      const body=await response.clone().json();
      if(body.data?.observationProjection){
        delete body.data.observationProjection;
        for(const event of body.data.latest)delete event.observation;
        if(body.readRevision)body.readRevision.contentHash=await revisionHash(body.data);
        return new Response(JSON.stringify(body),{status:response.status,headers:response.headers});
      }
      return response;
    });
    await prepare(x);
    expect((await inspect(x)).some(r=>r.receipt?.appViewId===x.f.attendance)).toBe(false);
    expect(JSON.stringify(await store.getPreparationRevisionStatus(x.scope.ownerKey,x.f.contract))).toContain("PREPARATION_OBSERVATION_UNBOUND");
  });
  it.each(["note-text","note-empty","note-null"])("persists %s across SQLite reopen and detects a remote revision change",async operation=>{
    const x=await setup();
    {
      control(operation);await prepare(x);
      const online=await x.api.getAttendanceWorkflow(x.token,x.f.contract,x.f.attendance,{date:x.f.day});
      expect(online.items).toEqual([]);expect(online.observationProjection).toEqual({version:1,fieldId:x.f.note});
      const expected=operation==="note-text"?"Synthetic ñ\nSecond line":operation==="note-empty"?"":null;
      expect(online.latest.find(e=>e.attendanceRecordId===x.f.record)?.observation).toBe(expected);
      const receipts=await inspect(x);expect(receipts.find(r=>r.receipt?.appViewId===x.f.attendance)?.status).toBe("remote_unchecked");
      await db.closeAsync();await open();
      const events=await store.listStateUpdateLatest({ownerKey:x.scope.ownerKey,contractId:x.f.contract,appViewId:x.f.attendance,targetEntityTypeId:x.f.target,date:x.f.day});
      expect(events.items.find(e=>e.subject.id===x.f.person)?.extraValues?.[x.f.note]).toBe(expected);
      expect((await inspect(x)).find(r=>r.receipt?.appViewId===x.f.attendance)?.status).toBe("remote_unchecked");
      control("note-text");
      const manifest=await x.api.getOfflineRevisionManifest(x.token,x.f.contract);
      expect((await store.inspectPreparationRevisionReceipts({scope:x.scope,manifest,isCurrent:()=>true})).every(r=>r.status==="invalid" && r.reuseAllowed===false)).toBe(true);
    }
  });
  it("certifies the whole day using new bounded pages when legacy latest exceeds ten",async()=>{
    const x=await setup();control("add-eleven");
    try{
      const day=await x.api.getAttendanceWorkflow(x.token,x.f.contract,x.f.attendance,{date:x.f.day});
      expect(day.items).toEqual([]);expect(day.latest).toHaveLength(10);expect(day.summary.totalRegistered).toBe(11);
      await prepare(x);expect((await inspect(x)).some(r=>r.receipt?.appViewId===x.f.attendance)).toBe(true);
      expect(x.traffic.some(t=>t.query.includes("daySnapshotVersion=1"))).toBe(true);
    }finally{control("remove-eleven");}
  });
  it("does not certify a swallowed failed Attendance day and keeps the usable cache",async()=>{
    const x=await setup();await prepare(x);const cached=await db.getAllAsync("SELECT server_id FROM entity_records WHERE entity_type_id=?",x.f.source);
    const original=x.api.getRevisionRead;x.api.getRevisionRead=async(...args)=>{const q=args[2];if(q.kind==="attendance"&&q.appViewId===x.f.attendancePlain&&q.query?.date===x.f.day.slice(0,8)+"01")throw Error("Synthetic held day failed");return original(...args);};await prepare(x);
    expect((await inspect(x)).find(r=>r.receipt?.appViewId===x.f.attendancePlain)?.status??"invalid").toBe("invalid");expect(await db.getAllAsync("SELECT server_id FROM entity_records WHERE entity_type_id=?",x.f.source)).toEqual(cached);
    expect(JSON.stringify(await store.getPreparationRevisionStatus(x.scope.ownerKey,x.f.contract))).toContain("PREPARATION_DAYS_INCOMPLETE");
  });
  it("gets a real 409 between normal source pages and never replaces prior valid rows with a mixed collection",async()=>{
    const x=await setup();await prepare(x);const before=await db.getAllAsync("SELECT server_id,values_json FROM entity_records WHERE entity_type_id=? ORDER BY server_id",x.f.source);
    const original=x.api.getRevisionRead;let changed=false;x.api.getRevisionRead=async(...args)=>{const d=await original(...args);if(!changed&&args[2].kind==="records"&&args[2].query?.page==="1"){changed=true;control("rename");}return d;};x.traffic.splice(0);await prepare(x);expect(changed).toBe(true);expect(x.traffic.some(t=>t.status===409)).toBe(true);
    expect(await db.getAllAsync("SELECT server_id,values_json FROM entity_records WHERE entity_type_id=? ORDER BY server_id",x.f.source)).toEqual(before);expect((await inspect(x)).every(r=>r.status==="invalid")).toBe(true);
  });
  it("keeps independent ordinary downloads running after a data-vector change but refuses mixed receipts",async()=>{
    const x=await setup(),read=x.api.getRevisionRead;let changed=false;
    x.api.getRevisionRead=async(...args)=>{const d=await read(...args);if(!changed&&args[2].kind==="attendance"&&args[2].query?.date?.toString().endsWith("-01")){changed=true;control("rename");}return d;};
    await prepare(x);expect(changed).toBe(true);const days=x.traffic.filter(t=>t.path.endsWith("/views/"+x.f.attendancePlain+"/workflow/attendance"));
    expect(new Set(days.map(t=>new URLSearchParams(t.query).get("date"))).size).toBe(new Date(Number(x.f.day.slice(0,4)),Number(x.f.day.slice(5,7)),0).getDate());
    expect(days.every(t=>t.status===200)).toBe(true);expect((await inspect(x)).some(r=>r.receipt?.status==="verified")).toBe(false);
    expect(JSON.stringify(await store.getPreparationRevisionStatus(x.scope.ownerKey,x.f.contract))).toContain("REVISION_REMOTE_CHANGED");
  });
  it("rejects a response mutated after its verified download and persistence",async()=>{
    const x=await setup(),read=x.api.getRevisionRead,manifest=x.api.getOfflineRevisionManifest;let captured:Awaited<ReturnType<typeof read>>|undefined,calls=0;
    x.api.getRevisionRead=async(...args)=>{const d=await read(...args);if(args[2].kind==="records")captured=d;return d;};
    x.api.getOfflineRevisionManifest=async(...args)=>{const m=await manifest(...args);if(++calls===2&&captured)(captured.data as Record<string,unknown>).syntheticMutation=true;return m;};
    await prepare(x);expect((await inspect(x)).some(r=>r.receipt?.status==="verified")).toBe(false);
    expect(JSON.stringify(await store.getPreparationRevisionStatus(x.scope.ownerKey,x.f.contract))).toContain("READ_REVISION_CONTENT_MISMATCH");
  });
  it("does not upgrade bounded latest to complete snapshot",async()=>{
    const x=await setup();const original=x.api.getRevisionRead;x.api.getRevisionRead=async(...args)=>{const d=await original(...args);if(args[2].kind==="state-update"&&args[2].appViewId===x.f.state){const n=d.normalized as {latestPagination:{page:number;hasMore:boolean;total:number}};n.latestPagination={page:1,hasMore:true,total:999};}return d;};await prepare(x);
    expect((await inspect(x)).some(r=>r.receipt?.appViewId===x.f.state)).toBe(false);expect(JSON.stringify(await store.getPreparationRevisionStatus(x.scope.ownerKey,x.f.contract))).toContain("PREPARATION_LATEST_INCOMPLETE");
  });
  it("preserves pending/conflict commands and refuses to certify a source overlay",async()=>{
    const x=await setup();for(const conflict of[false,true]){const row=await store.createLocalRecord({ownerKey:x.scope.ownerKey,contractId:x.f.contract,entityTypeId:x.f.source,values:{name:"Synthetic unsent"}});if(conflict)await db.runAsync("UPDATE entity_records SET sync_status='conflict' WHERE local_id=?",row.localId);}
    const before=await protectedHash();await prepare(x);expect(await protectedHash()).toBe(before);const receipts=(await inspect(x)).flatMap(r=>r.receipt?[r.receipt]:[]);expect(receipts.filter(r=>r.coverage.businessDataIncluded)).toHaveLength(0);
  });
  it("detects content changes and permission changes after reopening",async()=>{
    const x=await setup();await prepare(x);await db.closeAsync();await open();await db.runAsync("UPDATE entity_records SET display_name='Synthetic local mutation' WHERE server_id=?",x.f.person);
    expect((await inspect(x)).filter(r=>r.status==="invalid").length).toBeGreaterThanOrEqual(3);
    try{control("role-member");const m=await x.api.getOfflineRevisionManifest(x.token,x.f.contract);const next={...m.scope,ownerKey:x.scope.ownerKey};expect((await store.inspectPreparationRevisionReceipts({scope:next,manifest:m,isCurrent:()=>true})).every(r=>r.status==="invalid"&&r.reason==="REVISION_AUTHORIZATION_CHANGED")).toBe(true);}finally{control("role-admin");}
  });
  it("rejects stale scope and failed final receipt persistence without blocking ordinary preparation",async()=>{
    const x=await setup(),controller=new AbortController(),original=x.api.getRevisionRead;let retired=false;
    x.api.getRevisionRead=async(...args)=>{const d=await original(...args);if(args[2].kind==="records"&&!retired){retired=true;controller.abort();}return d;};await prepare(x,x.api,controller.signal);expect((await inspect(x)).every(r=>r.status==="invalid")).toBe(true);
    x.api.getRevisionRead=original;const writer=db.runAsync;db.runAsync=async(sql,...args)=>{if(sql.includes("INSERT INTO app_metadata")&&String(args[0]).startsWith("preparation_revision_receipt:v1:"))throw Error("Synthetic receipt commit failure");return writer(sql,...args);};await prepare(x);db.runAsync=writer;
    expect((await store.getAppViewDefinition(x.scope.ownerKey,x.f.contract,x.f.records))?.status).toBe("ready");expect((await inspect(x)).some(r=>r.receipt?.status==="verified")).toBe(false);
  });
  it("isolates reopened receipts from other owners, contracts, apps and changed definitions",async()=>{
    const x=await setup();await prepare(x);await db.closeAsync();await open();
    for(const scope of[{...x.scope,userId:"synthetic-other",ownerKey:x.scope.organizationId+":synthetic-other"},{...x.scope,contractId:"synthetic-other"},{...x.scope,applicationId:"synthetic-other"}])expect(await store.inspectPreparationRevisionReceipts({scope,isCurrent:()=>true})).toEqual([]);
    const cached=await store.getAppViewDefinition(x.scope.ownerKey,x.f.contract,x.f.records);expect(cached).not.toBeNull();
    await db.runAsync("UPDATE app_view_definitions SET status='partial' WHERE owner_key=? AND contract_id=? AND app_view_id=?",x.scope.ownerKey,x.f.contract,x.f.records);
    const result=await inspect(x);expect(result.filter(r=>r.status==="invalid")).toHaveLength(1);expect(result.find(r=>r.status==="invalid")?.reason).toBe("PREPARATION_DEFINITION_UNAVAILABLE");
  });
  it("does not continue scoped business reads after the authenticated owner mismatches",async()=>{
    const x=await setup(),manifest=await x.api.getOfflineRevisionManifest(x.token,x.f.contract);x.api.getOfflineRevisionManifest=async()=>({...manifest,scope:{...manifest.scope,userId:"synthetic-other"}});x.traffic.splice(0);await prepare(x);
    expect(x.traffic.filter(t=>t.path.includes("/entities/")||t.path.includes("/workflow/"))).toHaveLength(0);expect(await inspect(x)).toEqual([]);
    expect(JSON.stringify(await store.getPreparationRevisionStatus(x.scope.ownerKey,x.f.contract))).toContain("REVISION_SCOPE_MISMATCH");
  });
  it("does not certify a stale visual projection against a fresh source",async()=>{
    const x=await setup(),commit=store.commitPreparationRevisionReceipt;store.commitPreparationRevisionReceipt=async(context,plan)=>{
      if(plan.appView.id===x.f.current){const rows=await db.getAllAsync("SELECT key,value FROM app_metadata WHERE substr(key,1,length(?))=?","subject_presentation:v1:","subject_presentation:v1:") as {key:string;value:string}[];const row=rows.find(r=>JSON.parse(r.key.slice("subject_presentation:v1:".length))[2]===x.f.current);expect(row).toBeDefined();const value=JSON.parse(row!.value);value.cells[0].value="Synthetic stale label";await db.runAsync("UPDATE app_metadata SET value=? WHERE key=?",JSON.stringify(value),row!.key);}
      return commit(context,plan);
    };await prepare(x);expect((await inspect(x)).some(r=>r.receipt?.appViewId===x.f.current)).toBe(false);expect(JSON.stringify(await store.getPreparationRevisionStatus(x.scope.ownerKey,x.f.contract))).toContain("PREPARATION_PRESENTATION_UNVERIFIED");
  });
  it("keeps legacy Core preparation explicit and usable when the manifest is incompatible",async()=>{
    const x=await setup();x.api.getOfflineRevisionManifest=async()=>{throw Object.assign(Error("Old Core"),{code:"REVISION_MANIFEST_INCOMPATIBLE"});};await prepare(x);
    expect((await store.getAppViewDefinition(x.scope.ownerKey,x.f.contract,x.f.records))?.status).toBe("ready");expect(await inspect(x)).toEqual([]);expect(JSON.stringify(await store.getPreparationRevisionStatus(x.scope.ownerKey,x.f.contract))).toContain("REVISION_MANIFEST_INCOMPATIBLE");
  });
});
