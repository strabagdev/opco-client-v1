import { revisionCanonical, revisionHash, RevisionReceiptError, validateRevisionManifest, type RevisionManifest } from "./revision-receipts";

export const NEGOTIATION_VERSIONS = { readRepresentationVersion: 1, receiptVersion: 1, storagePolicyVersion: 1 } as const;
export type NegotiationRequest = { version: 2; nonce: string; appViewIds: string[]; date?: string; month?: string; negotiation: Omit<typeof NEGOTIATION_VERSIONS,"storagePolicyVersion"> & { storagePolicyVersion:1|2|3; nonce: string; expected: Partial<NegotiationBindings> } };
type NegotiationBindings = { scopeFingerprint: string; manifestVectorRevision: string; epoch: string; definitionsRevision: string };
type Identity = { contractId: string; ownerKey?: string; applicationId?: string; authorizationFingerprint?: string };
type Attestation = { bindingFingerprint:string; session: string; requestFingerprint: string; compatible: boolean; reuseViewIds: readonly string[]; genericViews: readonly {appViewId:string;kinds:string[]}[] };
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

export async function createManifestNegotiationRequest(input: { date?: string; month?: string; appViewIds?: string[]; expected?: RevisionManifest; selectiveReuse?:boolean; genericReuse?:boolean } = {}): Promise<NegotiationRequest> {
  proof(globalThis.crypto?.randomUUID, "REVISION_HASH_UNAVAILABLE");
  const nonce = crypto.randomUUID(), expected: Partial<NegotiationBindings> = input.expected ? {
    scopeFingerprint: await revisionHash(input.expected.scope), manifestVectorRevision: input.expected.readBindingVector.revision,
    epoch: input.expected.epoch, definitionsRevision: input.expected.readDefinitionsRevision,
  } : {};
  return { version: 2, ...(input.date ? { date: input.date } : {}), ...(input.month ? { month: input.month } : {}), appViewIds: [...(input.appViewIds ?? [])].sort(), nonce,
    negotiation: { ...NEGOTIATION_VERSIONS, storagePolicyVersion:input.genericReuse?3:input.selectiveReuse?2:1, nonce, expected } };
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
    negotiation:{genericReuse?:{version:number;policy:string;enabled:boolean;views:{appViewId:string;kinds:string[]}[]};selectiveReuse?:{version:number;policy:string;enabled:boolean;appViewIds:string[]};version:number;nonce:string;compatibilityOnly:boolean;reuseAllowed:boolean;clientMaySkipReads:boolean;coverageCertified:boolean;localReceiptVerified:boolean;storageIdentityVerified:boolean;
      requestedVersions:unknown;supportedVersions:unknown;bindings:unknown;comparison:unknown;status:string;issues:unknown[];requestFingerprint:string};
  }; // Untrusted JSON; every consumed binding is checked below.
  proof(raw?.version === 2, "REVISION_NEGOTIATION_MISSING");
  const n = raw.negotiation;
  proof(n?.version === 1 && n.nonce === request.nonce, "REVISION_NEGOTIATION_NONCE_MISMATCH");
  const versions={...NEGOTIATION_VERSIONS,storagePolicyVersion:request.negotiation.storagePolicyVersion};
  const pilot=request.negotiation.storagePolicyVersion>=2?n.selectiveReuse:undefined;
  if(request.negotiation.storagePolicyVersion>=2)proof(pilot?.version===1&&pilot.policy==="attendance-runtime-v1"&&typeof pilot.enabled==="boolean"&&Array.isArray(pilot.appViewIds)&&new Set(pilot.appViewIds).size===pilot.appViewIds.length);
  const generic=request.negotiation.storagePolicyVersion===3?n.genericReuse:undefined;
  if(request.negotiation.storagePolicyVersion===3)proof(generic?.version===1&&generic.policy==="verified-coverage-runtime-v1"&&typeof generic.enabled==="boolean"&&Array.isArray(generic.views)&&new Set(generic.views.map(v=>v.appViewId)).size===generic.views.length,"REVISION_GENERIC_REUSE_INCOMPATIBLE");
  const enabled=pilot?.enabled===true||generic?.enabled===true;
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
  if(generic)proof(generic.views.every(v=>v&&typeof v.appViewId==="string"&&Array.isArray(v.kinds)&&v.kinds.length>0&&new Set(v.kinds).size===v.kinds.length&&v.kinds.every(k=>GENERIC_COVERAGE_KINDS.includes(k as GenericCoverageKind)&&raw.experiences.some(e=>e.appViewId===v.appViewId&&genericKindsForExperience(e).includes(k))))&&(!generic.enabled?generic.views.length===0:generic.views.length>0),"REVISION_GENERIC_REUSE_SCOPE_MISMATCH");
  if(pilot)proof(pilot.appViewIds.every(id=>typeof id==="string"&&raw.experiences.some(e=>e.appViewId===id&&(e as unknown as {workflowKey:string}).workflowKey==="attendance"))&&(!pilot.enabled?pilot.appViewIds.length===0:pilot.appViewIds.length>0),"REVISION_REUSE_SCOPE_MISMATCH");
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
  attestations.set(manifest, { bindingFingerprint,session, requestFingerprint: n.requestFingerprint, compatible: true, reuseViewIds:pilot?.enabled?[...pilot.appViewIds]:[],genericViews:generic?.enabled?generic.views.map(v=>({...v,kinds:[...v.kinds]})):[] });
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
      const argument = (args[0] ?? {}) as ReceiptContext & {context?:ReceiptContext};
      const context = key === "commitRevisionReceipt" && argument.context ? argument.context : argument;
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
            if (observation?.status === "match_shadow" && (observation.coverage !== "partial" || observation.windowPrepared===true&&receipt?.coverage.completeWindow===true) && observation.coverage !== "unprepared" && receipt && ledger.get(receipt.snapshotId) === await receiptIdentity(receipt, attestation)) matched++; else rejected++;
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


export const GENERIC_COVERAGE_KINDS = ["metadata-only","field-options-and-direct-catalogs","context-required","state-update-snapshot","state-update-current","unfiltered-collection","exact-query-window"] as const;
export type GenericCoverageKind = typeof GENERIC_COVERAGE_KINDS[number];

/** A coverage predicate, not a second cache/ledger. Caller verifies and consumes inside its inspector transaction. */
export async function canConsumeGenericReceipt(input:{manifest:RevisionManifest;receipt:Receipt;appViewId:string;kind:GenericCoverageKind;storage:object;isCurrent():boolean}) {
  const {manifest,receipt,appViewId,kind,storage,isCurrent}=input,attestation=attestations.get(manifest);
  if(!isCurrent()||!attestation?.genericViews.some(v=>v.appViewId===appViewId&&v.kinds.includes(kind))||receipt.coverage.kind!==kind||receipt.status!=="verified"||
    (kind==="exact-query-window"?receipt.coverage.completeWindow!==true:receipt.coverage.complete!==true))return false;
  if(!same(receipt.scope,{...manifest.scope,ownerKey:`${manifest.scope.organizationId}:${manifest.scope.userId}`}))return false;
  const remote=receipt.remote as {epoch?:string;vector?:string;metadata?:string};
  if(remote.epoch!==manifest.epoch||remote.vector!==manifest.readBindingVector.revision||remote.metadata!==manifest.readDefinitionsRevision)return false;
  return isCurrent()&&runtimeReceipts.get(storage)?.get(receipt.snapshotId)===await receiptIdentity(receipt,attestation)&&
    await revisionHash(manifestBinding(manifest))===attestation.bindingFingerprint&&isCurrent();
}

function genericKindsForExperience(view:{appViewId:string}):readonly string[] {
  const {type,workflowKey}=view as typeof view&{type?:string;workflowKey?:string};
  if(type==="RECORDS")return ["metadata-only","field-options-and-direct-catalogs","unfiltered-collection"];
  if(type==="PANEL"||type==="REPORT")return ["metadata-only","exact-query-window"];
  if(type==="WORKFLOW"&&workflowKey==="attendance")return ["field-options-and-direct-catalogs"];
  if(type==="WORKFLOW"&&workflowKey==="state-update")return ["field-options-and-direct-catalogs","context-required","state-update-snapshot","state-update-current"];
  return [];
}
