import { useCallback, useEffect, useState } from "react";

import {
  createStateUpdateDiagnosticApi,
  createStateUpdateDiagnosticEvents,
  createStateUpdateDiagnosticStore,
} from "../diagnostics/state-update-route-logic";
import { ConnectivityStatus } from "../lib/connectivity";
import { LocalDatabase } from "../lib/local-db";
import { OpcoApi } from "../lib/opco-api";
import {
  mergeStateUpdateSyncDiagnosticsTelemetry,
  StateUpdateOutboxDiagnostics,
  StateUpdateSyncDiagnosticsTelemetry,
  StateUpdateSyncTrigger,
} from "../lib/state-update-offline";
import { shouldEmitStateUpdateRefresh } from "./state-update-refresh";
import { StateUpdateSyncStore, syncPendingStateUpdatesOnce } from "../sync/state-update-sync";

export type StateUpdateReconnectDiagnostics = {
  currentConnectivity: StateUpdateSyncDiagnosticsTelemetry["currentConnectivity"];
  lastReconnect: StateUpdateSyncDiagnosticsTelemetry["lastReconnect"];
  lastStateUpdateSync: StateUpdateSyncDiagnosticsTelemetry["lastStateUpdateSync"];
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
  lastStateUpdateSync: null,
};

type SyncPendingStateUpdatesWithTelemetry = (input: {
  api?: Pick<OpcoApi, "saveStateUpdateWorkflow"> & Partial<Pick<OpcoApi, "getStateUpdateWorkflow">>;
  ownerKey?: string;
  store?: StateUpdateSyncStore;
  token?: string;
  trigger: StateUpdateSyncTrigger;
}) => Promise<{
  completedAt: string;
  operationsSelected: number;
  result: Awaited<ReturnType<typeof syncPendingStateUpdatesOnce>>;
  startedAt: string;
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

    setStateUpdateReconnectDiagnostics((current) => {
      const next = updater(current);

      void definitionCache.setStateUpdateSyncDiagnosticsTelemetry(ownerKey, next).catch(() => undefined);

      return next;
    });
  }, [definitionCache, ownerKey]);

  const recordStateUpdateSyncRun = useCallback(async ({
    completedAt = new Date().toISOString(),
    ownerKey: runOwnerKey,
    operationsSelected,
    result,
    startedAt,
    trigger,
  }: {
    completedAt?: string;
    ownerKey?: string;
    operationsSelected: number;
    result: Awaited<ReturnType<typeof syncPendingStateUpdatesOnce>>;
    startedAt: string;
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
      timeoutOccurred: result.timeoutOccurred,
      trigger,
    });

    setStateUpdateReconnectDiagnostics(next);
    await definitionCache.setStateUpdateSyncDiagnosticsTelemetry(telemetryOwnerKey, next);
  }, [connectivityStatus, definitionCache, ownerKey, stateUpdateReconnectDiagnostics]);

  const syncPendingStateUpdatesWithTelemetry = useCallback(async ({
    api: stateUpdateApi = api,
    ownerKey: runOwnerKey = ownerKey ?? undefined,
    store = definitionCache,
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
      trigger,
    });

    return {
      completedAt,
      operationsSelected,
      result,
      startedAt,
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
          setStateUpdateReconnectDiagnostics(telemetry);
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
