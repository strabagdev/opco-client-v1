import {createOpcoApi} from "./opco-api";
import {prepareStateUpdateCurrent} from "./state-update-current-prewarm";
import {runWithConcurrency} from "./app-view-prewarm";
import {presentationFingerprint,projectSubject,type SubjectPresentationDefinition} from "./subject-presentation";
import {subjectPresentationView} from "./subject-presentation-display";
import comparisonFixtures from "./search-comparison-fixtures.json";
import { normalizeSearchComparison,parseSearchComparison,comparisonFingerprint,searchComparisonMatches,type SearchComparison,type WorkflowSearchComparison } from "./search-comparison";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getLocalDatabase, __resetLocalDatabaseForTests } from "./local-db";
import type { AppView } from "./opco-api";
const sqlite = vi.hoisted(() => ({ openDatabaseAsync: vi.fn() }));
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
const scope = { ownerKey: "code-owner", contractId: "code-contract", appViewId: "code-view", targetEntityTypeId: "target", sourceEntityTypeId: "source", date: "2026-10-27", historyMode: "update-current" as const, uniqueness: "subject-date" as const };
const descriptor = { id: "stable-identifier", key: "identifier", name: "Identificador", type: "TEXT" as const };
const view: AppView = { id: scope.appViewId, type: "WORKFLOW", name: "Lectura ficticia", slug: "code", icon: null, sortOrder: 0, config: { workflowKey: "state-update", codeSearch: { fieldId: descriptor.id }, sourceEntityTypeId: "source", targetEntityTypeId: "target", subjectFieldId: "subject", dateFieldId: "date", stateFields: [], uniqueness: "subject-date", historyMode: "update-current" } };
let dir: string, harness: ReturnType<typeof sqliteHarness>, store: ReturnType<typeof getLocalDatabase>;
beforeEach(async () => { dir = mkdtempSync("/tmp/opco-code-field-"); __resetLocalDatabaseForTests(); harness = sqliteHarness(dir + "/db.sqlite"); sqlite.openDatabaseAsync.mockResolvedValue(harness.db); store = getLocalDatabase(); await store.getSelectedContractId(); await definition(); });
afterEach(() => { harness.stop(); __resetLocalDatabaseForTests(); rmSync(dir, { recursive: true, force: true }); });
async function reopen() { harness.stop(); __resetLocalDatabaseForTests(); harness = sqliteHarness(dir + "/db.sqlite"); sqlite.openDatabaseAsync.mockResolvedValue(harness.db); store = getLocalDatabase(); await store.getSelectedContractId(); }
async function definition(metadata = true, appView = view) { await store.upsertAppViewDefinition({ appViewId: appView.id, ownerKey: scope.ownerKey, contractId: scope.contractId, appViewType: "WORKFLOW", workflowKey: "state-update", status: "ready", lastPreparedAt: "2026-10-27T10:00:00Z", definition: { appView, kind: "state-update", sourceEntityTypeId: "source", targetEntityTypeId: "target", subjectFieldId: "subject", dateFieldId: "date", stateFields: [], extraFields: [], historyMode: "update-current", uniqueness: "subject-date", ...(metadata ? { codeSearchField: descriptor } : {}) } }); }
async function seed() {
 await store.upsertRemoteRecords({ ...scope, entityTypeId: "source", records: [
  { id: "a", displayName: "Nombre de persona ficticia A", updatedAt: "2026-10-27T10:00:00Z", values: { identifier: "00.123.450-K", another: "not-used" } },
  { id: "b", displayName: "Nombre de persona ficticia B", updatedAt: "2026-10-27T10:00:00Z", values: { identifier: "00.123.450-k" } },
  { id: "c", displayName: "00.123.450-K", updatedAt: "2026-10-27T10:00:00Z", values: { identifier: "different", another: "00.123.450-K" } },
  { id: "d", displayName: "Sin dato", updatedAt: "2026-10-27T10:00:00Z", values: { identifier: null } },
 ] });
}
const search = (query: string, overrides = {}) => store.searchStateUpdateSubjects({ ...scope, search: query, searchFieldId: descriptor.id, ...overrides });
it("uses only the configured field with insensitive literal substring after reopening, returning multiple results", async () => {
 await seed(); await reopen(); expect((await search(" 00.123.450-k ")).map(item => item.subject.id).sort()).toEqual(["a", "b"]);
 expect(await search("00123450K")).toEqual([]); expect(await search("nonexistent")).toEqual([]);
 expect((await store.searchStateUpdateSubjects({ ...scope, search: "00.123.450-k" })).map(item => item.subject.id)).toContain("c");
});
it("does not silently use global search with old metadata, another view, user, contract or unconfigured field", async () => {
 await seed();
 for (const overrides of [{ appViewId: "other-view" }, { ownerKey: "other-owner" }, { contractId: "other-contract" }, { searchFieldId: "foreign" }]) await expect(search("00.123.450-K", overrides)).rejects.toMatchObject({ code: "CODE_SEARCH_CACHE_UNAVAILABLE" });
 await definition(false); await reopen(); await expect(search("00.123.450-K")).rejects.toMatchObject({ code: "CODE_SEARCH_CACHE_UNAVAILABLE" });
 expect(await store.searchStateUpdateSubjects({ ...scope, search: "Nombre" })).toHaveLength(2);
});
it("reports absent cached field values instead of pretending no matches", async () => {
 await store.upsertRemoteRecords({ ...scope, entityTypeId: "source", records: [{ id: "old", displayName: "Old cache", values: {}, updatedAt: "2026-10-27T10:00:00Z" }] });
 await expect(search("Old")).rejects.toMatchObject({ code: "CODE_SEARCH_CACHE_UNAVAILABLE" });
});
it("filters latest by the same source field and leaves durable intent, authorization and conflicts untouched after reopen", async () => {
 await seed(); const created = await store.saveStateUpdateLocally({ ...scope, subjectRecordId: "a", subjectDisplayName: "Nombre de persona ficticia A", stateFields: [], stateValues: [{ fieldId: "status", optionId: "local" }], extraValues: {}, overwrite: true, expectedUpdatedAt: "2026-10-27T08:00:00Z" });
 const operation = (await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
 await store.markStateUpdateOperationConflict(operation, { result: "CONFLICT", subjectRecordId: "a", requested: { stateValues: [] }, existing: { recordId: "remote-a", updatedAt: "2026-10-27T11:00:00Z", stateValues: [{ fieldId: "status", optionId: "remote", label: "Remoto" }] } });
 const before = await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id"); await reopen();
 const items = await search("00.123.450-K"); expect(items.find(item => item.subject.id === "a")?.current).not.toBeNull();
 const latest = await store.listStateUpdateLatest({ ...scope, search: "00.123.450-K", searchFieldId: descriptor.id }); expect(latest.items.map(item => item.subject?.id)).toContain("a");
 expect(await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")).toEqual(before);
 expect((await store.listStateUpdateConflicts(scope))[0].localRecordId).toBe(created.localRecordId);
 expect(JSON.parse(before[0].payload_json)).toMatchObject({ overwrite: true, expectedUpdatedAt: "2026-10-27T08:00:00Z" });
});
it("keeps compound contexts and another context's pending command independent during a field search", async () => {
 await seed();
 const identity = { version: 1 as const, definitionId: "code-definition", values: { context: "A" } };
 const identityB = { ...identity, values: { context: "B" } };
 const compound = { ...scope, dateFieldId: "date", uniqueness: "subject-date-fields" as const, identity };
 const compoundB = { ...compound, identity: identityB };
 const compoundView = { ...view, config: { ...view.config, uniqueness: { mode: "subject-date-fields", definitionId: identity.definitionId, identityVersion: 1, fieldIds: ["context"] } } } as AppView;
 await definition(true, compoundView);
 const subject = { id: "a", displayName: "Persona ficticia A" };
 for (const [input, id] of [[compound, "report-A"], [compoundB, "report-B"]] as const) {
  const current = { recordId: id, updatedAt: "2026-10-27T08:00:00.000Z", stateValues: [] };
  await store.upsertStateUpdateSnapshot({ ...input, items: [{ subject, current }], latest: [{ ...current, subject, date: scope.date }] });
 }
 await store.saveStateUpdateLocally({ ...compoundB, subjectRecordId: "b", subjectDisplayName: "Persona ficticia B", stateFields: [], stateValues: [], extraValues: {}, overwrite: true, expectedUpdatedAt: "2026-10-27T08:00:00.000Z" });
 const before = await store.listPendingStateUpdateOperations(scope.ownerKey); await reopen();
 for (const [input, id] of [[compound, "report-A"], [compoundB, "report-B"]] as const) {
  const found = await store.searchStateUpdateSubjects({ ...input, search: "00.123.450-K", searchFieldId: descriptor.id });
  const current = found.find(item => item.subject.id === "a")?.current;
  expect(current).toBeTruthy();
  const record = await store.getCachedRecord({ ...input, entityTypeId: "target", recordId: current!.recordId });
  expect(record?.serverId).toBe(id);
 }
 expect(await store.listPendingStateUpdateOperations(scope.ownerKey)).toEqual(before);
});

const comparisonPolicy={...comparisonFixtures.policy,ignoreCharacters:["-","."]} as SearchComparison;
function comparisonMetadata():WorkflowSearchComparison {
 const fields=[{id:descriptor.id,key:descriptor.key,type:"TEXT",primary:true,policy:comparisonPolicy},{id:"name-search",key:"name",type:"TEXT",primary:false,policy:null}].sort((a,b)=>a.id<b.id?-1:1);
 return {version:1,sourceEntityTypeId:scope.sourceEntityTypeId,fields,fingerprint:comparisonFingerprint(scope.sourceEntityTypeId,fields),applied:{mode:"definition"}};
}
async function comparisonDefinition(metadata=comparisonMetadata()){
 await store.upsertAppViewDefinition({appViewId:view.id,ownerKey:scope.ownerKey,contractId:scope.contractId,appViewType:"WORKFLOW",workflowKey:"state-update",status:"ready",lastPreparedAt:"2026-10-28T10:00:00.000Z",definition:{appView:view,kind:"state-update",sourceEntityTypeId:scope.sourceEntityTypeId,targetEntityTypeId:scope.targetEntityTypeId,subjectFieldId:"subject",dateFieldId:"date",stateFields:[],extraFields:[],historyMode:"update-current",uniqueness:"subject-date",codeSearchField:descriptor,searchComparison:metadata}});
}
async function comparisonRows(rows=comparisonFixtures.rows){
 await store.upsertRemoteRecords({...scope,entityTypeId:scope.sourceEntityTypeId,records:rows.map(([id,value])=>({id:"matrix-"+id,displayName:"Nombre "+id,updatedAt:"2026-10-28T09:00:00.000Z",values:{identifier:value,name:id==="j"?"00123K en otro campo":"Persona "+id}}))});
 const items=rows.map(([id])=>({subject:{id:"matrix-"+id,displayName:"Nombre "+id},current:{recordId:"event-"+id,updatedAt:"2026-10-28T10:00:00.000Z",stateValues:[]}}));
 await store.upsertStateUpdateSnapshot({...scope,items,latest:items.map(item=>({...item.current,subject:item.subject,date:scope.date}))});
}
it("SQLite reopen uses the exact shared PostgreSQL fixture, multiple IDs and global OR while leaving raw values unchanged",async()=>{
 await comparisonDefinition();await comparisonRows();const before=await harness.db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id");await reopen();
 for(const query of comparisonFixtures.queries){const expected=comparisonFixtures.rows.filter(([,value])=>searchComparisonMatches(value,query,comparisonPolicy)).map(([id])=>"matrix-"+id).sort();
  if(query==="---"){await expect(search(query)).rejects.toMatchObject({code:"EMPTY_NORMALIZED_SEARCH"});continue;}
  expect((await search(query)).map(row=>row.subject.id).sort()).toEqual(expected);
  const latest=await store.listStateUpdateLatest({...scope,search:query,searchFieldId:descriptor.id});expect(latest.items.map(item=>item.subject?.id).sort()).toEqual(expected);expect(latest.pagination.total).toBe(expected.length);
 }
 for(const policy of [{...comparisonPolicy,match:"contains" as const},{...comparisonPolicy,ignoreCase:false},{...comparisonPolicy,ignoreCharacters:["[","]","%","_","\\","\'"]}]){
  const metadata=comparisonMetadata();metadata.fields=metadata.fields.map(f=>f.policy?{...f,policy:parseSearchComparison(policy)}:f);metadata.fingerprint=comparisonFingerprint(scope.sourceEntityTypeId,metadata.fields);await comparisonDefinition(metadata);await reopen();
  for(const query of ["123","K","[]%_\\\'","Ñ áéíóú ü σ Σ ß"]){if(!normalizeSearchComparison(query,policy)){await expect(search(query)).rejects.toMatchObject({code:"EMPTY_NORMALIZED_SEARCH"});continue;}const expected=comparisonFixtures.rows.filter(([,value])=>searchComparisonMatches(value,query,policy)).map(([id])=>"matrix-"+id).sort();expect((await search(query)).map(row=>row.subject.id).sort()).toEqual(expected);}
 }
 await comparisonDefinition();
 const global=await store.searchStateUpdateSubjects({...scope,search:"00123k"});expect(global.map(v=>v.subject.id).sort()).toEqual(["matrix-a","matrix-b","matrix-c","matrix-j"]);
 expect((await store.listStateUpdateLatest({...scope,search:"00123k"})).pagination.total).toBe(4);
 expect(await harness.db.getAllAsync("SELECT * FROM entity_records ORDER BY local_id")).toEqual(before);
});
it("filters all cached content before paging/count and preserves pending authorization/conflicts after reopen",async()=>{
 await comparisonDefinition();await comparisonRows(Array.from({length:35},(_,i)=>[String(i).padStart(2,"0"),i%2?"00.123-K":"00123k"]));
 const pending=await store.saveStateUpdateLocally({...scope,subjectRecordId:"matrix-00",subjectDisplayName:"Nombre 00",stateFields:[],stateValues:[{fieldId:"status",optionId:"local"}],extraValues:{},overwrite:true,expectedUpdatedAt:"2026-10-28T10:00:00.000Z"});const op=(await store.listPendingStateUpdateOperations(scope.ownerKey))[0];
 await store.markStateUpdateOperationConflict(op,{result:"CONFLICT",subjectRecordId:"matrix-00",requested:{stateValues:[]},existing:{recordId:"event-00",updatedAt:"2026-10-28T11:00:00.000Z",stateValues:[{fieldId:"status",optionId:"remote",label:"Remoto"}]}});
 const before=await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id");await reopen();
 const first=await store.listStateUpdateLatest({...scope,search:"00123k",searchFieldId:descriptor.id,page:1,pageSize:10}),second=await store.listStateUpdateLatest({...scope,search:"00123k",searchFieldId:descriptor.id,page:2,pageSize:10});
 expect(first.pagination.total).toBe(35);expect(first.items).toHaveLength(10);expect(second.items).toHaveLength(10);expect(new Set([...first.items,...second.items].map(v=>v.recordId)).size).toBe(20);
 expect(await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")).toEqual(before);expect((await store.listStateUpdateConflicts(scope))[0].localRecordId).toBe(pending.localRecordId);
 for(const invalid of [{ownerKey:"another"},{contractId:"another"},{appViewId:"another"}])await expect(search("00123k",invalid)).rejects.toMatchObject({code:"CODE_SEARCH_CACHE_UNAVAILABLE"});
});
it("keeps legacy cache behavior but never silently uses it for a known configured or corrupt policy",async()=>{
 await comparisonRows();await reopen();expect(await search("00123k")).toHaveLength(2); // legacy literal: b and c, no punctuation equivalence
 await store.upsertEntityDefinition(scope.contractId,scope.sourceEntityTypeId,{id:scope.sourceEntityTypeId,name:"Origen",slug:"source",icon:null,active:true,fields:[{id:descriptor.id,key:descriptor.key,name:"Identificador",type:"TEXT",required:true,config:{searchComparison:comparisonPolicy}}]},"2026-10-28T10:00:00.000Z");
 await expect(store.searchStateUpdateSubjects({...scope,search:"00123k"})).rejects.toMatchObject({code:"SEARCH_COMPARISON_CACHE_UNAVAILABLE"});
 await comparisonDefinition({...comparisonMetadata(),fingerprint:"stale"});await reopen();await expect(search("00123k")).rejects.toMatchObject({code:"SEARCH_COMPARISON_NOT_CONFIRMED"});
});

function visualDefinition():SubjectPresentationDefinition{
 const config={version:1 as const,titleFieldIds:["visual-name"],secondaryFieldIds:[descriptor.id]};const fields=[{id:"visual-name",key:"name",name:"Nombre visual",type:"TEXT",multiple:false},{id:descriptor.id,key:descriptor.key,name:"Identificador",type:"TEXT",multiple:false}];return {version:1,sourceEntityTypeId:scope.sourceEntityTypeId,config,fields,fingerprint:presentationFingerprint(scope.sourceEntityTypeId,config,fields)};
}
async function prepareVisual(definition=visualDefinition()){
 await comparisonDefinition();const cached=await store.getAppViewDefinition(scope.ownerKey,scope.contractId,scope.appViewId);if(!cached)throw Error("fixture missing");await store.upsertAppViewDefinition({...cached,definition:{...cached.definition,appView:{...view,config:{...view.config,subjectPresentation:definition.config}},subjectPresentation:definition} as never});return definition;
}
it("persists visual projection through actual snapshot functions and SQLite reopen without changing durable names/outbox",async()=>{
 const d=await prepareVisual();await store.upsertRemoteRecords({...scope,entityTypeId:scope.sourceEntityTypeId,records:[{id:"visual-subject",displayName:"Legacy identifier",updatedAt:"2026-10-28T10:00:00.000Z",values:{identifier:"00123k"}}]});
 const subject={id:"visual-subject",displayName:"Legacy identifier",presentation:projectSubject(d,"visual-subject",{name:"Título desde Core",identifier:"00123k"})};
 await store.saveStateUpdateLocally({...scope,subjectRecordId:subject.id,subjectDisplayName:subject.displayName,stateFields:[],stateValues:[{fieldId:"status",optionId:"local"}],extraValues:{},overwrite:true,expectedUpdatedAt:"2026-10-28T10:00:00.000Z"});
 const before=await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id");
 await store.upsertStateUpdateSnapshot({...scope,subjectPresentation:d,items:[{subject,current:{recordId:"visual-event",updatedAt:"2026-10-28T10:00:00.000Z",stateValues:[{fieldId:"status",optionId:"remote",label:"Remote"}]}}]});await reopen();
 const [item]=await search("00123k");expect(subjectPresentationView(item.subject,d.config,d)).toMatchObject({title:"Título desde Core",complete:true});expect(item.subject.displayName).toBe("Legacy identifier");expect(await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")).toEqual(before);
 const prepared=await store.getAppViewDefinition(scope.ownerKey,scope.contractId,scope.appViewId);if(!prepared)throw Error();
 await store.upsertAppViewDefinition({...prepared,appViewId:"same-config-other-view",definition:{...prepared.definition,appView:{...view,id:"same-config-other-view",config:{...view.config,subjectPresentation:d.config}}} as never});
 const [isolated]=await store.searchStateUpdateSubjects({...scope,appViewId:"same-config-other-view",search:"00123k",searchFieldId:descriptor.id});expect(subjectPresentationView(isolated.subject,d.config,d).title).not.toBe("Título desde Core");
 const other={...d,config:{...d.config,titleFieldIds:[descriptor.id],secondaryFieldIds:["visual-name"]},fields:[d.fields[1],d.fields[0]]};other.fingerprint=presentationFingerprint(other.sourceEntityTypeId,other.config,other.fields);await prepareVisual(other);const [changed]=await search("00123k");const v=subjectPresentationView(changed.subject,other.config,other);expect(v.title).toBe("00123k");expect(v.complete).toBe(false);expect(JSON.stringify(v)).not.toContain("Título desde Core");
});
it("reuses prepared source values offline with scoped definition, including explicit missing data, without requiring a remote event",async()=>{
 const d=await prepareVisual();await store.upsertRemoteRecords({...scope,entityTypeId:scope.sourceEntityTypeId,records:[{id:"prepared-subject",displayName:"Legacy",updatedAt:"2026-10-28T10:00:00.000Z",values:{identifier:"00123k",name:"Fuente preparada"}}]});await reopen();const [item]=await search("00123k");expect(item.current).toBeNull();expect(subjectPresentationView(item.subject,d.config,d).title).toBe("Fuente preparada");
 const cached=await store.getAppViewDefinition(scope.ownerKey,scope.contractId,scope.appViewId);if(!cached)throw Error();await store.upsertAppViewDefinition({...cached,appViewId:"other-view",definition:{...cached.definition,appView:{...view,id:"other-view",config:{...view.config,subjectPresentation:{...d.config,titleFieldIds:[descriptor.id]}}}} as never});const [other]=await store.searchStateUpdateSubjects({...scope,appViewId:"other-view",search:"00123k"});expect(other.subject.presentation).toBeUndefined();
});
it("failed visual persistence never rolls back the business snapshot or announces enriched completeness",async()=>{
 const d=await prepareVisual();await store.upsertRemoteRecords({...scope,entityTypeId:scope.sourceEntityTypeId,records:[{id:"visual-fail",displayName:"Legacy",updatedAt:"2026-10-28T10:00:00.000Z",values:{identifier:"00123k"}}]});
 const run=harness.db.runAsync;harness.db.runAsync=vi.fn(async(sql,...args)=>{if(sql.startsWith("INSERT INTO app_metadata")&&String(args[0]).startsWith("subject_presentation:"))throw Error("synthetic visual storage failure");return run(sql,...args);});
 const subject={id:"visual-fail",displayName:"Legacy",presentation:projectSubject(d,"visual-fail",{name:"Not persisted",identifier:"00123k"})};const result=await store.upsertStateUpdateSnapshot({...scope,subjectPresentation:d,items:[{subject,current:{recordId:"visual-event",updatedAt:"2026-10-28T10:00:00.000Z",stateValues:[]}}]});expect(result.persistedRemoteEventCount).toBe(1);expect(result.presentationWrite).toMatchObject({status:"failed",complete:false});harness.db.runAsync=run;await reopen();const [item]=await search("00123k");expect(item.current).not.toBeNull();expect(subjectPresentationView(item.subject,d.config,d).complete).toBe(false);expect(JSON.stringify(item.subject.presentation)).not.toContain("Not persisted");
});
it("ignores an older visual response for the same scope/configuration and preserves both configurations independently",async()=>{
 const d=await prepareVisual();await store.upsertRemoteRecords({...scope,entityTypeId:scope.sourceEntityTypeId,records:[{id:"late-subject",displayName:"Legacy",updatedAt:"2026-10-28T11:00:00.000Z",values:{identifier:"00123k"}}]});
 const save=async(name:string,version:string)=>{const subject={id:"late-subject",displayName:"Legacy",presentation:projectSubject(d,"late-subject",{name,identifier:"00123k"},[],version,version)};return store.upsertStateUpdateSnapshot({...scope,subjectPresentation:d,items:[{subject,current:null}]});};
 await save("Nuevo","2026-10-28T11:00:00.000Z");await save("Viejo","2026-10-28T10:00:00.000Z");await reopen();const [item]=await search("00123k");expect(subjectPresentationView(item.subject,d.config,d)).toMatchObject({title:"Nuevo",complete:true});
});


it.each([false,true])("current preparation preserves ordered presentation and durable conflicts through reopen; batch=%s",async useBatch=>{
 const currentScope={...scope,uniqueness:"subject" as const,historyMode:"append" as const,dateFieldId:"date"};
 const d=visualDefinition();
 d.config.secondaryFieldIds.push("visual-choice","visual-relation");
 d.fields.push({id:"visual-choice",key:"choice",name:"Opción visual",type:"SELECT",multiple:false,options:[{value:"canonical",label:"Etiqueta autorizada"}]},{id:"visual-relation",key:"relation",name:"Relación visual",type:"RELATION",multiple:true,targetEntityTypeId:"roles",relationReadable:true});
 d.fingerprint=presentationFingerprint(d.sourceEntityTypeId,d.config,d.fields);await prepareVisual(d);
 const prepared=(await store.getAppViewDefinition(scope.ownerKey,scope.contractId,scope.appViewId))!;await store.upsertAppViewDefinition({...prepared,definition:{...prepared.definition,stateFields:[{fieldId:"date",label:"Fecha",type:"DATE",required:false,options:[]}],historyMode:currentScope.historyMode,uniqueness:currentScope.uniqueness,appView:{...view,config:{...view.config,historyMode:currentScope.historyMode,uniqueness:currentScope.uniqueness,subjectPresentation:d.config}}} as never});
 const subjects=[{id:"current-visual-one",displayName:"Legacy uno"},{id:"current-visual-two",displayName:"Legacy dos"}];
 await store.upsertRemoteRecords({...currentScope,entityTypeId:scope.sourceEntityTypeId,records:subjects.map(subject=>({...subject,updatedAt:"2026-10-29T10:00:00.000Z",values:{identifier:"00123k"}}))});
 const pending=await store.saveStateUpdateLocally({...currentScope,subjectRecordId:subjects[0].id,subjectDisplayName:subjects[0].displayName,stateFields:[],stateValues:[{fieldId:"status",optionId:"local"}],overwrite:true,expectedUpdatedAt:"2026-10-29T10:00:00.000Z"});
 await harness.db.runAsync("UPDATE entity_records SET sync_status='conflict' WHERE local_id=?",pending.localRecordId);
 const outbox=await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id");const local=await harness.db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced' ORDER BY local_id");
 const capability={version:1 as const,maxSubjects:100,configurationFingerprint:"b".repeat(64)};const requests:string[][]=[];
 const api=createOpcoApi({apiUrl:"https://synthetic.invalid",fetcher:async input=>{
  const url=new URL(String(input)),ids=url.searchParams.getAll("subjectRecordIds"),individual=url.searchParams.get("subjectRecordId");requests.push(ids.length?ids:[individual!]);
  return new Response(JSON.stringify({ok:true,data:{appView:view,contractId:scope.contractId,date:scope.date,dateFieldId:"date",subjectFieldId:"subject",workflow:{historyMode:currentScope.historyMode,uniqueness:{mode:currentScope.uniqueness}},subjectEntityType:{id:scope.sourceEntityTypeId,name:"Origen sintético"},targetEntityType:{id:scope.targetEntityTypeId,name:"Destino sintético"},stateFields:[{fieldId:"date",label:"Fecha",type:"DATE",required:false,options:[]}],extraFields:[],subjectPresentation:d,
   ...(useBatch?{currentBatchCapabilities:capability,currentBatch:{version:1,requestedSubjectIds:ids,results:ids.map(subjectRecordId=>({subjectRecordId,status:"resolved"}))}}:{}),
   subjects:subjects.filter(subject=>ids.length?ids.includes(subject.id):subject.id===individual).map(subject=>({subject:{...subject,presentation:projectSubject(d,subject.id,{name:"Título "+subject.id,identifier:"00123k",choice:"canonical",relation:[{id:"role-id",entityTypeId:"roles",displayName:"Rol autorizado"}]})},current:subject.id===subjects[1].id?null:{recordId:"current-event",updatedAt:"2026-10-29T10:00:00.000Z",states:{status:"remote",date:scope.date}}})),latest:{items:[],pagination:{page:1,pageSize:20,total:0,hasMore:false}}}}),{status:200});
 }});
 const proof=await prepareStateUpdateCurrent({api,token:"synthetic",scope:currentScope,store,sourceRemoteTotal:2,sourceFetched:2,sourceCacheTotal:2,runWithConcurrency,concurrency:4,...(useBatch?{currentBatchCapabilities:capability}:{})});
 expect(proof?.status).toBe("complete");expect(requests).toHaveLength(useBatch?1:2);expect(await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")).toEqual(outbox);expect(await harness.db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced' ORDER BY local_id")).toEqual(local);
 await reopen();const items=await store.searchStateUpdateSubjects({...currentScope,search:"00123k",searchFieldId:descriptor.id});expect(items).toHaveLength(2);
 for(const item of items){const visual=subjectPresentationView(item.subject,d.config,d);expect(visual).toMatchObject({title:"Título "+item.subject.id,complete:true});expect(visual.secondary.map(cell=>cell.value)).toEqual(["00123k","Etiqueta autorizada","Rol autorizado"]);expect(item.subject.displayName).toBe(subjects.find(s=>s.id===item.subject.id)!.displayName);}
 expect(items.find(item=>item.subject.id===subjects[0].id)?.current?.recordId).toBe(pending.localRecordId);expect(items.find(item=>item.subject.id===subjects[1].id)?.current).toBeNull();expect(await store.getStateUpdateCurrentCoverage(currentScope)).toMatchObject({status:"complete",subjects:{[subjects[1].id]:{status:"verified",remoteRecordId:null}}});
 expect(await harness.db.getAllAsync("SELECT * FROM pending_operations ORDER BY id")).toEqual(outbox);expect(await harness.db.getAllAsync("SELECT * FROM entity_records WHERE sync_status!='synced' ORDER BY local_id")).toEqual(local);expect(await harness.db.getFirstAsync("PRAGMA integrity_check")).toEqual({integrity_check:"ok"});
});
