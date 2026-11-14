import { describe, expect, it } from "vitest";
import { createManifestNegotiationRequest, validateManifestNegotiation, observeNegotiatedReceipts, canConsumeAttendanceReceipt } from "./revision-negotiation";
import { sampleNegotiation, negotiationScope as scope } from "../test/revision-negotiation-fixture";
import { revisionHash } from "./revision-receipts";

async function remote(enabled=true,token="synthetic-session") {
  const request=await createManifestNegotiationRequest({month:"2026-11",appViewIds:["attendance"],selectiveReuse:true});
  const raw=await sampleNegotiation(request);
  const state={...raw,experiences:raw.experiences.map(v=>({...v,workflowKey:"attendance"}))};
  const {version,representationVersion,epoch,trackingSignature,scope:identity,context,viewsRevision,readDefinitionsRevision,readBindingVector,entities,experiences}=state;
  const response={...state,manifestRevision:await revisionHash({version,representationVersion,epoch,trackingSignature,scope:identity,context,viewsRevision,readDefinitionsRevision,readBindingVector,entities,experiences}),
    negotiation:{...raw.negotiation,requestedVersions:{...raw.negotiation.requestedVersions,storagePolicyVersion:2},supportedVersions:{...raw.negotiation.supportedVersions,storagePolicyVersion:2},
      compatibilityOnly:!enabled,reuseAllowed:enabled,clientMaySkipReads:enabled,selectiveReuse:{version:1,policy:"attendance-runtime-v1",enabled,appViewIds:enabled?["attendance"]:[]}}};
  return validateManifestNegotiation(response,request,{contractId:"contract",ownerKey:"org:user"},token);
}

async function prepared(){
  const manifest=await remote(),storage={};
  const receipt={version:1,mode:"shadow",reuseAllowed:false,snapshotId:crypto.randomUUID(),status:"verified",appViewId:"attendance",scope:{...scope,ownerKey:"org:user"},
    remote:{epoch:manifest.epoch,vector:manifest.readBindingVector.revision,metadata:manifest.readDefinitionsRevision},
    coverage:{kind:"attendance-month",businessDataIncluded:true,complete:true,latest:"complete-snapshot"},localHash:"verified-local-content"};
  const store=observeNegotiatedReceipts({async commitPreparationRevisionReceipt(_context:unknown){return receipt;}},async()=>storage);
  const consume=(m=manifest,handle=storage)=>canConsumeAttendanceReceipt({manifest:m,receipt,storage:handle,isCurrent:()=>true});
  return {manifest,storage,receipt,store,consume};
}

describe("explicit selective reuse protocol", () => {
  it("negotiates policy2 only for an explicit local pilot", async () => {
    const request = await createManifestNegotiationRequest({ month: "2026-11", selectiveReuse: true });
    expect(request.negotiation.storagePolicyVersion).toBe(2);
  });
  it("retains policy1 by default", async () => {
    expect((await createManifestNegotiationRequest()).negotiation.storagePolicyVersion).toBe(1);
  });
  it("requires a verified receipt committed on the current handle",async()=>{
    const x=await prepared();expect(await x.consume()).toBe(false);
    await x.store.commitPreparationRevisionReceipt({scope:x.receipt.scope,manifest:x.manifest,isCurrent:()=>true});
    expect(await x.consume(await remote())).toBe(true);
    expect(await x.consume(await remote(),{})).toBe(false);
  });
  it("denies a reopened session and a disabled Core policy",async()=>{
    const x=await prepared();await x.store.commitPreparationRevisionReceipt({scope:x.receipt.scope,manifest:x.manifest,isCurrent:()=>true});
    expect(await x.consume(await remote(true,"other-session"))).toBe(false);
    expect(await x.consume(await remote(false))).toBe(false);
  });
  it.each(["epoch","revision","metadata","scope","content","partial","kind"])("denies changed %s without changing the original command data",async change=>{
    const x=await prepared();await x.store.commitPreparationRevisionReceipt({scope:x.receipt.scope,manifest:x.manifest,isCurrent:()=>true});
    if(change==="epoch")x.receipt.remote.epoch="new-epoch";
    if(change==="revision")x.receipt.remote.vector="other";
    if(change==="metadata")x.receipt.remote.metadata="other";
    if(change==="scope")x.receipt.scope.contractId="other";
    if(change==="content")x.receipt.localHash="changed";
    if(change==="partial")x.receipt.coverage.complete=false;
    if(change==="kind")x.receipt.coverage.kind="metadata-only";
    expect(await x.consume()).toBe(false);
  });
  it("rejects a retired scope during the async proof",async()=>{
    const x=await prepared();await x.store.commitPreparationRevisionReceipt({scope:x.receipt.scope,manifest:x.manifest,isCurrent:()=>true});
    let calls=0;expect(await canConsumeAttendanceReceipt({...x,isCurrent:()=>++calls===1})).toBe(false);
  });
});
