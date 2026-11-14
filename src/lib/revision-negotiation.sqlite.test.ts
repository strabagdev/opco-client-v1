// Real SQLite-file transport reused from the stage-3 receipt harness.
// @ts-expect-error Node types are intentionally absent from Expo config.
import {spawn} from "node:child_process";
// @ts-expect-error Node types are intentionally absent from Expo config.
import {mkdtempSync, rmSync} from "node:fs";
import {beforeEach, afterEach, describe, it, expect, vi} from "vitest";
import {getLocalDatabase, __resetLocalDatabaseForTests} from "./local-db";


import {createManifestNegotiationRequest,validateManifestNegotiation,getRevisionNegotiationDiagnostics} from "./revision-negotiation";
import {negotiationScope,sampleNegotiation} from "../test/revision-negotiation-fixture";
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


const scope={...negotiationScope,ownerKey:"org:user"};
const appView={id:"audit-view",name:"Synthetic",type:"BOARD",config:{}} as unknown as import("./opco-api").AppView;
async function remote(){const request=await createManifestNegotiationRequest();return validateManifestNegotiation(await sampleNegotiation(request),request,{contractId:scope.contractId,ownerKey:scope.ownerKey},"synthetic-session");}
async function seed(){
 const manifest=await remote(),context={scope,manifest,sessionId:crypto.randomUUID(),runId:"run",isCurrent:()=>true};
 await store.upsertAppViews(scope.ownerKey,scope.contractId,[appView],"2026-11-13T00:00:00Z");
 const prepared={kind:"unsupported"as const,appView};await store.upsertAppViewDefinition({ownerKey:scope.ownerKey,contractId:scope.contractId,appViewId:appView.id,appViewType:appView.type,workflowKey:null,status:"ready",definition:prepared,lastPreparedAt:"2026-11-13T00:00:00Z"});
 await store.beginRevisionReceiptSession(context);
 const read={version:1 as const,representationVersion:1 as const,mode:"shadow"as const,reuseAllowed:false as const,clientMaySkipReads:false as const,revision:"d".repeat(64),manifestVectorRevision:manifest.readBindingVector.revision,epoch:manifest.epoch,authorizationFingerprint:scope.authorizationFingerprint,selectionFingerprint:"e".repeat(64),requestFingerprint:"f".repeat(64),contentHash:"0".repeat(64),snapshot:{isolation:"repeatable-read"as const,at:"2026-11-13T00:00:00Z"},coverageCertified:false as const};
 return store.commitPreparationRevisionReceipt(context,{appView,prepared,coverage:{version:1,kind:"metadata-only",complete:true,scope:"ordinary-preparation",businessDataIncluded:false,arbitraryQueries:false,relationCatalogs:false,latest:"not-included",dates:[]},parts:[{resource:{kind:"views"},artifact:{kind:"views"},expected:{json:[appView]},reads:[read]}],markers:[]});
}
describe("v2 runtime binding and real SQLite reopening",()=>{
 it("consumes verified content before an interleaved cache writer can commit",async()=>{
  const receipt=await seed(),manifest=await remote();let enter!:()=>void,release!:()=>void,committed=false;
  const entered=new Promise<void>(r=>enter=r),hold=new Promise<void>(r=>release=r);
  const read=store.inspectPreparationRevisionReceipts({scope,manifest,isCurrent:()=>true,onVerified:async(current)=>{expect(current.snapshotId).toBe(receipt.snapshotId);enter();await hold;expect(committed).toBe(false);}});
  await entered;
  const writer=store.upsertAppViews(scope.ownerKey,scope.contractId,[],"2026-11-13T01:00:00Z").then(()=>{committed=true;});
  await Promise.resolve();release();await read;await writer;
  expect((await store.inspectPreparationRevisionReceipts({scope,manifest,isCurrent:()=>true}))[0].status).toBe("invalid");
 });
 it("never consumes a mismatched period or a retired inspection",async()=>{
  const receipt=await seed(),manifest=await remote(),consume=vi.fn();
  await store.inspectPreparationRevisionReceipts({scope,manifest,request:{appViewId:appView.id,kind:"metadata-only",dates:["2026-12-01"]},isCurrent:()=>true,onVerified:consume});
  expect(consume).not.toHaveBeenCalled();let current=true;
  await expect(store.inspectPreparationRevisionReceipts({scope,manifest,isCurrent:()=>current,onVerified:async()=>{current=false;}})).rejects.toMatchObject({code:"REVISION_SCOPE_RETIRED"});
  expect((await store.inspectPreparationRevisionReceipts({scope,manifest,isCurrent:()=>true}))[0].receipt?.snapshotId).toBe(receipt.snapshotId);
 });
 it("recognizes the same committed receipt through a new store facade",async()=>{const receipt=await seed();store=getLocalDatabase();const result=await store.inspectPreparationRevisionReceipts({scope,manifest:await remote(),isCurrent:()=>true});expect(result[0].receipt?.snapshotId).toBe(receipt.snapshotId);expect(getRevisionNegotiationDiagnostics().at(-1)).toMatchObject({code:"REVISION_RUNTIME_RECEIPTS_MATCH",matched:1,reuse:false,skipDownloads:false});});
 it("retains offline content after reopen but withdraws runtime accreditation",async()=>{const receipt=await seed();await db.closeAsync();await open();const result=await store.inspectPreparationRevisionReceipts({scope,manifest:await remote(),isCurrent:()=>true});expect(result[0]).toMatchObject({status:"match_shadow",receipt:{snapshotId:receipt.snapshotId},reuseAllowed:false});expect(getRevisionNegotiationDiagnostics().at(-1)).toMatchObject({code:"REVISION_STORAGE_RUNTIME_UNACCREDITED",rejected:1,reuse:false,skipDownloads:false});expect((await store.getAppViews(scope.ownerKey,scope.contractId))?.views).toEqual([appView]);});
 it("preserves ordinary invalidation for epoch mismatch and content corruption",async()=>{await seed();const manifest=await remote();expect((await store.inspectPreparationRevisionReceipts({scope,manifest:{...manifest,epoch:"rotated"},isCurrent:()=>true}))[0].status).toBe("invalid");await seed();await db.runAsync("UPDATE app_views SET views_json='[]'");expect((await store.inspectPreparationRevisionReceipts({scope,manifest:await remote(),isCurrent:()=>true}))[0].status).toBe("invalid");});
 it("keeps scopes isolated and does not touch pending work while inspecting",async()=>{await seed();const before=await db.getAllAsync("SELECT * FROM pending_operations");const other={...scope,contractId:"other"};expect(await store.inspectPreparationRevisionReceipts({scope:other,isCurrent:()=>true})).toEqual([]);expect(await db.getAllAsync("SELECT * FROM pending_operations")).toEqual(before);});
});
