import { createManifestNegotiationRequest, validateManifestNegotiation, type GenericCoverageKind } from "../lib/revision-negotiation";
import { revisionHash } from "../lib/revision-receipts";
import { sampleNegotiation } from "./revision-negotiation-fixture";

export async function genericNegotiationFixture(kinds:GenericCoverageKind[]=["unfiltered-collection"], input:{enabled?:boolean;token?:string;appViewId?:string;type?:string}={}) {
  const request=await createManifestNegotiationRequest({genericReuse:true,appViewIds:[input.appViewId??"view"]});
  const sample=await sampleNegotiation(request);
  const type=input.type??(kinds.includes("exact-query-window")?"PANEL":kinds.some(k=>k.startsWith("state-update")||k==="context-required")?"WORKFLOW":"RECORDS");
  const raw={...sample,experiences:sample.experiences.map(e=>({...e,type,workflowKey:type==="WORKFLOW"?"state-update":null})),negotiation:{...sample.negotiation,requestedVersions:request.negotiation&&{readRepresentationVersion:1,receiptVersion:1,storagePolicyVersion:3},supportedVersions:{readRepresentationVersion:1,receiptVersion:1,storagePolicyVersion:3},
    compatibilityOnly:input.enabled===false,reuseAllowed:input.enabled!==false,clientMaySkipReads:input.enabled!==false,
    selectiveReuse:{version:1,policy:"attendance-runtime-v1",enabled:false,appViewIds:[] as string[]},
    genericReuse:{version:1,policy:"verified-coverage-runtime-v1",enabled:input.enabled!==false,views:input.enabled===false?[]:[{appViewId:input.appViewId??"view",kinds}]}}};
  const {version,representationVersion,epoch,trackingSignature,scope,context,viewsRevision,readDefinitionsRevision,readBindingVector,entities,experiences}=raw;
  raw.manifestRevision=await revisionHash({version,representationVersion,epoch,trackingSignature,scope,context,viewsRevision,readDefinitionsRevision,readBindingVector,entities,experiences});
  const manifest=await validateManifestNegotiation(raw,request,{contractId:"contract",ownerKey:"org:user"},input.token??"synthetic");
  return {request,raw,manifest,scope:{...manifest.scope,ownerKey:"org:user"},async fingerprint(value:unknown){return revisionHash(value);}};
}
