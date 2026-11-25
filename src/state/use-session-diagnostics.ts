import { useCallback, useEffect, useRef, useState } from "react";

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
import type { SessionLifecycleScope } from "./pending-work-lifecycle-logic";
import { StateUpdateSyncStore, syncPendingStateUpdatesOnce } from "../sync/state-update-sync";

export type StateUpdateReconnectDiagnostics = {
  currentConnectivity: StateUpdateSyncDiagnosticsTelemetry["currentConnectivity"];
  lastReconnect: StateUpdateSyncDiagnosticsTelemetry["lastReconnect"];
  lastReconnectPreflight?: StateUpdateSyncDiagnosticsTelemetry["lastReconnectPreflight"];
  lastStateUpdateActivity: StateUpdateSyncDiagnosticsTelemetry["lastStateUpdateActivity"];
  lastStateUpdateSync: StateUpdateSyncDiagnosticsTelemetry["lastStateUpdateSync"];
  lastSessionTermination?: StateUpdateSyncDiagnosticsTelemetry["lastSessionTermination"];
  lastVisibleErrorEvent: StateUpdateSyncDiagnosticsTelemetry["lastVisibleErrorEvent"];
  reconnectRunHistory?: StateUpdateSyncDiagnosticsTelemetry["reconnectRunHistory"];
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
  lastReconnectPreflight: null,
  lastStateUpdateActivity: null,
  lastStateUpdateSync: null,
  lastSessionTermination: null,
  lastVisibleErrorEvent: null,
  reconnectRunHistory: [],
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
  coordinateStateUpdateSync(scope: Omit<SessionLifecycleScope, "selectedContractId">, work: () => ReturnType<SyncPendingStateUpdatesWithTelemetry>): ReturnType<SyncPendingStateUpdatesWithTelemetry>;
  onRetriableSync?(scope: Omit<SessionLifecycleScope, "selectedContractId">): void;
  api: OpcoApi;
  connectivityStatus: ConnectivityStatus;
  definitionCache: LocalDatabase;
  ownerKey: string | null;
  setStateUpdateReconnectRefreshKey(updater: (key: number) => number): void;
  showStateUpdateDiagnostics: boolean;
  token: string | null;
};

export function useSessionDiagnostics({
  coordinateStateUpdateSync,
  onRetriableSync,
  api,
  connectivityStatus,
  definitionCache,
  ownerKey,
  setStateUpdateReconnectRefreshKey,
  showStateUpdateDiagnostics,
  token,
}: UseSessionDiagnosticsInput) {
  const readAuthGeneration = api.getAuthSessionGeneration;
  const authGeneration = readAuthGeneration?.();
  const isCurrentAuth = useCallback(() => readAuthGeneration?.() === authGeneration, [readAuthGeneration, authGeneration]);
  type ScopedDiagnostic<T> = { generation: number | undefined; ownerKey: string | null; value: T };
  const [diagnosticsSnapshot, setDiagnosticsSnapshot] = useState<ScopedDiagnostic<StateUpdateOutboxDiagnostics | null> | null>(null);
  const [errorSnapshot, setErrorSnapshot] = useState<ScopedDiagnostic<string | null> | null>(null);
  const [runSnapshot, setRunSnapshot] = useState<ScopedDiagnostic<StateUpdateDiagnosticRun> | null>(null);
  const currentValue = <T,>(snapshot: ScopedDiagnostic<T> | null): T | null =>
    snapshot !== null && snapshot.generation === authGeneration && snapshot.ownerKey === ownerKey ? snapshot.value : null;
  const stateUpdateDiagnostics = currentValue(diagnosticsSnapshot);
  const stateUpdateDiagnosticsError = currentValue(errorSnapshot);
  const stateUpdateDiagnosticRun = currentValue(runSnapshot);
  const setStateUpdateDiagnostics = useCallback((value: StateUpdateOutboxDiagnostics | null) => {
    if (isCurrentAuth()) setDiagnosticsSnapshot({ generation: authGeneration, ownerKey, value });
  }, [authGeneration, isCurrentAuth, ownerKey]);
  const setStateUpdateDiagnosticsError = useCallback((value: string | null) => {
    if (isCurrentAuth()) setErrorSnapshot({ generation: authGeneration, ownerKey, value });
  }, [authGeneration, isCurrentAuth, ownerKey]);
  const setStateUpdateDiagnosticRun = useCallback((value: StateUpdateDiagnosticRun) => {
    if (isCurrentAuth()) setRunSnapshot({ generation: authGeneration, ownerKey, value });
  }, [authGeneration, isCurrentAuth, ownerKey]);
  type ManualDiagnosticAction = { generation: number | undefined; ownerKey: string };
  const manualDiagnosticActionRef = useRef<ManualDiagnosticAction | null>(null);
  const [manualDiagnosticAction, setManualDiagnosticAction] = useState<ManualDiagnosticAction | null>(null);
  const isStateUpdateDiagnosticSyncing = manualDiagnosticAction !== null &&
    manualDiagnosticAction.generation === authGeneration && manualDiagnosticAction.ownerKey === ownerKey;
  const [stateUpdateReconnectDiagnostics, setStateUpdateReconnectDiagnostics] =
    useState<StateUpdateReconnectDiagnostics>(emptyStateUpdateReconnectDiagnostics);
  const stateUpdateReconnectDiagnosticsRef = useRef(stateUpdateReconnectDiagnostics);

  const commitStateUpdateReconnectDiagnostics = useCallback((next: StateUpdateReconnectDiagnostics) => {
    stateUpdateReconnectDiagnosticsRef.current = next;
    setStateUpdateReconnectDiagnostics(next);
  }, []);

  const refreshStateUpdateDiagnostics = useCallback(async () => {
    if (!isCurrentAuth()) return;
    if (!ownerKey) {
      setStateUpdateDiagnostics(null);
      setStateUpdateDiagnosticsError(ownerKey ? null : "owner unavailable");
      return;
    }

    try {
      const diagnostics = await definitionCache.getStateUpdateOutboxDiagnostics(ownerKey);
      if (!isCurrentAuth()) return;
      setStateUpdateDiagnostics(diagnostics);
      setStateUpdateDiagnosticsError(null);
    } catch {
      if (!isCurrentAuth()) return;
      setStateUpdateDiagnostics(null);
      setStateUpdateDiagnosticsError("diagnostics unavailable");
    }
  }, [definitionCache, isCurrentAuth, ownerKey, setStateUpdateDiagnostics, setStateUpdateDiagnosticsError]);

  const persistStateUpdateReconnectDiagnostics = useCallback(async (
    updater: (current: StateUpdateReconnectDiagnostics) => StateUpdateReconnectDiagnostics,
  ) => {
    if (!ownerKey || !isCurrentAuth()) return;
    try {
      const persisted = await definitionCache.getStateUpdateSyncDiagnosticsTelemetry(ownerKey).catch(() => null);
      const next = mergeStateUpdateReconnectDiagnosticsForPersistence({
        current: stateUpdateReconnectDiagnosticsRef.current,
        persisted,
        updater,
      });

      if (isCurrentAuth()) commitStateUpdateReconnectDiagnostics(next);
      await definitionCache.setStateUpdateSyncDiagnosticsTelemetry(ownerKey, next);
    } catch {
      return;
    }
  }, [commitStateUpdateReconnectDiagnostics, definitionCache, isCurrentAuth, ownerKey]);

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
      current: persisted ?? (isCurrentAuth() ? stateUpdateReconnectDiagnosticsRef.current : emptyStateUpdateReconnectDiagnostics),
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

    if (isCurrentAuth() && telemetryOwnerKey === ownerKey) commitStateUpdateReconnectDiagnostics(next);
    await definitionCache.setStateUpdateSyncDiagnosticsTelemetry(telemetryOwnerKey, next);
  }, [commitStateUpdateReconnectDiagnostics, connectivityStatus, definitionCache, isCurrentAuth, ownerKey]);

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
      const current = persisted ?? (isCurrentAuth() ? stateUpdateReconnectDiagnosticsRef.current : emptyStateUpdateReconnectDiagnostics);
      const next = appendStateUpdateRequestHistory(current, event);

      if (next === current) {
        return;
      }

      if (isCurrentAuth() && runOwnerKey === ownerKey) commitStateUpdateReconnectDiagnostics(next);
      await definitionCache.setStateUpdateSyncDiagnosticsTelemetry(runOwnerKey, next);
    } catch {
      return;
    }
  }, [commitStateUpdateReconnectDiagnostics, definitionCache, isCurrentAuth, ownerKey]);

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

      if (persisted && isCurrentAuth() && runOwnerKey === ownerKey) {
        commitStateUpdateReconnectDiagnostics(persisted);
      }
    } catch {
      return;
    }
  }, [commitStateUpdateReconnectDiagnostics, definitionCache, isCurrentAuth, ownerKey]);

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

    if (isCurrentAuth() && runOwnerKey === ownerKey && shouldEmitStateUpdateRefresh({ result, selectedOperations: operationsSelected })) {
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

    if (result.retriable > 0) onRetriableSync?.({ authGeneration, ownerKey: runOwnerKey, token: runToken });
    return {
      completedAt,
      operationsSelected,
      result,
      startedAt,
      syncRunId,
    };
  }, [api, authGeneration, definitionCache, isCurrentAuth, onRetriableSync, ownerKey, recordStateUpdateSyncRun, setStateUpdateReconnectRefreshKey, token]);

  const runStateUpdateDiagnosticSync = useCallback(async () => {
    if (!isCurrentAuth()) return;
    if (!token || !ownerKey) {
      setStateUpdateDiagnosticsError("session unavailable");
      return;
    }
    const active = manualDiagnosticActionRef.current;
    if (active?.generation === authGeneration && active.ownerKey === ownerKey) return;
    const action: ManualDiagnosticAction = { generation: authGeneration, ownerKey };
    const isCurrentAction = () => isCurrentAuth() && manualDiagnosticActionRef.current === action;
    manualDiagnosticActionRef.current = action;
    setManualDiagnosticAction(action);
    try {
      const beforeRun = await definitionCache.getStateUpdateOutboxDiagnostics(ownerKey);
      if (!isCurrentAction()) return;
      const events = createStateUpdateDiagnosticEvents(beforeRun);
      const diagnosticStore = createStateUpdateDiagnosticStore(definitionCache, events);
      const diagnosticApi = createStateUpdateDiagnosticApi(api, events);
      const runResult = await coordinateStateUpdateSync({ authGeneration, ownerKey, token }, () => syncPendingStateUpdatesWithTelemetry({
        api: diagnosticApi,
        ownerKey,
        store: diagnosticStore,
        token,
        trigger: "manual-retry",
      }));
      // The existing engine has already reconciled a valid ACK for its owner.
      // Retire only this action's UI publication, never that durable receipt.
      if (!isCurrentAction()) return;
      if (!runResult) return; // The captured scope was retired before the coordinated action began.

      const { completedAt, result } = runResult;
      const refreshed = await definitionCache.getStateUpdateOutboxDiagnostics(ownerKey);
      if (!isCurrentAction()) return;

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
      if (!isCurrentAction()) return;
      setStateUpdateDiagnosticsError("diagnostic sync failed");
      await refreshStateUpdateDiagnostics();
    } finally {
      if (manualDiagnosticActionRef.current === action) {
        manualDiagnosticActionRef.current = null;
        if (isCurrentAuth()) setManualDiagnosticAction(null);
      }
    }
  }, [api, authGeneration, coordinateStateUpdateSync, definitionCache, isCurrentAuth, ownerKey, refreshStateUpdateDiagnostics, setStateUpdateDiagnosticRun, setStateUpdateDiagnostics, setStateUpdateDiagnosticsError, syncPendingStateUpdatesWithTelemetry, token]);

  const retryFailedStateUpdateDiagnostics = useCallback(async (manualRetryToken?: string | null) => {
    if (!isCurrentAuth()) return;
    if (!token || !ownerKey) {
      setStateUpdateDiagnosticsError("session unavailable");
      return;
    }

    try {
      const retried = await definitionCache.retryFailedStateUpdateOperations({
        manualRetryToken,
        ownerKey,
      });
      if (!isCurrentAuth()) return;

      if (!retried) {
        await refreshStateUpdateDiagnostics();
        return;
      }

      await runStateUpdateDiagnosticSync();
    } catch {
      if (!isCurrentAuth()) return;
      setStateUpdateDiagnosticsError("retry unavailable");
      await refreshStateUpdateDiagnostics();
    }
  }, [definitionCache, isCurrentAuth, ownerKey, refreshStateUpdateDiagnostics, runStateUpdateDiagnosticSync, setStateUpdateDiagnosticsError, token]);

  useEffect(() => {
    if (!ownerKey) {
      const timer = setTimeout(() => {
        commitStateUpdateReconnectDiagnostics(emptyStateUpdateReconnectDiagnostics);
      }, 0);

      return () => {
        clearTimeout(timer);
      };
    }

    let isMounted = true;

    definitionCache.getStateUpdateSyncDiagnosticsTelemetry(ownerKey)
      .then((telemetry) => {
        if (isMounted && isCurrentAuth() && telemetry) {
          const next = markInterruptedReadinessActivity(telemetry);

          commitStateUpdateReconnectDiagnostics(next);
          if (next !== telemetry) {
            void definitionCache.setStateUpdateSyncDiagnosticsTelemetry(ownerKey, next);
          }
        }
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, [commitStateUpdateReconnectDiagnostics, definitionCache, isCurrentAuth, ownerKey]);

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
