import { describe, expect, it, vi } from "vitest";
import { createOpcoApi } from "./opco-api";
import { sampleNegotiation } from "../test/revision-negotiation-fixture";
import { genericNegotiationFixture } from "../test/generic-negotiation-fixture";
import { canConsumeGenericReceipt, createManifestNegotiationRequest, getRevisionNegotiationDiagnostics, observeNegotiatedReceipts, validateManifestNegotiation } from "./revision-negotiation";

describe("generic negotiation and existing runtime ledger", () => {
  it("retains a closed default offer and requires a runtime-accredited receipt",async()=>{
    const f=await genericNegotiationFixture(),storage={};
    const receipt={version:1,mode:"shadow",reuseAllowed:false,snapshotId:"snapshot",scope:f.scope,status:"verified",localHash:"hash",coverage:{kind:"unfiltered-collection",complete:true},remote:{epoch:f.manifest.epoch,vector:f.manifest.readBindingVector.revision,metadata:f.manifest.readDefinitionsRevision}};
    const check=()=>canConsumeGenericReceipt({manifest:f.manifest,receipt,appViewId:"view",kind:"unfiltered-collection",storage,isCurrent:()=>true});
    expect(await check()).toBe(false);
    const store=observeNegotiatedReceipts({async commitRecordsRevisionReceipt(_context:unknown){return receipt;}},async()=>storage);
    await store.commitRecordsRevisionReceipt({manifest:f.manifest,scope:f.scope,isCurrent:()=>true});
    expect(await check()).toBe(true);
    const closed=await genericNegotiationFixture([], {enabled:false});
    expect(await canConsumeGenericReceipt({manifest:closed.manifest,receipt,appViewId:"view",kind:"unfiltered-collection",storage,isCurrent:()=>true})).toBe(false);
    for(const input of [{storage:{}},{appViewId:"other"},{isCurrent:()=>false},{kind:"metadata-only" as const}])expect(await canConsumeGenericReceipt({manifest:f.manifest,receipt,appViewId:"view",kind:"unfiltered-collection",storage,isCurrent:()=>true,...input})).toBe(false);
    receipt.localHash="changed";expect(await check()).toBe(false);
  });
  it.each(["nonce","scope","versions","kinds","offer","epoch"])("rejects incompatible %s",async change=>{
    const f=await genericNegotiationFixture(),raw=structuredClone(f.raw);
    if(change==="nonce")raw.negotiation.nonce="other";
    if(change==="scope")raw.scope.userId="other";
    if(change==="versions")raw.negotiation.supportedVersions.storagePolicyVersion=2;
    if(change==="kinds")raw.negotiation.genericReuse.views[0].kinds=["unknown" as never];
    if(change==="offer")raw.negotiation.genericReuse.views[0].appViewId="other";
    if(change==="epoch")raw.epoch="restored";
    await expect(validateManifestNegotiation(raw,f.request,{contractId:"contract",ownerKey:"org:user"},"synthetic")).rejects.toThrow();
  });
  it("extracts the real nested context of the base receipt commit",async()=>{
    const f=await genericNegotiationFixture(),storage={},context={scope:f.scope,manifest:f.manifest,isCurrent:()=>true};
    const receipt={version:1,mode:"shadow",reuseAllowed:false,snapshotId:"base-receipt",scope:f.scope,status:"verified",coverage:{complete:true},remote:{epoch:f.manifest.epoch},localHash:"local"};
    const store=observeNegotiatedReceipts({async commitRevisionReceipt(_input:{context:typeof context}){return receipt;}},async()=>storage);
    await store.commitRevisionReceipt({context});
    expect(getRevisionNegotiationDiagnostics().at(-1)?.code).toBe("REVISION_RUNTIME_RECEIPT_ACCREDITED");
  });
  it("an old Core policy rejection retains the Attendance negotiation path, never loops",async()=>{
    const policies:string[]=[];
    const fetcher=vi.fn(async(url:RequestInfo|URL)=>{
      const q=new URL(String(url)).searchParams,policy=Number(q.get("storagePolicyVersion"));policies.push(String(policy));
      const request=await createManifestNegotiationRequest({selectiveReuse:policy===2});
      request.nonce=q.get("nonce")!;request.negotiation.nonce=request.nonce;request.negotiation.storagePolicyVersion=policy as 2|3;
      const raw=await sampleNegotiation(request);
      if(policy===3)return Response.json({ok:true,data:{...raw,negotiation:{...raw.negotiation,issues:["STORAGE_POLICY_UNSUPPORTED"]}}});
      return Response.json({ok:true,data:{...raw,negotiation:{...raw.negotiation,requestedVersions:{...raw.negotiation.requestedVersions,storagePolicyVersion:2},supportedVersions:{...raw.negotiation.supportedVersions,storagePolicyVersion:2},selectiveReuse:{version:1,policy:"attendance-runtime-v1",enabled:false,appViewIds:[]}}}});
    });
    const api=createOpcoApi({apiUrl:"http://local.invalid",fetcher,genericReuse:true,selectiveReuse:true});
    expect((await api.getOfflineRevisionManifest("synthetic","contract",{selectiveReuse:true})).version).toBe(2);
    expect(policies).toEqual(["3","2"]);
  });
});
