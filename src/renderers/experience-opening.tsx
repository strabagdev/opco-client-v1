import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

import type { AppView, AppViewType } from "@/lib/opco-api";
import type { RecordsOpeningMeasurement, RecordsOpeningResult, RecordsOpeningSource } from "@/lib/records-opening-history";
import { useSession } from "@/state/session";
import {
  activateRecordsOpeningHistoryOwner,
  hydrateRecordsOpeningHistory,
  recordRecordsOpeningMeasurement,
} from "@/renderers/records/records-opening";

type OpeningSession = {
  id: string;
  monotonicStartedAt: number;
  origin: "navigation" | "route";
  resolutionMs: number;
  startedAt: string;
};

type OpeningStatus = {
  coverage?: RecordsOpeningMeasurement["coverage"];
  errorCode?: string | null;
  firstUseful: boolean;
  initialUpdateComplete?: boolean;
  moduleSummary?: RecordsOpeningMeasurement["moduleSummary"];
  processedCount?: number;
  ready: boolean;
  result?: RecordsOpeningResult;
  shownCount?: number;
  source?: RecordsOpeningSource;
};

const ExperienceOpeningContext = createContext<OpeningSession | null>(null);
let openingSequence = 0;

export function ExperienceOpeningProvider({ children, routeStartedAt }: { children: ReactNode; routeStartedAt: OpeningSession["monotonicStartedAt"] }) {
  const [session] = useState<OpeningSession>(() => {
    openingSequence += 1;
    return {
      id: `experience-opening-${Date.now().toString(36)}-${openingSequence.toString(36)}`,
      monotonicStartedAt: routeStartedAt,
      origin: "route",
      resolutionMs: elapsed(routeStartedAt),
      startedAt: new Date().toISOString(),
    };
  });

  return <ExperienceOpeningContext.Provider value={session}>{children}</ExperienceOpeningContext.Provider>;
}

export function useExperienceOpeningSession() {
  return useContext(ExperienceOpeningContext);
}

export function useExperienceOpeningTelemetry(appView: AppView, status: OpeningStatus) {
  const opening = useExperienceOpeningSession();
  const { definitionCache, ownerKey, selectedContractId } = useSession();
  const terminalRef = useRef(false);
  const latestMeasurementRef = useRef<RecordsOpeningMeasurement | null>(null);
  const firstUsefulMsRef = useRef<number | null>(null);
  const readyMsRef = useRef<number | null>(null);
  const initialUpdateMsRef = useRef<number | null>(null);

  useEffect(() => {
    if (!opening || !ownerKey || !selectedContractId || terminalRef.current) return;
    if (status.firstUseful && firstUsefulMsRef.current === null) firstUsefulMsRef.current = elapsed(opening.monotonicStartedAt);
    if (status.ready && readyMsRef.current === null) readyMsRef.current = elapsed(opening.monotonicStartedAt);
    if (status.initialUpdateComplete && initialUpdateMsRef.current === null) initialUpdateMsRef.current = elapsed(opening.monotonicStartedAt);

    const result = status.result ?? (status.ready ? "completed" : "in_progress");
    if (result !== "in_progress") terminalRef.current = true;
    const measurement: RecordsOpeningMeasurement = {
      appViewId: appView.id,
      appViewResolutionMs: opening.resolutionMs,
      appViewTitle: appView.name,
      appViewType: appView.type,
      configurationMs: null,
      coverage: status.coverage ?? "unknown",
      errorCode: status.errorCode ?? null,
      firstUsefulContentMs: firstUsefulMsRef.current,
      id: opening.id,
      initialUpdateMs: initialUpdateMsRef.current,
      localReadMs: null,
      moduleSummary: status.moduleSummary ?? null,
      origin: opening.origin,
      preparationMs: null,
      processedCount: status.processedCount ?? 0,
      readyMs: readyMsRef.current,
      remoteRefreshMs: null,
      result,
      shownCount: status.shownCount ?? 0,
      source: status.source ?? "unknown",
      startedAt: opening.startedAt,
      timeToFirstRowsMs: firstUsefulMsRef.current,
      variant: experienceVariant(appView),
    };
    latestMeasurementRef.current = measurement;

    activateRecordsOpeningHistoryOwner(ownerKey);
    void hydrateRecordsOpeningHistory({ contractId: selectedContractId, ownerKey, store: definitionCache });
    recordRecordsOpeningMeasurement({ contractId: selectedContractId, measurement, ownerKey, store: definitionCache });
  }, [appView, definitionCache, opening, ownerKey, selectedContractId, status]);

  useEffect(() => () => {
    const measurement = latestMeasurementRef.current;
    if (!measurement || terminalRef.current || !ownerKey || !selectedContractId) return;
    recordRecordsOpeningMeasurement({
      contractId: selectedContractId,
      measurement: { ...measurement, result: "cancelled" },
      ownerKey,
      store: definitionCache,
    });
  }, [definitionCache, opening?.id, ownerKey, selectedContractId]);
}

export function experienceVariant(appView: AppView) {
  if (appView.type === "WORKFLOW") return appView.config.workflowKey ?? "unknown";
  if (appView.type === "REPORT") return appView.config.presentationMode ?? "unknown";
  return null;
}

export function monotonicNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function elapsed(startedAt: number) {
  return Math.max(0, Math.round(monotonicNow() - startedAt));
}

export function supportedExperienceTypes(): AppViewType[] {
  return ["RECORDS", "WORKFLOW", "REPORT", "PANEL", "BOARD", "DASHBOARD"];
}
