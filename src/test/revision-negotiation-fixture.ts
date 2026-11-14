import {revisionHash} from "../lib/revision-receipts";
import {createManifestNegotiationRequest,NEGOTIATION_VERSIONS} from "../lib/revision-negotiation";
export const negotiationScope = { userId: "user", organizationId: "org", contractId: "contract", applicationId: "app", authorizationFingerprint: "a".repeat(64) };
export async function sampleNegotiation(request: Awaited<ReturnType<typeof createManifestNegotiationRequest>>) {
  const state = { version: 2, representationVersion: 1, epoch: "epoch", trackingSignature: "b".repeat(32), scope: negotiationScope, context: { date: request.date ?? null, month: request.month ?? null }, viewsRevision: "c".repeat(64), readDefinitionsRevision: "d".repeat(64),
    readBindingVector: { version: 1, representationVersion: 1, available: true, revision: "e".repeat(64) }, entities: [], experiences: request.appViewIds.map(appViewId => ({ appViewId,definitionRevision:"f".repeat(64),dependsOn:[],coverage:{certified:false} })) };
  const { nonce: _nonce, ...canonicalRequest } = request;
  const bindings = { scopeFingerprint: await revisionHash(negotiationScope), manifestVectorRevision: state.readBindingVector.revision, epoch: state.epoch, definitionsRevision: state.readDefinitionsRevision };
  return { ...state, manifestRevision: await revisionHash(state), mode: "shadow", reuseAllowed: false, tracking: { databaseDml: "installed", dependenciesResolved: true }, capabilities: { revisionBoundBusinessReads: false, persistedClientReceipts: false, clientMaySkipReads: false }, snapshot: { isolation: "repeatable-read", at: "2026-11-13T00:00:00Z" },
    negotiation: { version: 1, nonce: request.nonce, requestedVersions: NEGOTIATION_VERSIONS, supportedVersions: NEGOTIATION_VERSIONS, bindings,
      comparison: Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key, request.negotiation.expected[key as keyof typeof bindings] === undefined ? "not-requested" : request.negotiation.expected[key as keyof typeof bindings] === value ? "match" : "mismatch"])),
      status: "compatible", issues: [] as string[], requestFingerprint: await revisionHash({ scope:negotiationScope, query: canonicalRequest }), compatibilityOnly: true, reuseAllowed: false, clientMaySkipReads: false, coverageCertified: false, localReceiptVerified: false, storageIdentityVerified: false } };
}
