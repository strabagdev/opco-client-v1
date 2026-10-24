// Synthetic API envelopes and real SQLite files; this is not browser/OPFS evidence.
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { mkdtempSync, rmSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import payload from "../../../tests/fixtures/state-update-select-extras-legacy.json";
import {createOpcoApi} from "../../lib/opco-api";
import {getLocalDatabase,__resetLocalDatabaseForTests} from "../../lib/local-db";
import {buildStateUpdateExtraForm,buildStateUpdateExtraSubmit,unavailableStateUpdateExtraInput} from "../../lib/state-update-extras";
import {RecordFieldInput} from "./RecordFieldInput";
import {buildStateUpdateLatestRows} from "../workflows/state-update/state-update-workflow-logic";
const sqlite=vi.hoisted(()=>({openDatabaseAsync:vi.fn()}));
vi.mock("expo-sqlite",()=>sqlite);
vi.mock("react-native",async()=>import("react-native-web"));
vi.mock("./temporal-input",async()=>import("./temporal-input.web"));
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

const scope={ownerKey:"synthetic-tenant-a:user-a",contractId:"contract_1",appViewId:"view_state",targetEntityTypeId:"equipment_state",date:"2026-08-22"};
const options=[{id:"opt_alpha",value:"ALPHA",label:"Opción sintética Alfa",active:true,order:0},{id:"opt_beta",value:"BETA",label:"Opción sintética Beta",active:true,order:1},{id:"opt_gamma",value:"GAMMA",label:"Opción sintética Gamma",active:true,order:2}];
async function response(){const fetcher=vi.fn(async(_url: RequestInfo | URL)=>new Response(JSON.stringify(payload),{headers:{"content-type":"application/json"}}));const api=createOpcoApi({apiUrl:"https://synthetic.invalid",fetcher});const value=await api.getStateUpdateWorkflow("synthetic",scope.contractId,scope.appViewId,{date:scope.date});return{value,fetcher};}
let directory:string,harness:ReturnType<typeof sqliteHarness>;
beforeEach(()=>{__resetLocalDatabaseForTests();directory=mkdtempSync("/tmp/opco-extra-fields-diagnosis-");harness=sqliteHarness(directory+"/db.sqlite");sqlite.openDatabaseAsync.mockResolvedValue(harness.db);});
afterEach(()=>{harness.stop();__resetLocalDatabaseForTests();rmSync(directory,{recursive:true,force:true});});
async function reopen(){await harness.db.closeAsync();__resetLocalDatabaseForTests();harness=sqliteHarness(directory+"/db.sqlite");sqlite.openDatabaseAsync.mockResolvedValue(harness.db);return getLocalDatabase();}


async function correctedResponse() {
 const wire=structuredClone(payload) as any;
 wire.data.extraFields[0]={...wire.data.extraFields[0],multiple:false,options};
 for(const item of wire.data.latest.items){item.extraValues.choice_extra="ALPHA";item.extraValuesFormat="field-value";}
 wire.data.subjects[0].current.extraValues={choice_extra:"ALPHA"};
 wire.data.subjects[0].current.extraValuesFormat="field-value";
 const fetcher=vi.fn(async()=>new Response(JSON.stringify(wire),{headers:{"content-type":"application/json"}}));
 const api=createOpcoApi({apiUrl:"https://synthetic.invalid",fetcher});
 return api.getStateUpdateWorkflow("synthetic",scope.contractId,scope.appViewId,{date:scope.date});
}
function definition(r:any){return{active:true,icon:null,id:r.targetEntityType.id,name:r.targetEntityType.name,slug:"synthetic",fields:r.extraFields};}
async function cache(r:any){const store=getLocalDatabase();await store.upsertAppViewDefinition({...scope,appViewType:"WORKFLOW",workflowKey:"state-update",lastPreparedAt:"2026-08-22T12:00:00.000Z",status:"ready",definition:{kind:"state-update",appView:{id:scope.appViewId,name:"Sintético",slug:"synthetic",type:"WORKFLOW",sortOrder:0,icon:null,config:{workflowKey:"state-update"}},dateFieldId:r.dateFieldId,extraFields:r.extraFields,stateFields:r.stateFields,historyMode:r.historyMode,uniqueness:r.uniqueness,subjectFieldId:r.subjectFieldId,sourceEntityTypeId:r.sourceEntityType.id,targetEntityTypeId:r.targetEntityType.id}});await store.upsertStateUpdateSnapshot({...scope,dateFieldId:r.dateFieldId,historyMode:r.historyMode,uniqueness:r.uniqueness,items:r.items,latest:r.latest,complete:false});return store;}
describe("SELECT extras: real API adapter, form control and SQLite cache",()=>{
 it("renders options and selected label, submits field ID/canonical value and reopens the same readable snapshot",async()=>{
  const r=await correctedResponse(),field=r.extraFields[0];
  const form=buildStateUpdateExtraForm(definition(r),r.items[0].current!.extraValues,r.items[0].current!.extraValuesFormat);
  const html=renderToStaticMarkup(<RecordFieldInput field={field} value={form.values[field.key]} onChange={vi.fn()}/>);
  expect(html).toContain('value="ALPHA" selected=""');expect(html).toContain("Opción sintética Alfa");expect(html.match(/<option /g)).toHaveLength(4);
  const changed={...form.values,[field.key]:"BETA"};expect(buildStateUpdateExtraSubmit(r.extraFields,changed)).toEqual({choice_extra:"BETA"});
  await cache(r);const reopened=await reopen();const cached=await reopened.getAppViewDefinition(scope.ownerKey,scope.contractId,scope.appViewId);
  if(cached?.definition.kind!=="state-update")throw Error("Missing definition");
  const latest=await reopened.listStateUpdateLatest(scope);expect(latest.items).toHaveLength(1);expect(latest.items[0].extraValuesFormat).toBe("field-value");
  expect(buildStateUpdateLatestRows({...cached.definition,dateField:null},latest.items[0]).find(v=>v.fieldId===field.id)?.value).toBe("Opción sintética Alfa");
  for(const foreign of [{...scope,ownerKey:"other:other"},{...scope,contractId:"other"},{...scope,appViewId:"other"}])expect((await reopened.listStateUpdateLatest(foreign)).items).toEqual([]);
 });
 it("keeps old metadata and pending payload bytes unchanged during read/reopen; hydrated metadata repairs only the view",async()=>{
  const{value:old}=await response();const store=await cache(old);
  await store.saveStateUpdateLocally({...scope,historyMode:"update-current",uniqueness:"subject-date",stateFields:old.stateFields,stateValues:[{fieldId:"revision_field",value:"revision"}],extraValues:{choice_extra:"ALPHA"},subjectRecordId:"equipment_1",subjectDisplayName:"Sintético",overwrite:true,expectedUpdatedAt:"2026-08-22T10:00:00.000Z"});
  const before=JSON.stringify(await store.listPendingStateUpdateOperations(scope.ownerKey));const reopened=await reopen();
  expect(JSON.stringify(await reopened.listPendingStateUpdateOperations(scope.ownerKey))).toBe(before);
  const pending=(await reopened.listPendingStateUpdateOperations(scope.ownerKey))[0];expect((pending.payload as any).extraValues).toEqual({choice_extra:"ALPHA"});
  const missing=buildStateUpdateExtraForm(definition(old),{choice_extra:"opt_alpha"});expect(missing.values.choice_key).toBe("opt_alpha");expect(missing.issues.choice_key).toBeTruthy();
  const corrected=await correctedResponse();const repaired=buildStateUpdateExtraForm(definition(corrected),{choice_extra:"opt_alpha"});expect(repaired.values.choice_key).toBe("ALPHA");expect(repaired.issues).toEqual({});
  expect(JSON.stringify(await reopened.listPendingStateUpdateOperations(scope.ownerKey))).toBe(before);
 });
 it("preserves canonical read provenance through ACK and keeps an old outbox unchanged while reading repaired metadata",async()=>{
  const r=await correctedResponse(),store=getLocalDatabase();
  await store.saveStateUpdateLocally({...scope,historyMode:"update-current",uniqueness:"subject-date",stateFields:r.stateFields,stateValues:[{fieldId:"revision_field",value:"revision"}],extraValues:{choice_extra:"ALPHA"},subjectRecordId:"equipment_1",subjectDisplayName:"Sintético"});
  const operation=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
  await store.completeStateUpdateOperation(operation,{result:"CREATED",subjectRecordId:"equipment_1",recordId:"new_remote",updatedAt:"2026-08-22T14:00:00.000Z"});
  let reopened=await reopen();expect((await reopened.listStateUpdateLatest(scope)).items[0].extraValuesFormat).toBe("field-value");
  await reopened.saveStateUpdateLocally({...scope,historyMode:"append",uniqueness:"none",stateFields:r.stateFields,stateValues:[{fieldId:"revision_field",value:"old"}],extraValues:{choice_extra:"opt_alpha"},subjectRecordId:"other_subject",subjectDisplayName:"Sintético antiguo"});
  // Simulate the durable format predating this correction, without rewriting its outbox.
  await harness.db.runAsync("UPDATE entity_records SET values_json=json_remove(values_json,'$.extraValuesFormat') WHERE json_extract(values_json,'$.subjectRecordId')=?","other_subject");
  const before=JSON.stringify(await reopened.listPendingStateUpdateOperations(scope.ownerKey));reopened=await reopen();
  const legacy=(await reopened.listPendingStateUpdateOperations(scope.ownerKey))[0];
  expect((legacy.payload as any).extraValues).toEqual({choice_extra:"opt_alpha"});
  const view=buildStateUpdateExtraForm(definition(r),(legacy.payload as any).extraValues);expect(view.values.choice_key).toBe("ALPHA");
  expect(JSON.stringify(await reopened.listPendingStateUpdateOperations(scope.ownerKey))).toBe(before);
  await reopened.completeStateUpdateOperation(legacy,{result:"CREATED",subjectRecordId:"other_subject",recordId:"old_remote",updatedAt:"2026-08-22T15:00:00.000Z"});
  expect((await reopened.listStateUpdateLatest(scope)).items.find(x=>x.subject.id==="other_subject")?.extraValuesFormat).toBeUndefined();
 });
 it("shows an unavailable choice instead of selecting an ambiguous legacy ID, while keeping the original value",async()=>{
  const r=await correctedResponse(),f={...r.extraFields[0],options:[...options,{id:"id_other",value:"opt_alpha",label:"Otra opción",active:true,order:3}]};
  const form=buildStateUpdateExtraForm({...definition(r),fields:[f]},{choice_extra:"opt_alpha"});
  const html=renderToStaticMarkup(<RecordFieldInput field={f} value={unavailableStateUpdateExtraInput(f,form.values[f.key])} error={form.issues[f.key]} onChange={vi.fn()}/>);
  expect(html).toContain("Selección no disponible");expect(html).toContain("ambigua");expect(html).not.toContain('value="opt_alpha" selected=""');expect(form.values[f.key]).toBe("opt_alpha");
 });
});
