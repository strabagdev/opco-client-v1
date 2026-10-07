import { buildStateUpdateCoverageScope } from "../lib/app-view-definitions-cache";
import { getExperienceActivitySnapshot, type ExperienceActivitySnapshot, type StateUpdateVisibleCoverageContext } from "../lib/experience-activity";
import { fingerprintDiagnosticValue, type LocalDatabase } from "../lib/local-db";
import { formatStateUpdateDiagnosticsCopyText, type DiagnosticCopySection } from "./state-update-diagnostics-copy";

type CoverageCopyStore = Pick<LocalDatabase, "getAppViews" | "getAppViewDefinition" | "getStateUpdateSnapshotCoverage" | "getSyncTelemetry">;

async function readCoverageSection(
  store: CoverageCopyStore,
  context: StateUpdateVisibleCoverageContext,
  origin: "home_local_today" | "visible_workflow",
): Promise<DiagnosticCopySection> {
  const { scope, sourceEntityTypeId } = context;
  const coverage = await store.getStateUpdateSnapshotCoverage(scope);
  const source = await store.getSyncTelemetry({ ownerKey: scope.ownerKey, contractId: scope.contractId, entityTypeId: sourceEntityTypeId });
  return {
    title: `STATE_UPDATE ${origin} latest coverage ${fingerprintDiagnosticValue(scope.appViewId)}`,
    rows: [
      ["context", origin],
      ["ownerFingerprint", fingerprintDiagnosticValue(scope.ownerKey)],
      ["contractFingerprint", fingerprintDiagnosticValue(scope.contractId)],
      ["appViewFingerprint", fingerprintDiagnosticValue(scope.appViewId)],
      ["targetEntityFingerprint", fingerprintDiagnosticValue(scope.targetEntityTypeId)],
      ["sourceEntityFingerprint", fingerprintDiagnosticValue(sourceEntityTypeId)],
      ["dateFieldFingerprint", fingerprintDiagnosticValue(scope.dateFieldId ?? null)],
      ["uniqueness", scope.uniqueness ?? null],
      ["historyMode", scope.historyMode ?? null],
      ["queriedDate", scope.date ?? "all"],
      ["markerPresent", coverage !== null],
      ["status", coverage?.status ?? "absent"],
      ["contentVerified", coverage?.contentVerified ?? null],
      ["downloadedThroughPage", coverage?.downloadedThroughPage ?? null],
      ["pageSize", coverage?.pageSize ?? null],
      ["total", coverage?.total ?? null],
      ["lastSuccessfulRefreshAt", coverage?.lastSuccessfulRefreshAt ?? null],
      ["coverageMeaning", "latest unfiltered query; not subjects/current completeness"],
      ["subjectsLastFullRefreshAt", source?.lastFullRefreshCompletedAt ?? null],
      ["subjectsAvailability", source?.lastFullRefreshCompletedAt ? "previous_full_refresh" : "unverified"],
      ["currentCompleteness", "not_certified"],
    ],
  };
}

/** Only local metadata reads; no preparation, record values or remote requests. */
export async function readStateUpdateCoverageCopySections({
  store, ownerKey, contractId, date,
}: {
  store: CoverageCopyStore;
  ownerKey: string;
  contractId: string;
  date: string;
}): Promise<DiagnosticCopySection[]> {
  const assigned = await store.getAppViews(ownerKey, contractId);
  const sections: DiagnosticCopySection[] = [];
  for (const view of assigned?.views ?? []) {
    if (view.type !== "WORKFLOW" || view.config.workflowKey !== "state-update") continue;
    const cached = await store.getAppViewDefinition(ownerKey, contractId, view.id);
    if (cached?.definition.kind !== "state-update") continue;
    const definition = cached.definition;
    sections.push(await readCoverageSection(store, {
      scope: buildStateUpdateCoverageScope({ ownerKey, contractId, appViewId: view.id, date }, definition),
      sourceEntityTypeId: definition.sourceEntityTypeId,
    }, "home_local_today"));
  }
  return sections.length ? sections : [{
    title: "STATE_UPDATE home_local_today latest coverage",
    rows: [["availability", "no_cached_state_update_definition"], ["currentCompleteness", "not_certified"]],
  }];
}

export async function readVisibleStateUpdateCoverageCopySection({
  store, ownerKey, contractId, visibleAppViewId, experience,
}: {
  store: CoverageCopyStore;
  ownerKey: string;
  contractId: string;
  visibleAppViewId: string | null;
  experience: ExperienceActivitySnapshot;
}): Promise<DiagnosticCopySection> {
  const context = experience.stateUpdateCoverage;
  const available = context && visibleAppViewId &&
    experience.appViewType === "WORKFLOW" && experience.appViewId === visibleAppViewId &&
    context.scope.appViewId === visibleAppViewId &&
    context.scope.ownerKey === ownerKey && context.scope.contractId === contractId &&
    experience.scopeKey === `${ownerKey}\u0000${contractId}\u0000${visibleAppViewId}`;
  if (!available) return {
    title: "STATE_UPDATE visible_workflow coverage context",
    rows: [
      ["context", "visible_workflow"],
      ["availability", "unavailable"],
      ["reason", "no_matching_visible_state_update_context"],
      ["visibleWarningExplanation", "not_established; home marker does not explain visible workflow warning"],
      ["currentCompleteness", "not_certified"],
    ],
  };
  return readCoverageSection(store, context, "visible_workflow");
}

/** Shared copy-button path. Read the visible context at click time, never from the clock. */
export async function copyStateUpdateDiagnosticsWithCoverage({
  copyText, copyToClipboard, store, ownerKey, contractId, visibleAppViewId, homeDate,
  getVisibleExperience = getExperienceActivitySnapshot,
}: {
  copyText: string;
  copyToClipboard(text: string): Promise<void>;
  store: CoverageCopyStore;
  ownerKey: string | null;
  contractId: string | null;
  visibleAppViewId: string | null;
  homeDate: string;
  getVisibleExperience?: () => ExperienceActivitySnapshot;
}) {
  const experience = getVisibleExperience();
  const sections = ownerKey && contractId ? [
    { title: "Coverage query context", rows: [["homeDateSource", "local_today"], ["homeDate", homeDate], ["visibleDateSource", "workflow_context; never_clock"]] } satisfies DiagnosticCopySection,
    ...await readStateUpdateCoverageCopySections({ store, ownerKey, contractId, date: homeDate }),
    await readVisibleStateUpdateCoverageCopySection({ store, ownerKey, contractId, visibleAppViewId, experience }),
  ] : [{
    title: "STATE_UPDATE coverage context",
    rows: [["availability", "context_unavailable"], ["visibleWarningExplanation", "not_established; home marker does not explain visible workflow warning"]],
  } satisfies DiagnosticCopySection];
  await copyToClipboard(`${copyText}\n\n${formatStateUpdateDiagnosticsCopyText(sections)}`);
}
