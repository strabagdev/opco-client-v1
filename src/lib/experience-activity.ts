import type { StateUpdateScope } from "./state-update-offline";
import type { AppViewType } from "./opco-api";

export type ExperienceActivityResult = "idle" | "running" | "success" | "partial" | "error" | "cancelled";

export type ExperienceActivityRun = {
  id: string;
  startedAt: string;
};

export type StateUpdateVisibleCoverageContext = {
  scope: StateUpdateScope;
  sourceEntityTypeId: string;
};

export type ExperienceActivitySnapshot = {
  stateUpdateCoverage?: StateUpdateVisibleCoverageContext | null;
  activeRuns: ExperienceActivityRun[];
  readCount?: number;
  readMode?: "initial" | "refresh";
  appViewId: string | null;
  appViewTitle: string | null;
  appViewType: AppViewType | null;
  errorCode: string | null;
  result: ExperienceActivityResult;
  scopeKey: string | null;
  updatedAt: string | null;
};

const emptySnapshot: ExperienceActivitySnapshot = {
  activeRuns: [],
  appViewId: null,
  appViewTitle: null,
  appViewType: null,
  errorCode: null,
  result: "idle",
  scopeKey: null,
  updatedAt: null,
};

let snapshot = emptySnapshot;
let runSequence = 0;
let activeReporterId: string | undefined;
const listeners = new Set<() => void>();

export function activateExperienceActivityScope({
  appViewId,
  appViewTitle,
  appViewType,
  scopeKey,
  reporterId,
}: {
  reporterId?: string;
  appViewId: string | null;
  appViewTitle: string;
  appViewType: AppViewType | null;
  scopeKey: string;
}) {
  if (snapshot.scopeKey === scopeKey && activeReporterId === reporterId) return;
  activeReporterId = reporterId;
  setSnapshot({
    activeRuns: [],
    appViewId,
    appViewTitle,
    appViewType,
    errorCode: null,
    result: "idle",
    scopeKey,
    updatedAt: new Date().toISOString(),
  });
}

export function reportExperienceActivity({
  activeCount,
  errorCode,
  result,
  scopeKey,
  stateUpdateCoverage = null,
  reporterId,
  readCount,
  readMode,
}: {
  reporterId?: string;
  readCount?: number;
  readMode?: "initial" | "refresh";
  stateUpdateCoverage?: StateUpdateVisibleCoverageContext | null;
  activeCount: number;
  errorCode: string | null;
  result: Exclude<ExperienceActivityResult, "idle" | "running"> | null;
  scopeKey: string;
}) {
  if (snapshot.scopeKey !== scopeKey || activeReporterId !== reporterId) return;
  const nextCount = Math.max(0, activeCount);
  const activeRuns = snapshot.activeRuns.slice(0, nextCount);

  while (activeRuns.length < nextCount) {
    runSequence += 1;
    activeRuns.push({ id: `experience-run-${runSequence}`, startedAt: new Date().toISOString() });
  }

  const nextResult = nextCount > 0 ? "running" : errorCode ? "error" : result ?? snapshot.result;
  const nextErrorCode = errorCode ?? (nextCount === 0 && result === "success" ? null : snapshot.errorCode);
  if (
    readCount === snapshot.readCount &&
    readMode === snapshot.readMode &&
    activeRuns.length === snapshot.activeRuns.length &&
    nextResult === snapshot.result &&
    nextErrorCode === snapshot.errorCode &&
    stateUpdateCoverage === (snapshot.stateUpdateCoverage ?? null)
  ) return;

  setSnapshot({
    ...snapshot,
    stateUpdateCoverage,
    readCount,
    readMode,
    activeRuns,
    errorCode: nextErrorCode,
    result: nextResult,
    updatedAt: new Date().toISOString(),
  });
}

export function leaveExperienceActivityScope(scopeKey: string, reporterId?: string) {
  if (snapshot.scopeKey === scopeKey && activeReporterId === reporterId) {
    activeReporterId = undefined;
    setSnapshot(emptySnapshot);
  }
}

export function getExperienceActivitySnapshot() {
  return snapshot;
}

export function subscribeExperienceActivity(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetExperienceActivityForTests() {
  snapshot = emptySnapshot;
  activeReporterId = undefined;
  runSequence = 0;
  listeners.clear();
}

function setSnapshot(next: ExperienceActivitySnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}
