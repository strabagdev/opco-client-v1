import { revisionCanonical, revisionHash, RevisionReceiptError, validateRevisionManifest, type RevisionManifest } from "./revision-receipts";

export const NEGOTIATION_VERSIONS = { readRepresentationVersion: 1, receiptVersion: 1, storagePolicyVersion: 1 } as const;
export type NegotiationRequest = { version: 2; nonce: string; appViewIds: string[]; date?: string; month?: string; negotiation: Omit<typeof NEGOTIATION_VERSIONS,"storagePolicyVersion"> & { storagePolicyVersion:1|2; nonce: string; expected: Partial<NegotiationBindings> } };
type NegotiationBindings = { scopeFingerprint: string; manifestVectorRevision: string; epoch: string; definitionsRevision: string };
type Identity = { contractId: string; ownerKey?: string; applicationId?: string; authorizationFingerprint?: string };
type Attestation = { bindingFingerprint:string; session: string; requestFingerprint: string; compatible: boolean; reuseViewIds: readonly string[] };
const attestations = new WeakMap<object, Attestation>();
const manifestBinding=(m:RevisionManifest)=>m;
type Diagnostic = { phase: "transport" | "receipt"; code: string; matched: number; rejected: number; reuse: false; skipDownloads: false };
const diagnostics: Diagnostic[] = [];
export function recordNegotiationDiagnostic(phase: Diagnostic["phase"], code: string, matched = 0, rejected = 0) {
  diagnostics.push({ phase, code: /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : "REVISION_NEGOTIATION_REJECTED", matched, rejected, reuse: false, skipDownloads: false });
  if (diagnostics.length > 50) diagnostics.shift();
}
export function getRevisionNegotiationDiagnostics() { return diagnostics.map(item => ({ ...item })); }
function proof(value: unknown, code = "REVISION_NEGOTIATION_INCOMPATIBLE"): asserts value { if (!value) throw new RevisionReceiptError(code); }
const same = (a: unknown, b: unknown) => revisionCanonical(a) === revisionCanonical(b);
const hex = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export async function createManifestNegotiationRequest(input: { date?: string; month?: string; appViewIds?: string[]; expected?: RevisionManifest; selectiveReuse?:boolean } = {}): Promise<NegotiationRequest> {
  proof(globalThis.crypto?.randomUUID, "REVISION_HASH_UNAVAILABLE");
  const nonce = crypto.randomUUID(), expected: Partial<NegotiationBindings> = input.expected ? {
    scopeFingerprint: await revisionHash(input.expected.scope), manifestVectorRevision: input.expected.readBindingVector.revision,
    epoch: input.expected.epoch, definitionsRevision: input.expected.readDefinitionsRevision,
  } : {};
  return { version: 2, ...(input.date ? { date: input.date } : {}), ...(input.month ? { month: input.month } : {}), appViewIds: [...(input.appViewIds ?? [])].sort(), nonce,
    negotiation: { ...NEGOTIATION_VERSIONS, storagePolicyVersion:input.selectiveReuse?2:1, nonce, expected } };
}
export function manifestNegotiationPath(contractId: string, request: NegotiationRequest) {
  const q = new URLSearchParams({ version: "2", nonce: request.nonce, ...Object.fromEntries(Object.entries({...NEGOTIATION_VERSIONS,storagePolicyVersion:request.negotiation.storagePolicyVersion}).map(([key, value]) => [key, String(value)])) });
  if (request.date) q.set("date", request.date); if (request.month) q.set("month", request.month);
  for (const id of request.appViewIds) q.append("appViewId", id);
  const parameters = { scopeFingerprint: "expectedScopeFingerprint", manifestVectorRevision: "expectedManifestVectorRevision", epoch: "expectedEpoch", definitionsRevision: "expectedDefinitionsRevision" };
  for (const [key, value] of Object.entries(request.negotiation.expected)) q.set(parameters[key as keyof typeof parameters], value!);
  return `/api/v1/contracts/${encodeURIComponent(contractId)}/offline/manifest?${q}`;
}

/** Verify the actual v2 envelope before it can participate even in shadow comparisons. */
export async function validateManifestNegotiation(value: unknown, request: NegotiationRequest, identity: Identity, token: string, isCurrent: () => boolean = () => true): Promise<RevisionManifest> {
  proof(isCurrent(), "REVISION_SCOPE_RETIRED");
  const raw = value as RevisionManifest & {
    snapshot:{isolation:string;at:string};tracking:{databaseDml:string;dependenciesResolved:boolean};capabilities:{revisionBoundBusinessReads:boolean;persistedClientReceipts:boolean;clientMaySkipReads:boolean};
    context:unknown;viewsRevision:string;trackingSignature:string;manifestRevision:string;entities:{entityTypeId:string;definitionRevision:string;dataRevision:string;tracked:boolean;active:boolean}[];experiences:{appViewId:string;definitionRevision:string;dependsOn:string[];coverage:{certified:boolean}}[];
    negotiation:{selectiveReuse?:{version:number;policy:string;enabled:boolean;appViewIds:string[]};version:number;nonce:string;compatibilityOnly:boolean;reuseAllowed:boolean;clientMaySkipReads:boolean;coverageCertified:boolean;localReceiptVerified:boolean;storageIdentityVerified:boolean;
      requestedVersions:unknown;supportedVersions:unknown;bindings:unknown;comparison:unknown;status:string;issues:unknown[];requestFingerprint:string};
  }; // Untrusted JSON; every consumed binding is checked below.
  proof(raw?.version === 2, "REVISION_NEGOTIATION_MISSING");
  const n = raw.negotiation;
  proof(n?.version === 1 && n.nonce === request.nonce, "REVISION_NEGOTIATION_NONCE_MISMATCH");
  const versions={...NEGOTIATION_VERSIONS,storagePolicyVersion:request.negotiation.storagePolicyVersion};
  const pilot=request.negotiation.storagePolicyVersion===2?n.selectiveReuse:undefined;
  if(request.negotiation.storagePolicyVersion===2)proof(pilot?.version===1&&pilot.policy==="attendance-runtime-v1"&&typeof pilot.enabled==="boolean"&&Array.isArray(pilot.appViewIds)&&new Set(pilot.appViewIds).size===pilot.appViewIds.length);
  const enabled=pilot?.enabled===true;
  proof(n.compatibilityOnly === !enabled && n.reuseAllowed===enabled && n.clientMaySkipReads===enabled && [n.coverageCertified, n.localReceiptVerified, n.storageIdentityVerified].every(flag => flag === false));
  proof(same(n.requestedVersions, versions) && same(n.supportedVersions, versions), "REVISION_NEGOTIATION_VERSION_MISMATCH");
  proof(raw.scope && raw.scope.contractId === identity.contractId && (!identity.ownerKey || identity.ownerKey === `${raw.scope.organizationId}:${raw.scope.userId}`) &&
    (!identity.applicationId || identity.applicationId === raw.scope.applicationId) && (!identity.authorizationFingerprint || identity.authorizationFingerprint === raw.scope.authorizationFingerprint), "REVISION_SCOPE_MISMATCH");
  proof(raw.tracking?.databaseDml === "installed" && raw.tracking.dependenciesResolved === true && raw.readBindingVector?.available === true, "REVISION_NEGOTIATION_UNAVAILABLE");
  const manifest = validateRevisionManifest(raw, 2);
  proof(same(raw.context, { date: request.date ?? null, month: request.month ?? null }), "REVISION_NEGOTIATION_CONTEXT_MISMATCH");
  proof(typeof manifest.epoch === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(manifest.epoch));
  proof(raw.snapshot?.isolation === "repeatable-read" && typeof raw.snapshot.at === "string" && Number.isFinite(Date.parse(raw.snapshot.at)) && hex(raw.viewsRevision) && typeof raw.trackingSignature === "string" && /^[a-f0-9]{32}$/.test(raw.trackingSignature) && hex(raw.manifestRevision));
  proof(raw.capabilities && [raw.capabilities.revisionBoundBusinessReads, raw.capabilities.persistedClientReceipts, raw.capabilities.clientMaySkipReads].every(flag => flag === false));
  proof(Array.isArray(raw.entities) && Array.isArray(raw.experiences));
  const id=(value:unknown)=>typeof value==="string"&&value.length>0&&value.length<=200;
  proof(raw.entities.every(e=>e&&id(e.entityTypeId)&&hex(e.definitionRevision)&&typeof e.dataRevision==="string"&&/^\d+$/.test(e.dataRevision)&&e.tracked===true&&e.active===true)&&new Set(raw.entities.map(e=>e.entityTypeId)).size===raw.entities.length);
  proof(raw.experiences.every(e=>e&&id(e.appViewId)&&hex(e.definitionRevision)&&Array.isArray(e.dependsOn)&&e.dependsOn.every(id)&&e.coverage?.certified===false)&&new Set(raw.experiences.map(e=>e.appViewId)).size===raw.experiences.length);
  if(pilot)proof(pilot.appViewIds.every(id=>typeof id==="string"&&raw.experiences.some(e=>e.appViewId===id&&(e as unknown as {workflowKey:string}).workflowKey==="attendance"))&&(!enabled?pilot.appViewIds.length===0:pilot.appViewIds.length>0),"REVISION_REUSE_SCOPE_MISMATCH");
  if (request.appViewIds.length) proof(same(raw.experiences.map((view: { appViewId: string }) => view.appViewId).sort(), request.appViewIds), "REVISION_NEGOTIATION_CONTEXT_MISMATCH");
  const { version, representationVersion, epoch, trackingSignature, scope, context, viewsRevision, readDefinitionsRevision, readBindingVector, entities, experiences } = raw;
  proof(await revisionHash({ version, representationVersion, epoch, trackingSignature, scope, context, viewsRevision, readDefinitionsRevision, readBindingVector, entities, experiences }) === raw.manifestRevision, "REVISION_NEGOTIATION_CONTENT_MISMATCH");
  const bindings = { scopeFingerprint: await revisionHash(manifest.scope), manifestVectorRevision: manifest.readBindingVector.revision, epoch: manifest.epoch, definitionsRevision: manifest.readDefinitionsRevision };
  proof(same(n.bindings, bindings), "REVISION_NEGOTIATION_BINDING_MISMATCH");
  const comparisons = Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key, request.negotiation.expected[key as keyof NegotiationBindings] === undefined ? "not-requested" : request.negotiation.expected[key as keyof NegotiationBindings] === value ? "match" : "mismatch"]));
  proof(same(n.comparison, comparisons));
  proof(n.status === "compatible" && Array.isArray(n.issues) && n.issues.length === 0 && !Object.values(comparisons).includes("mismatch"), "REVISION_NEGOTIATION_REJECTED");
  const canonicalRequest = { version: 2, ...(request.date ? { date: request.date } : {}), ...(request.month ? { month: request.month } : {}), appViewIds: request.appViewIds, negotiation: request.negotiation };
  proof(await revisionHash({ scope: manifest.scope, query: canonicalRequest }) === n.requestFingerprint, "REVISION_NEGOTIATION_REQUEST_MISMATCH");
  const session = await revisionHash(token), bindingFingerprint=await revisionHash(manifestBinding(manifest));
  proof(isCurrent(), "REVISION_SCOPE_RETIRED");
  attestations.set(manifest, { bindingFingerprint,session, requestFingerprint: n.requestFingerprint, compatible: true, reuseViewIds:enabled?[...pilot!.appViewIds]:[] });
  recordNegotiationDiagnostic("transport", "REVISION_NEGOTIATION_V2_MATCH");
  return manifest;
}

type Receipt = { version: number; mode: string; reuseAllowed: boolean; snapshotId: string; scope: unknown; status: string; localHash?: string; local?: { contentHash: string }; coverage: { kind?:string;businessDataIncluded?:boolean;latest?:string;complete?: boolean; completeWindow?: boolean }; remote: unknown };
type ReceiptContext = { manifest?: RevisionManifest; scope?: unknown; isCurrent?: () => boolean };
const runtimeReceipts = new WeakMap<object, Map<string, string>>();
const commits = new Set(["commitRevisionReceipt", "commitPreparationRevisionReceipt", "commitCatalogRevisionReceipt", "commitRecordsRevisionReceipt", "commitConsultationRevision"]);
const inspections = new Set(["inspectRevisionReceipts", "inspectPreparationRevisionReceipts", "inspectCatalogRevisionReceipts", "inspectRecordsRevisionCoverage", "inspectConsultationRevision"]);
async function receiptIdentity(receipt: Receipt, attestation: Attestation) { return revisionHash({ receipt, session: attestation.session }); }

/** Observation only: original returns/errors persist. No SQL, schema, queue or command changes. */
export function observeNegotiatedReceipts<T extends object>(store: T, getStorage: () => Promise<object>): T {
  const methods = new Map<PropertyKey, unknown>();
  return new Proxy(store, { get(target, key, receiver) {
    const original = Reflect.get(target, key, receiver);
    if (typeof key !== "string" || !commits.has(key) && !inspections.has(key) || typeof original !== "function") return original;
    if (methods.has(key)) return methods.get(key);
    const wrapped = async (...args: unknown[]) => {
      const context = (args[0] ?? {}) as ReceiptContext;
      let before: object | undefined;
      try { before = await getStorage(); } catch { /* Original operation retains its own failure. */ }
      const result = await Reflect.apply(original, target, args);
      try {
        const current = () => context.isCurrent?.() === true;
        if (!current()) return result;
        const after = await getStorage(), attestation = context.manifest && attestations.get(context.manifest);
        proof(current(), "REVISION_SCOPE_RETIRED");
        proof(before === after, "REVISION_STORAGE_HANDLE_CHANGED");
        proof(attestation, "REVISION_NEGOTIATION_NOT_ACCREDITED");
        proof(await revisionHash(manifestBinding(context.manifest!))===attestation.bindingFingerprint,"REVISION_NEGOTIATION_BINDING_MISMATCH");
        let ledger = runtimeReceipts.get(after); if (!ledger) { ledger = new Map(); runtimeReceipts.set(after, ledger); }
        if (commits.has(key)) {
          const receipt = result as Receipt;
          proof(receipt?.status === "verified" && receipt.version === 1 && receipt.mode === "shadow" && receipt.reuseAllowed === false &&
            (receipt.coverage?.complete === true || receipt.coverage?.completeWindow === true) && typeof receipt.snapshotId === "string" && same(receipt.scope, context.scope));
          const identity = await receiptIdentity(receipt, attestation);
          proof(current() && await getStorage() === after, "REVISION_STORAGE_HANDLE_CHANGED");
          ledger.set(receipt.snapshotId, identity);
          if (ledger.size > 500) ledger.delete(ledger.keys().next().value!);
          recordNegotiationDiagnostic("receipt", "REVISION_RUNTIME_RECEIPT_ACCREDITED", 1);
        } else {
          const observations = Array.isArray(result) ? result : [result]; let matched = 0, rejected = 0;
          for (const observation of observations) {
            const receipt = observation?.receipt as Receipt | undefined;
            if (observation?.status === "match_shadow" && observation.coverage !== "partial" && observation.coverage !== "unprepared" && receipt && ledger.get(receipt.snapshotId) === await receiptIdentity(receipt, attestation)) matched++; else rejected++;
          }
          proof(current() && await getStorage() === after, "REVISION_STORAGE_HANDLE_CHANGED");
          recordNegotiationDiagnostic("receipt", rejected ? "REVISION_STORAGE_RUNTIME_UNACCREDITED" : "REVISION_RUNTIME_RECEIPTS_MATCH", matched, rejected);
        }
      } catch (error) {
        if (context.isCurrent?.()) recordNegotiationDiagnostic("receipt", error instanceof RevisionReceiptError ? error.code : "REVISION_NEGOTIATION_OBSERVATION_FAILED", 0, 1);
      }
      return result;
    };
    methods.set(key, wrapped); return wrapped;
  } });
}

/** Called inside the existing receipt inspection transaction, after materialization/hash checks. */
export async function canConsumeAttendanceReceipt(input: {manifest:RevisionManifest;receipt:Receipt & {appViewId:string};storage:object;isCurrent():boolean}) {
  const {manifest,receipt,storage,isCurrent}=input, attestation=attestations.get(manifest);
  if(!isCurrent()||!attestation?.reuseViewIds.includes(receipt.appViewId)||receipt.status!=="verified"||receipt.coverage?.complete!==true || receipt.coverage.kind!=="attendance-month" || receipt.coverage.businessDataIncluded!==true || receipt.coverage.latest!=="complete-snapshot")return false;
  if(!same(receipt.scope,{...manifest.scope,ownerKey:`${manifest.scope.organizationId}:${manifest.scope.userId}`}))return false;
  const remote=receipt.remote as {epoch?:string;vector?:string;metadata?:string};
  if(remote?.epoch!==manifest.epoch||remote.vector!==manifest.readBindingVector.revision||remote.metadata!==manifest.readDefinitionsRevision)return false;
  const binding=await revisionHash(manifestBinding(manifest));
  const matches=runtimeReceipts.get(storage)?.get(receipt.snapshotId)===await receiptIdentity(receipt,attestation);
  return isCurrent()&&matches&&binding===attestation.bindingFingerprint;
}
