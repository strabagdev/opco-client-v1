import { parseSubjectPresentation, projectSubject, validSubjectProjection, verifyPresentationDefinition } from "./subject-presentation";
import { subjectPresentationView } from "./subject-presentation-display";
import { isPreparationCoverage, matchesPreparationRequest } from "./preparation-revision-contract";
import type * as SQLite from "expo-sqlite";
import type { ReceiptArtifact, ReceiptExpected, ReceiptContext } from "./revision-receipt-storage";
import type { RevisionScope } from "./revision-receipts";
import { assertRevisionMatches, assertRevisionScope, revisionCanonical, revisionHash, RevisionReceiptError } from "./revision-receipts";
import type { StateUpdateCurrentCoverageScope, StateUpdateScope } from "./state-update-offline";
import { normalizePreparedAppViewDefinition } from "./app-view-definitions-cache";
import type { PreparationMarker, PreparationPlan, PreparationRevisionContext, PreparationRevisionReceipt, PreparationRevisionObservation, PreparationInspection } from "./preparation-revision-contract";

type Database = Omit<SQLite.SQLiteDatabase, "withTransactionAsync"> & {
  withTransactionAsync(work: (tx: SQLite.SQLiteDatabase) => Promise<void>, name?: `transaction:${string}`): Promise<void>;
};
export type PreparationCoverageKeys = {
  attendanceDay?(scope: StateUpdateScope & { date: string }): string;
  stateSnapshot?(scope: StateUpdateScope): string;
  stateCurrent?(scope: StateUpdateCurrentCoverageScope): string;
};
type Dependencies = {
  active(db: SQLite.SQLiteDatabase, context: ReceiptContext): Promise<void>;
  materialize(db: SQLite.SQLiteDatabase, scope: RevisionScope, artifact: ReceiptArtifact, expected?: ReceiptExpected): Promise<unknown>;
  keys: PreparationCoverageKeys;
};
const PREFIX = "preparation_revision_receipt:v1:";
const statusKey = (ownerKey: string, contractId: string) => "preparation_revision_status:v1:" + JSON.stringify([ownerKey, contractId]);
const prefix = (owner: string, contract: string) => PREFIX + JSON.stringify([owner, contract]) + ":";
const same = (a: unknown, b: unknown) => revisionCanonical(a) === revisionCanonical(b);
function requireProof(value: unknown, code: string): asserts value {
  if (!value) throw new RevisionReceiptError(code);
}
async function write(db: SQLite.SQLiteDatabase, key: string, value: unknown) {
  await db.runAsync("INSERT INTO app_metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, JSON.stringify(value));
}
async function read(db: SQLite.SQLiteDatabase, key: string) {
  const row = await db.getFirstAsync<{value: string}>("SELECT value FROM app_metadata WHERE key=?", key);
  return row ? JSON.parse(row.value) as Record<string, unknown> : null;
}
function key(scope: RevisionScope, appViewId: string) {
  // A new coverage retires the old one for this experience; it cannot leave an old day looking current.
  return prefix(scope.ownerKey, scope.contractId) + JSON.stringify([scope.applicationId, scope.userId, appViewId]);
}
function markerKey(marker: PreparationMarker, keys: PreparationCoverageKeys) {
  const value = marker.kind === "attendance" ? keys.attendanceDay?.(marker.scope)
    : marker.kind === "snapshot" ? keys.stateSnapshot?.(marker.scope) : keys.stateCurrent?.(marker.scope);
  requireProof(value, "PREPARATION_COVERAGE_KEY_UNAVAILABLE");
  return value;
}
async function markers(db: SQLite.SQLiteDatabase, input: PreparationMarker[], scope: RevisionScope, keys: PreparationCoverageKeys) {
  const result = [];
  for (const marker of input) {
    requireProof(marker.scope.ownerKey === scope.ownerKey && marker.scope.contractId === scope.contractId, "REVISION_SCOPE_MISMATCH");
    const value = await read(db, markerKey(marker, keys));
    if (marker.kind === "attendance") requireProof(typeof value?.lastSuccessfulRefreshAt === "string", "PREPARATION_DAY_UNVERIFIED");
    else if (marker.kind === "snapshot") requireProof(value?.status === "complete" && value.total === marker.total && value.downloadedThroughPage === 1, "PREPARATION_SNAPSHOT_INCOMPLETE");
    else {
      const outcomes = value?.subjects as Record<string, {status?: string; remoteRecordId?: string | null}> | undefined;
      requireProof(value?.status === "complete" && value.sourceComplete === true && outcomes && value.totalSubjects === Object.keys(marker.subjects).length &&
        Object.keys(outcomes).length === Object.keys(marker.subjects).length && Object.entries(marker.subjects).every(([id, remoteId]) => outcomes[id]?.status === "verified" && outcomes[id].remoteRecordId === remoteId), "PREPARATION_CURRENT_INCOMPLETE");
    }
    result.push({key: markerKey(marker, keys), value});
  }
  return result;
}

export function createPreparationRevisionStorage(getDatabase: () => Promise<Database>, dependencies: Dependencies) {
  async function content(db: SQLite.SQLiteDatabase, scope: RevisionScope, receipt: Pick<PreparationRevisionReceipt, "appViewId" | "coverage" | "parts" | "markers">, expected?: PreparationPlan) {
    requireProof(isPreparationCoverage(receipt.coverage) && receipt.parts.length > 0 && receipt.parts.filter(p=>p.artifact.kind === "views").length === 1, "PREPARATION_COVERAGE_INCOMPATIBLE");
    for (const part of receipt.parts) {
      requireProof(part.artifact.kind === "workflow" ? ["attendance","state-update"].includes(part.resource.kind) && part.resource.appViewId === receipt.appViewId && part.artifact.scope.appViewId === receipt.appViewId : part.artifact.kind === part.resource.kind, "PREPARATION_COVERAGE_INCOMPATIBLE");
      if (part.artifact.kind === "definition" || part.artifact.kind === "records") requireProof(part.artifact.entityTypeId === part.resource.entityTypeId, "PREPARATION_COVERAGE_INCOMPATIBLE");
    }
    requireProof(receipt.markers.every(m=>m.scope.appViewId === receipt.appViewId), "REVISION_SCOPE_MISMATCH");
    if (receipt.coverage.sourceEntityTypeId) {
      requireProof(receipt.parts.some(p=>p.artifact.kind === "definition" && p.artifact.entityTypeId === receipt.coverage.sourceEntityTypeId) &&
        receipt.parts.some(p=>p.artifact.kind === "records" && p.artifact.entityTypeId === receipt.coverage.sourceEntityTypeId && p.artifact.total === receipt.coverage.subjectCount), "PREPARATION_SOURCE_INCOMPLETE");
    }
    if (receipt.coverage.kind === "attendance-month") requireProof(receipt.markers.length === receipt.coverage.dates.length && receipt.markers.every(m=>m.kind === "attendance") && receipt.coverage.dates.every(date=>receipt.markers.some(m=>m.kind === "attendance" && m.scope.date === date)), "PREPARATION_DAYS_INCOMPLETE");
    if (receipt.coverage.kind === "state-update-current") requireProof(receipt.markers.length === 1 && receipt.markers[0].kind === "current" && Object.keys(receipt.markers[0].subjects).length === receipt.coverage.subjectCount, "PREPARATION_CURRENT_INCOMPLETE");
    if (receipt.coverage.kind === "state-update-snapshot") requireProof(receipt.markers.length === 1 && receipt.markers[0].kind === "snapshot", "PREPARATION_SNAPSHOT_INCOMPLETE");
    if (!receipt.coverage.businessDataIncluded) requireProof(receipt.markers.length === 0 && !receipt.parts.some(p=>p.artifact.kind === "workflow"), "PREPARATION_COVERAGE_INCOMPATIBLE");
    const definition = await db.getFirstAsync<{definition_json: string; status: string}>(
      "SELECT definition_json,status FROM app_view_definitions WHERE owner_key=? AND contract_id=? AND app_view_id=?", scope.ownerKey, scope.contractId, receipt.appViewId);
    requireProof(definition?.status === "ready", "PREPARATION_DEFINITION_UNAVAILABLE");
    const prepared = JSON.parse(definition.definition_json);
    if (expected) requireProof(same(prepared, normalizePreparedAppViewDefinition(expected.prepared)) && same(prepared.appView, expected.appView), "PREPARATION_DEFINITION_MISMATCH");
    const parts = [];
    for (let index = 0; index < receipt.parts.length; index++) {
      const part = receipt.parts[index];
      requireProof(part.reads.length > 0, "READ_REVISION_INCOMPATIBLE");
      parts.push(await dependencies.materialize(db, scope, part.artifact, expected?.parts[index].expected));
    }
    const viewsIndex = receipt.parts.findIndex(part=>part.artifact.kind === "views");
    const views = parts[viewsIndex] as {id:string}[];
    requireProof(Array.isArray(views) && same(views.find(view=>view.id === receipt.appViewId), prepared.appView), "PREPARATION_ASSIGNMENTS_CHANGED");
    // Prepared visual projections participate too; another update cannot leave the aggregate valid.
    const presentations = await db.getAllAsync<{key: string; value: string}>(
      "SELECT key,value FROM app_metadata WHERE substr(key,1,length(?))=? ORDER BY key", "subject_presentation:v1:", "subject_presentation:v1:");
    const visual = presentations.filter(row => {
      try {const p = JSON.parse(row.key.slice("subject_presentation:v1:".length)); return p[0] === scope.ownerKey && p[1] === scope.contractId && p[2] === receipt.appViewId;} catch {return false;}
    });
    if (prepared.appView?.config?.subjectPresentation !== undefined && receipt.coverage.sourceEntityTypeId) {
      const config = parseSubjectPresentation(prepared.appView.config.subjectPresentation)!;
      const definition = verifyPresentationDefinition(prepared.subjectPresentation, receipt.coverage.sourceEntityTypeId, config);
      const source = await db.getAllAsync<{server_id:string;display_name:string;values_json:string;remote_updated_at:string|null}>(
        "SELECT server_id,display_name,values_json,remote_updated_at FROM entity_records WHERE owner_key=? AND contract_id=? AND entity_type_id=?", scope.ownerKey, scope.contractId, receipt.coverage.sourceEntityTypeId);
      for (const row of source) {
        const derived = projectSubject(definition, row.server_id, JSON.parse(row.values_json), [], row.remote_updated_at ?? undefined);
        const existing = visual.find(entry=>{const key=JSON.parse(entry.key.slice("subject_presentation:v1:".length));return key[4] === definition.fingerprint && key[5] === row.server_id;});
        const cached: unknown = existing ? JSON.parse(existing.value) : null;
        requireProof(!existing || validSubjectProjection(cached,definition,row.server_id) && same(cached.cells,derived.cells), "PREPARATION_PRESENTATION_UNVERIFIED");
        const presentation = cached && validSubjectProjection(cached,definition,row.server_id) ? cached : derived;
        requireProof(subjectPresentationView({id:row.server_id,displayName:row.display_name,presentation},config,definition).complete, "PREPARATION_PRESENTATION_UNVERIFIED");
      }
    }
    return {prepared, coverage: receipt.coverage, parts, markers: await markers(db, receipt.markers, scope, dependencies.keys), visual};
  }
  return {
    async retirePreparationRevisionReceipts(ownerKey: string, contractId: string, reason: string, isCurrent: () => boolean = () => true) {
      const db = await getDatabase(), start = prefix(ownerKey, contractId);
      await db.withTransactionAsync(async tx => {
        requireProof(isCurrent(), "REVISION_SCOPE_RETIRED");
        const rows = await tx.getAllAsync<{key: string; value: string}>("SELECT key,value FROM app_metadata WHERE substr(key,1,length(?))=?", start, start);
        for (const row of rows) {
          try {await write(tx, row.key, {...JSON.parse(row.value), status: "invalid", invalidReason: reason});} catch { /* Corrupt metadata never certifies anything. */ }
        }
        requireProof(isCurrent(), "REVISION_SCOPE_RETIRED");
      }, "transaction:preparation-revision-retire");
    },
    async recordPreparationRevisionStatus(ownerKey: string, contractId: string, input: {runId: string; appViewId?: string; status: "emitted" | "rejected" | "unavailable"; reason: string | null}) {
      const reason = input.reason && /^[A-Z][A-Z0-9_]{0,79}$/.test(input.reason) ? input.reason : input.reason ? "PREPARATION_REVISION_FAILED" : null;
      const safe = {at: new Date().toISOString(), runId: input.runId, viewFingerprint: input.appViewId ? (await revisionHash(input.appViewId)).slice(0, 12) : null, status: input.status, reason};
      const db = await getDatabase();
      await db.withTransactionAsync(async tx => {
        const previous = await read(tx, statusKey(ownerKey, contractId));
        const entries = Array.isArray(previous?.entries) ? previous.entries : [];
        await write(tx, statusKey(ownerKey, contractId), {version: 1, reuseAllowed: false, entries: [...entries.slice(-99), safe]});
      }, "transaction:preparation-revision-status");
    },
    async getPreparationRevisionStatus(ownerKey: string, contractId: string) {
      return read(await getDatabase(), statusKey(ownerKey, contractId));
    },
    async commitPreparationRevisionReceipt(context: PreparationRevisionContext, plan: PreparationPlan) {
      assertRevisionScope(context.scope, context.manifest);
      requireProof(isPreparationCoverage(plan.coverage) && plan.parts.length > 0, "PREPARATION_COVERAGE_INCOMPATIBLE");
      for (const part of plan.parts) {
        requireProof(part.reads.length > 0, "READ_REVISION_INCOMPATIBLE");
        for (const seal of part.reads) {assertRevisionMatches(context.manifest, seal); requireProof(seal.revision === part.reads[0].revision, "REVISION_PAGES_MIXED");}
      }
      const db = await getDatabase(); let receipt!: PreparationRevisionReceipt;
      await db.withTransactionAsync(async tx => {
        await dependencies.active(tx, context);
        const base = {appViewId: plan.appView.id, coverage: plan.coverage, parts: plan.parts.map(({expected: _expected, ...part}) => part), markers: plan.markers};
        const localHash = await revisionHash(await content(tx, context.scope, base, plan));
        await dependencies.active(tx, context);
        receipt = {...base, version: 1, mode: "shadow", reuseAllowed: false, runId: context.runId, snapshotId: crypto.randomUUID(), scope: context.scope,
          remote: {epoch: context.manifest.epoch, vector: context.manifest.readBindingVector.revision, metadata: context.manifest.readDefinitionsRevision}, localHash, verifiedAt: new Date().toISOString(), status: "verified"};
        await write(tx, key(context.scope, plan.appView.id), receipt);
      }, "transaction:preparation-revision-commit");
      return receipt;
    },
    async inspectPreparationRevisionReceipts(input: PreparationInspection): Promise<PreparationRevisionObservation[]> {
      const db = await getDatabase(), result: PreparationRevisionObservation[] = [], start = prefix(input.scope.ownerKey, input.scope.contractId);
      await db.withTransactionAsync(async tx => {
        requireProof(input.isCurrent(), "REVISION_SCOPE_RETIRED");
        if (input.manifest) assertRevisionScope(input.scope, input.manifest);
        const rows = await tx.getAllAsync<{key: string; value: string}>("SELECT key,value FROM app_metadata WHERE substr(key,1,length(?))=?", start, start);
        for (const row of rows) {
          let receipt: PreparationRevisionReceipt | null = null;
          try {
            receipt = JSON.parse(row.value) as PreparationRevisionReceipt;
            requireProof(receipt.version === 1 && receipt.mode === "shadow" && receipt.reuseAllowed === false && isPreparationCoverage(receipt.coverage), "PREPARATION_RECEIPT_INCOMPATIBLE");
            if (input.request && receipt.appViewId !== input.request.appViewId) continue;
            if (receipt.scope.applicationId !== input.scope.applicationId || receipt.scope.userId !== input.scope.userId) continue;
            requireProof(same(receipt.scope, input.scope), "REVISION_AUTHORIZATION_CHANGED");
            requireProof(receipt.status === "verified", receipt.invalidReason ?? "PREPARATION_RECEIPT_INVALID");
            const local = await content(tx, input.scope, receipt);
            requireProof(await revisionHash(local) === receipt.localHash, "REVISION_LOCAL_CONTENT_MISMATCH");
            if (input.manifest) requireProof(receipt.remote.epoch === input.manifest.epoch && receipt.remote.vector === input.manifest.readBindingVector.revision && receipt.remote.metadata === input.manifest.readDefinitionsRevision, "REVISION_REMOTE_CHANGED");
            if (input.request && !matchesPreparationRequest(receipt, input.request, local.prepared)) {
              // A valid November proof is not a December proof. Keep it for its own request.
              result.push({status:"invalid",reason:"PREPARATION_REQUEST_COVERAGE_MISMATCH",receipt:null,reuseAllowed:false});
              continue;
            }
            if(input.manifest)await input.onVerified?.(receipt,db,local.prepared);
            requireProof(input.isCurrent(),"REVISION_SCOPE_RETIRED");
            result.push({status: input.manifest ? "match_shadow" : "remote_unchecked", reason: null, receipt, reuseAllowed: false});
          } catch (error) {
            const reason = error instanceof RevisionReceiptError ? error.code : "PREPARATION_LOCAL_READ_FAILED";
            if (receipt) await write(tx, row.key, {...receipt, status: "invalid", invalidReason: reason});
            result.push({status: "invalid", reason, receipt: null, reuseAllowed: false});
          }
        }
        requireProof(input.isCurrent(), "REVISION_SCOPE_RETIRED");
      }, "transaction:preparation-revision-inspect");
      return result;
    },
  };
}
