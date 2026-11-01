import type { AppViewPrewarmStore } from "./app-view-prewarm";
import type { AppView } from "./opco-api";
import { currentMonthDateKeys } from "./attendance-snapshot-cache";
import { preparedPresentationAvailable } from "./subject-presentation-cache";

/** Order-independent objects; ordered configured arrays retain their meaning. Memory only. */
export function preparationSignature(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

export function homePreparationDay(appView: AppView, day: string) {
  return appView.type === "WORKFLOW" && (appView.config.workflowKey === "attendance" || Boolean(appView.config.dateFieldId)) ? day : "";
}

/** Local proof of the preparer's bounded output. Never evidence of remote freshness. */
export async function homePreparationProof(store: AppViewPrewarmStore, ownerKey: string, contractId: string, appView: AppView, day: string): Promise<string | null> {
  try {
    const cached = await store.getAppViewDefinition(ownerKey, contractId, appView.id);
    if (!cached || cached.status !== "ready" || preparationSignature(cached.definition.appView) !== preparationSignature(appView)) return null;
    const prepared = cached.definition;
    if (prepared.kind === "records" || prepared.kind === "unsupported") return preparationSignature(prepared);
    if (prepared.kind !== "state-update") return null;
    if (!store.getSyncTelemetry || !(await store.getSyncTelemetry({ ownerKey, contractId, entityTypeId: prepared.sourceEntityTypeId }))?.lastFullRefreshCompletedAt) return null;
    const scope = { ownerKey, contractId, appViewId: appView.id, targetEntityTypeId: prepared.targetEntityTypeId,
      sourceEntityTypeId: prepared.sourceEntityTypeId, date: prepared.dateFieldId ? day : undefined,
      dateFieldId: prepared.dateFieldId, uniqueness: prepared.uniqueness, historyMode: prepared.historyMode };
    if (!await preparedPresentationAvailable(store, scope, prepared)) return null;
    if (appView.type === "WORKFLOW" && appView.config.workflowKey === "attendance") {
      if (!store.getAttendanceDaySnapshotHydration) return null;
      // All required days, including the observation proof already checked when each marker was written.
      for (const date of currentMonthDateKeys(new Date(`${day}T12:00:00`))) {
        if (!(await store.getAttendanceDaySnapshotHydration({ ...scope, date }))?.lastSuccessfulRefreshAt) return null;
      }
      return preparationSignature(prepared);
    }
    if (prepared.uniqueness === "subject-date-fields") {
      // Home prepares source/definition only. Context coverage belongs to its existing selected-context preparer.
      return preparationSignature(prepared);
    }
    if (prepared.uniqueness === "subject" && prepared.historyMode === "append" && prepared.dateFieldId) {
      const coverage = await store.getStateUpdateCurrentCoverage?.(scope);
      if (!coverage || coverage.status !== "complete" || !coverage.sourceComplete ||
        Object.keys(coverage.subjects).length !== coverage.totalSubjects || Object.values(coverage.subjects).some(subject => subject.status !== "verified")) return null;
      return preparationSignature(prepared);
    }
    const coverage = await store.getStateUpdateSnapshotCoverage?.(scope);
    // A bounded latest page may stay partial. Reuse that same output without upgrading its coverage.
    if (!coverage) return null;
    return preparationSignature([prepared, coverage]);
  } catch {
    return null; // Missing/unreadable proof never authorizes reuse.
  }
}
