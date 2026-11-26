import { PYTHON_SQLITE_SCRIPT_EXECUTOR } from "../test/sqlite-script";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import ts from "typescript";
import { loadAttendanceRecordPresentation, groupAttendancePresentations } from "../renderers/workflows/attendance/attendance-record-presentation";
import { attendanceReadScope } from "./attendance-repetition";
import { stateUpdateLatestToAttendanceLatest } from "./attendance-offline";
import { hasSuccessfulAttendanceDayHydration } from "./attendance-snapshot-cache";
import { isAttendanceRequestCurrent, shouldPublishAttendanceDay } from "../renderers/workflows/attendance/attendance-workflow-logic";
import { recordAttendanceLocalRead } from "../renderers/workflows/attendance/attendance-local-read-trace";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";
import { readAttendanceLocalRecord, inspectAttendanceLocalQueries, type AttendanceReadView } from "../renderers/workflows/attendance/attendance-local-read";
const sqlite = vi.hoisted(() => ({
  openDatabaseAsync: vi.fn()
}));
vi.mock("expo-sqlite", () => sqlite);
function sqliteHarness(databasePath = ":memory:") {
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


const scope={ownerKey:"synthetic:user",contractId:"contract",appViewId:"attendance",targetEntityTypeId:"attendance-entity",date:"2026-10-09"};
const base="2026-10-09T10:00:00.000Z";
const fields=[{fieldId:"status",label:"Status",type:"SELECT" as const,required:true,options:[{optionId:"training",label:"Training",value:"TRAINING"},{optionId:"present",label:"Present",value:"PRESENT"}]}];
let directory:string,harness:ReturnType<typeof sqliteHarness>,store:ReturnType<typeof getLocalDatabase>;
beforeEach(async()=>{__resetLocalDatabaseForTests();directory=mkdtempSync("/tmp/opco-attendance-confirm-");harness=sqliteHarness(directory+"/db.sqlite");sqlite.openDatabaseAsync.mockResolvedValue(harness.db);store=getLocalDatabase();await store.getSelectedContractId();await store.upsertStateUpdateSnapshot({...scope,historyMode:"update-current",uniqueness:"subject-date",complete:false,latest:[],items:[{subject:{id:"person",displayName:"Synthetic"},current:{recordId:"remote",updatedAt:base,stateValues:[{fieldId:"status",optionId:"training",label:"Training"}]}}]});});
afterEach(()=>{harness.stop();__resetLocalDatabaseForTests();rmSync(directory,{recursive:true,force:true});});
async function reopen(){await harness.db.closeAsync();__resetLocalDatabaseForTests();harness=sqliteHarness(directory+"/db.sqlite");sqlite.openDatabaseAsync.mockResolvedValue(harness.db);store=getLocalDatabase();await store.getSelectedContractId();}
function input(overwrite?:boolean){return {...scope,subjectRecordId:"person",subjectDisplayName:"Synthetic",historyMode:"update-current" as const,uniqueness:"subject-date" as const,stateFields:fields,stateValues:[{fieldId:"status",optionId:"present"}],expectedUpdatedAt:base,overwrite};}
describe("sync attention local read model",()=>{
 async function conflict(subjectRecordId="person",extra={}){
  await store.saveStateUpdateLocally({...input(),subjectRecordId,...extra});const operation=(await store.listPendingStateUpdateOperations(scope.ownerKey)).find(o=>(o.payload as Record<string,unknown>).subjectRecordId===subjectRecordId)!;
  await store.markStateUpdateOperationConflict(operation,{result:"CONFLICT",subjectRecordId,existing:{recordId:"remote",updatedAt:base,stateValues:[{fieldId:"status",optionId:"training",label:"Training"}]},requested:{stateValues:[{fieldId:"status",optionId:"present",label:"Present"}]}});return operation;
 }
 it("reproduces old double count but presents linked row/outbox as one problem without writing",async()=>{
  await conflict();await reopen();const records=await store.getRecordsSyncSummary(scope);const diagnosis=await store.getStateUpdateOutboxDiagnostics(scope.ownerKey);expect(records.conflictCount+Math.max(diagnosis.summary.conflict,diagnosis.summary.localConflict)).toBe(2);const before=await harness.db.getAllAsync("SELECT * FROM pending_operations");const rows=await harness.db.getAllAsync("SELECT * FROM entity_records");const problems=await store.getSyncAttentionProblems(scope);expect(problems).toHaveLength(1);expect(problems[0]).toMatchObject({state:"conflict",recordName:"Synthetic",date:scope.date});expect(await harness.db.getAllAsync("SELECT * FROM pending_operations")).toEqual(before);expect(await harness.db.getAllAsync("SELECT * FROM entity_records")).toEqual(rows);
 });
 it("two distinct changes remain two and other owner/contract are isolated",async()=>{
  await conflict();await conflict("second");expect(await store.getSyncAttentionProblems(scope)).toHaveLength(2);expect(await store.getSyncAttentionProblems({...scope,ownerKey:"other"})).toEqual([]);expect(await store.getSyncAttentionProblems({...scope,contractId:"other"})).toEqual([]);
 });
 it("uses cached definition for exact navigation date/row and drops the notice when resolved",async()=>{
  const op=await conflict();await store.upsertAppViewDefinition({...scope,appViewType:"WORKFLOW",workflowKey:"attendance",status:"ready",lastPreparedAt:base,definition:{kind:"attendance",appView:{id:scope.appViewId,name:"Attendance synthetic",slug:"synthetic",type:"WORKFLOW",config:{workflowKey:"attendance",sourceEntityTypeId:"people",targetEntityTypeId:scope.targetEntityTypeId,personFieldId:"person",statusFieldId:"status",dateFieldId:"date"}} as any,statuses:[]}});
  const problems=await store.getSyncAttentionProblems(scope);expect(problems[0].href).toEqual({pathname:"/view/[appViewId]",params:{appViewId:scope.appViewId,attentionDate:scope.date,attentionRecordId:op.localRecordId}});
  await harness.db.runAsync("UPDATE entity_records SET sync_status='synced' WHERE local_id=?",op.localRecordId);await harness.db.runAsync("DELETE FROM pending_operations WHERE id=?",op.id);expect(await store.getSyncAttentionProblems(scope)).toEqual([]);
 });
});
// These inspections use the ordinary readers against the same on-disk SQLite connection.
const capturedAt="2026-10-09T10:00:00.000Z";
async function prepareReadDetail(){
 const appView={id:scope.appViewId,name:"Captura sintética",slug:"synthetic",type:"WORKFLOW",config:{workflowKey:"attendance",sourceEntityTypeId:"people",targetEntityTypeId:scope.targetEntityTypeId,personFieldId:"person",statusFieldId:"status",dateFieldId:"date",contextFieldIds:["relation"],repetitionPolicy:"MULTIPLE_WITH_WARNING",captureTime:{fieldId:"capture",timeZone:"America/Santiago"}}}as AttendanceReadView;
 await store.upsertAppViewDefinition({...scope,appViewType:"WORKFLOW",workflowKey:"attendance",status:"ready",lastPreparedAt:base,definition:{kind:"state-update",appView,sourceEntityTypeId:"people",targetEntityTypeId:scope.targetEntityTypeId,subjectFieldId:"person",dateFieldId:"date",historyMode:"append",uniqueness:"subject-date",stateFields:fields,extraFields:[{id:"relation",name:"Objeto relacionado",key:"relation",type:"RELATION",required:true,multiple:false,active:true,config:{relationKind:"ONE",targetEntityTypeId:"catalog"}}]}}as never);
 await store.upsertRemoteRecords({ownerKey:scope.ownerKey,contractId:scope.contractId,entityTypeId:"catalog",records:[{id:"lot",displayName:"Catálogo sintético",updatedAt:base,values:{}}]});
 const command={...input(),expectedUpdatedAt:undefined,historyMode:"append" as const,repetitionPolicy:"MULTIPLE_WITH_WARNING" as const,repetitionAcknowledged:true,eventOccurredAt:capturedAt,captureTime:{version:1 as const,fieldId:"capture",timeZone:"America/Santiago"},extraValues:{relation:"lot"}};
 return {appView,command};
}
describe("exact pending Attendance detail on durable SQLite",()=>{
 it("reopens two equivalent pending records independently and inspection leaves all rows/outbox unchanged",async()=>{
  const {appView,command}=await prepareReadDetail();const first=await store.saveStateUpdateLocally(command),second=await store.saveStateUpdateLocally(command);expect(first.localRecordId).not.toBe(second.localRecordId);await reopen();
  const before={rows:await harness.db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id"),ops:await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id"),meta:await harness.db.getAllAsync("SELECT * FROM app_metadata ORDER BY key")};const writes=harness.db.runAsync.mock.calls.length;
  for(const recordId of [first.localRecordId,second.localRecordId]){
   const request={ownerKey:scope.ownerKey,contractId:scope.contractId,appView,recordId,requestedDate:scope.date};const detail=await readAttendanceLocalRecord(store,request);expect(detail.record.localRecordId).toBe(recordId);expect(detail.record.eventOccurredAt).toBe(capturedAt);expect(detail.record.extraValues).toEqual({relation:"lot"});expect(detail.presentation.fields.map(f=>f.values[0].text)).toEqual(["Present","Catálogo sintético"]);
   const report=await inspectAttendanceLocalQueries(store,request,detail);expect(report.daily).toMatchObject({count:2,selectedIncluded:true});expect(report.personSelection).toMatchObject({count:2,selectedIncluded:true});expect(report.outbox).toMatchObject({activeMatchingOperations:1});
  }
  expect(harness.db.runAsync.mock.calls.length).toBe(writes);expect(await harness.db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id")).toEqual(before.rows);expect(await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")).toEqual(before.ops);expect(await harness.db.getAllAsync("SELECT * FROM app_metadata ORDER BY key")).toEqual(before.meta);
 });
 it("keeps the original local identity and capture after ACK and another full reopen",async()=>{
  const {appView,command}=await prepareReadDetail();const saved=await store.saveStateUpdateLocally(command);const op=(await store.listPendingStateUpdateOperations(scope.ownerKey)).find(o=>o.localRecordId===saved.localRecordId)!;
  const before=await readAttendanceLocalRecord(store,{...scope,appView,recordId:saved.localRecordId});await store.completeStateUpdateOperation(op,{result:"CREATED",subjectRecordId:"person",recordId:"remote-exact",updatedAt:base,captureTime:{...command.captureTime,value:capturedAt,source:"DEVICE_CONFIRMATION"}});await reopen();
  const after=await readAttendanceLocalRecord(store,{...scope,appView,recordId:saved.localRecordId});expect(after.cached.serverId).toBe("remote-exact");expect(after.record.localRecordId).toBe(before.record.localRecordId);expect(after.record.captureTime).toEqual(before.record.captureTime);expect(after.presentation.capture).toEqual(before.presentation.capture);expect(after.presentation.syncLabel).toBe("Sincronizado");expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toHaveLength(0);
 });
 it("explains a selected-date exclusion without mutating the original date or operation",async()=>{
  const {appView,command}=await prepareReadDetail();const saved=await store.saveStateUpdateLocally(command);const request={...scope,appView,recordId:saved.localRecordId,requestedDate:"2026-10-08"};const detail=await readAttendanceLocalRecord(store,request);expect(detail.scope.date).toBe(scope.date);const report=await inspectAttendanceLocalQueries(store,request,detail);expect(report.daily).toMatchObject({count:0,selectedIncluded:false});expect(report.stored.requestedDateMatches).toBe(false);expect(report.stored.date).toBe(scope.date);expect(((await store.listPendingStateUpdateOperations(scope.ownerKey))[0].payload as Record<string,unknown>).date).toBe(scope.date);
 });
 it("documents recent-page exclusion separately from a complete subject/day read",async()=>{
  const {appView,command}=await prepareReadDetail();const first=await store.saveStateUpdateLocally({...command,eventOccurredAt:"2026-10-09T09:00:00.000Z"});for(let n=0;n<21;n++)await store.saveStateUpdateLocally({...command,eventOccurredAt:`2026-10-09T10:00:${String(n).padStart(2,"0")}.000Z`});
  const request={...scope,appView,recordId:first.localRecordId,requestedDate:scope.date};const report=await inspectAttendanceLocalQueries(store,request,await readAttendanceLocalRecord(store,request));expect(report.daily).toMatchObject({count:22,selectedIncluded:true});expect(report.recent).toMatchObject({returned:20,selectedIncluded:false,pagination:{hasMore:true,total:22}});
 });
});

it("does not disclose a pending detail through another owner, contract or AppView",async()=>{
 const{appView,command}=await prepareReadDetail();const saved=await store.saveStateUpdateLocally(command);const request={...scope,appView,recordId:saved.localRecordId,requestedDate:scope.date};
 await expect(readAttendanceLocalRecord(store,{...request,ownerKey:"other-owner"})).rejects.toMatchObject({code:"LOCAL_RECORD_NOT_FOUND"});
 await expect(readAttendanceLocalRecord(store,{...request,contractId:"other-contract"})).rejects.toMatchObject({code:"LOCAL_RECORD_NOT_FOUND"});
 await expect(readAttendanceLocalRecord(store,{...request,appView:{...appView,id:"other-view"}})).rejects.toMatchObject({code:"LOCAL_RECORD_SCOPE_MISMATCH"});
 expect((await store.listPendingStateUpdateOperations(scope.ownerKey))[0].localRecordId).toBe(saved.localRecordId);
});


function actualDayRefresh(appView: AttendanceReadView, extra: Record<string, unknown> = {}) {
 const source=ts.createSourceFile("AttendanceWorkflow.tsx",readFileSync(`${process.cwd()}/src/renderers/workflows/attendance/AttendanceWorkflow.tsx`,"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let callback:ts.Expression|undefined;
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(source)==="refreshLocalDayState"&&node.initializer&&ts.isCallExpression(node.initializer)) callback=node.initializer.arguments[0];ts.forEachChild(node,visit);};visit(source);
 if(!callback)throw Error("Actual day refresh missing");
 const context={ownerKey:scope.ownerKey,selectedContractId:scope.contractId,appView,date:scope.date,definitionCache:store,
  attendanceReadScope,hasSuccessfulAttendanceDayHydration,shouldPublishAttendanceDay,isAttendanceRequestCurrent,recordAttendanceLocalRead,stateUpdateLatestToAttendanceLatest,
  mergeAttendanceLatestWithLocalOverlay:(remote:unknown[],local:unknown[])=>[...remote,...local],
  requestSequenceRef:{current:1},attendanceDayScopeRef:{current:{...scope}},
  setLatest:vi.fn(),setTotalRegistered:vi.fn(),setPendingCount:vi.fn(),setLocalConflicts:vi.fn(),setDaySnapshotHydrated:vi.fn(),setLoadedDate:vi.fn(),setError:vi.fn(),
  ...extra};
 const code=ts.transpileModule(`const run=${callback.getText(source)};return run;`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return {run:new Function(...Object.keys(context),code)(...Object.values(context)) as (...args:unknown[])=>Promise<unknown>,context};
}
it("keeps every daily pending create visible beyond the recent page, after reopening, without changing rows/outbox",async()=>{
 const {appView,command}=await prepareReadDetail();
 const first=await store.saveStateUpdateLocally({...command,eventOccurredAt:"2026-10-09T09:00:00.000Z"});
 for(let n=0;n<21;n++)await store.saveStateUpdateLocally({...command,eventOccurredAt:`2026-10-09T10:00:${String(n).padStart(2,"0")}.000Z`});
 await reopen();
 const recent=await store.listStateUpdateLatest({...scope,historyMode:"append",uniqueness:"subject-date"});
 expect(recent.items).toHaveLength(20);expect(recent.items.some(r=>r.recordId===first.localRecordId)).toBe(false);
 const rows=await harness.db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id"),ops=await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id");
 const {run,context}=actualDayRefresh(appView);await run();
 const visible=context.setLatest.mock.calls.at(-1)![0] as {attendanceRecordId:string}[];
 expect(visible.filter(r=>r.attendanceRecordId===first.localRecordId)).toHaveLength(1);
 expect(new Set(visible.map(r=>r.attendanceRecordId)).size).toBe(22);
 expect(await harness.db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id")).toEqual(rows);
 expect(await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")).toEqual(ops);
});

it("shows two ACKed rows and one identical pending row once, preserves their exact details, then keeps one alias per ACK",async()=>{
 const {appView,command}=await prepareReadDetail();
 const saved: {localRecordId:string}[]=[];const remote=[];
 for(let n=0;n<3;n++){
  const row=await store.saveStateUpdateLocally(command);saved.push(row);
  if(n<2){const op=(await store.listPendingStateUpdateOperations(scope.ownerKey)).find(o=>o.localRecordId===row.localRecordId)!;
   await store.completeStateUpdateOperation(op,{result:"CREATED",subjectRecordId:"person",recordId:"server-"+n,updatedAt:base,captureTime:{...command.captureTime,value:capturedAt,source:"DEVICE_CONFIRMATION"}});
   remote.push({attendanceRecordId:"server-"+n,person:{id:"person",displayName:"Synthetic"},statusOptionId:"present",statusLabel:"Present",updatedAt:base,captureTime:{...command.captureTime,value:capturedAt,source:"DEVICE_CONFIRMATION" as const},contextValues:{relation:{id:"lot",displayName:"Catálogo sintético"}}});
  }
 }
 const fields=[{id:"relation",name:"Objeto relacionado",type:"RELATION" as const,required:true,config:{relationKind:"ONE",targetEntityTypeId:"catalog"}}];
 async function grouped(snapshot?:unknown){const{run,context}=actualDayRefresh(appView);await run(snapshot);const latest=context.setLatest.mock.calls.at(-1)![0];
  const presentations=await Promise.all(latest.map((item:any)=>loadAttendanceRecordPresentation(store,scope,{...item,recordId:item.attendanceRecordId},fields)));
  return{groups:groupAttendancePresentations(presentations),context};}
 for(let n=0;n<2;n++){
  await reopen();const before={rows:await harness.db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id"),ops:await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")};
  const result=await grouped({latest:remote,totalRegistered:2});expect(result.groups).toHaveLength(1);expect(result.groups[0].rows).toHaveLength(3);
  expect(result.groups[0].rows.map(r=>r.reference).sort()).toEqual(saved.map(r=>r.localRecordId).sort());
  const pending=result.groups[0].rows.find(r=>r.reference===saved[2].localRecordId)!;
  expect(pending.syncLabel).toBe("Guardado local · pendiente");expect(pending.record.captureTime?.value).toBe(capturedAt);expect(pending.fields[1].values[0].text).toBe("Catálogo sintético");
  const request={...scope,appView,recordId:saved[2].localRecordId,requestedDate:scope.date};const detail=await readAttendanceLocalRecord(store,request);
  expect(detail.record.date).toBe(scope.date);expect(detail.record.eventOccurredAt).toBe(capturedAt);expect(detail.record.extraValues).toEqual({relation:"lot"});
  expect(await harness.db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id")).toEqual(before.rows);expect(await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")).toEqual(before.ops);
 }
 const op=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];await store.completeStateUpdateOperation(op,{result:"CREATED",subjectRecordId:"person",recordId:"server-2",updatedAt:base,captureTime:{...command.captureTime,value:capturedAt,source:"DEVICE_CONFIRMATION"}});
 await reopen();const after=await grouped({latest:[...remote,{...remote[0],attendanceRecordId:"server-2"}],totalRegistered:3});
 expect(after.groups[0].rows).toHaveLength(3);expect(after.groups[0].rows.map(r=>r.reference).sort()).toEqual(saved.map(r=>r.localRecordId).sort());expect(after.groups[0].rows.every(r=>r.record.captureTime?.value===capturedAt)).toBe(true);
 expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toHaveLength(0);
});
it("publishes available local rows without certifying day completeness, and rejects a retired scope",async()=>{
 const {appView,command}=await prepareReadDetail();await store.saveStateUpdateLocally(command);
 const good=actualDayRefresh(appView);await good.run();expect(good.context.setLoadedDate.mock.calls.at(-1)![0](null)).toBe(scope.date);expect(good.context.setDaySnapshotHydrated).toHaveBeenCalledWith(false);
 const stale=actualDayRefresh(appView);const read=store.listStateUpdateLatest.bind(store);
 stale.context.definitionCache={...store,listStateUpdateLatest:async(q:any)=>{const result=await read(q);stale.context.requestSequenceRef.current++;return result;}};
 // Recreate the function with the controlled late result, retaining its actual scope checks.
 const run=actualDayRefresh(appView,stale.context);await run.run();expect(run.context.setLatest).not.toHaveBeenCalled();
});
