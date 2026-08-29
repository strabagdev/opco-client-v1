import { useCallback, useEffect, useState } from "react";

import {
  createStateUpdateDiagnosticApi,
  createStateUpdateDiagnosticEvents,
  createStateUpdateDiagnosticStore,
} from "../diagnostics/state-update-route-logic";
import { ConnectivityStatus } from "../lib/connectivity";
import { LocalDatabase } from "../lib/local-db";
import { OpcoApi, OpcoNetworkDiagnostics } from "../lib/opco-api";
import {
  appendStateUpdateRequestHistory,
  mergeStateUpdateSyncDiagnosticsTelemetry,
  stateUpdateRequestDiagnosticsFromNetwork,
  StateUpdateOutboxDiagnostics,
  StateUpdateSessionTerminationTelemetry,
  StateUpdateSyncDiagnosticsTelemetry,
  StateUpdateSyncTrigger,
} from "../lib/state-update-offline";
import { shouldEmitStateUpdateRefresh } from "./state-update-refresh";
import { createSyncRunId } from "../sync/pending-work-sync";
import { StateUpdateSyncStore, syncPendingStateUpdatesOnce } from "../sync/state-update-sync";

export type StateUpdateReconnectDiagnostics = {
  currentConnectivity: StateUpdateSyncDiagnosticsTelemetry["currentConnectivity"];
  lastReconnect: StateUpdateSyncDiagnosticsTelemetry["lastReconnect"];
  lastStateUpdateActivity: StateUpdateSyncDiagnosticsTelemetry["lastStateUpdateActivity"];
  lastStateUpdateSync: StateUpdateSyncDiagnosticsTelemetry["lastStateUpdateSync"];
  lastSessionTermination?: StateUpdateSyncDiagnosticsTelemetry["lastSessionTermination"];
  lastVisibleErrorEvent: StateUpdateSyncDiagnosticsTelemetry["lastVisibleErrorEvent"];
  requestHistory?: StateUpdateSyncDiagnosticsTelemetry["requestHistory"];
};

export type StateUpdateDiagnosticRun = {
  invokedAt: string;
  operationsAttempted: number;
  operationsCompleted: number;
  operationsFailed: number;
  operationsSelected: number;
  rows: {
    clientRequestId: string;
    endpoint: string;
    fetchResolvedAt: string | null;
    finalSyncStatus: string;
    httpStatus: number | null;
    requestAbortControllerTriggered: boolean | null;
    requestCompletedAt: string | null;
    requestAttempted: boolean;
    requestDurationMs: number | null;
    requestStartedAt: string | null;
    requestTimeoutMs: number | null;
    responseBodyStartedAt: string | null;
    responseParsedAt: string | null;
    responseStarted: boolean | null;
    result: string;
    selectedForSync: boolean;
  }[];
};

export const emptyStateUpdateReconnectDiagnostics: StateUpdateReconnectDiagnostics = {
  currentConnectivity: {
    status: "unknown",
    updatedAt: null,
  },
  lastReconnect: {
    detected: false,
    detectedAt: null,
    previousConnectivityStatus: null,
    resultingConnectivityStatus: null,
  },
  lastStateUpdateActivity: null,
  lastStateUpdateSync: null,
  lastSessionTermination: null,
  lastVisibleErrorEvent: null,
  requestHistory: [],
};

let stateUpdateNetworkDiagnosticsRecorder: (diagnostics: OpcoNetworkDiagnostics) => void = () => undefined;
let stateUpdateSessionTerminationRecorder: (event: StateUpdateSessionTerminationTelemetry) => void = () => undefined;

export function recordStateUpdateNetworkDiagnostics(diagnostics: OpcoNetworkDiagnostics) {
  stateUpdateNetworkDiagnosticsRecorder(diagnostics);
}

export function recordStateUpdateSessionTermination(event: StateUpdateSessionTerminationTelemetry) {
  stateUpdateSessionTerminationRecorder(event);
}

export function setStateUpdateNetworkDiagnosticsRecorder(
  recorder: (diagnostics: OpcoNetworkDiagnostics) => void,
) {
  stateUpdateNetworkDiagnosticsRecorder = recorder;

  return () => {
    if (stateUpdateNetworkDiagnosticsRecorder === recorder) {
      stateUpdateNetworkDiagnosticsRecorder = () => undefined;
    }
  };
}

export function setStateUpdateSessionTerminationRecorder(
  recorder: (event: StateUpdateSessionTerminationTelemetry) => void,
) {
  stateUpdateSessionTerminationRecorder = recorder;

  return () => {
    if (stateUpdateSessionTerminationRecorder === recorder) {
      stateUpdateSessionTerminationRecorder = () => undefined;
    }
  };
}

export function mergeStateUpdateReconnectDiagnosticsForPersistence({
  current,
  persisted,
  updater,
}: {
  current: StateUpdateReconnectDiagnostics;
  persisted: StateUpdateReconnectDiagnostics | null;
  updater: (current: StateUpdateReconnectDiagnostics) => StateUpdateReconnectDiagnostics;
}) {
  return updater(persisted ?? current);
}

export function markInterruptedReadinessActivity(
  telemetry: StateUpdateReconnectDiagnostics,
  completedAt = new Date().toISOString(),
): StateUpdateReconnectDiagnostics {
  const activity = telemetry.lastStateUpdateActivity;

  if (activity?.type !== "ready_check" || activity.result !== "reconnecting" || !activity.syncRunId) {
    return telemetry;
  }

  const hasReadyCheckRequest = (telemetry.requestHistory ?? []).some((request) =>
    request.diagnosticSyncRunId === activity.syncRunId && request.diagnosticOperation === "READY_CHECK"
  );

  if (hasReadyCheckRequest) {
    return telemetry;
  }

  return {
    ...telemetry,
    lastStateUpdateActivity: {
      ...activity,
      completedAt,
      result: "interrupted",
    },
  };
}

type SyncPendingStateUpdatesWithTelemetry = (input: {
  api?: Pick<OpcoApi, "saveStateUpdateWorkflow"> & Partial<Pick<OpcoApi, "getStateUpdateWorkflow">>;
  ownerKey?: string;
  store?: StateUpdateSyncStore;
  syncRunId?: string;
  token?: string;
  trigger: StateUpdateSyncTrigger;
}) => Promise<{
  completedAt: string;
  operationsSelected: number;
  result: Awaited<ReturnType<typeof syncPendingStateUpdatesOnce>>;
  startedAt: string;
  syncRunId: string;
} | null>;

type UseSessionDiagnosticsInput = {
  api: OpcoApi;
  connectivityStatus: ConnectivityStatus;
  definitionCache: LocalDatabase;
  ownerKey: string | null;
  setStateUpdateReconnectRefreshKey(updater: (key: number) => number): void;
  showStateUpdateDiagnostics: boolean;
  token: string | null;
};

export function useSessionDiagnostics({
  api,
  connectivityStatus,
  definitionCache,
  ownerKey,
  setStateUpdateReconnectRefreshKey,
  showStateUpdateDiagnostics,
  token,
}: UseSessionDiagnosticsInput) {
  const [stateUpdateDiagnostics, setStateUpdateDiagnostics] = useState<StateUpdateOutboxDiagnostics | null>(null);
  const [stateUpdateDiagnosticsError, setStateUpdateDiagnosticsError] = useState<string | null>(null);
  const [stateUpdateDiagnosticRun, setStateUpdateDiagnosticRun] = useState<StateUpdateDiagnosticRun | null>(null);
  const [isStateUpdateDiagnosticSyncing, setIsStateUpdateDiagnosticSyncing] = useState(false);
  const [stateUpdateReconnectDiagnostics, setStateUpdateReconnectDiagnostics] =
    useState<StateUpdateReconnectDiagnostics>(emptyStateUpdateReconnectDiagnostics);

  const refreshStateUpdateDiagnostics = useCallback(async () => {
    if (!showStateUpdateDiagnostics || !ownerKey) {
      setStateUpdateDiagnostics(null);
      setStateUpdateDiagnosticsError(ownerKey ? null : "owner unavailable");
      return;
    }

    try {
      const diagnostics = await definitionCache.getStateUpdateOutboxDiagnostics(ownerKey);

      setStateUpdateDiagnostics(diagnostics);
      setStateUpdateDiagnosticsError(null);
    } catch {
      setStateUpdateDiagnostics(null);
      setStateUpdateDiagnosticsError("diagnostics unavailable");
    }
  }, [definitionCache, ownerKey, showStateUpdateDiagnostics]);

  const persistStateUpdateReconnectDiagnostics = useCallback(async (
    updater: (current: StateUpdateReconnectDiagnostics) => StateUpdateReconnectDiagnostics,
  ) => {
    if (!ownerKey) {
      return;
    }

    try {
      const persisted = await definitionCache.getStateUpdateSyncDiagnosticsTelemetry(ownerKey).catch(() => null);
      const next = mergeStateUpdateReconnectDiagnosticsForPersistence({
        current: stateUpdateReconnectDiagnostics,
        persisted,
        updater,
      });

      setStateUpdateReconnectDiagnostics(next);
      await definitionCache.setStateUpdateSyncDiagnosticsTelemetry(ownerKey, next);
    } catch {
      return;
    }
  }, [definitionCache, ownerKey, stateUpdateReconnectDiagnostics]);

  const recordStateUpdateSyncRun = useCallback(async ({
    completedAt = new Date().toISOString(),
    ownerKey: runOwnerKey,
    operationsSelected,
    result,
    startedAt,
    syncRunId,
    trigger,
  }: {
    completedAt?: string;
    ownerKey?: string;
    operationsSelected: number;
    result: Awaited<ReturnType<typeof syncPendingStateUpdatesOnce>>;
    startedAt: string;
    syncRunId?: string | null;
    trigger: StateUpdateSyncTrigger;
  }) => {
    const telemetryOwnerKey = runOwnerKey ?? ownerKey;

    if (!telemetryOwnerKey) {
      return;
    }

    const operationsFailed = result.conflicts + result.failed + result.retriable;
    const persisted = await definitionCache.getStateUpdateSyncDiagnosticsTelemetry(telemetryOwnerKey);
    const next = mergeStateUpdateSyncDiagnosticsTelemetry({
      completedAt,
      current: persisted ?? stateUpdateReconnectDiagnostics,
      currentConnectivityStatus: connectivityStatus,
      lastRequestDiagnostics: result.lastRequestDiagnostics,
      operationsAttempted: result.operationsAttempted,
      operationsCompleted: result.completed,
      operationsFailed,
      operationsSelected,
      reconciledAfterTimeout: result.reconciledAfterTimeout,
      startedAt,
      syncRunId,
      timeoutOccurred: result.timeoutOccurred,
      trigger,
    });

    setStateUpdateReconnectDiagnostics(next);
    await definitionCache.setStateUpdateSyncDiagnosticsTelemetry(telemetryOwnerKey, next);
  }, [connectivityStatus, definitionCache, ownerKey, stateUpdateReconnectDiagnostics]);

  const recordStateUpdateRequestDiagnostics = useCallback(async (
    diagnostics: OpcoNetworkDiagnostics,
    runOwnerKey = ownerKey,
  ) => {
    if (!runOwnerKey) {
      return;
    }

    try {
      const event = stateUpdateRequestDiagnosticsFromNetwork(diagnostics);

      if (!event) {
        return;
      }

      const persisted = await definitionCache.getStateUpdateSyncDiagnosticsTelemetry(runOwnerKey);
      const current = persisted ?? stateUpdateReconnectDiagnostics;
      const next = appendStateUpdateRequestHistory(current, event);

      if (next === current) {
        return;
      }

      setStateUpdateReconnectDiagnostics(next);
      await definitionCache.setStateUpdateSyncDiagnosticsTelemetry(runOwnerKey, next);
    } catch {
      return;
    }
  }, [definitionCache, ownerKey, stateUpdateReconnectDiagnostics]);

  const recordStateUpdateSessionTerminationDiagnostics = useCallback(async (
    event: StateUpdateSessionTerminationTelemetry,
    runOwnerKey = ownerKey,
  ) => {
    if (!runOwnerKey) {
      return;
    }

    try {
      await definitionCache.recordStateUpdateSessionTermination(runOwnerKey, event);
      const persisted = await definitionCache.getStateUpdateSyncDiagnosticsTelemetry(runOwnerKey);

      if (persisted) {
        setStateUpdateReconnectDiagnostics(persisted);
      }
    } catch {
      return;
    }
  }, [definitionCache, ownerKey]);

  const syncPendingStateUpdatesWithTelemetry = useCallback(async ({
    api: stateUpdateApi = api,
    ownerKey: runOwnerKey = ownerKey ?? undefined,
    store = definitionCache,
    syncRunId = createSyncRunId(),
    token: runToken = token ?? undefined,
    trigger,
  }: Parameters<SyncPendingStateUpdatesWithTelemetry>[0]) => {
    if (!runOwnerKey || !runToken) {
      return null;
    }

    const selectedStateUpdates = await store.listPendingStateUpdateOperations(runOwnerKey);
    const startedAt = new Date().toISOString();
    const result = await syncPendingStateUpdatesOnce({
      api: stateUpdateApi,
      ownerKey: runOwnerKey,
      store,
      syncRunId,
      token: runToken,
    });
    const completedAt = new Date().toISOString();
    const operationsSelected = selectedStateUpdates.length;

    if (shouldEmitStateUpdateRefresh({ result, selectedOperations: operationsSelected })) {
      setStateUpdateReconnectRefreshKey((key) => key + 1);
    }
    await recordStateUpdateSyncRun({
      completedAt,
      ownerKey: runOwnerKey,
      operationsSelected,
      result,
      startedAt,
      syncRunId,
      trigger,
    });

    return {
      completedAt,
      operationsSelected,
      result,
      startedAt,
      syncRunId,
    };
  }, [api, definitionCache, ownerKey, recordStateUpdateSyncRun, setStateUpdateReconnectRefreshKey, token]);

  const runStateUpdateDiagnosticSync = useCallback(async () => {
    if (!token || !ownerKey) {
      setStateUpdateDiagnosticsError("session unavailable");
      return;
    }

    const beforeRun = await definitionCache.getStateUpdateOutboxDiagnostics(ownerKey);
    const events = createStateUpdateDiagnosticEvents(beforeRun);

    setIsStateUpdateDiagnosticSyncing(true);
    try {
      const diagnosticStore = createStateUpdateDiagnosticStore(definitionCache, events);
      const diagnosticApi = createStateUpdateDiagnosticApi(api, events);
      const runResult = await syncPendingStateUpdatesWithTelemetry({
        api: diagnosticApi,
        ownerKey,
        store: diagnosticStore,
        token,
        trigger: "manual-retry",
      });

      if (!runResult) {
        setStateUpdateDiagnosticsError("session unavailable");
        return;
      }

      const { completedAt, result } = runResult;
      const refreshed = await definitionCache.getStateUpdateOutboxDiagnostics(ownerKey);

      for (const operation of refreshed.operations) {
        const event = [...events.values()].find((item) => item.clientRequestId === operation.clientRequestId);

        if (event) {
          event.finalSyncStatus = operation.syncStatus;
        }
      }

      setStateUpdateDiagnosticRun({
        invokedAt: completedAt,
        operationsAttempted: [...events.values()].filter((event) => event.requestAttempted).length,
        operationsCompleted: result.completed,
        operationsFailed: result.failed + result.conflicts + result.retriable,
        operationsSelected: [...events.values()].filter((event) => event.selectedForSync).length,
        rows: [...events.values()],
      });
      setStateUpdateDiagnostics(refreshed);
      setStateUpdateDiagnosticsError(null);
    } catch {
      setStateUpdateDiagnosticsError("diagnostic sync failed");
      await refreshStateUpdateDiagnostics();
    } finally {
      setIsStateUpdateDiagnosticSyncing(false);
    }
  }, [api, definitionCache, ownerKey, refreshStateUpdateDiagnostics, syncPendingStateUpdatesWithTelemetry, token]);

  const retryFailedStateUpdateDiagnostics = useCallback(async (manualRetryToken?: string | null) => {
    if (!token || !ownerKey) {
      setStateUpdateDiagnosticsError("session unavailable");
      return;
    }

    try {
      const retried = await definitionCache.retryFailedStateUpdateOperations({
        manualRetryToken,
        ownerKey,
      });

      if (!retried) {
        await refreshStateUpdateDiagnostics();
        return;
      }

      await runStateUpdateDiagnosticSync();
    } catch {
      setStateUpdateDiagnosticsError("retry unavailable");
      await refreshStateUpdateDiagnostics();
    }
  }, [definitionCache, ownerKey, refreshStateUpdateDiagnostics, runStateUpdateDiagnosticSync, token]);

  useEffect(() => {
    if (!ownerKey) {
      const timer = setTimeout(() => {
        setStateUpdateReconnectDiagnostics(emptyStateUpdateReconnectDiagnostics);
      }, 0);

      return () => {
        clearTimeout(timer);
      };
    }

    let isMounted = true;

    definitionCache.getStateUpdateSyncDiagnosticsTelemetry(ownerKey)
      .then((telemetry) => {
        if (isMounted && telemetry) {
          const next = markInterruptedReadinessActivity(telemetry);

          setStateUpdateReconnectDiagnostics(next);
          if (next !== telemetry) {
            void definitionCache.setStateUpdateSyncDiagnosticsTelemetry(ownerKey, next);
          }
        }
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, [definitionCache, ownerKey]);

  useEffect(() => {
    if (!showStateUpdateDiagnostics) {
      return;
    }

    const timer = setTimeout(() => {
      void refreshStateUpdateDiagnostics();
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [refreshStateUpdateDiagnostics, showStateUpdateDiagnostics]);

  useEffect(() => {
    const updatedAt = new Date().toISOString();
    const timer = setTimeout(() => {
      void persistStateUpdateReconnectDiagnostics((current) => ({
        ...current,
        currentConnectivity: {
          status: connectivityStatus,
          updatedAt,
        },
      }));
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [connectivityStatus, persistStateUpdateReconnectDiagnostics]);

  return {
    isStateUpdateDiagnosticSyncing,
    persistStateUpdateReconnectDiagnostics,
    recordStateUpdateSyncRun,
    recordStateUpdateSessionTerminationDiagnostics,
    recordStateUpdateRequestDiagnostics,
    refreshStateUpdateDiagnostics,
    retryFailedStateUpdateDiagnostics,
    runStateUpdateDiagnosticSync,
    stateUpdateDiagnosticRun,
    stateUpdateDiagnostics,
    stateUpdateDiagnosticsError,
    stateUpdateReconnectDiagnostics,
    syncPendingStateUpdatesWithTelemetry,
  };
}

export function shouldShowStateUpdateDiagnostics() {
  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).get("stateUpdateDiagnostics") === "1";
}
