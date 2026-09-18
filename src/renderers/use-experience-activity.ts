import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  activateExperienceActivityScope,
  getExperienceActivitySnapshot,
  leaveExperienceActivityScope,
  reportExperienceActivity,
  subscribeExperienceActivity,
  type ExperienceActivityResult,
} from "@/lib/experience-activity";
import type { AppView } from "@/lib/opco-api";
import { useSession } from "@/state/session";

export function useExperienceActivityReporter(appView: AppView, {
  activeCount,
  errorCode,
  result,
}: {
  activeCount: number;
  errorCode: string | null;
  result: Exclude<ExperienceActivityResult, "idle" | "running"> | null;
}) {
  const { ownerKey, selectedContractId } = useSession();
  const scopeKey = useMemo(
    () => ownerKey && selectedContractId ? `${ownerKey}\u0000${selectedContractId}\u0000${appView.id}` : null,
    [appView.id, ownerKey, selectedContractId],
  );

  useEffect(() => {
    if (!scopeKey) return;
    activateExperienceActivityScope({
      appViewId: appView.id,
      appViewTitle: appView.name,
      appViewType: appView.type,
      scopeKey,
    });
    return () => leaveExperienceActivityScope(scopeKey);
  }, [appView.id, appView.name, appView.type, scopeKey]);

  useEffect(() => {
    if (!scopeKey) return;
    reportExperienceActivity({ activeCount, errorCode, result, scopeKey });
  }, [activeCount, errorCode, result, scopeKey]);
}

export function useExperienceActivitySnapshot() {
  return useSyncExternalStore(subscribeExperienceActivity, getExperienceActivitySnapshot, getExperienceActivitySnapshot);
}
