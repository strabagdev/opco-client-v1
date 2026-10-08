// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { mkdtempSync, rmSync } from "node:fs";
import { formatStateValueLabel, resolveStateUpdateOfflineHistoryState } from "../renderers/workflows/state-update/state-update-workflow-logic";
import { createOpcoApi } from "./opco-api";
import { prewarmAssignedAppViewsOnce } from "./app-view-prewarm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";
const sqlite = vi.hoisted(() => ({
  openDatabaseAsync: vi.fn()
}));
vi.mock("expo-sqlite", () => sqlite);
function sqliteHarness(databasePath = ":memory:") {
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
 except Exception as e: print(json.dumps({'error':str(e),'sqliteCode':getattr(e,'sqlite_errorcode',None),'sqliteName':getattr(e,'sqlite_errorname',None)}))
`, databasePath]);
  let buffer = "";
  const queue: {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }[] = [];
  worker.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      const reply = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const task = queue.shift()!;
      if (reply.error) task.reject(Object.assign(new Error(reply.error), {
        sqliteCode: reply.sqliteCode,
        sqliteName: reply.sqliteName
      }));else task.resolve(reply.result);
    }
  });
  const query = (kind: string, sql: string, args: unknown[] = []) => new Promise<any>((resolve, reject) => {
    queue.push({
      resolve,
      reject
    });
    worker.stdin.write(JSON.stringify({
      kind,
      sql,
      args
    }) + "\n");
  });
  const db = {
    execAsync: (sql: string) => query("exec", sql),
    getAllAsync: (sql: string, ...args: unknown[]) => query("read", sql, args),
    getFirstAsync: async (sql: string, ...args: unknown[]) => (await query("read", sql, args))[0] ?? null,
    runAsync: vi.fn((sql: string, ...args: unknown[]) => query("write", sql, args)),
    withTransactionAsync: async (task: () => Promise<void>) => {
      await query("exec", "BEGIN");
      try {
        await task();
        await query("exec", "COMMIT");
      } catch (error) {
        await query("exec", "ROLLBACK");
        throw error;
      }
    },
    closeAsync: async () => {
      worker.kill();
    }
  };
  return {
    db,
    stop: () => worker.kill()
  };
}


const scope = { ownerKey: "audit-owner", contractId: "audit-contract", appViewId: "audit-view", targetEntityTypeId: "audit-events", date: "2026-10-07", dateFieldId: "event-date", historyMode: "append" as const, uniqueness: "subject" as const };
const subjects = Array.from({length:130}, (_, n) => ({id: "subject-"+String(n).padStart(3,"0"), displayName: "TOLVA "+String(n).padStart(3,"0")+" sintética"}));
const view = {id:scope.appViewId,name:"Versionado",slug:"versions",icon:null,sortOrder:0,type:"WORKFLOW",config:{workflowKey:"state-update",dateFieldId:scope.dateFieldId}};
let harness: ReturnType<typeof sqliteHarness>, store: ReturnType<typeof getLocalDatabase>, directory: string;
beforeEach(async()=>{__resetLocalDatabaseForTests();directory=mkdtempSync("/tmp/opco-prewarm-current-");harness=sqliteHarness(directory+"/cache.sqlite");sqlite.openDatabaseAsync.mockResolvedValue(harness.db);store=getLocalDatabase();await store.getSelectedContractId();});
afterEach(()=>{harness.stop();__resetLocalDatabaseForTests();rmSync(directory,{recursive:true,force:true});});
function fixture(dateValue="2026-08-13T00:00:00.000Z") {
 const stateFields=[{fieldId:"revision",label:"Revisión",type:"TEXT",required:false,options:[]},{fieldId:scope.dateFieldId,label:"Fecha",type:"DATE",required:false,options:[]}];
 const event=(id:string,n:number,revision:string,date:string)=>({recordId:id,date:date.slice(0,10),updatedAt:"2026-10-06T08:00:00.000Z",subject:subjects[n],states:{revision,[scope.dateFieldId]:date}});
 const events=[...Array.from({length:100},(_,n)=>event("dominant-"+String(n).padStart(3,"0"),0,"D"+n,n<20?"2026-10-06T00:00:00.000Z":"2026-10-05T00:00:00.000Z")),...Array.from({length:115},(_,n)=>event("event-"+String(n+1).padStart(3,"0"),n+1,"V"+(n+1),dateValue)),event("tie-a",116,"R1",dateValue),event("tie-b",116,"R99",dateValue)];
 const workflowQueries: {search:string;page:number;subjectRecordId:string|null;pageSize:number}[]=[],sourcePages:number[]=[];
 const adapter=createOpcoApi({apiUrl:"https://synthetic.invalid",fetcher:async input=>{
  const url=new URL(String(input)),search=url.searchParams.get("search")??"",page=Number(url.searchParams.get("page")??1),pageSize=Number(url.searchParams.get("pageSize")??20);const subjectRecordId=url.searchParams.get("subjectRecordId");workflowQueries.push({search,page,subjectRecordId,pageSize});
  const selected=subjectRecordId?subjects.filter(s=>s.id===subjectRecordId):search?subjects.filter(s=>s.displayName.toLowerCase().includes(search.toLowerCase())).slice(0,20):[];
  const matches=search?events.filter(e=>selected.some(s=>s.id===e.subject.id)):events;
  return new Response(JSON.stringify({ok:true,data:{appView:view,date:scope.date,dateFieldId:scope.dateFieldId,historyMode:"append",uniqueness:{mode:"subject"},sourceEntityType:{id:"audit-subjects",name:"Procedimientos"},targetEntityType:{id:scope.targetEntityTypeId,name:"Versionado"},subjectFieldId:"subject",stateFields,extraFields:[],subjects:selected.map(s=>{const winner=events.find(e=>e.subject.id===s.id);return {subject:s,current:winner?{...winner,extraValues:{}}:null}}),latest:{items:matches.slice((page-1)*pageSize,page*pageSize),pagination:{page,pageSize,total:matches.length,hasMore:page*pageSize<matches.length}}}}),{status:200});
 }});
 const api={...adapter,getEntityDefinition:async()=>({entity:{id:"audit-subjects",name:"Procedimientos",slug:"procedures",active:true,icon:null,fields:[]}}),getEntityRecords:async(_token:string,_contract:string,_entity:string,q:{page:number;pageSize:number})=>{sourcePages.push(q.page);return {records:subjects.slice((q.page-1)*q.pageSize,q.page*q.pageSize).map(s=>({...s,updatedAt:"2026-10-04T08:00:00.000Z",values:{}})),pagination:{page:q.page,pageSize:q.pageSize,total:subjects.length,totalPages:Math.ceil(subjects.length/q.pageSize)}}}};
 return {api,adapter,workflowQueries,sourcePages};
}
async function prepare(f:ReturnType<typeof fixture>, signal?:AbortSignal){await prewarmAssignedAppViewsOnce({api:f.api as any,appViews:[view] as any,ownerKey:scope.ownerKey,contractId:scope.contractId,store,token:"synthetic",signal});}
async function find(n:number){return (await store.searchStateUpdateSubjects({...scope,sourceEntityTypeId:"audit-subjects",search:"TOLVA "+String(n).padStart(3,"0")}))[0];}
async function reopen(){harness.stop();__resetLocalDatabaseForTests();harness=sqliteHarness(directory+"/cache.sqlite");sqlite.openDatabaseAsync.mockResolvedValue(harness.db);store=getLocalDatabase();}
describe("characterization: prewarm current proof is separate from latest",()=>{
 it("prepares all 130 subjects including current outside latest page one, and survives disk reopen",async()=>{
  const f=fixture();await prepare(f);expect(f.sourcePages).toEqual([1,2]);expect(f.workflowQueries).toHaveLength(131);expect(f.workflowQueries.filter(q=>q.subjectRecordId)).toHaveLength(130);expect(f.workflowQueries.filter(q=>q.subjectRecordId).every(q=>q.pageSize===1)).toBe(true);
  expect(await store.getStateUpdateCurrentCoverage({...scope,sourceEntityTypeId:"audit-subjects"})).toMatchObject({status:"complete",sourceComplete:true,totalSubjects:130,requestCount:130,subjects:{"subject-129":{status:"verified",remoteRecordId:null},"subject-116":{status:"verified",remoteRecordId:"tie-a"}}});
  expect((await store.getStateUpdateSnapshotCoverage(scope))).toMatchObject({status:"partial",pageSize:20,total:217,contentVerified:false});
  expect((await store.getSyncTelemetry({ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:"audit-subjects"}))?.lastFullRefreshCompletedAt).toBeTruthy();
  for(const n of [1,115,116]){const online=await f.adapter.getStateUpdateWorkflow("synthetic",scope.contractId,scope.appViewId,{date:scope.date,search:"TOLVA "+String(n).padStart(3,"0")});expect(online.items[0].current).not.toBeNull();expect((await find(n)).current).not.toBeNull();}
  expect((await find(0)).current?.recordId).toContain('"dominant-000"');expect((await find(129)).current).toBeNull();
  await reopen();for(const n of [1,115,116])expect((await find(n)).current).not.toBeNull();expect((await find(0)).current?.recordId).toContain('"dominant-000"');
  expect(resolveStateUpdateOfflineHistoryState({storedCoverage:(await store.getStateUpdateSnapshotCoverage(scope))?.status,cachedRecordCount:20})).toBe("partial");
 });
 it("bounds requests, preserves all events without duplicates and keeps partial latest separate",async()=>{
  const f=fixture();const get=f.api.getStateUpdateWorkflow;let active=0,peak=0;
  f.api.getStateUpdateWorkflow=async(...args)=>{active++;peak=Math.max(peak,active);try {await new Promise(resolve=>setTimeout(resolve,2));return await get(...args);}finally {active--;}};
  await prepare(f);expect(peak).toBeGreaterThan(1);expect(peak).toBeLessThanOrEqual(4);
  const count=()=>harness.db.getFirstAsync("SELECT COUNT(*) AS n FROM entity_records WHERE entity_type_id=?",scope.targetEntityTypeId);
  expect((await count()).n).toBe(136);await prepare(f);expect((await count()).n).toBe(136);
  expect((await store.getStateUpdateSnapshotCoverage(scope))?.status).toBe("partial");
  const before=await store.getStateUpdateCurrentCoverage({...scope,sourceEntityTypeId:"audit-subjects"});
  const response=await f.adapter.getStateUpdateWorkflow("synthetic",scope.contractId,scope.appViewId,{date:scope.date,search:"TOLVA 115"});
  await store.upsertStateUpdateSnapshot({...scope,complete:false,items:response.items,latest:response.latest});
  expect(await store.getStateUpdateCurrentCoverage({...scope,sourceEntityTypeId:"audit-subjects"})).toEqual(before);
  for (const changed of [{ownerKey:"another"},{contractId:"another"},{appViewId:"another"},{sourceEntityTypeId:"another"},{targetEntityTypeId:"another"},{date:"2026-10-08"},{dateFieldId:"another"}])
   expect(await store.getStateUpdateCurrentCoverage({...scope,sourceEntityTypeId:"audit-subjects",...changed})).toBeNull();
 });
 it("records failure separately from explicit no version and recovers on repetition",async()=>{
  const f=fixture();const get=f.api.getStateUpdateWorkflow;
  f.api.getStateUpdateWorkflow=async(...args)=>{if(args[3]?.subjectRecordId===subjects[115].id)throw new Error("SYNTHETIC_FAILURE");return get(...args);};
  await prepare(f);expect(await store.getStateUpdateCurrentCoverage({...scope,sourceEntityTypeId:"audit-subjects"})).toMatchObject({status:"partial",requestCount:130,subjects:{"subject-115":{status:"failed"},"subject-129":{status:"verified",remoteRecordId:null}}});
  f.api.getStateUpdateWorkflow=get;await prepare(f);expect((await store.getStateUpdateCurrentCoverage({...scope,sourceEntityTypeId:"audit-subjects"}))?.status).toBe("complete");
 });
 it("invalidates prior completion and leaves unqueried subjects uncredited when interrupted",async()=>{
  const f=fixture();await prepare(f);const controller=new AbortController(),get=f.api.getStateUpdateWorkflow;let requests=0;
  f.api.getStateUpdateWorkflow=async(...args)=>{const response=await get(...args);if(args[3]?.subjectRecordId && ++requests===9)controller.abort();return response;};
  await prepare(f,controller.signal);const coverage=await store.getStateUpdateCurrentCoverage({...scope,sourceEntityTypeId:"audit-subjects"});
  expect(coverage?.status).toBe("partial");expect(coverage?.requestCount).toBeLessThan(130);expect(coverage?.subjects["subject-129"]).toBeUndefined();
  await reopen();expect((await store.getStateUpdateCurrentCoverage({...scope,sourceEntityTypeId:"audit-subjects"}))?.status).toBe("partial");
 });
 it("does not certify current globally if the complete source refresh cannot be proven",async()=>{
  const f=fixture(),get=f.api.getEntityRecords;
  f.api.getEntityRecords=async(...args)=>{const response=await get(...args);return {...response,pagination:{...response.pagination,total:129}};};
  await prepare(f);expect(await store.getStateUpdateCurrentCoverage({...scope,sourceEntityTypeId:"audit-subjects"})).toMatchObject({status:"partial",sourceComplete:false,requestCount:130});
 });
 it("does not credit a subject whose current snapshot failed persistence verification",async()=>{
  const f=fixture(),write=store.upsertStateUpdateSnapshot.bind(store);
  vi.spyOn(store,"upsertStateUpdateSnapshot").mockImplementation(async input=>input.items[0]?.subject.id===subjects[115].id?{staleSyncedRemoved:0,contentVerified:false,persistedRemoteEventCount:0}:write(input));
  await prepare(f);expect(await store.getStateUpdateCurrentCoverage({...scope,sourceEntityTypeId:"audit-subjects"})).toMatchObject({status:"partial",subjects:{"subject-115":{status:"failed"}}});
 });
 it.each(["2026-08-13","2026-08-13T00:00:00.000Z"])("DATE labels survive the real adapter and SQLite offline read: %s",async dateValue=>{
  const f=fixture(dateValue);await prepare(f);const online=await f.adapter.getStateUpdateWorkflow("synthetic",scope.contractId,scope.appViewId,{date:scope.date,search:"TOLVA 116"});
  const field=online.stateFields.find(x=>x.fieldId===scope.dateFieldId)!;const value=online.items[0].current!.stateValues.find(x=>x.fieldId===scope.dateFieldId)!;
  expect(formatStateValueLabel(field,value)).toBe("13-08-2026");expect(online.items[0].current?.recordId).toBe("tie-a");
  await store.upsertStateUpdateSnapshot({...scope,complete:false,items:online.items,latest:online.latest});
  await reopen();const current=(await find(116)).current!;expect(current.recordId).toContain('"tie-a"');const cached=current.stateValues.find(x=>x.fieldId===scope.dateFieldId)!;
  expect(formatStateValueLabel(field,cached)).toBe("13-08-2026");expect(cached.value).toBe(value.value);expect(cached.label).toBe(value.label);
  expect((await store.getStateUpdateSnapshotCoverage(scope))?.status).toBe("partial");
 });
 it("repeated partial preparation preserves append intentions, conflicts and outbox byte for byte",async()=>{
  const f=fixture();await prepare(f);const input={...scope,subjectRecordId:subjects[115].id,subjectDisplayName:subjects[115].displayName,stateFields:[],stateValues:[{fieldId:"revision",value:"LOCAL"}]};
  const a=await store.saveStateUpdateLocally(input),b=await store.saveStateUpdateLocally(input);expect(a.localRecordId).not.toBe(b.localRecordId);
  await harness.db.runAsync("UPDATE entity_records SET sync_status='conflict' WHERE local_id=?",a.localRecordId);
  const before=await harness.db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced' ORDER BY local_id"),outbox=await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id");
  await prepare(f);expect(await harness.db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced' ORDER BY local_id")).toEqual(before);expect(await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")).toEqual(outbox);
  expect((await find(115)).current?.stateValues[0].value).toBe("LOCAL");await reopen();expect((await find(115)).current?.stateValues[0].value).toBe("LOCAL");
 });
});

 it("cached obsolete current must not survive authoritative current=null with complete coverage",async()=>{
  const f=fixture();
  await store.upsertStateUpdateSnapshot({...scope,complete:false,items:[{subject:subjects[129],current:{recordId:"obsolete-129",updatedAt:"2026-08-13T08:00:00.000Z",stateValues:[{fieldId:scope.dateFieldId,value:"2026-08-13",label:"2026-08-13",optionId:null},{fieldId:"revision",value:"OLD",label:"OLD",optionId:null}]}}],latest:[]});
  await prepare(f);
  const proof=await store.getStateUpdateCurrentCoverage({...scope,sourceEntityTypeId:"audit-subjects"});
  expect(proof?.status).toBe("complete");
  expect(proof?.subjects[subjects[129].id]).toEqual({status:"verified",remoteRecordId:null});
  const before=(await find(129)).current!==null;await reopen();const after=(await find(129)).current!==null;
  expect({before,after}).toEqual({before:false,after:false});
 });

 it("cached newer stale event must not override authoritative current in a completed preparation",async()=>{
  const f=fixture();
  await store.upsertStateUpdateSnapshot({...scope,complete:false,items:[{subject:subjects[115],current:{recordId:"obsolete-115",updatedAt:"2026-10-06T08:00:00.000Z",stateValues:[{fieldId:scope.dateFieldId,value:"2026-10-06",label:"2026-10-06",optionId:null},{fieldId:"revision",value:"OLD",label:"OLD",optionId:null}]}}],latest:[]});
  await prepare(f);
  const proof=await store.getStateUpdateCurrentCoverage({...scope,sourceEntityTypeId:"audit-subjects"});
  expect(proof?.status).toBe("complete");expect(proof?.subjects[subjects[115].id]).toEqual({status:"verified",remoteRecordId:"event-115"});
  const before=(await find(115)).current?.recordId.includes('"event-115"');await reopen();const after=(await find(115)).current?.recordId.includes('"event-115"');
  expect({before,after}).toEqual({before:true,after:true});
 });

async function cacheObsolete(n:number) {
 await store.upsertStateUpdateSnapshot({...scope,complete:false,items:[{subject:subjects[n],current:{recordId:"obsolete-"+n,updatedAt:"2026-10-06T08:00:00.000Z",stateValues:[{fieldId:scope.dateFieldId,value:"2026-10-06",label:"2026-10-06",optionId:null},{fieldId:"revision",value:"OLD",label:"OLD",optionId:null}]}}],latest:[]});
}
const proofScope={...scope,sourceEntityTypeId:"audit-subjects"};
it.each(["failed","unqueried","incomplete","legacy","malformed","other-date","missing-event","other-subject"])("keeps conservative reading and no complete proof for %s authority",async kind=>{
 const f=fixture();await cacheObsolete(129);await prepare(f);
 const proof=(await store.getStateUpdateCurrentCoverage(proofScope))!;
 if(kind==="failed")proof.subjects[subjects[129].id]={status:"failed"};
 if(kind==="unqueried")delete proof.subjects[subjects[129].id];
 if(kind==="incomplete")proof.subjects[subjects[129].id]={status:"verified"} as any;
 if(kind==="missing-event")proof.subjects[subjects[129].id]={status:"verified",remoteRecordId:"not-cached"};
 if(kind==="other-subject")proof.subjects[subjects[129].id]={status:"verified",remoteRecordId:"event-115"};
 if(kind==="legacy")delete (proof as any).sourceComplete;
 if(kind==="other-date"){
  const readScope={...proofScope,date:"2026-10-08"};expect(await store.getStateUpdateCurrentCoverage(readScope)).toBeNull();
  const read=()=>store.searchStateUpdateSubjects({...readScope,search:"TOLVA 129"});expect((await read())[0].current?.recordId).toContain('"obsolete-129"');
  await reopen();expect((await read())[0].current?.recordId).toContain('"obsolete-129"');return;
 }
 if(kind==="malformed")await harness.db.runAsync("UPDATE app_metadata SET value='invalid json' WHERE key LIKE 'state_update_current_coverage:%'");
 else await store.setStateUpdateCurrentCoverage({...proofScope,coverage:proof});
 const stored=await harness.db.getAllAsync("SELECT value FROM app_metadata WHERE key LIKE 'state_update_current_coverage:%'");
 expect((await store.getStateUpdateCurrentCoverage(proofScope))?.status).not.toBe("complete");
 expect((await find(129)).current?.recordId).toContain('"obsolete-129"');
 expect(await harness.db.getAllAsync("SELECT value FROM app_metadata WHERE key LIKE 'state_update_current_coverage:%'")).toEqual(stored);
 await reopen();expect((await find(129)).current?.recordId).toContain('"obsolete-129"');
});
it("honors a verified null per subject even when global coverage is partial",async()=>{
 await cacheObsolete(129);await prepare(fixture());const proof=(await store.getStateUpdateCurrentCoverage(proofScope))!;
 proof.status="partial";delete proof.subjects[subjects[0].id];await store.setStateUpdateCurrentCoverage({...proofScope,coverage:proof});
 expect((await store.getStateUpdateCurrentCoverage(proofScope))?.status).toBe("partial");expect((await find(129)).current).toBeNull();
 await reopen();expect((await find(129)).current).toBeNull();
});
it.each(["pending_create","conflict"])("keeps %s overlay and durable outbox over authoritative null",async status=>{
 await cacheObsolete(129);await prepare(fixture());const intent=await store.saveStateUpdateLocally({...scope,subjectRecordId:subjects[129].id,subjectDisplayName:subjects[129].displayName,stateFields:[],stateValues:[{fieldId:"revision",value:"LOCAL"}]});
 if(status==="conflict")await harness.db.runAsync("UPDATE entity_records SET sync_status='conflict' WHERE local_id=?",intent.localRecordId);
 const before=await harness.db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced' ORDER BY local_id"),outbox=await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id");
 expect((await find(129)).current?.recordId).toBe(intent.localRecordId);expect((await find(129)).current?.stateValues[0].value).toBe("LOCAL");
 await reopen();expect((await find(129)).current?.recordId).toBe(intent.localRecordId);expect((await harness.db.getFirstAsync("SELECT sync_status FROM entity_records WHERE local_id=?",intent.localRecordId)).sync_status).toBe(status);
 expect(await harness.db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced' ORDER BY local_id")).toEqual(before);expect(await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")).toEqual(outbox);
 expect((await harness.db.getFirstAsync("SELECT COUNT(*) AS n FROM entity_records WHERE server_id='obsolete-129'")).n).toBe(1);
});
