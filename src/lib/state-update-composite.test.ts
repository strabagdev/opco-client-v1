// Runtime regression against real SQLite v10 storage and the shared functions.
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";
import { prepareStateUpdateCurrent } from "./state-update-current-prewarm";
import { runWithConcurrency } from "./app-view-prewarm";
import { createOpcoApi } from "./opco-api";
import { compositeConfirmationKey, compositeIdentityKey, parseCompositeContextValues, hasVerifiedCompositeAbsence } from "./state-update-identity";
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

const scope = { ownerKey: "synthetic-owner", contractId: "synthetic-contract", targetEntityTypeId: "synthetic-target", date: "2026-10-12" };
const subject = { id: "synthetic-subject", displayName: "Synthetic subject" };
const event = { recordId: "shared-remote-event", updatedAt: "2026-10-12T12:00:00.000Z", date: scope.date, subject, stateValues: [{ fieldId: "date", value: scope.date, label: null, optionId: null }] };
let temporaryDirectory: string | undefined;
let harness: ReturnType<typeof sqliteHarness>, store: ReturnType<typeof getLocalDatabase>;
beforeEach(async () => { __resetLocalDatabaseForTests(); harness = sqliteHarness(); sqlite.openDatabaseAsync.mockResolvedValue(harness.db); store = getLocalDatabase(); await store.getSelectedContractId(); });
afterEach(() => { harness.stop(); __resetLocalDatabaseForTests(); if (temporaryDirectory) { rmSync(temporaryDirectory, { recursive: true, force: true }); temporaryDirectory = undefined; } });
const attendanceScope = { ...scope, appViewId: "attendance-view", historyMode: "update-current" as const, uniqueness: "subject-date" as const };
async function reopenFile() {
 harness.stop(); __resetLocalDatabaseForTests();
 harness = sqliteHarness(temporaryDirectory + "/db.sqlite"); sqlite.openDatabaseAsync.mockResolvedValue(harness.db);
 store = getLocalDatabase(); await store.getSelectedContractId();
}
async function fileDatabase() {
 harness.stop(); __resetLocalDatabaseForTests(); temporaryDirectory = mkdtempSync("/tmp/opco-v10-runtime-");
 harness = sqliteHarness(temporaryDirectory + "/db.sqlite"); sqlite.openDatabaseAsync.mockResolvedValue(harness.db);
 store = getLocalDatabase(); await store.getSelectedContractId();
}
async function cacheCompositeDefinition(){ await store.upsertAppViewDefinition({ownerKey:scope.ownerKey,contractId:scope.contractId,appViewId:compositeA.appViewId,appViewType:"WORKFLOW",workflowKey:"state-update",status:"ready",lastPreparedAt:event.updatedAt,definition:{kind:"state-update",appView:{id:compositeA.appViewId,name:"Synthetic",slug:"synthetic",type:"WORKFLOW",icon:null,sortOrder:0,config:{workflowKey:"state-update",sourceEntityTypeId:"source",targetEntityTypeId:scope.targetEntityTypeId,subjectFieldId:"subject-field",dateFieldId:"date",stateFields:[],uniqueness:{mode:"subject-date-fields"},historyMode:"update-current"}},sourceEntityTypeId:"source",sourceEntityTypeName:"Subjects",targetEntityTypeId:scope.targetEntityTypeId,targetEntityTypeName:"Reports",subjectFieldId:"subject-field",dateFieldId:"date",historyMode:"update-current",uniqueness:"subject-date-fields",stateFields:[],extraFields:[]}}); }
async function remoteCurrent(view: typeof compositeA) { const item=(await search(view))[0]; if(!item.current)return null; return (await store.getCachedRecord({ownerKey:view.ownerKey,contractId:view.contractId,entityTypeId:view.targetEntityTypeId,recordId:item.current.recordId,appViewId:view.appViewId,date:view.date,identity:view.identity}))?.serverId; }
async function seedSubject() {
 await store.upsertRemoteRecords({ ownerKey: scope.ownerKey, contractId: scope.contractId, entityTypeId: "source",
   records: [{ id: subject.id, displayName: subject.displayName, updatedAt: event.updatedAt, values: {} }] });
}
async function search(view: typeof attendanceScope | typeof compositeA) {
 return store.searchStateUpdateSubjects({ ...view, sourceEntityTypeId: "source", search: "Synthetic" });
}

const identityA = { version: 1 as const, definitionId: "definition", values: { shift: "A", group: "1" } };
const compositeA = { ...attendanceScope, appViewId: "composite-view", uniqueness: "subject-date-fields" as const, dateFieldId: "date", identity: identityA };
const compositeB = { ...compositeA, identity: { ...identityA, values: { shift: "A", group: "2" } } };
const input = (view = compositeA, optionId = "present") => ({ ...view, subjectRecordId: subject.id, subjectDisplayName: subject.displayName, stateFields: [], stateValues: [{ fieldId: "status", optionId }], extraValues: {} });
it("canonicalizes stable IDs without changing legacy keys; rejects incomplete identity", async()=> {
 expect(compositeIdentityKey(identityA)).toBe(compositeIdentityKey({...identityA,values:{group:"1",shift:"A"}}));
 await expect(store.saveStateUpdateLocally({...input(),identity:undefined})).rejects.toThrow();
});
it("isolates same-subject/date snapshots, coverage, intents and conflict restoration after reopen",async()=>{
 await fileDatabase();await seedSubject();await cacheCompositeDefinition();
 const a={...event,recordId:"report-A"};const b={...event,recordId:"report-B"};
 for(const [v,e] of [[compositeA,a],[compositeB,b]] as const){await store.upsertStateUpdateSnapshot({...v,items:[{subject,current:e}],latest:[e]});await store.setStateUpdateCurrentCoverage({...v,sourceEntityTypeId:"source",coverage:{status:"complete",sourceComplete:true,totalSubjects:1,subjects:{[subject.id]:{status:"verified",remoteRecordId:e.recordId}},requestCount:1,durationMs:1,refreshedAt:event.updatedAt}});}
 await reopenFile();expect(await remoteCurrent(compositeA)).toBe("report-A");expect(await remoteCurrent(compositeB)).toBe("report-B");
 const own=await store.saveStateUpdateLocally({...input(),overwrite:true,expectedUpdatedAt:event.updatedAt});
 await store.saveStateUpdateLocally({...input(compositeB),overwrite:true,expectedUpdatedAt:event.updatedAt});
 await reopenFile();const ops=await store.listPendingStateUpdateOperations(scope.ownerKey);expect(ops).toHaveLength(2);expect(new Set(ops.map(o=>o.clientRequestId)).size).toBe(2);
 const op=ops.find(o=>o.clientRequestId===own.clientRequestId)!;expect(op.payload).toMatchObject({identity:identityA,overwrite:true,expectedUpdatedAt:event.updatedAt});
 await store.completeStateUpdateOperation(op,{result:"UPDATED",recordId:"report-A",subjectRecordId:subject.id,updatedAt:"2026-10-12T14:00:00Z"});
 expect((await store.listPendingStateUpdateOperations(scope.ownerKey))).toHaveLength(1);expect((await store.getStateUpdateCurrentCoverage({...compositeB,sourceEntityTypeId:"source"}))?.status).toBe("complete");
 await reopenFile();expect((await search(compositeB))[0].current).not.toBeNull();expect((await store.listStateUpdateLatest(compositeA)).items.every(i=>i.recordId!=="report-B")).toBe(true);
});
it("normalizes actual reports payload through API adapter before persisting scoped current",async()=>{
 await seedSubject();await cacheCompositeDefinition();
 const api=createOpcoApi({apiUrl:"https://synthetic.test",fetcher:async()=>new Response(JSON.stringify({ok:true,data:{appView:{id:compositeA.appViewId,name:"Synthetic",slug:"synthetic"},date:scope.date,sourceEntityType:{id:"source",name:"Subjects"},targetEntityType:{id:scope.targetEntityTypeId,name:"Reports"},workflow:{historyMode:"update-current",uniqueness:{mode:"subject-date-fields"},dateFieldId:"date"},stateFields:[],identityContext:identityA,subjects:[{subject,reports:[{identity:identityA,current:{...event,states:{}}}]}],latest:{items:[],pagination:{page:1,pageSize:1,total:0,hasMore:false}},summary:{totalRegistered:1}}}),{status:200})});
 const response=await api.getStateUpdateWorkflow("synthetic",scope.contractId,compositeA.appViewId,{date:scope.date,identity:identityA});
 expect(response.uniqueness).toBe("subject-date-fields");expect(response.items[0].current?.recordId).toBe(event.recordId);
 await store.upsertStateUpdateSnapshot({...compositeA,items:response.items,latest:[]});expect(await remoteCurrent(compositeA)).toBe(event.recordId);expect((await search(compositeB))[0].current).toBeNull();
});

it("conflicts and Use Opco consume only the exact selected combination after reopening",async()=>{
 await fileDatabase();await cacheCompositeDefinition();await seedSubject();
 for(const v of [compositeA,compositeB])await store.saveStateUpdateLocally({...input(v),overwrite:true,expectedUpdatedAt:event.updatedAt});
 const ops=await store.listPendingStateUpdateOperations(scope.ownerKey);
 for(const op of ops)await store.markStateUpdateOperationConflict(op,{result:"CONFLICT",subjectRecordId:subject.id,requested:{stateValues:[]},existing:{recordId:JSON.stringify(op.payload).includes('"group":"2"')?"report-B":"report-A",updatedAt:event.updatedAt,stateValues:[{fieldId:"status",optionId:"remote",label:null}]}});
 await reopenFile();const a=(await store.listStateUpdateConflicts(compositeA))[0],b=(await store.listStateUpdateConflicts(compositeB))[0];expect(a.identity).toEqual(identityA);expect(a.localRecordId).not.toBe(b.localRecordId);expect(await store.listStateUpdateConflicts(compositeA)).toHaveLength(1);
 const before=await harness.db.getFirstAsync("SELECT * FROM pending_operations WHERE local_record_id=?",b.localRecordId);
 await expect(store.discardStateUpdateLocalChange({...compositeB,localRecordId:a.localRecordId,subjectRecordId:subject.id,conflictIdentity:a.conflictIdentity!})).rejects.toThrow();
 await store.discardStateUpdateLocalChange({...compositeA,localRecordId:a.localRecordId,subjectRecordId:subject.id,conflictIdentity:a.conflictIdentity!});
 await reopenFile();expect(await remoteCurrent(compositeA)).toBe("report-A");expect(await store.listStateUpdateConflicts(compositeA)).toHaveLength(0);expect(await store.listStateUpdateConflicts(compositeB)).toHaveLength(1);expect(await harness.db.getFirstAsync("SELECT * FROM pending_operations WHERE local_record_id=?",b.localRecordId)).toEqual(before);
});

it.each(["complete", "partial-source", "failed-subject", "interrupted"])("certifies only the explicit context with source and every subject persisted: %s",async scenario=>{
 await cacheCompositeDefinition();await seedSubject();
 await store.upsertRemoteRecords({ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:"source",records:[{id:"empty-subject",displayName:"Synthetic empty",updatedAt:event.updatedAt,values:{}}]});
 let requests=0;const controller=new AbortController();
 const api=createOpcoApi({apiUrl:"https://synthetic.test",fetcher:async url=>{requests++;const params=new URL(String(url)).searchParams;expect(JSON.parse(params.get("identity")!)).toEqual(identityA);expect(params.get("pageSize")).toBe("1");if(scenario==="failed-subject"&&params.get("subjectRecordId")==="empty-subject")return new Response(JSON.stringify({ok:false,error:{code:"CONTROLLED",message:"Synthetic failure"}}),{status:500});if(scenario==="interrupted")controller.abort();const current=params.get("subjectRecordId")===subject.id?{...event,states:{}}:null;return new Response(JSON.stringify({ok:true,data:{appView:{id:compositeA.appViewId,name:"Synthetic",slug:"synthetic"},date:scope.date,dateFieldId:"date",subjectFieldId:"subject-field",sourceEntityType:{id:"source",name:"Subjects"},targetEntityType:{id:scope.targetEntityTypeId,name:"Reports"},historyMode:"update-current",uniqueness:{mode:"subject-date-fields"},stateFields:[],extraFields:[],identityContext:identityA,subjects:[{subject:params.get("subjectRecordId")===subject.id?subject:{id:"empty-subject",displayName:"Synthetic empty"},reports:[{identity:identityA,current}]}],latest:[]}}),{status:200})}});
 const prep=prepareStateUpdateCurrent({api,token:"synthetic",store,scope:{...compositeA,sourceEntityTypeId:"source"},sourceRemoteTotal:scenario==="partial-source"?3:2,sourceFetched:2,sourceCacheTotal:2,runWithConcurrency,concurrency:2,signal:controller.signal});
 if(scenario==="failed-subject")await expect(prep).rejects.toThrow();else await prep;
 expect(requests).toBeLessThanOrEqual(2);const coverage=await store.getStateUpdateCurrentCoverage({...compositeA,sourceEntityTypeId:"source"});expect(coverage?.status).toBe(scenario==="complete"?"complete":"partial");if(scenario==="complete")expect(coverage?.subjects["empty-subject"]).toEqual({status:"verified",remoteRecordId:null});expect(await store.getStateUpdateCurrentCoverage({...compositeB,sourceEntityTypeId:"source"})).toBeNull();
});

it("binds confirmation to scope, shown version, values and extras, and rejects malformed route context",()=>{
 const key=compositeConfirmationKey("owner/contract/view/date/context","subject","base",[{fieldId:"s",value:1}],{note:"shown"});
 for(const candidate of [compositeConfirmationKey("other-scope","subject","base",[{fieldId:"s",value:1}],{note:"shown"}),compositeConfirmationKey("owner/contract/view/date/context","subject","new-base",[{fieldId:"s",value:1}],{note:"shown"}),compositeConfirmationKey("owner/contract/view/date/context","subject","base",[{fieldId:"s",value:2}],{note:"shown"}),compositeConfirmationKey("owner/contract/view/date/context","subject","base",[{fieldId:"s",value:1}],{note:"edited"})])expect(candidate).not.toBe(key);
 expect(parseCompositeContextValues(JSON.stringify(identityA.values))).toEqual(identityA.values);expect(parseCompositeContextValues('["A"]')).toEqual({});expect(parseCompositeContextValues('{"shift":1}')).toEqual({});
});

it("preserves an identical authorized composite intention byte for byte after reopening",async()=>{
 await fileDatabase();await cacheCompositeDefinition();await seedSubject();await store.upsertStateUpdateSnapshot({...compositeA,items:[{subject,current:event}],latest:[event]});
 const saved=await store.saveStateUpdateLocally({...input(),overwrite:true,expectedUpdatedAt:event.updatedAt});const row=await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id=?",saved.localRecordId),op=await harness.db.getFirstAsync("SELECT * FROM pending_operations WHERE local_record_id=?",saved.localRecordId);
 await reopenFile();const again=await store.saveStateUpdateLocally({...input(),expectedUpdatedAt:event.updatedAt,preserveIdenticalConfirmedIntent:true});expect(again.clientRequestId).toBe(saved.clientRequestId);expect(await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id=?",saved.localRecordId)).toEqual(row);expect(await harness.db.getFirstAsync("SELECT * FROM pending_operations WHERE local_record_id=?",saved.localRecordId)).toEqual(op);
});

it("keeps the complete remote conflict content supplied by the new mode",async()=>{
 const full=[{fieldId:"status",optionId:"ok",label:"Operativo"},{fieldId:"counter",optionId:null,label:null,value:45},{fieldId:"note",optionId:null,label:null,value:"Remote note"}];
 const api=createOpcoApi({apiUrl:"https://synthetic.test",fetcher:async()=>new Response(JSON.stringify({ok:true,data:{identity:identityA,appView:{id:compositeA.appViewId,name:"Synthetic",slug:"synthetic"},result:{result:"CONFLICT",subjectRecordId:subject.id,differences:[{kind:"state",fieldId:"counter",currentValue:45,requestedValue:44}],existing:{recordId:event.recordId,updatedAt:event.updatedAt,stateValues:full,extraValues:{observation:"remote"}},requested:{states:{counter:44}}}}}),{status:200})});
 const response=await api.saveStateUpdateWorkflow("synthetic",scope.contractId,compositeA.appViewId,{identity:identityA,date:scope.date,clientRequestId:"request",subjectRecordId:subject.id,stateValues:[{fieldId:"counter",value:44}]});expect(response.results[0]).toMatchObject({result:"CONFLICT",existing:{stateValues:full,extraValues:{observation:"remote"}}});
});

it("distinguishes confirmed report absence from failure, missing query and an existing report",()=>{expect(hasVerifiedCompositeAbsence({status:"verified",remoteRecordId:null})).toBe(true);expect(hasVerifiedCompositeAbsence()).toBe(false);expect(hasVerifiedCompositeAbsence({status:"failed"})).toBe(false);expect(hasVerifiedCompositeAbsence({status:"verified",remoteRecordId:"existing"})).toBe(false);});

it("scoped direct lookups reject another operational date or identity, including pending physical rows",async()=>{
 await fileDatabase();await cacheCompositeDefinition();await seedSubject();await store.upsertStateUpdateSnapshot({...compositeA,items:[{subject,current:event}],latest:[event]});
 const lookup={ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:scope.targetEntityTypeId,appViewId:compositeA.appViewId,date:scope.date,identity:identityA};
 expect(await store.getCachedRecord({...lookup,date:"2026-10-13",recordId:event.recordId})).toBeNull();
 const saved=await store.saveStateUpdateLocally({...input(),overwrite:true,expectedUpdatedAt:event.updatedAt});
 expect(await store.getCachedRecord({...lookup,identity:compositeB.identity,recordId:saved.localRecordId})).toBeNull();
 expect(await store.getCachedRecord({...lookup,recordId:saved.localRecordId})).not.toBeNull();
});
