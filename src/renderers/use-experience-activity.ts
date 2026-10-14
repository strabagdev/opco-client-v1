import { useCallback, useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useFocusEffect } from "expo-router";

import {
  activateExperienceActivityScope,
  getExperienceActivitySnapshot,
  leaveExperienceActivityScope,
  reportExperienceActivity,
  subscribeExperienceActivity,
  type ExperienceActivityResult,
  type StateUpdateVisibleCoverageContext,
} from "@/lib/experience-activity";
import type { AppView } from "@/lib/opco-api";
import { useSession } from "@/state/session";

type ActivityReport = {
  stateUpdateCoverage?: StateUpdateVisibleCoverageContext | null;
  activeCount: number;
  readCount?: number;
  readMode?: "initial" | "refresh";
  errorCode: string | null;
  result: Exclude<ExperienceActivityResult, "idle" | "running"> | null;
};

// Reuse the single visible activity scope. Reporter ownership prevents an outgoing
// route bootstrap or hidden screen from clearing/replacing the mounted renderer.
function useVisibleActivity(scopeKey: string | null, identity: {
  appViewId: string | null; appViewTitle: string; appViewType: AppView["type"] | null;
}, report: ActivityReport) {
  const reporterId = useId();
  const latest = useRef(report);
  useLayoutEffect(() => { latest.current = report; }, [report]);
  const { appViewId, appViewTitle, appViewType } = identity;
  useFocusEffect(useCallback(() => {
    if (!scopeKey) return;
    activateExperienceActivityScope({ appViewId, appViewTitle, appViewType, scopeKey, reporterId });
    reportExperienceActivity({ ...latest.current, scopeKey, reporterId });
    return () => leaveExperienceActivityScope(scopeKey, reporterId);
  }, [appViewId, appViewTitle, appViewType, reporterId, scopeKey]));
  const { activeCount, errorCode, result, readCount, readMode, stateUpdateCoverage } = report;
  useEffect(() => {
    if (scopeKey) reportExperienceActivity({ activeCount, errorCode, result, readCount, readMode, stateUpdateCoverage, scopeKey, reporterId });
  }, [activeCount, errorCode, readCount, readMode, reporterId, result, scopeKey, stateUpdateCoverage]);
}

export function useExperienceActivityReporter(appView: AppView, report: ActivityReport) {
  const { ownerKey, selectedContractId } = useSession();
  const scopeKey = ownerKey && selectedContractId ? `${ownerKey}\u0000${selectedContractId}\u0000${appView.id}` : null;
  useVisibleActivity(scopeKey, { appViewId: appView.id, appViewTitle: appView.name, appViewType: appView.type }, report);
}

export function useHomeReadActivity({ isLoading, hasContent, error }: { isLoading: boolean; hasContent: boolean; error: string | null }) {
  const { ownerKey, selectedContractId } = useSession();
  const scopeKey = ownerKey ? `${ownerKey}\u0000${selectedContractId ?? ""}\u0000home` : null;
  useVisibleActivity(scopeKey, { appViewId: null, appViewTitle: "Inicio", appViewType: null }, {
    activeCount: Number(isLoading), readCount: Number(isLoading), readMode: hasContent ? "refresh" : "initial",
    errorCode: error ? "HOME_READ_FAILED" : null, result: error ? "error" : isLoading ? null : "success",
  });
}

export function useExperienceBootstrapActivity(appViewId: string | undefined, { enabled, errorCode, isLoading }: {
  enabled: boolean; errorCode: string | null; isLoading: boolean;
}) {
  const { ownerKey, selectedContractId } = useSession();
  const scopeKey = enabled && appViewId && ownerKey && selectedContractId ? `${ownerKey}\u0000${selectedContractId}\u0000${appViewId}` : null;
  useVisibleActivity(scopeKey, { appViewId: appViewId ?? null, appViewTitle: "Experiencia", appViewType: null }, {
    activeCount: Number(isLoading), readCount: Number(isLoading), readMode: "initial", errorCode,
    result: errorCode ? "error" : isLoading ? null : "success",
  });
}

export function useExperienceActivitySnapshot() {
  return useSyncExternalStore(subscribeExperienceActivity, getExperienceActivitySnapshot, getExperienceActivitySnapshot);
}
