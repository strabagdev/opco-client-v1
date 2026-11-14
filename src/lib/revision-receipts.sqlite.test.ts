// Same real SQLite-file transport as the existing PANEL/STATE_UPDATE regression harness.
// @ts-expect-error Node types are intentionally absent from Expo config.
import { spawn,execFileSync } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from Expo config.
import { mkdtempSync,rmSync,readFileSync } from "node:fs";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { getLocalDatabase,__resetLocalDatabaseForTests } from "./local-db";
import { cacheAttendanceRemoteSnapshot } from "./attendance-snapshot-cache";
import { prewarmAssignedAppViewsOnce } from "./app-view-prewarm";
import { createOpcoApi, type EntityRecord, type PanelResponse, type ReportResponse, type EntityDefinitionResponse, type AppViewsResponse, type StateUpdateResponse, type AttendanceResponse, type AttendanceWorkflowConfig } from "./opco-api";
import { revisionHash,type RevisionManifest,type RevisionScope } from "./revision-receipts";
import { captureCachedRecordsReceipt,captureCachedSnapshotReceipt,workflowReceiptMaterialization,compareRevisionReceiptsShadow } from "./revision-receipt-shadow";
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
beforeEach(async()=>{directory=mkdtempSync("/tmp/revision-receipt-sqlite-");await open();});
afterEach(async()=>{await db.closeAsync();__resetLocalDatabaseForTests();rmSync(directory,{recursive:true,force:true});vi.restoreAllMocks();});
const scope:RevisionScope={ownerKey:"org:user",organizationId:"org",userId:"user",applicationId:"app",contractId:"contract",authorizationFingerprint:"a".repeat(64)};
const records:EntityRecord[]=[{id:"r1",displayName:"Synthetic 001",updatedAt:"2026-11-11T00:00:00.000Z",values:{code:"001"}},{id:"r2",displayName:"Synthetic 002",updatedAt:"2026-11-11T00:00:00.000Z",values:{code:"002"}}];
function fixture(){const state={vector:"b".repeat(64),auth:scope.authorizationFingerprint,records:[...records],failPage:0,mixedPage:0,http409:0,requests:[]as string[]};
 const manifest=():RevisionManifest=>({version:1,representationVersion:1,mode:"shadow",reuseAllowed:false,epoch:"epoch-one",readDefinitionsRevision:"d".repeat(64),scope:{userId:scope.userId,organizationId:scope.organizationId,applicationId:scope.applicationId,contractId:scope.contractId,authorizationFingerprint:state.auth},readBindingVector:{version:1,representationVersion:1,available:true,revision:state.vector}});
 const api=createOpcoApi({apiUrl:"http://local.invalid",fetcher:async(url)=>{const u=new URL(url.toString());state.requests.push(u.pathname+u.search);if(u.pathname.endsWith('/manifest'))return Response.json({ok:true,data:manifest()});const page=Number(u.searchParams.get('page')??1),pageSize=Number(u.searchParams.get('pageSize')??1);if(page===state.failPage)throw new TypeError("Failed to fetch");if(page===state.http409)return Response.json({ok:false,error:{code:"READ_REVISION_CHANGED",message:"Synthetic concurrent change"}},{status:409});
 const data={pagination:{page,pageSize,total:state.records.length,totalPages:Math.max(1,Math.ceil(state.records.length/pageSize))},records:state.records.slice((page-1)*pageSize,page*pageSize)};
 const entries=[...u.searchParams.entries()].filter(([key])=>!["readRevisionVersion","expectedReadRevision"].includes(key)).sort(([a],[b])=>a<b?-1:a>b?1:0),selection=entries.filter(([key])=>key!=="page"),descriptor={kind:"records",contractId:scope.contractId,entityTypeId:"source"},effectiveContext={date:null,from:null,to:null};
 const selectionFingerprint=await revisionHash({resource:descriptor,query:selection,effectiveContext}),requestFingerprint=await revisionHash({resource:descriptor,query:entries,effectiveContext}),revision=await revisionHash({manifestVectorRevision:state.vector,selectionFingerprint,representationVersion:1});
 return Response.json({ok:true,data,readRevision:{version:1,representationVersion:1,mode:"shadow",reuseAllowed:false,clientMaySkipReads:false,coverageCertified:false,revision:page===state.mixedPage?"f".repeat(64):revision,manifestVectorRevision:state.vector,epoch:"epoch-one",authorizationFingerprint:state.auth,selectionFingerprint,requestFingerprint,contentHash:await revisionHash(data),snapshot:{isolation:"repeatable-read",at:"2026-11-11T00:00:00.000Z"}}});}});
 return {state,api,manifest};}
const seed=()=>store.reconcileRemoteRecordsSnapshot({ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:"source",records});
const input=(f:ReturnType<typeof fixture>)=>({api:f.api,store,scope,token:"synthetic-token",sessionId:"session-one",isCurrent:()=>true,entityTypeId:"source",pageSize:1});
const inspect=(s=scope)=>store.inspectRevisionReceipts({scope:s,isCurrent:()=>true});
const businessHash=async()=>revisionHash({records:await db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id"),outbox:await db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")});

describe("durable shadow receipts with real SQLite",()=>{
 it("verifies every page, sends expected revision and survives close/reopen",async()=>{await seed();const f=fixture(),receipt=await captureCachedRecordsReceipt(input(f));expect(receipt.coverage).toMatchObject({complete:true,completeCollection:true,wholeExperience:false});expect(f.state.requests.some(p=>p.includes("page=2")&&p.includes("expectedReadRevision="))).toBe(true);const before=await businessHash();await db.closeAsync();await open();expect(await businessHash()).toBe(before);const offline=await inspect();expect(offline[0]).toMatchObject({status:"remote_unchecked",reuseAllowed:false,receipt:{snapshotId:receipt.snapshotId}});expect((await compareRevisionReceiptsShadow(input(f)))[0].status).toBe("match_shadow");});
 it("never emits a receipt for an unprepared or partial local collection",async()=>{const f=fixture();await expect(captureCachedRecordsReceipt(input(f))).rejects.toThrow("REVISION_LOCAL_CONTENT_MISMATCH");expect(await inspect()).toEqual([]);await store.upsertRemoteRecords({ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:"source",records:records.slice(0,1)});await expect(captureCachedRecordsReceipt(input(f))).rejects.toThrow("REVISION_LOCAL_CONTENT_MISMATCH");expect(await inspect()).toEqual([]);});
 it("a fully downloaded empty collection is different from missing coverage",async()=>{const f=fixture();f.state.records=[];const receipt=await captureCachedRecordsReceipt(input(f));expect(receipt.artifact).toMatchObject({kind:"records",total:0});expect((await compareRevisionReceiptsShadow(input(f)))[0].status).toBe("match_shadow");});
 it.each(["interruption","409","mixed"]as const)("invalidates proof but preserves usable data after %s",async fault=>{await seed();const f=fixture();await captureCachedRecordsReceipt(input(f));const old=await businessHash();if(fault==="interruption")f.state.failPage=2;if(fault==="409")f.state.http409=2;if(fault==="mixed")f.state.mixedPage=2;await expect(captureCachedRecordsReceipt(input(f))).rejects.toThrow();expect(await businessHash()).toBe(old);expect((await inspect())[0].status).toBe("invalid");});
 it("does not accredit data that differs from the remote content",async()=>{await seed();const f=fixture();f.state.records=[{...records[0],values:{code:"different"}},records[1]];await expect(captureCachedRecordsReceipt(input(f))).rejects.toThrow("REVISION_LOCAL_CONTENT_MISMATCH");expect(await inspect()).toEqual([]);});
 it("a later local mutation invalidates the stored receipt after reopen",async()=>{await seed();const f=fixture();await captureCachedRecordsReceipt(input(f));await store.upsertRemoteRecords({ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:"source",records:[{...records[0],displayName:"Synthetic changed"}]});await db.closeAsync();await open();expect((await inspect())[0]).toMatchObject({status:"invalid",reason:"REVISION_LOCAL_CONTENT_MISMATCH"});});
 it("remote changes and permission changes invalidate without overwriting local data",async()=>{await seed();const f=fixture();await captureCachedRecordsReceipt(input(f));const old=await businessHash();f.state.vector="f".repeat(64);expect((await compareRevisionReceiptsShadow(input(f)))[0].reason).toBe("REVISION_REMOTE_CHANGED");expect(await businessHash()).toBe(old);
  f.state.vector="b".repeat(64);await captureCachedRecordsReceipt(input(f));f.state.auth="0".repeat(64);const next={...input(f),scope:{...scope,authorizationFingerprint:f.state.auth}};expect((await compareRevisionReceiptsShadow(next))[0].reason).toBe("REVISION_AUTHORIZATION_CHANGED");expect(await businessHash()).toBe(old);});
 it("isolates owner, contract and application",async()=>{await seed();const f=fixture();await captureCachedRecordsReceipt(input(f));expect(await inspect({...scope,ownerKey:"org:other",userId:"other"})).toEqual([]);expect(await inspect({...scope,contractId:"other"})).toEqual([]);expect(await inspect({...scope,applicationId:"other"})).toEqual([]);expect((await inspect())[0].status).toBe("remote_unchecked");});
 it("keeps pending/conflict rows and outbox byte-identical and refuses an overlay certificate",async()=>{await seed();await store.createLocalRecord({ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:"source",values:{code:"003"}});const old=await businessHash();const f=fixture();await expect(captureCachedRecordsReceipt(input(f))).rejects.toThrow("REVISION_LOCAL_OVERLAY");expect(await businessHash()).toBe(old);await db.runAsync("UPDATE entity_records SET sync_status='conflict' WHERE sync_status='pending_create'");const conflict=await businessHash();await expect(captureCachedRecordsReceipt(input(f))).rejects.toThrow("REVISION_LOCAL_OVERLAY");expect(await businessHash()).toBe(conflict);});
 it("a retired scope cannot publish after a held download",async()=>{await seed();const f=fixture();let active=true;const original=f.api.getRevisionRead;f.api.getRevisionRead=async(...args)=>{const value=await original(...args);active=false;return value;};await expect(captureCachedRecordsReceipt({...input(f),isCurrent:()=>active})).rejects.toThrow("REVISION_SCOPE_RETIRED");expect(await inspect()).toEqual([]);});
 it("a lost final metadata write rolls back proof without changing business data",async()=>{await seed();const f=fixture(),before=await businessHash(),original=db.runAsync;let fail=true;db.runAsync=async(sql,...args)=>{if(fail&&sql.includes("INSERT INTO app_metadata")&&String(args[0]).startsWith("revision_receipt_v1:")){fail=false;throw Error("Synthetic receipt persistence failure");}return original(sql,...args);};await expect(captureCachedRecordsReceipt(input(f))).rejects.toThrow();db.runAsync=original;expect(await inspect()).toEqual([]);expect(await businessHash()).toBe(before);expect((await captureCachedRecordsReceipt(input(f))).status).toBe("verified");});

 it("a newer session fences a late publisher even when its stale callback says current",async()=>{await seed();const f=fixture(),original=f.api.getRevisionRead;let switched=false;f.api.getRevisionRead=async(...args)=>{const result=await original(...args);if(!switched){switched=true;await store.beginRevisionReceiptSession({scope,sessionId:"new-session",manifest:f.manifest(),isCurrent:()=>true});}return result;};const before=await businessHash();await expect(captureCachedRecordsReceipt(input(f))).rejects.toThrow("REVISION_SCOPE_RETIRED");expect(await inspect()).toEqual([]);expect(await businessHash()).toBe(before);});
 it("local values changed before the receipt transaction cannot receive an old certificate",async()=>{await seed();const f=fixture(),original=store.commitRevisionReceipt;store.commitRevisionReceipt=async args=>{await store.upsertRemoteRecords({ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:"source",records:[{...records[0],values:{code:"newer"}}]});return original(args);};await expect(captureCachedRecordsReceipt(input(f))).rejects.toThrow("REVISION_LOCAL_CONTENT_MISMATCH");expect(await inspect()).toEqual([]);});
 it("old or corrupt receipts do not become verified",async()=>{await db.runAsync("INSERT INTO app_metadata(key,value) VALUES (?,?)",'revision_receipt_v1:'+JSON.stringify([scope.ownerKey,scope.contractId])+':old',JSON.stringify({version:0}));expect((await inspect())[0].status).toBe("invalid");});
});

const httpSuite=process.env.REVISION_RECEIPT_HTTP==="1"?describe.sequential:describe.skip;
httpSuite("receipts with real isolated Core HTTP and PostgreSQL",()=>{
 function real(){const base=process.env.REVISION_RECEIPT_API??"";if(base!=="http://127.0.0.1:19564")throw Error("ISOLATED_HTTP_REQUIRED");const fixturePath=process.env.REVISION_RECEIPT_FIXTURE!;const f=JSON.parse(readFileSync(fixturePath,"utf8")) as {org:string;contract:string;user:string;app:string;source:string;target:string;attendance:string;state:string;panel:string;report:string;matrix:string;record:string;person:string;person2:string;day:string;date:string;subject:string;status:string;note:string;group:string;lot:string;credentials:{email:string;password:string}};return {api:createOpcoApi({apiUrl:base}),f,base};}
 const control=(operation:string)=>execFileSync("node",[process.env.REVISION_RECEIPT_CONTROL!,operation],{env:{...process.env,DATABASE_URL:"postgresql://receipt_owner@127.0.0.1:19563/receipt_shadow?schema=public",API_AUTH_SECRET:"receipt-local-api-secret-20261111"},stdio:"pipe"});
 async function realInput(){const {api,f,base}=real();const login=await api.login(f.credentials.email,f.credentials.password);if(!("accessToken"in login))throw Error("Synthetic login selection unexpected");const m=await api.getOfflineRevisionManifest(login.accessToken,f.contract);const owner=m.scope.organizationId+":"+m.scope.userId;return {api,f,base,scope:{...m.scope,ownerKey:owner},token:login.accessToken,store,sessionId:"real-session",isCurrent:()=>true,entityTypeId:f.source,pageSize:2};}
 async function seedReal(x:Awaited<ReturnType<typeof realInput>>){const all=[];for(let page=1;page<=2;page++)all.push(...(await x.api.getEntityRecords(x.token,x.f.contract,x.f.source,{page,pageSize:2})).records);await store.reconcileRemoteRecordsSnapshot({ownerKey:x.scope.ownerKey,contractId:x.f.contract,entityTypeId:x.f.source,records:all});}
 it("authenticates, downloads all real pages, verifies local content and reopens",async()=>{const x=await realInput();await seedReal(x);const receipt=await captureCachedRecordsReceipt(x);expect(receipt.remote.requestFingerprints).toHaveLength(2);expect((await compareRevisionReceiptsShadow(x))[0].status).toBe("match_shadow");await db.closeAsync();await open();expect((await store.inspectRevisionReceipts({scope:x.scope,isCurrent:()=>true}))[0].receipt?.snapshotId).toBe(receipt.snapshotId);});
 it("receives a real HTTP 409 after a PostgreSQL mutation between pages",async()=>{const x=await realInput();await seedReal(x);const before=await businessHash();let changed=false;const api=createOpcoApi({apiUrl:x.base,fetcher:async(url,init)=>{const response=await fetch(url,init);if(!changed&&String(url).includes("/records?")&&String(url).includes("readRevisionVersion=1")&&String(url).includes("page=1")){changed=true;control("rename");}return response;}});await expect(captureCachedRecordsReceipt({...x,api})).rejects.toMatchObject({code:"READ_REVISION_CHANGED",status:409});expect(changed).toBe(true);expect(await businessHash()).toBe(before);expect(await store.inspectRevisionReceipts({scope:x.scope,isCurrent:()=>true})).toEqual([]);});

 it("detects a real membership change without modifying cached data",async()=>{const x=await realInput();await seedReal(x);await captureCachedRecordsReceipt(x);const before=await businessHash();try{control("role-member");const manifest=await x.api.getOfflineRevisionManifest(x.token,x.f.contract);const next={...x,scope:{...manifest.scope,ownerKey:x.scope.ownerKey}};expect((await compareRevisionReceiptsShadow(next))[0].reason).toBe("REVISION_AUTHORIZATION_CHANGED");expect(await businessHash()).toBe(before);}finally{control("role-admin");}});
 it("invalidates receipt after real bearer authorization is revoked",async()=>{const x=await realInput();await seedReal(x);await captureCachedRecordsReceipt(x);const before=await businessHash();try{control("disable");await expect(compareRevisionReceiptsShadow(x)).rejects.toMatchObject({status:401});expect((await store.inspectRevisionReceipts({scope:x.scope,isCurrent:()=>true}))[0].status).toBe("invalid");expect(await businessHash()).toBe(before);}finally{control("enable");}});

 it("binds a negotiated current batch to explicit event/null outcomes and existing local authorities",async()=>{
  const x=await realInput(),views=(await x.api.getAppViews(x.token,x.f.contract)).views;
  await prewarmAssignedAppViewsOnce({api:x.api,store,token:x.token,ownerKey:x.scope.ownerKey,contractId:x.f.contract,appViews:views});
  const workflowScope={ownerKey:x.scope.ownerKey,contractId:x.f.contract,appViewId:x.f.state,targetEntityTypeId:x.f.target,date:x.f.day,dateFieldId:x.f.date,uniqueness:"subject-date" as const,historyMode:"update-current" as const};
  let fingerprint="";
  for(const subjectRecordId of[x.f.person,x.f.person2]){const current=await x.api.getStateUpdateWorkflow(x.token,x.f.contract,x.f.state,{date:x.f.day,subjectRecordId});fingerprint=current.currentBatchCapabilities!.configurationFingerprint;await store.upsertStateUpdateSnapshot({...workflowScope,complete:false,items:current.items,latest:current.latest});}
  const resource={kind:"state-update" as const,appViewId:x.f.state,query:{date:x.f.day,currentBatchVersion:"1",currentBatchFingerprint:fingerprint,subjectRecordIds:[x.f.person,x.f.person2]}};
  const download=await x.api.getRevisionRead(x.token,x.f.contract,resource),response=download.normalized as StateUpdateResponse;
  expect(response.items.find(i=>i.subject.id===x.f.person)?.current?.recordId).toBe(x.f.record);expect(response.items.find(i=>i.subject.id===x.f.person2)?.current).toBeNull();
  const receipt=await captureCachedSnapshotReceipt({...x,resource,materialized:d=>workflowReceiptMaterialization(workflowScope,d.normalized as StateUpdateResponse)});
  expect(receipt.artifact).toMatchObject({kind:"workflow",currentSubjectIds:[x.f.person,x.f.person2]});await db.closeAsync();await open();expect((await store.inspectRevisionReceipts({scope:x.scope,isCurrent:()=>true}))[0]).toMatchObject({status:"remote_unchecked",receipt:{snapshotId:receipt.snapshotId}});
 });

 it("accredits metadata, PANEL/REPORT/MATRIX and bounded Attendance/STATE_UPDATE projections against real Core",async()=>{
  const x=await realInput(),views=(await x.api.getAppViews(x.token,x.f.contract)).views;await store.upsertAppViews(x.scope.ownerKey,x.f.contract,views,new Date().toISOString());
  await prewarmAssignedAppViewsOnce({api:x.api,store,token:x.token,ownerKey:x.scope.ownerKey,contractId:x.f.contract,appViews:views});
  const common={...x,store};
  await captureCachedRecordsReceipt(common);
  await captureCachedSnapshotReceipt({...common,resource:{kind:"definition",entityTypeId:x.f.source},materialized:d=>({artifact:{kind:"definition",entityTypeId:x.f.source},expected:{json:(d.normalized as EntityDefinitionResponse).entity}})});
  await captureCachedSnapshotReceipt({...common,resource:{kind:"views"},materialized:d=>({artifact:{kind:"views"},expected:{json:(d.normalized as AppViewsResponse).views}})});
  const panelQuery={datasetId:"rows",page:1,pageSize:25};const panel=await x.api.getPanel(x.token,x.f.contract,x.f.panel,panelQuery);const panelScope={...panelQuery,ownerKey:x.scope.ownerKey,contractId:x.f.contract,appViewId:x.f.panel,configRevision:panel.configRevision};await store.upsertPanelSnapshot({...panelScope,panel});
  const panelReceipt=await captureCachedSnapshotReceipt({...common,resource:{kind:"panel",appViewId:x.f.panel,query:{datasetId:"rows",page:"1",pageSize:"25"}},materialized:d=>({artifact:{kind:"panel",scope:panelScope},expected:{json:d.normalized as PanelResponse}})});expect(panelReceipt.coverage.completeCollection).toBe(false);
  await expect(captureCachedSnapshotReceipt({...common,resource:{kind:"panel",appViewId:x.f.panel,query:{datasetId:"rows",page:"1",pageSize:"25",filters:JSON.stringify({ignored:"synthetic"})}},materialized:d=>({artifact:{kind:"panel",scope:panelScope},expected:{json:d.normalized}})})).rejects.toThrow("REVISION_COVERAGE_MISMATCH");
  for(const appViewId of[x.f.report,x.f.matrix]){const query={from:x.f.day,to:x.f.day},report=await x.api.getReport(x.token,x.f.contract,appViewId,query),scope={ownerKey:x.scope.ownerKey,contractId:x.f.contract,appViewId,...query};await store.upsertReportSnapshot({...scope,report});await captureCachedSnapshotReceipt({...common,resource:{kind:"report",appViewId,query},materialized:d=>({artifact:{kind:"report",scope},expected:{json:d.normalized as ReportResponse}})});}
  const workflowScope={ownerKey:x.scope.ownerKey,contractId:x.f.contract,appViewId:x.f.state,targetEntityTypeId:x.f.target,date:x.f.day,dateFieldId:x.f.date,uniqueness:"subject-date" as const,historyMode:"update-current" as const};
  const current=await x.api.getStateUpdateWorkflow(x.token,x.f.contract,x.f.state,{date:x.f.day,subjectRecordId:x.f.person});await store.upsertStateUpdateSnapshot({...workflowScope,complete:false,items:current.items,latest:current.latest});
  const empty=await x.api.getStateUpdateWorkflow(x.token,x.f.contract,x.f.state,{date:x.f.day,subjectRecordId:x.f.person2});await store.upsertStateUpdateSnapshot({...workflowScope,complete:false,items:empty.items,latest:[]});
  await captureCachedSnapshotReceipt({...common,resource:{kind:"state-update",appViewId:x.f.state,query:{date:x.f.day,subjectRecordId:x.f.person}},materialized:d=>workflowReceiptMaterialization(workflowScope,d.normalized as StateUpdateResponse)});
  await captureCachedSnapshotReceipt({...common,resource:{kind:"state-update",appViewId:x.f.state,query:{date:x.f.day,subjectRecordId:x.f.person2}},materialized:d=>workflowReceiptMaterialization(workflowScope,d.normalized as StateUpdateResponse)});
  const attendanceScope={...workflowScope,appViewId:x.f.attendance};const view=views.find(v=>v.id===x.f.attendance)!;
  const attended=await x.api.getAttendanceWorkflow(x.token,x.f.contract,x.f.attendance,{date:x.f.day,personRecordId:x.f.person});await cacheAttendanceRemoteSnapshot({...attendanceScope,response:attended,config:view.config as AttendanceWorkflowConfig,store});
  await captureCachedSnapshotReceipt({...common,resource:{kind:"attendance",appViewId:x.f.attendance,query:{date:x.f.day,personRecordId:x.f.person}},materialized:d=>workflowReceiptMaterialization(attendanceScope,d.normalized as AttendanceResponse,view.config as AttendanceWorkflowConfig)});
  const before=await businessHash(),proofs=await compareRevisionReceiptsShadow(common);expect(proofs).toHaveLength(9);expect(proofs.every(p=>p.status==="match_shadow"&&p.reuseAllowed===false)).toBe(true);await db.closeAsync();await open();expect((await store.inspectRevisionReceipts({scope:x.scope,isCurrent:()=>true})).every(p=>p.status==="remote_unchecked")).toBe(true);expect(await businessHash()).toBe(before);
 });

});
