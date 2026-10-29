// @ts-expect-error Node types absent from Expo config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types absent from Expo config.
import { mkdtempSync,rmSync } from "node:fs";
import { beforeEach,afterEach,it,expect,vi } from "vitest";
import { createOpcoApi, type StateUpdateCurrentBatchCapabilities } from "./opco-api";
import { getLocalDatabase,__resetLocalDatabaseForTests } from "./local-db";
import { prewarmAssignedAppViewsOnce,runWithConcurrency } from "./app-view-prewarm";
import { refreshEntityRecordsCache } from "./offline-records";
import { prepareStateUpdateCurrent } from "./state-update-current-prewarm";
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
    withTransactionAsync: async (task:()=>Promise<void>) => { await query("exec","BEGIN");try{await task();await query("exec","COMMIT");}catch(error){await query("exec","ROLLBACK");throw error;} },
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

const cap:StateUpdateCurrentBatchCapabilities={version:1,maxSubjects:100,configurationFingerprint:"a".repeat(64)};
const scope={ownerKey:"synthetic-owner",contractId:"synthetic-contract",appViewId:"synthetic-view",sourceEntityTypeId:"synthetic-source",targetEntityTypeId:"synthetic-target",date:"2026-10-29",dateFieldId:"date",uniqueness:"subject"as const,historyMode:"append"as const};
const subjects=Array.from({length:217},(_,i)=>({id:"subject-"+String(i).padStart(3,"0"),displayName:"Synthetic "+String(i).padStart(3,"0")}));
const view={id:scope.appViewId,name:"Synthetic workflow",slug:"synthetic",type:"WORKFLOW",config:{workflowKey:"state-update",dateFieldId:"date"},icon:null,sortOrder:0};
let directory:string,db:ReturnType<typeof sqliteFile>,store:ReturnType<typeof getLocalDatabase>;
async function open(){__resetLocalDatabaseForTests();db=sqliteFile(directory+"/opco-client-v10-epoch2.db");sqlite.openDatabaseAsync.mockResolvedValue(db);store=getLocalDatabase();await store.getSelectedContractId();}
async function reopen(){await db.closeAsync();await open();}
beforeEach(async()=>{directory=mkdtempSync("/tmp/opco-current-batch-");await open();});
afterEach(async()=>{await db.closeAsync();__resetLocalDatabaseForTests();rmSync(directory,{recursive:true,force:true});});
function fixture(advertise=true,count=217){
 const currentSubjects=subjects.slice(0,count);
 const requests:{ids:string[];individual:string|null}[]=[];let unavailable:string|undefined,omit:string|undefined,incompatible=false,revision="R1";
 const adapter=createOpcoApi({apiUrl:"https://synthetic.invalid",fetcher:async input=>{
  const url=new URL(String(input)),ids=url.searchParams.getAll("subjectRecordIds"),individual=url.searchParams.get("subjectRecordId");requests.push({ids,individual});
  const batch=ids.length>0&&!incompatible,selected=ids.length?currentSubjects.filter(s=>ids.includes(s.id)&&s.id!==unavailable&&s.id!==omit):currentSubjects.filter(s=>s.id===individual);
  const current=(id:string)=>id===subjects[215].id||id===subjects[216].id?null:{recordId:"event-"+id,updatedAt:"2026-10-29T10:00:00.000Z",states:{revision,date:"2026-10-29"}};
  return new Response(JSON.stringify({ok:true,data:{appView:view,date:scope.date,dateFieldId:"date",subjectFieldId:"subject",workflow:{historyMode:"append",uniqueness:{mode:"subject"}},subjectEntityType:{id:scope.sourceEntityTypeId,name:"Synthetic source"},targetEntityType:{id:scope.targetEntityTypeId,name:"Synthetic target"},stateFields:[{fieldId:"revision",label:"Revision",type:"TEXT",required:false,options:[]},{fieldId:"date",label:"Date",type:"DATE",required:false,options:[]}],extraFields:[],
    ...(advertise?{currentBatchCapabilities:cap}:{}),
    ...(batch?{contractId:scope.contractId,currentBatch:{version:1,requestedSubjectIds:ids,results:ids.filter(id=>id!==omit).map(id=>({subjectRecordId:id,status:id===unavailable?"error":"resolved",...(id===unavailable?{code:"SUBJECT_UNAVAILABLE"}:{})}))}}:{}),
    subjects:selected.map(subject=>({subject,current:current(subject.id)})),
    latest:batch?undefined:{items:currentSubjects.slice(0,20).map(subject=>({...current(subject.id),date:scope.date,subject})),pagination:{page:1,pageSize:20,total:currentSubjects.length,hasMore:currentSubjects.length>20}},
  }}),{status:200});}});
 const api={...adapter,getEntityDefinition:async()=>({entity:{id:scope.sourceEntityTypeId,name:"Synthetic source",slug:"synthetic-source",active:true,icon:null,fields:[]}}),getEntityRecords:async(_t:string,_c:string,_e:string,q:{page:number;pageSize:number})=>({records:currentSubjects.slice((q.page-1)*q.pageSize,q.page*q.pageSize).map(subject=>({...subject,updatedAt:"2026-10-29T09:00:00.000Z",values:{}})),pagination:{...q,total:currentSubjects.length,totalPages:Math.ceil(currentSubjects.length/q.pageSize)}})};
 return{api,requests,unavailable:(id?:string)=>{unavailable=id;},omit:(id?:string)=>{omit=id;},oldResponse:()=>{incompatible=true;},revision:(r:string)=>{revision=r;}};
}
async function warm(f:ReturnType<typeof fixture>){await prewarmAssignedAppViewsOnce({api:f.api as any,store,token:"synthetic",appViews:[view]as any,ownerKey:scope.ownerKey,contractId:scope.contractId});}
const read=(n:number)=>store.searchStateUpdateSubjects({...scope,search:subjects[n].displayName});
it("prepares 217 subjects with three batches and persists verified event/null through SQLite reopen",async()=>{
 const f=fixture();await warm(f);expect(f.requests.filter(r=>r.ids.length)).toHaveLength(3);expect(f.requests.filter(r=>r.individual)).toHaveLength(0);
 expect(f.requests.filter(r=>r.ids.length).map(r=>r.ids.length)).toEqual([100,100,17]);
 const proof=await store.getStateUpdateCurrentCoverage(scope);expect(proof).toMatchObject({status:"complete",sourceComplete:true,totalSubjects:217,requestCount:3});expect(Object.keys(proof!.subjects)).toHaveLength(217);expect(proof!.subjects[subjects[215].id]).toEqual({status:"verified",remoteRecordId:null});
 expect((await store.getStateUpdateSnapshotCoverage(scope))?.status).toBe("partial");expect((await read(216))[0].current).toBeNull();expect((await read(0))[0].current?.stateValues.find(v=>v.fieldId==="revision")?.value).toBe("R1");
 await reopen();expect(await store.getStateUpdateCurrentCoverage(scope)).toEqual(proof);expect((await read(216))[0].current).toBeNull();expect((await read(0))[0].current?.stateValues.find(v=>v.fieldId==="revision")?.value).toBe("R1");expect(await db.getFirstAsync("PRAGMA integrity_check")).toEqual({integrity_check:"ok"});expect(f.requests).toHaveLength(4);
});
it("explicit old Core capability absence uses individual reads, but incompatible batch never falls back",async()=>{
 const legacy=fixture(false);await warm(legacy);expect(legacy.requests.filter(r=>r.individual)).toHaveLength(217);expect((await store.getStateUpdateCurrentCoverage(scope))?.status).toBe("complete");
 const f=fixture();f.oldResponse();await warm(f);expect(f.requests.filter(r=>r.ids.length)).toHaveLength(3);expect(f.requests.filter(r=>r.individual)).toHaveLength(0);expect((await store.getStateUpdateCurrentCoverage(scope))?.status).toBe("partial");expect((await read(0))[0].current).not.toBeNull();
});
it("preserves successful subjects and explicit null while a reported error or persistence failure remains failed",async()=>{
 const f=fixture();f.unavailable(subjects[12].id);const write=store.upsertStateUpdateSnapshot.bind(store);
 vi.spyOn(store,"upsertStateUpdateSnapshot").mockImplementation(async input=>input.items[0]?.subject.id===subjects[13].id?{contentVerified:false,persistedRemoteEventCount:0,staleSyncedRemoved:0}:write(input));
 await warm(f);const proof=await store.getStateUpdateCurrentCoverage(scope);expect(proof?.status).toBe("partial");for(const n of[12,13])expect(proof?.subjects[subjects[n].id]).toEqual({status:"failed"});expect(proof?.subjects[subjects[215].id]).toEqual({status:"verified",remoteRecordId:null});expect(proof?.subjects[subjects[200].id].status).toBe("verified");await reopen();expect(await store.getStateUpdateCurrentCoverage(scope)).toEqual(proof);
});
it("omitted subjects invalidate the batch instead of certifying null; later retry succeeds",async()=>{
 const f=fixture();f.omit(subjects[10].id);await warm(f);let proof=await store.getStateUpdateCurrentCoverage(scope);expect(proof?.status).toBe("partial");expect(proof?.subjects[subjects[10].id].status).toBe("failed");expect(proof?.subjects[subjects[200].id].status).toBe("verified");f.omit();await warm(f);proof=await store.getStateUpdateCurrentCoverage(scope);expect(proof?.status).toBe("complete");
});
it("preserves durable local identities/authorization/conflicts on refresh",async()=>{
 const f=fixture(true,48);await warm(f);const saved=await store.saveStateUpdateLocally({...scope,subjectRecordId:subjects[0].id,subjectDisplayName:subjects[0].displayName,stateFields:[],stateValues:[{fieldId:"revision",value:"LOCAL"}],overwrite:true,expectedUpdatedAt:"2026-10-29T10:00:00.000Z"});await db.runAsync("UPDATE entity_records SET sync_status='conflict' WHERE local_id=?",saved.localRecordId);
 const pending=()=>db.getAllAsync("SELECT * FROM pending_operations ORDER BY id"),rows=()=>db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced' ORDER BY local_id");const before=await pending(),beforeRows=await rows();f.revision("R2");await warm(f);expect(await pending()).toEqual(before);expect(await rows()).toEqual(beforeRows);await reopen();expect(await pending()).toEqual(before);expect((await read(0))[0].current?.recordId).toBe(saved.localRecordId);
 });
it("does not persist a cancelled late batch",async()=>{
 const f=fixture();await refreshEntityRecordsCache({api:f.api,store,ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:scope.sourceEntityTypeId,token:"synthetic"});
 const controller=new AbortController();const api={getStateUpdateWorkflow:async(...args:Parameters<typeof f.api.getStateUpdateWorkflow>)=>{const r=await f.api.getStateUpdateWorkflow(...args);controller.abort();return r;}};
 const write=vi.spyOn(store,"upsertStateUpdateSnapshot");await prepareStateUpdateCurrent({api,token:"synthetic",scope,store,sourceRemoteTotal:217,sourceFetched:217,sourceCacheTotal:217,currentBatchCapabilities:cap,runWithConcurrency,concurrency:4,signal:controller.signal});expect(write).not.toHaveBeenCalled();expect((await store.getStateUpdateCurrentCoverage(scope))?.status).toBe("partial");
});

it("validates batch capacity without replacing persisted-content proof or legacy request semantics",async()=>{
 const f=fixture();await warm(f);const proof=(await store.getStateUpdateCurrentCoverage(scope))!;expect(proof.status).toBe("complete");
 const legacy={...proof};delete legacy.requestBatchSize;await store.setStateUpdateCurrentCoverage({...scope,coverage:legacy});expect((await store.getStateUpdateCurrentCoverage(scope))?.status).toBe("partial");
 await store.setStateUpdateCurrentCoverage({...scope,coverage:{...proof,requestBatchSize:101}});expect(await store.getStateUpdateCurrentCoverage(scope)).toBeNull();
 await store.setStateUpdateCurrentCoverage({...scope,coverage:proof});await db.runAsync("DELETE FROM app_metadata WHERE key LIKE 'state_update_v10_snapshot:%' AND json_extract(value,'$.row.server_id')=?","event-"+subjects[200].id);expect((await store.getStateUpdateCurrentCoverage(scope))?.status).toBe("partial");
 for(const changed of [{ownerKey:"other"},{contractId:"other"},{appViewId:"other"},{date:"2026-10-28"},{targetEntityTypeId:"other"}])expect(await store.getStateUpdateCurrentCoverage({...scope,...changed})).toBeNull();
});

it("rejects a late response attributed to another contract without publishing it",async()=>{
 const f=fixture();await refreshEntityRecordsCache({api:f.api,store,ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:scope.sourceEntityTypeId,token:"synthetic"});
 const api={getStateUpdateWorkflow:async(...args:Parameters<typeof f.api.getStateUpdateWorkflow>)=>({...await f.api.getStateUpdateWorkflow(...args),contractId:"other-contract"})};
 const write=vi.spyOn(store,"upsertStateUpdateSnapshot");
 await expect(prepareStateUpdateCurrent({api,token:"synthetic",scope,store,sourceRemoteTotal:217,sourceFetched:217,sourceCacheTotal:217,currentBatchCapabilities:cap,runWithConcurrency,concurrency:4})).rejects.toThrow("STATE_UPDATE_CURRENT_PREPARATION_FAILED");
 expect(write).not.toHaveBeenCalled();expect((await store.getStateUpdateCurrentCoverage(scope))?.status).toBe("partial");expect(await store.getStateUpdateCurrentCoverage({...scope,contractId:"other-contract"})).toBeNull();expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toEqual([]);
});
