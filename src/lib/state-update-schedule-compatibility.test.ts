// Compatibility regressions from archived review; runtime consumers are now under test.
// Only new-format fixture metadata is injected; every consumer below is the unmodified published runtime.
// Runtime regression against real SQLite v10 storage and the shared functions.
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { stateUpdateIntentsEqual, resolveStateUpdateClientRequestId } from "./state-update-offline";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";
import { createOpcoApi } from "./opco-api";
import { syncPendingStateUpdatesOnce } from "../sync/state-update-sync";
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
const input = (view = compositeA, optionId = "present") => ({ ...view, subjectRecordId: subject.id, subjectDisplayName: subject.displayName, preserveIdenticalConfirmedIntent: true, stateFields: [{fieldId:"status",label:"Synthetic status",type:"SELECT" as const,required:true,options:[{optionId:"present",value:"PRESENT",label:"Present"},{optionId:"changed",value:"CHANGED",label:"Changed"}]}], stateValues: [{ fieldId: "status", optionId }], extraValues: {} });


const schedule = { schemaVersion: 1 as const, bindingId: "synthetic-binding", revisionId: "synthetic-revision-1", revisionDigest: "synthetic-immutable-digest" };
const scheduleApplication = { ...schedule, scheduleRecordId: "synthetic-schedule", operationalDate: scope.date,
  applied: { name: "Synthetic shift", startTime: "20:00", endTime: "08:00", endDayOffset: 1, timeZone: "America/Santiago", nominalMinutes: 720, durationPolicy: "civil-clock" as const } };
async function seedProposedIntent(mode: "create" | "update" = "update") {
 await fileDatabase();await cacheCompositeDefinition();await seedSubject();
 if(mode === "update")await store.upsertStateUpdateSnapshot({...compositeA,items:[{subject,current:event}],latest:[event]});
 const own = await store.saveStateUpdateLocally({...input(),...(mode === "update" ? {overwrite:true,expectedUpdatedAt:event.updatedAt} : {})});
 await store.saveStateUpdateLocally({...input(compositeB),overwrite:true,expectedUpdatedAt:event.updatedAt});
 const row=await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id=?",own.localRecordId);
 const operation=await harness.db.getFirstAsync("SELECT * FROM pending_operations WHERE local_record_id=?",own.localRecordId);
 // Exclusive synthetic database: additive proposed JSON. No new functional writer is claimed.
 await harness.db.withTransactionAsync(async()=>{
  await harness.db.runAsync("UPDATE entity_records SET values_json=? WHERE local_id=?",JSON.stringify({...JSON.parse(row.values_json),scheduleApplication}),own.localRecordId);
  await harness.db.runAsync("UPDATE pending_operations SET payload_json=? WHERE id=?",JSON.stringify({...JSON.parse(operation.payload_json),schedule,scheduleApplication}),operation.id);
 });
 return {own,operation};
}
async function readOwn(localId:string) {
 const row=await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id=?",localId);
 const op=await harness.db.getFirstAsync("SELECT * FROM pending_operations WHERE local_record_id=?",localId);
 return {row,op,values:JSON.parse(row.values_json),payload:JSON.parse(op.payload_json)};
}
const editedInput = (mode: "create" | "update") => ({...input(compositeA,"changed"),...(mode === "update" ? {overwrite:true,expectedUpdatedAt:event.updatedAt} : {})});

it("published runtime can open/read proposed metadata after SQLite reopen without deleting it",async()=>{
 const {own}=await seedProposedIntent();await reopenFile();const before=await readOwn(own.localRecordId);
 expect(before.payload.schedule).toEqual(schedule);expect(before.values.scheduleApplication).toEqual(scheduleApplication);
 const subjects=await search(compositeA);expect(subjects[0].current).not.toBeNull();
 const after=await readOwn(own.localRecordId);expect(after).toEqual(before);
});
it("published identical confirmed save WITH the actual composite preservation flag keeps all bytes",async()=>{
 const {own}=await seedProposedIntent();await reopenFile();const before=await readOwn(own.localRecordId);
 await store.saveStateUpdateLocally({...input(),overwrite:true,expectedUpdatedAt:event.updatedAt});
 await reopenFile();expect(await readOwn(own.localRecordId)).toEqual(before);
});
// Both original positive preservation regressions, unchanged.
it.each(["create","update"] as const)("REQUIRED: retain proposed schedule metadata across content edit and reopen: %s",async mode=>{
 const {own}=await seedProposedIntent(mode);await reopenFile();
 await store.saveStateUpdateLocally(editedInput(mode));await reopenFile();const after=await readOwn(own.localRecordId);
 expect(after.payload.schedule).toEqual(schedule);
 expect(after.payload.scheduleApplication).toEqual(scheduleApplication);
 expect(after.values.scheduleApplication).toEqual(scheduleApplication);
});

it("REQUIRED: current sync and API adapter transmit the persisted schedule reference without replacing authorization or base",async()=>{
 const {own}=await seedProposedIntent();await reopenFile();const before=await readOwn(own.localRecordId);
 const sent:Record<string,unknown>[]=[];
 const api=createOpcoApi({apiUrl:"https://synthetic.test",fetcher:async(_url,init)=>{
  sent.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify({ok:false,error:{code:"SYNTHETIC_CONTROLLED_REJECTION",message:"Controlled rejection; no Core write"}}),{status:400});
 }});
 const result=await syncPendingStateUpdatesOnce({api,store,ownerKey:scope.ownerKey,token:"synthetic-only"});
 expect(result.completed).toBe(0);expect(sent).toHaveLength(2);
 const request=sent.find(r=>r.clientRequestId===before.op.client_request_id)!;
 expect(request).toMatchObject({identity:identityA,overwrite:before.payload.overwrite,expectedUpdatedAt:before.payload.expectedUpdatedAt,clientRequestId:before.op.client_request_id});
 expect(request.schedule).toEqual(before.payload.schedule);
});
it("REQUIRED: changing only the applied schedule revision is a different semantic intent and request identity",async()=>{
 const {own}=await seedProposedIntent();await reopenFile();const before=await readOwn(own.localRecordId);
 const next={...before.payload,schedule:{...schedule,revisionId:"synthetic-revision-2",revisionDigest:"synthetic-second-digest"},scheduleApplication:{...scheduleApplication,revisionId:"synthetic-revision-2",revisionDigest:"synthetic-second-digest"}};
 expect(stateUpdateIntentsEqual(before.payload,next)).toBe(false);
 expect(resolveStateUpdateClientRequestId({existingClientRequestId:before.op.client_request_id,existingPayload:before.payload,nextPayload:next})).not.toBe(before.op.client_request_id);
});

it("an explicit incompatible revision cannot reuse the pinned authorization or base", async () => {
 const {own}=await seedProposedIntent();await reopenFile();const before=await readOwn(own.localRecordId);
 const replacement={...schedule,revisionId:"another-revision",revisionDigest:"another-digest"};
 await expect(store.saveStateUpdateLocally({...editedInput("update"),schedule:replacement,scheduleApplication:{...scheduleApplication,...replacement}})).rejects.toThrow("revisión explícita");
 await expect(store.saveStateUpdateLocally({...editedInput("update"),expectedUpdatedAt:"2026-10-13T12:00:00.000Z"})).rejects.toThrow("revisión explícita");
 await reopenFile();expect(await readOwn(own.localRecordId)).toEqual(before);
});
it("identical replay retains authorization, delivery state and the exact request after reopen", async()=>{
 const {own}=await seedProposedIntent();const operation=(await store.listPendingStateUpdateOperations(scope.ownerKey)).find(op=>op.localRecordId===own.localRecordId)!;
 await store.markStateUpdateOperationSyncing(operation.id,operation.clientRequestId);await reopenFile();const before=await readOwn(own.localRecordId);
 await store.saveStateUpdateLocally({...input(),overwrite:true,expectedUpdatedAt:event.updatedAt});await reopenFile();expect(await readOwn(own.localRecordId)).toEqual(before);
});
it("synthetic ACK/replay preserves schedule in the durable receipt and consumes only its intention",async()=>{
 const {own}=await seedProposedIntent();const operations=await store.listPendingStateUpdateOperations(scope.ownerKey);const operation=operations.find(op=>op.localRecordId===own.localRecordId)!;
 const foreign=(await harness.db.getAllAsync("SELECT * FROM pending_operations")).filter((op:{local_record_id:string})=>op.local_record_id!==own.localRecordId);
 const ack={result:"UPDATED" as const,recordId:event.recordId,subjectRecordId:subject.id,updatedAt:"2026-10-12T13:00:00.000Z",scheduleApplication};
 await store.completeStateUpdateOperation(operation,ack);await reopenFile();
 const row=await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id=?",own.localRecordId);const values=JSON.parse(row.values_json);
 expect(row.sync_status).toBe("synced");expect(values.schedule).toEqual(schedule);expect(values.scheduleApplication).toEqual(scheduleApplication);expect(values.clientRequestId).toBe(operation.clientRequestId);
 expect(await harness.db.getFirstAsync("SELECT * FROM pending_operations WHERE id=?",operation.id)).toBeNull();
 for(const op of foreign)expect(await harness.db.getFirstAsync("SELECT * FROM pending_operations WHERE id=?",op.id)).toEqual(op);
 await store.completeStateUpdateOperation(operation,ack);await reopenFile();expect(await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id=?",own.localRecordId)).toEqual(row);
});
it("late ACK and conflict cannot consume a newer content edit with its pinned schedule",async()=>{
 const {own}=await seedProposedIntent();const old=(await store.listPendingStateUpdateOperations(scope.ownerKey)).find(op=>op.localRecordId===own.localRecordId)!;
 await store.markStateUpdateOperationSyncing(old.id,old.clientRequestId);await store.saveStateUpdateLocally(editedInput("update"));await reopenFile();const edited=await readOwn(own.localRecordId);
 expect(edited.op.client_request_id).not.toBe(old.clientRequestId);
 await store.completeStateUpdateOperation(old,{result:"UPDATED",recordId:event.recordId,subjectRecordId:subject.id,updatedAt:event.updatedAt,scheduleApplication});
 await store.markStateUpdateOperationConflict(old,{result:"CONFLICT",subjectRecordId:subject.id,existing:{...event,scheduleApplication},requested:{stateValues:[]}});
 await reopenFile();expect(await readOwn(own.localRecordId)).toEqual(edited);
});
it("rollback leaves the pinned snapshot, authorization and outbox intact",async()=>{
 const {own}=await seedProposedIntent();const before=await readOwn(own.localRecordId);const run=harness.db.runAsync.getMockImplementation()!;
 harness.db.runAsync.mockImplementation((sql,...args)=>{if(sql.includes("INSERT INTO pending_operations"))throw Error("controlled outbox failure");return run(sql,...args);});
 await expect(store.saveStateUpdateLocally(editedInput("update"))).rejects.toThrow("controlled outbox failure");await reopenFile();expect(await readOwn(own.localRecordId)).toEqual(before);
});
const remoteSchedule={...schedule,revisionId:"remote-revision",revisionDigest:"remote-digest"};
const remoteApplication={...scheduleApplication,...remoteSchedule};
async function scheduleConflict(){
 const {own}=await seedProposedIntent();const operation=(await store.listPendingStateUpdateOperations(scope.ownerKey)).find(op=>op.localRecordId===own.localRecordId)!;
 await store.markStateUpdateOperationConflict(operation,{result:"CONFLICT",subjectRecordId:subject.id,existing:{...event,updatedAt:"2026-10-12T14:00:00.000Z",schedule:remoteSchedule,scheduleApplication:remoteApplication},requested:{stateValues:[]}});
 await reopenFile();const conflict=(await store.listStateUpdateConflicts(compositeA))[0];return {own,operation,conflict};
}
it("Use Opco restores the selected REMOTE snapshot, keeps the foreign intention and reopens",async()=>{
 const {own,operation,conflict}=await scheduleConflict();expect(conflict.scheduleApplication).toEqual(scheduleApplication);expect(conflict.conflictRemoteScheduleApplication).toEqual(remoteApplication);
 const foreign=(await harness.db.getAllAsync("SELECT * FROM pending_operations")).filter((op:{id:string})=>op.id!==operation.id);
 await store.discardStateUpdateLocalChange({...compositeA,localRecordId:own.localRecordId,subjectRecordId:subject.id,conflictIdentity:conflict.conflictIdentity!});await reopenFile();
 const row=await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id=?",own.localRecordId);expect(JSON.parse(row.values_json).scheduleApplication).toEqual(remoteApplication);expect(row.sync_status).toBe("synced");
 for(const op of foreign)expect(await harness.db.getFirstAsync("SELECT * FROM pending_operations WHERE id=?",op.id)).toEqual(op);
});
it("Use local retains the LOCAL applied snapshot and only the explicitly confirmed remote base",async()=>{
 const {own,operation,conflict}=await scheduleConflict();
 await store.resolveStateUpdateConflictWithLocal({...input(),schedule,scheduleApplication,localRecordId:own.localRecordId,conflictIdentity:conflict.conflictIdentity!,expectedUpdatedAt:conflict.conflictRemoteUpdatedAt,overwrite:true});await reopenFile();
 const saved=await readOwn(own.localRecordId);expect(saved.payload.scheduleApplication).toEqual(scheduleApplication);expect(saved.payload.overwrite).toBe(true);expect(saved.payload.expectedUpdatedAt).toBe(conflict.conflictRemoteUpdatedAt);expect(saved.op.client_request_id).not.toBe(operation.clientRequestId);
});
it("an incomplete remote conflict cannot discard the local schedule or its intention",async()=>{
 const {own}=await seedProposedIntent();const operation=(await store.listPendingStateUpdateOperations(scope.ownerKey)).find(op=>op.localRecordId===own.localRecordId)!;
 await store.markStateUpdateOperationConflict(operation,{result:"CONFLICT",subjectRecordId:subject.id,existing:event,requested:{stateValues:[]}});const conflict=(await store.listStateUpdateConflicts(compositeA))[0];const before=await readOwn(own.localRecordId);
 await expect(store.discardStateUpdateLocalChange({...compositeA,localRecordId:own.localRecordId,subjectRecordId:subject.id,conflictIdentity:conflict.conflictIdentity!})).rejects.toThrow("revisión explícita");await reopenFile();expect(await readOwn(own.localRecordId)).toEqual(before);
});
it("invalid future metadata is not erased by editing or sent as an ordinary command",async()=>{
 const {own}=await seedProposedIntent();const before=await readOwn(own.localRecordId);
 await harness.db.runAsync("UPDATE pending_operations SET payload_json=? WHERE id=?",JSON.stringify({...before.payload,schedule:{...schedule,schemaVersion:999}}),before.op.id);await reopenFile();const invalid=await readOwn(own.localRecordId);
 await expect(store.saveStateUpdateLocally(editedInput("update"))).rejects.toThrow("revisión explícita");expect(await readOwn(own.localRecordId)).toEqual(invalid);
});

it.each(["attendance","state-update"] as const)("without schedule: %s retains exact payload, identity, confirmation, reopen, sync and conflict resolution",async workflowKey=>{
 await fileDatabase();await seedSubject();const view={...attendanceScope,appViewId:workflowKey+"-legacy-view"};
 const fields=input().stateFields;
 const appView={id:view.appViewId,name:"Synthetic",slug:"synthetic",type:"WORKFLOW" as const,icon:null,sortOrder:0,config:{workflowKey,sourceEntityTypeId:"source",targetEntityTypeId:scope.targetEntityTypeId,subjectFieldId:"subject-field",personFieldId:"subject-field",statusFieldId:"status",dateFieldId:"date",stateFields:[],uniqueness:{mode:"subject-date" as const},historyMode:"update-current" as const}};
 await store.upsertAppViewDefinition({ownerKey:scope.ownerKey,contractId:scope.contractId,appViewId:view.appViewId,appViewType:"WORKFLOW",workflowKey,status:"ready",lastPreparedAt:event.updatedAt,definition: workflowKey==="attendance"?{kind:"attendance",appView,statuses:[],sourceEntityTypeId:"source",targetEntityTypeId:scope.targetEntityTypeId}:{kind:"state-update",appView,sourceEntityTypeId:"source",targetEntityTypeId:scope.targetEntityTypeId,subjectFieldId:"subject-field",dateFieldId:"date",historyMode:"update-current",uniqueness:"subject-date",stateFields:fields,extraFields:[]}});
 await store.upsertStateUpdateSnapshot({...view,items:[{subject,current:event}]});
 const save={...view,subjectRecordId:subject.id,subjectDisplayName:subject.displayName,stateFields:fields,stateValues:[{fieldId:"status",optionId:"present"}],extraValues:{note:"Synthetic"},preserveIdenticalConfirmedIntent:true,expectedUpdatedAt:event.updatedAt,overwrite:true};
 const own=await store.saveStateUpdateLocally(save);await reopenFile();const before=await readOwn(own.localRecordId);
 const expectedPayload={appViewId:view.appViewId,snapshotConfiguration:before.payload.snapshotConfiguration,...(workflowKey==="state-update"?{snapshotDateFieldId:"date"}:{}),clientRequestId:before.op.client_request_id,date:scope.date,expectedUpdatedAt:event.updatedAt,extraValues:{note:"Synthetic"},historyMode:"update-current",overwrite:true,stateValues:[{fieldId:"status",label:"Present",optionId:"present"}],subjectDisplayName:subject.displayName,subjectRecordId:subject.id,uniqueness:"subject-date",localDelivery:"never-dispatched"};
 // Exact durable format of the published runtime: no new fields are introduced when absent.
 expect(before.payload).toEqual(expectedPayload);expect(before.values).not.toHaveProperty("schedule");expect(before.values).not.toHaveProperty("scheduleApplication");
 await store.saveStateUpdateLocally(save);await reopenFile();expect(await readOwn(own.localRecordId)).toEqual(before);
 const sent:Record<string,unknown>[]=[];let remoteConflict=true;
 const api=createOpcoApi({apiUrl:"https://synthetic.test",fetcher:async(_url,init)=>{
  sent.push(JSON.parse(String(init?.body)));
  const result=remoteConflict?{result:"CONFLICT",subjectRecordId:subject.id,differences:[],existing:{recordId:event.recordId,updatedAt:"2026-10-12T15:00:00.000Z",stateValues:[{fieldId:"status",optionId:"changed",label:"Changed"}]},requested:{states:{status:"present"}}}:{result:"UPDATED",recordId:event.recordId,subjectRecordId:subject.id,updatedAt:"2026-10-12T16:00:00.000Z"};
  return new Response(JSON.stringify({ok:true,data:{appView:{id:view.appViewId,name:"Synthetic",slug:"synthetic"},results:[result]}}),{status:200});
 }});
 await syncPendingStateUpdatesOnce({api,store,ownerKey:scope.ownerKey,token:"synthetic-only"});
 expect(sent[0]).toEqual({clientRequestId:before.op.client_request_id,date:scope.date,expectedUpdatedAt:event.updatedAt,extraValues:{note:"Synthetic"},overwrite:true,states:{status:"present"},subjectRecordId:subject.id});
 await reopenFile();const conflict=(await store.listStateUpdateConflicts(view))[0];expect(conflict).toBeDefined();expect((await readOwn(own.localRecordId)).payload).toEqual(Object.fromEntries(Object.entries(expectedPayload).filter(([key])=>key!=="localDelivery")));
 await store.resolveStateUpdateConflictWithLocal({...save,localRecordId:own.localRecordId,conflictIdentity:conflict.conflictIdentity!,expectedUpdatedAt:conflict.conflictRemoteUpdatedAt});
 const confirmed=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];expect(confirmed.clientRequestId).not.toBe(before.op.client_request_id);remoteConflict=false;
 await syncPendingStateUpdatesOnce({api,store,ownerKey:scope.ownerKey,token:"synthetic-only"});await reopenFile();
 expect(sent[1]).toEqual({...sent[0],clientRequestId:confirmed.clientRequestId,expectedUpdatedAt:conflict.conflictRemoteUpdatedAt});
 expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toEqual([]);
 const row=await harness.db.getFirstAsync("SELECT * FROM entity_records WHERE local_id=?",own.localRecordId);expect(row.sync_status).toBe("synced");expect(JSON.parse(row.values_json)).not.toHaveProperty("schedule");
});

it("current/latest snapshots retain the applied schedule; an older response cannot downgrade them",async()=>{
 await fileDatabase();await cacheCompositeDefinition();await seedSubject();
 const remote={...event,schedule,scheduleApplication};
 expect((await store.upsertStateUpdateSnapshot({...compositeA,items:[{subject,current:remote}],latest:[remote],complete:true})).contentVerified).toBe(true);
 await reopenFile();expect((await search(compositeA))[0].current?.scheduleApplication).toEqual(scheduleApplication);
 expect((await store.listStateUpdateLatest(compositeA)).items[0].scheduleApplication).toEqual(scheduleApplication);
 const incomplete={...event,updatedAt:"2026-10-12T18:00:00.000Z"};
 expect((await store.upsertStateUpdateSnapshot({...compositeA,items:[{subject,current:incomplete}],latest:[incomplete],complete:true})).contentVerified).toBe(false);
 await reopenFile();expect((await store.listStateUpdateLatest(compositeA)).items[0].scheduleApplication).toEqual(scheduleApplication);
});
it("a controlled Core rejection and an explicit replay retain the exact pinned command",async()=>{
 const {own}=await seedProposedIntent();const op=(await store.listPendingStateUpdateOperations(scope.ownerKey)).find(o=>o.localRecordId===own.localRecordId)!;
 const sent:Record<string,unknown>[]=[];
 const api=createOpcoApi({apiUrl:"https://synthetic.test",fetcher:async(_url,init)=>{
  sent.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify({ok:false,error:{code:"SCHEDULE_NOT_SUPPORTED",message:"Schedules disabled"}}),{status:400});
 }});
 await syncPendingStateUpdatesOnce({api,store,ownerKey:scope.ownerKey,token:"synthetic-only"});await reopenFile();const rejected=await readOwn(own.localRecordId);
 expect(rejected.row.sync_status).toBe("failed");expect(rejected.op.client_request_id).toBe(op.clientRequestId);expect(rejected.payload.scheduleApplication).toEqual(scheduleApplication);
 await store.retryStateUpdateOperation(op,"CONTROLLED_EXPLICIT_REPLAY","Synthetic explicit retry");
 await syncPendingStateUpdatesOnce({api,store,ownerKey:scope.ownerKey,token:"synthetic-only"});await reopenFile();
 const requests=sent.filter(r=>r.clientRequestId===op.clientRequestId);expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);expect((await readOwn(own.localRecordId)).payload).toEqual(rejected.payload);
});
it("unsupported metadata terminates its operation without stopping an unrelated queued command",async()=>{
 const {own}=await seedProposedIntent();const before=await readOwn(own.localRecordId);
 await harness.db.runAsync("UPDATE pending_operations SET payload_json=? WHERE id=?",JSON.stringify({...before.payload,schedule:{...schedule,schemaVersion:999}}),before.op.id);
 const sent:Record<string,unknown>[]=[];const api=createOpcoApi({apiUrl:"https://synthetic.test",fetcher:async(_url,init)=>{sent.push(JSON.parse(String(init?.body)));return new Response(JSON.stringify({ok:false,error:{code:"CONTROLLED_REJECTION",message:"Synthetic"}}),{status:400});}});
 const result=await syncPendingStateUpdatesOnce({api,store,ownerKey:scope.ownerKey,token:"synthetic-only"});expect(result.failed).toBe(2);expect(sent).toHaveLength(1);
 await reopenFile();const after=await readOwn(own.localRecordId);expect(after.payload.schedule.schemaVersion).toBe(999);expect(after.row.sync_status).toBe("failed");expect(after.op.last_error_code).toBe("SCHEDULE_METADATA_REVIEW_REQUIRED");expect(after.op.client_request_id).toBe(before.op.client_request_id);
});
it("a synthetic ACK with a different revision cannot consume the selected intention",async()=>{
 const {own}=await seedProposedIntent();const operation=(await store.listPendingStateUpdateOperations(scope.ownerKey)).find(op=>op.localRecordId===own.localRecordId)!;const before=await readOwn(own.localRecordId);
 await expect(store.completeStateUpdateOperation(operation,{result:"UPDATED",recordId:event.recordId,subjectRecordId:subject.id,updatedAt:event.updatedAt,schedule:remoteSchedule,scheduleApplication:remoteApplication})).rejects.toThrow("revisión explícita");
 await reopenFile();expect(await readOwn(own.localRecordId)).toEqual(before);
});
it("a reference-only outbox preserves its matching row snapshot when edited",async()=>{
 const {own}=await seedProposedIntent();const before=await readOwn(own.localRecordId);const referenceOnly={...before.payload};delete referenceOnly.scheduleApplication;
 await harness.db.runAsync("UPDATE pending_operations SET payload_json=? WHERE id=?",JSON.stringify(referenceOnly),before.op.id);await reopenFile();
 await store.saveStateUpdateLocally(editedInput("update"));await reopenFile();const after=await readOwn(own.localRecordId);
 expect(after.payload.schedule).toEqual(schedule);expect(after.payload.scheduleApplication).toEqual(scheduleApplication);expect(after.values.scheduleApplication).toEqual(scheduleApplication);expect(after.payload.expectedUpdatedAt).toBe(before.payload.expectedUpdatedAt);
});
it("a new offline intention with no applied snapshot cannot be silently queued",async()=>{
 await fileDatabase();await cacheCompositeDefinition();await seedSubject();
 await expect(store.saveStateUpdateLocally({...input(),schedule})).rejects.toThrow("revisión explícita");await reopenFile();expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toEqual([]);
});

it("an unsent scheduled create reopens with its durable null base and remains editable",async()=>{
 const {own}=await seedProposedIntent("create");await reopenFile();const current=(await search(compositeA))[0].current!;
 expect(current.localExpectedUpdatedAt).toBeNull();expect(current.updatedAt).toBeTruthy();
 await store.saveStateUpdateLocally({...editedInput("create"),expectedUpdatedAt:current.localExpectedUpdatedAt});await reopenFile();
 const after=await readOwn(own.localRecordId);expect(after.payload.expectedUpdatedAt).toBeNull();expect(after.payload.scheduleApplication).toEqual(scheduleApplication);expect(after.payload.overwrite).toBeUndefined();
});

const schedulePolicy = {schemaVersion:1 as const,kind:"consumer" as const,bindingId:schedule.bindingId,catalogEntityTypeId:"catalog",sourceFieldId:"shift",dateFieldId:"date",activeFrom:"2020-01-01",optionBindings:[{optionId:"A",scheduleRecordId:scheduleApplication.scheduleRecordId}],requirement:"required-for-new-records" as const,operationalDatePolicy:"explicit-start-date" as const,durationPolicy:"civil-clock" as const};
const scheduleResolution={schemaVersion:1 as const,bindingId:schedule.bindingId,sourceFieldId:"shift",dateFieldId:"date",operationalDate:scope.date,optionId:"A",status:"resolved" as const,effectiveFrom:"2020-01-01",application:scheduleApplication};
it("persists the selected-context revision separately and reopens it only within its full scope",async()=>{
 await fileDatabase();await cacheCompositeDefinition();
 await store.upsertStateUpdateSnapshot({...compositeA,schedulePolicy,scheduleResolution,items:[],latest:[]});await reopenFile();
 expect(await store.getStateUpdateScheduleContext!({...compositeA,policy:schedulePolicy})).toMatchObject({resolution:scheduleResolution});
 for(const wrong of [{ownerKey:"other"},{contractId:"other"},{appViewId:"other"},{targetEntityTypeId:"other"},{date:"2026-10-13"},{identity:compositeB.identity}])expect(await store.getStateUpdateScheduleContext!({...compositeA,...wrong,policy:schedulePolicy})).toBeNull();
 expect(await store.getStateUpdateScheduleContext!({...compositeA,policy:{...schedulePolicy,bindingId:"other"}})).toBeNull();
 expect(await store.getStateUpdateCurrentCoverage({...compositeA,sourceEntityTypeId:"source",scheduleBindingId:schedule.bindingId})).toBeNull();
});
it("a mismatched revision response rolls back without erasing the prepared context or a pending intent",async()=>{
 await fileDatabase();await cacheCompositeDefinition();
 await store.upsertStateUpdateSnapshot({...compositeA,schedulePolicy,scheduleResolution,items:[],latest:[]});
 const own=await store.saveStateUpdateLocally({...input(),scheduleApplication});const before=await readOwn(own.localRecordId);
 await expect(store.upsertStateUpdateSnapshot({...compositeA,schedulePolicy,scheduleResolution:{...scheduleResolution,optionId:"wrong"},items:[],latest:[]})).rejects.toThrow();
 await reopenFile();expect(await readOwn(own.localRecordId)).toEqual(before);expect(await store.getStateUpdateScheduleContext!({...compositeA,policy:schedulePolicy})).toMatchObject({resolution:scheduleResolution});
});
it("an old snapshot without required schedule metadata cannot certify reports after policy activation",async()=>{
 await fileDatabase();await cacheCompositeDefinition();
 const result=await store.upsertStateUpdateSnapshot({...compositeA,schedulePolicy,scheduleResolution,items:[{subject,current:event}],latest:[event]});expect(result.contentVerified).toBe(false);
 expect(await store.getStateUpdateScheduleContext!({...compositeA,policy:schedulePolicy})).not.toBeNull();
 const complete=await store.upsertStateUpdateSnapshot({...compositeA,schedulePolicy,scheduleResolution,items:[{subject,current:{...event,scheduleApplication}}],latest:[{...event,scheduleApplication}]});expect(complete.contentVerified).toBe(true);
 await reopenFile();expect((await store.listStateUpdateLatest(compositeA)).items[0]).toMatchObject({scheduleApplication});
});
it("a new revision is an explicit command only after a definitive rejection, retaining values and authorization",async()=>{
 await fileDatabase();await cacheCompositeDefinition();
 const own=await store.saveStateUpdateLocally({...input(),scheduleApplication});await reopenFile();const before=await readOwn(own.localRecordId), operation=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
 const application={...scheduleApplication,revisionId:"synthetic-revision-2",revisionDigest:"digest2",applied:{...scheduleApplication.applied,startTime:"19:00",endTime:"07:00"}};
 const review={...compositeA,localRecordId:own.localRecordId,subjectRecordId:subject.id,clientRequestId:operation.clientRequestId,previousApplication:scheduleApplication,application};
 await expect(store.reviewStateUpdateSchedule!(review)).rejects.toThrow();expect(await readOwn(own.localRecordId)).toEqual(before);
 await store.markStateUpdateOperationSyncing(operation.id,operation.clientRequestId);
 await store.failStateUpdateOperation(operation,"SCHEDULE_REVISION_CHANGED","Controlled Core rejection",undefined,400);
 await reopenFile();const rejected=await readOwn(own.localRecordId);
 await expect(store.reviewStateUpdateSchedule!({...review,application:scheduleApplication})).rejects.toThrow();expect(await readOwn(own.localRecordId)).toEqual(rejected);
 expect(await store.getStateUpdateScheduleReviewCandidate!({...compositeA,subjectRecordId:subject.id})).toMatchObject({current:{recordId:own.localRecordId,scheduleApplication,localScheduleReviewRequired:true}});
 expect(await store.getStateUpdateScheduleReviewCandidate!({...compositeB,subjectRecordId:subject.id})).toBeNull();
 await store.reviewStateUpdateSchedule!(review);await reopenFile();const after=await readOwn(own.localRecordId);
 expect(after.payload.clientRequestId).not.toBe(rejected.payload.clientRequestId);expect(after.payload.scheduleApplication).toEqual(application);expect(after.payload.stateValues).toEqual(rejected.payload.stateValues);expect(after.payload.extraValues).toEqual(rejected.payload.extraValues);expect(after.payload.overwrite).toBe(rejected.payload.overwrite);expect(after.payload.expectedUpdatedAt).toBe(rejected.payload.expectedUpdatedAt);expect(after.row.local_id).toBe(rejected.row.local_id);
 expect(await store.getStateUpdateScheduleReviewCandidate!({...compositeA,subjectRecordId:subject.id})).toBeNull();
 await store.completeStateUpdateOperation(operation,{result:"CREATED",recordId:event.recordId,subjectRecordId:subject.id,updatedAt:event.updatedAt});expect(await readOwn(own.localRecordId)).toEqual(after);
 await expect(store.reviewStateUpdateSchedule!(review)).rejects.toThrow();
});

it("an old intention without schedule is never consumed merely because scheduled remote values match",async()=>{
 await fileDatabase();await cacheCompositeDefinition();
 const own=await store.saveStateUpdateLocally(input());const before=await readOwn(own.localRecordId);
 const scheduled={...event,stateValues:before.payload.stateValues,scheduleApplication};
 await store.upsertStateUpdateSnapshot({...compositeA,schedulePolicy,scheduleResolution,items:[{subject,current:scheduled}],latest:[scheduled]});await reopenFile();
 expect(await readOwn(own.localRecordId)).toEqual(before);
});
