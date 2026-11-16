import {describe,it,expect,vi} from "vitest";
import {genericNegotiationFixture} from "../test/generic-negotiation-fixture";
import {observeNegotiatedReceipts} from "./revision-negotiation";
import {revisionHash} from "./revision-receipts";
import {createPreparationRevisionRun} from "./preparation-revision-receipts";
vi.mock("expo-sqlite",()=>({openDatabaseAsync:vi.fn()}));

async function fixture(){
  const f=await genericNegotiationFixture(["metadata-only","field-options-and-direct-catalogs"]),storage={};
  const view={id:"view",name:"Synthetic",type:"RECORDS",config:{entityTypeId:"entity"}},prepared={kind:"records",appView:view};
  const remote={epoch:f.manifest.epoch,vector:f.manifest.readBindingVector.revision,metadata:f.manifest.readDefinitionsRevision};
  const receipt={version:1,mode:"shadow",reuseAllowed:false,snapshotId:"metadata",scope:f.scope,status:"verified",localHash:"metadata-hash",appViewId:"view",markers:[],coverage:{kind:"metadata-only",complete:true,businessDataIncluded:false,dates:[]},remote};
  const catalog={...receipt,snapshotId:"catalog",coverage:{kind:"field-options-and-direct-catalogs",complete:true}};
  type Inspection={request?:unknown;appViewId?:string;onVerified?:(r:unknown,s:object,p:unknown)=>Promise<void>};
  // Unit boundary: materialization is verified separately by real SQLite/OPFS coverage tests.
  const original={commitPreparationRevisionReceipt:vi.fn(async(_context:unknown)=>receipt),commitCatalogRevisionReceipt:vi.fn(async(_context:unknown)=>catalog),retirePreparationRevisionReceipts:vi.fn(),recordPreparationRevisionStatus:vi.fn(),beginRevisionReceiptSession:vi.fn(),
    inspectPreparationRevisionReceipts:vi.fn(async(input:Inspection)=>{if(input.request||input.appViewId)await input.onVerified?.(receipt,storage,prepared);return[];}),
    inspectCatalogRevisionReceipts:vi.fn(async(input:Inspection)=>{await input.onVerified?.(catalog,storage,prepared);return[];})};
  const store=observeNegotiatedReceipts(original,async()=>storage),context={scope:f.scope,manifest:f.manifest,isCurrent:()=>true};
  await store.commitPreparationRevisionReceipt(context as never);await store.commitCatalogRevisionReceipt(context as never);
  const data={views:[view]},readRevision={version:1,representationVersion:1,mode:"shadow",reuseAllowed:false,clientMaySkipReads:false,coverageCertified:false,revision:"1".repeat(64),manifestVectorRevision:remote.vector,epoch:remote.epoch,authorizationFingerprint:f.scope.authorizationFingerprint,selectionFingerprint:"2".repeat(64),requestFingerprint:"3".repeat(64),contentHash:await revisionHash(data),snapshot:{isolation:"repeatable-read",at:"2026-11-15T00:00:00Z"}};
  const api={genericReuseEnabled:true,getOfflineRevisionManifest:vi.fn(async()=>f.manifest),getRevisionRead:vi.fn(async()=>({resource:{kind:"views"},data,normalized:data,readRevision})),getEntityRecords:vi.fn(),getEntityDefinition:vi.fn()};
  const input={api,store,token:"synthetic",ownerKey:f.scope.ownerKey,contractId:f.scope.contractId,appViews:[view],runId:"run"} as unknown as Parameters<typeof createPreparationRevisionRun>[0];
  return{f,api,store,original,input,view,receipt,catalog};
}

describe("ordinary preparation consumes existing complete proofs",()=>{
  it("skips metadata and direct catalogs, keeps snapshot identities and downloads no business data",async()=>{
    const x=await fixture(),before=structuredClone([x.receipt,x.catalog]),run=await createPreparationRevisionRun(x.input);
    expect(await run.tryReusePreparation(x.view as never)).toBe(true);run.viewResult("view","skipped");await run.prepareCatalogs();expect(await run.finish()).toEqual([]);expect(run.validatedReuseIds()).toEqual(["view"]);
    expect(x.api.getEntityRecords).not.toHaveBeenCalled();expect(x.api.getEntityDefinition).not.toHaveBeenCalled();expect([x.receipt,x.catalog]).toEqual(before);
    expect(x.original.commitCatalogRevisionReceipt).toHaveBeenCalledTimes(1);expect(x.original.commitPreparationRevisionReceipt).toHaveBeenCalledTimes(1);
  });
  it("withdraws once at final revalidation when the vector changes",async()=>{
    const x=await fixture(),run=await createPreparationRevisionRun(x.input);expect(await run.tryReusePreparation(x.view as never)).toBe(true);run.viewResult("view","skipped");await run.prepareCatalogs();
    x.api.getOfflineRevisionManifest.mockResolvedValue({...x.f.manifest,readBindingVector:{...x.f.manifest.readBindingVector,revision:"9".repeat(64)}});
    expect(await run.finish()).toEqual(["view"]);expect(run.validatedReuseIds()).toEqual([]);
  });
  it("a closed local gate leaves the normal preparation path available",async()=>{
    const x=await fixture();x.api.genericReuseEnabled=false;const run=await createPreparationRevisionRun(x.input);expect(await run.tryReusePreparation(x.view as never)).toBe(false);
  });
});
