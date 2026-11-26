import { PYTHON_SQLITE_SCRIPT_EXECUTOR } from "../test/sqlite-script";
// Real SQLite-file transport reused from the stage-3 receipt harness.
// @ts-expect-error Node types are intentionally absent from Expo config.
import {spawn, execFileSync} from "node:child_process";
// @ts-expect-error Node types are intentionally absent from Expo config.
import {mkdtempSync, rmSync, readFileSync, writeFileSync} from "node:fs";
import {beforeEach, afterEach, describe, it, expect, vi} from "vitest";
import {getLocalDatabase, __resetLocalDatabaseForTests} from "./local-db";
import {createOpcoApi, type AttendanceWorkflowConfig} from "./opco-api";
import {prewarmAssignedAppViews} from "./app-view-prewarm";
import {revisionHash} from "./revision-receipts";
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

import type {AttendanceResponse} from "./opco-api";
import {attendanceStateFields} from "./attendance-offline";
import {refreshAttendanceDaySnapshot} from "./attendance-snapshot-cache";

const realSuite=process.env.ATTENDANCE_DAY_HTTP==="1"?describe.sequential:describe.skip;
realSuite("Attendance full days, real Core/PostgreSQL and SQLite",()=>{
 const fixture=()=>JSON.parse(readFileSync(process.env.REVISION_RECEIPT_FIXTURE!,"utf8"));
 async function setup(){const f=fixture(),traffic:{path:string;status:number}[]=[];
  const api=createOpcoApi({apiUrl:"http://127.0.0.1:19564",fetcher:async(url,init)=>{const response=await fetch(url,init);traffic.push({path:new URL(String(url)).pathname+new URL(String(url)).search,status:response.status});return response;}});
  const pages:AttendanceResponse["latest"]=[],read=api.getRevisionRead;api.getRevisionRead=async(...args)=>{const d=await read(...args);if(args[2].kind==="attendance"&&args[2].query?.daySnapshotVersion==="1")pages.push(...(d.normalized as AttendanceResponse).latest);return d;};
  const login=await api.login(f.credentials.email,f.credentials.password);if(!("accessToken"in login))throw Error("Synthetic auth failed");
  const views=(await api.getAppViews(login.accessToken,f.contract)).views,m=await api.getOfflineRevisionManifest(login.accessToken,f.contract);
  return{f,api,pages,token:login.accessToken,traffic,views,ownerKey:m.scope.organizationId+":"+m.scope.userId,scope:{...m.scope,ownerKey:m.scope.organizationId+":"+m.scope.userId}};
 }
 const control=(operation:string)=>execFileSync("node",[process.env.REVISION_RECEIPT_CONTROL!,operation],{env:{...process.env,DATABASE_URL:"postgresql://receipt_owner@127.0.0.1:19563/receipt_shadow?schema=public"},stdio:"pipe"});
 async function refresh(x:Awaited<ReturnType<typeof setup>>,date:string,observation=true,isCurrent=()=>true){const appViewId=observation?x.f.attendance:x.f.attendancePlain,view=x.views.find(v=>v.id===appViewId)!;
  if(!await store.getAppViewDefinition(x.ownerKey,x.f.contract,appViewId)){
    const response=await x.api.getAttendanceWorkflow(x.token,x.f.contract,appViewId,{date});const cfg=view.config as AttendanceWorkflowConfig;
    await store.upsertAppViewDefinition({ownerKey:x.ownerKey,contractId:x.f.contract,appViewId,appViewType:"WORKFLOW",workflowKey:"attendance",status:"ready",lastPreparedAt:new Date().toISOString(),definition:{kind:"state-update",appView:view,
      sourceEntityTypeId:x.f.source,targetEntityTypeId:x.f.target,subjectFieldId:cfg.personFieldId,dateFieldId:cfg.dateFieldId,uniqueness:"subject-date",historyMode:"update-current",
      stateFields:attendanceStateFields(response.statuses,cfg),extraFields:(response.contextFields??[]).map(f=>f.type==="RELATION"?({...f,active:true,key:f.key??f.id}):({active:true,id:f.id,key:f.key??f.id,name:f.name,required:f.required,type:"SELECT" as const,
       options:f.options.map(o=>({active:true,id:o.optionId,label:o.label,value:o.value??o.optionId,order:o.order??0}))}))}});
  }
  return refreshAttendanceDaySnapshot({api:x.api,token:x.token,ownerKey:x.ownerKey,contractId:x.f.contract,appViewId,config:view.config as AttendanceWorkflowConfig,date,store,isCurrent});
 }
 for(const observation of[false,true])it.each([0,1,10,11,30,137])("persists and reopens %i rows; observation="+observation,async count=>{
  const x=await setup(),date=x.f.dayCases.find((c:{count:number})=>c.count===count).date,appViewId=observation?x.f.attendance:x.f.attendancePlain;
  const result=await refresh(x,date,observation);expect(result?.hydration.complete).toBe(true);expect(result?.response.latest).toHaveLength(Math.min(count,10));
  expect(x.traffic.filter(t=>t.path.includes("daySnapshotVersion=1")).length).toBe(count<=10?0:Math.ceil(count/100));
  if(count>100)expect(x.traffic.some(t=>t.path.includes("page=2")&&t.path.includes("expectedReadRevision="))).toBe(true);
  const scope={ownerKey:x.ownerKey,contractId:x.f.contract,appViewId,targetEntityTypeId:x.f.target,date};
  const before=x.traffic.length;await db.closeAsync();await open();
  const cached=await store.listStateUpdateLatest({...scope,pageSize:500});expect(cached.pagination.total).toBe(count);
  expect((await store.getAttendanceDaySnapshotHydration(scope))?.lastSuccessfulRefreshAt).toBeTruthy();expect(x.traffic.length).toBe(before);
  for(const event of cached.items){expect(event.extraValues?.[x.f.group]).toBe("first");expect(event.extraValues?.[x.f.lot]).toMatchObject({id:x.f.lot1,displayName:"Referencia sintética uno"});
   if(observation)expect(event.extraValues?.[x.f.note]).toBe([...result!.response.latest,...x.pages].find(e=>e.person.id===event.subject.id)!.observation);else expect(Object.hasOwn(event.extraValues??{},x.f.note)).toBe(false);}
  expect(await db.getFirstAsync("PRAGMA integrity_check")).toEqual({integrity_check:"ok"});
 });
 it("gets a real 409 between daily pages and preserves the previous complete copy",async()=>{
  const x=await setup(),date=x.f.dayCases.find((c:{count:number})=>c.count===137).date;await refresh(x,date);
  const before=await db.getAllAsync("SELECT local_id,values_json FROM entity_records ORDER BY local_id"),read=x.api.getRevisionRead;let changed=false;
  x.api.getRevisionRead=async(...args)=>{const d=await read(...args);if(args[2].query?.daySnapshotVersion==="1"&&args[2].query.page==="1"){changed=true;control("day-note-change");}return d;};
  await expect(refresh(x,date)).rejects.toMatchObject({status:409,code:"READ_REVISION_CHANGED"});expect(changed).toBe(true);
  expect(await db.getAllAsync("SELECT local_id,values_json FROM entity_records ORDER BY local_id")).toEqual(before);
 });
 it("never writes a partial page after interruption",async()=>{
  const x=await setup(),date=x.f.dayCases.find((c:{count:number})=>c.count===137).date;await refresh(x,date);
  const before=await db.getAllAsync("SELECT local_id,values_json FROM entity_records ORDER BY local_id"),read=x.api.getRevisionRead;
  x.api.getRevisionRead=async(...args)=>{if(args[2].query?.page==="2")throw Error("Synthetic transport interruption");return read(...args);};
  await expect(refresh(x,date)).rejects.toThrow("Synthetic transport interruption");
  expect(await db.getAllAsync("SELECT local_id,values_json FROM entity_records ORDER BY local_id")).toEqual(before);
  await db.closeAsync();await open();expect((await store.listStateUpdateLatest({ownerKey:x.ownerKey,contractId:x.f.contract,appViewId:x.f.attendance,targetEntityTypeId:x.f.target,date,pageSize:500})).pagination.total).toBe(137);
 });
 it("retires a daily download on scope change before any persistence",async()=>{
  const x=await setup(),date=x.f.dayCases.find((c:{count:number})=>c.count===137).date;await refresh(x,date);
  const before=await db.getAllAsync("SELECT local_id,values_json FROM entity_records ORDER BY local_id"),read=x.api.getRevisionRead;let current=true;
  x.api.getRevisionRead=async(...args)=>{const d=await read(...args);current=false;return d;};
  await expect(refresh(x,date,true,()=>current)).rejects.toThrow("REVISION_SCOPE_RETIRED");
  expect(await db.getAllAsync("SELECT local_id,values_json FROM entity_records ORDER BY local_id")).toEqual(before);
 });
 it("preserves Attendance pending/conflict commands across a complete large refresh and reopen",async()=>{
  const x=await setup(),date=x.f.dayCases.find((c:{count:number})=>c.count===137).date;await refresh(x,date);
  const scope={ownerKey:x.ownerKey,contractId:x.f.contract,appViewId:x.f.attendance,targetEntityTypeId:x.f.target,date,uniqueness:"subject-date" as const,historyMode:"update-current" as const};
  for(const conflict of[false,true]){const saved=await store.saveStateUpdateLocally({...scope,subjectRecordId:conflict?x.f.person2:x.f.person,subjectDisplayName:"Synthetic unsent",stateFields:[],stateValues:[{fieldId:x.f.status,optionId:x.f.present}],extraValues:{[x.f.note]:"Synthetic protected draft",[x.f.group]:"first",[x.f.lot]:x.f.lot1}});if(conflict)await db.runAsync("UPDATE entity_records SET sync_status='conflict' WHERE local_id=?",saved.localRecordId);}
  const protectedState=async()=>revisionHash({rows:await db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced' ORDER BY local_id"),outbox:await db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")});
  const before=await protectedState();await refresh(x,date);expect(await protectedState()).toBe(before);await db.closeAsync();await open();expect(await protectedState()).toBe(before);
 });
 it("emits monthly receipts only after all day pages and local content are verified",async()=>{
  const x=await setup();await store.upsertAppViews(x.ownerKey,x.f.contract,x.views,new Date().toISOString());
  await prewarmAssignedAppViews({api:x.api,store,token:x.token,ownerKey:x.ownerKey,contractId:x.f.contract,appViews:x.views,prepareAppViewIds:[x.f.attendance]});
  const inspected=await store.inspectPreparationRevisionReceipts({scope:x.scope,isCurrent:()=>true});
  const receipt=inspected.find(r=>r.receipt?.appViewId===x.f.attendance)?.receipt;
  expect(receipt,JSON.stringify(await store.getPreparationRevisionStatus(x.ownerKey,x.f.contract))).toBeTruthy();
  expect(receipt?.coverage).toMatchObject({kind:"attendance-month",complete:true,subjectCount:201});
  expect(receipt?.parts.some(p=>p.resource.kind==="attendance"&&p.reads.length===2)).toBe(true);
  expect(inspected.every(r=>r.reuseAllowed===false)).toBe(true);
  // Cold monthly receipt inspection is exercised by the browser/OPFS harness;
  // the twelve day cases above independently close/reopen their SQLite files.

 });
});
