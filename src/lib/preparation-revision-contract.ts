import { revisionCanonical } from "./revision-receipts";
import type { AppView } from "./opco-api";
import type { PreparedAppViewDefinition } from "./app-view-definitions-cache";
import type { ReceiptArtifact, ReceiptContext, ReceiptExpected } from "./revision-receipt-storage";
import type { ReadRevision, RevisionManifest, RevisionResource, RevisionScope } from "./revision-receipts";
import type { StateUpdateCurrentCoverageScope, StateUpdateScope } from "./state-update-offline";

/** Complete means this declared preparation, never arbitrary offline queries or write authorization. */
export type PreparationCoverage = {
  version: 1;
  kind: "metadata-only" | "context-required" | "attendance-month" | "state-update-snapshot" | "state-update-current";
  complete: true;
  scope: "ordinary-preparation";
  businessDataIncluded: boolean;
  arbitraryQueries: false;
  relationCatalogs: false;
  latest: "not-included" | "complete-snapshot" | "bounded-first-page";
  dates: string[];
  sourceEntityTypeId?: string;
  subjectCount?: number;
};
export type PreparationPart = {
  resource: RevisionResource;
  artifact: ReceiptArtifact;
  expected: ReceiptExpected;
  reads: ReadRevision[];
};
export type PreparationMarker =
  | { kind: "attendance"; scope: StateUpdateScope & { date: string } }
  | { kind: "snapshot"; scope: StateUpdateScope; total: number }
  | { kind: "current"; scope: StateUpdateCurrentCoverageScope; subjects: Record<string, string | null> };
export type PreparationPlan = {
  appView: AppView;
  prepared: PreparedAppViewDefinition;
  coverage: PreparationCoverage;
  parts: PreparationPart[];
  markers: PreparationMarker[];
};
export type PreparationRevisionReceipt = {
  version: 1;
  mode: "shadow";
  reuseAllowed: false;
  runId: string;
  snapshotId: string;
  scope: RevisionScope;
  appViewId: string;
  coverage: PreparationCoverage;
  remote: { epoch: string; vector: string; metadata: string };
  parts: Omit<PreparationPart, "expected">[];
  markers: PreparationMarker[];
  localHash: string;
  verifiedAt: string;
  status: "verified" | "invalid";
  invalidReason?: string;
};
export type PreparationRevisionObservation = {
  status: "match_shadow" | "remote_unchecked" | "invalid";
  reason: string | null;
  receipt: PreparationRevisionReceipt | null;
  reuseAllowed: false;
};
export type PreparationRevisionContext = ReceiptContext & { runId: string };
export type PreparationReceiptRequest = {
  appViewId: string;
  kind: PreparationCoverage["kind"];
  dates: string[];
  snapshotId?: string;
  identity?: StateUpdateScope["identity"];
  definition?: AppView;
};
export type PreparationInspection = { scope: RevisionScope; manifest?: RevisionManifest; request?: PreparationReceiptRequest; isCurrent(): boolean;
  /** Internal read-only consumption point: runs under the same SQLite transaction as verification. */
  onVerified?(receipt:PreparationRevisionReceipt, storage:object, prepared:PreparedAppViewDefinition):Promise<void>;
};

/** Compare requested coverage, independently of content integrity and remote freshness. */
export function matchesPreparationRequest(receipt: Pick<PreparationRevisionReceipt,"appViewId"|"coverage"|"markers"|"snapshotId">, request: PreparationReceiptRequest, prepared: PreparedAppViewDefinition) {
  if (receipt.appViewId !== request.appViewId || receipt.coverage.kind !== request.kind ||
      revisionCanonical(receipt.coverage.dates) !== revisionCanonical(request.dates) ||
      request.snapshotId !== undefined && receipt.snapshotId !== request.snapshotId ||
      request.definition !== undefined && revisionCanonical(request.definition) !== revisionCanonical(prepared.appView)) return false;
  const identities = receipt.markers.map(marker => marker.scope.identity);
  if (request.identity) return identities.length > 0 && identities.every(identity => revisionCanonical(identity) === revisionCanonical(request.identity));
  return identities.every(identity => identity === undefined);
}

/** Persisted metadata is untrusted input too: never promote a different coverage silently. */
export function isPreparationCoverage(value: unknown): value is PreparationCoverage {
  const c = value as PreparationCoverage;
  const kinds = ["metadata-only", "context-required", "attendance-month", "state-update-snapshot", "state-update-current"];
  if (!c || c.version !== 1 || !kinds.includes(c.kind) || c.complete !== true || c.scope !== "ordinary-preparation" ||
      c.arbitraryQueries !== false || c.relationCatalogs !== false || !Array.isArray(c.dates) || new Set(c.dates).size !== c.dates.length ||
      c.businessDataIncluded !== ["attendance-month", "state-update-snapshot", "state-update-current"].includes(c.kind)) return false;
  if (c.dates.some(date => typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + "T00:00:00Z")) || new Date(date + "T00:00:00Z").toISOString().slice(0,10) !== date)) return false;
  if (c.kind === "metadata-only") return c.dates.length === 0 && c.latest === "not-included";
  if (typeof c.sourceEntityTypeId !== "string" || !c.sourceEntityTypeId || !Number.isInteger(c.subjectCount) || c.subjectCount! < 0) return false;
  if (c.kind === "context-required") return c.dates.length === 0 && c.latest === "not-included";
  if (c.kind === "attendance-month") {
    if (!c.dates.length || c.latest !== "complete-snapshot") return false;
    const month = c.dates[0].slice(0,7), count = new Date(Number(month.slice(0,4)), Number(month.slice(5)), 0).getDate();
    return c.dates.length === count && c.dates.every((date,index) => date === month + "-" + String(index+1).padStart(2,"0"));
  }
  return c.dates.length <= 1 && c.latest === (c.kind === "state-update-current" ? "bounded-first-page" : "complete-snapshot");
}
