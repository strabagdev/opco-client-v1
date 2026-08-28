import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";

import { buildOwnerKey, loadAppViewsWithCache } from "../lib/app-navigation-cache";
import { prewarmAssignedAppViewsOnce } from "../lib/app-view-prewarm";
import { ConnectivityStatus } from "../lib/connectivity";
import { selectContractId } from "../lib/contract-selection";
import { LocalDatabase } from "../lib/local-db";
import { ContextResponse, MeResponse, OpcoApi, OpcoNetworkError } from "../lib/opco-api";
import { readPersistedContractId } from "../lib/session-persistence";
import { StateUpdateSyncTrigger } from "../lib/state-update-offline";
import { createReconnectSyncController, ReconnectSyncController } from "./reconnect-sync";
import { StateUpdateReconnectDiagnostics } from "./use-session-diagnostics";
import { syncPendingWork } from "../sync/pending-work-sync";
import { StateUpdateSyncStore, syncPendingStateUpdatesOnce } from "../sync/state-update-sync";
import * as tokenStorage from "../lib/token-storage";
import {
  isSessionLifecycleScopeCurrent,
  SessionLifecycleScope,
  shouldRunForegroundPendingSync,
} from "./pending-work-lifecycle-logic";

type SessionStatus = "loading" | "anonymous" | "authenticated" | "offline";

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

type UsePendingWorkLifecycleInput = {
  api: OpcoApi;
  connectivityStatus: ConnectivityStatus;
  definitionCache: LocalDatabase;
  ownerKey: string | null;
  persistStateUpdateReconnectDiagnostics(
    updater: (current: StateUpdateReconnectDiagnostics) => StateUpdateReconnectDiagnostics,
  ): Promise<void>;
  refreshPendingRecordsCount(): Promise<void>;
  refreshStateUpdateDiagnostics(): Promise<void>;
  selectedContractIdState: string | null;
  setContext(value: ContextResponse): void;
  setMe(value: MeResponse): void;
  setRecordsReconnectRefreshKey(updater: (key: number) => number): void;
  setSelectedContractIdState(value: string | null): void;
  setStatus(value: SessionStatus): void;
  setToken(value: string): void;
  shouldShowStateUpdateDiagnostics: boolean;
  status: SessionStatus;
  syncPendingStateUpdatesWithTelemetry: SyncPendingStateUpdatesWithTelemetry;
  token: string | null;
};

export function usePendingWorkLifecycle({
  api,
  connectivityStatus,
  definitionCache,
  ownerKey,
  persistStateUpdateReconnectDiagnostics,
  refreshPendingRecordsCount,
  refreshStateUpdateDiagnostics,
  selectedContractIdState,
  setContext,
  setMe,
  setRecordsReconnectRefreshKey,
  setSelectedContractIdState,
  setStatus,
  setToken,
  shouldShowStateUpdateDiagnostics,
  status,
  syncPendingStateUpdatesWithTelemetry,
  token,
}: UsePendingWorkLifecycleInput) {
  const reconnectSessionAndRecordsRef = useRef<(trigger?: StateUpdateSyncTrigger) => Promise<void>>(
    () => Promise.resolve(),
  );
  const reconnectShouldSyncRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false));
  const reconnectSyncControllerRef = useRef<ReconnectSyncController | null>(null);
  const foregroundResumeSyncPromiseRef = useRef<Promise<void> | null>(null);
  const latestSessionScopeRef = useRef<SessionLifecycleScope>({
    ownerKey,
    selectedContractId: selectedContractIdState,
    token,
  });

  useEffect(() => {
    latestSessionScopeRef.current = {
      ownerKey,
      selectedContractId: selectedContractIdState,
      token,
    };
  }, [ownerKey, selectedContractIdState, token]);

  const syncPendingRecords = useCallback(async (trigger: StateUpdateSyncTrigger = "manual-retry") => {
    if (!token || !ownerKey) {
      return;
    }

    const runScope = {
      ownerKey,
      selectedContractId: selectedContractIdState,
      token,
    };

    try {
      await syncPendingWork({
        api,
        ownerKey,
        recordsStore: definitionCache,
        syncStateUpdates: syncPendingStateUpdatesWithTelemetry,
        token,
        trigger,
      });
      if (isSessionLifecycleScopeCurrent(runScope, latestSessionScopeRef.current) && shouldShowStateUpdateDiagnostics) {
        await refreshStateUpdateDiagnostics();
      }
    } finally {
      if (isSessionLifecycleScopeCurrent(runScope, latestSessionScopeRef.current)) {
        await refreshPendingRecordsCount();
      }
    }
  }, [
    api,
    definitionCache,
    ownerKey,
    refreshPendingRecordsCount,
    refreshStateUpdateDiagnostics,
    selectedContractIdState,
    shouldShowStateUpdateDiagnostics,
    syncPendingStateUpdatesWithTelemetry,
    token,
  ]);

  const reconnectSessionAndRecords = useCallback(async (trigger: StateUpdateSyncTrigger = "reconnect") => {
    if (!token) {
      return;
    }

    let nextToken = token;
    const runScope = {
      ownerKey,
      selectedContractId: selectedContractIdState,
      token,
    };

    try {
      const refreshed = await api.refreshSession();

      nextToken = refreshed.accessToken;
      if (!isSessionLifecycleScopeCurrent(runScope, latestSessionScopeRef.current)) {
        return;
      }
      runScope.token = nextToken;
      latestSessionScopeRef.current = {
        ...latestSessionScopeRef.current,
        token: nextToken,
      };
      setToken(nextToken);
    } catch (error) {
      if (!(error instanceof OpcoNetworkError)) {
        throw error;
      }
    }

    const nextMe = await api.getMe(nextToken);
    const nextContext = await api.getContext(nextToken);
    const nextOwnerKey = buildOwnerKey(nextMe, nextContext);

    if (!isSessionLifecycleScopeCurrent(runScope, latestSessionScopeRef.current)) {
      return;
    }

    await tokenStorage.setSessionOwnerKey(nextOwnerKey);
    await definitionCache.upsertContextSnapshot(nextOwnerKey, nextMe, nextContext, new Date().toISOString());
    setMe(nextMe);
    setContext(nextContext);
    setStatus("authenticated");

    const nextContractId = selectContractId(
      nextContext.contracts,
      selectedContractIdState ?? await readPersistedContractId(definitionCache, nextOwnerKey),
    );

    setSelectedContractIdState(nextContractId);

    if (nextContractId) {
      const appViewsResult = await loadAppViewsWithCache({
        api,
        cache: definitionCache,
        contractId: nextContractId,
        ownerKey: nextOwnerKey,
        token: nextToken,
      });

      if (!appViewsResult.offline) {
        void prewarmAssignedAppViewsOnce({
          api,
          appViews: appViewsResult.views,
          contractId: nextContractId,
          ownerKey: nextOwnerKey,
          store: definitionCache,
          token: nextToken,
        });
      }
    }

    if (!isSessionLifecycleScopeCurrent(runScope, latestSessionScopeRef.current)) {
      return;
    }

    await syncPendingWork({
      api,
      ownerKey: nextOwnerKey,
      recordsStore: definitionCache,
      syncStateUpdates: syncPendingStateUpdatesWithTelemetry,
      token: nextToken,
      trigger,
    });
    if (!isSessionLifecycleScopeCurrent(runScope, latestSessionScopeRef.current)) {
      return;
    }

    if (shouldShowStateUpdateDiagnostics) {
      await refreshStateUpdateDiagnostics();
    }
    await refreshPendingRecordsCount();
  }, [
    api,
    definitionCache,
    ownerKey,
    refreshPendingRecordsCount,
    refreshStateUpdateDiagnostics,
    selectedContractIdState,
    setContext,
    setMe,
    setSelectedContractIdState,
    setStatus,
    setToken,
    shouldShowStateUpdateDiagnostics,
    syncPendingStateUpdatesWithTelemetry,
    token,
  ]);

  useEffect(() => {
    reconnectSessionAndRecordsRef.current = reconnectSessionAndRecords;
  }, [reconnectSessionAndRecords]);

  const hasReconnectPendingWork = useCallback(async () => {
    if (!ownerKey) {
      return false;
    }

    const [recordsCount, stateUpdateOperations] = await Promise.all([
      definitionCache.countPendingOperations(ownerKey),
      definitionCache.listPendingStateUpdateOperations(ownerKey),
    ]);

    return recordsCount > 0 || stateUpdateOperations.length > 0;
  }, [definitionCache, ownerKey]);

  useEffect(() => {
    reconnectShouldSyncRef.current = hasReconnectPendingWork;
  }, [hasReconnectPendingWork]);

  useEffect(() => {
    if (status !== "authenticated" && status !== "offline") {
      return;
    }

    let previousAppState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const lastAppState = previousAppState;

      previousAppState = nextAppState;

      if (!shouldRunForegroundPendingSync({
        connectivityStatus,
        hasInFlightSync: Boolean(foregroundResumeSyncPromiseRef.current),
        nextAppState,
        previousAppState: lastAppState,
      })) {
        return;
      }

      foregroundResumeSyncPromiseRef.current = reconnectShouldSyncRef.current()
        .then((shouldSync) => {
          if (!shouldSync) {
            return undefined;
          }

          return reconnectSessionAndRecordsRef.current("foreground/resume");
        })
        .catch(() => undefined)
        .finally(() => {
          foregroundResumeSyncPromiseRef.current = null;
        });
    });

    return () => {
      subscription.remove();
    };
  }, [connectivityStatus, status]);

  useEffect(() => {
    const controller = createReconnectSyncController({
      onSynced() {
        setRecordsReconnectRefreshKey((key) => key + 1);
      },
      async runSync({ previousConnectivityStatus, resultingConnectivityStatus, trigger }) {
        const detectedAt = new Date().toISOString();

        await persistStateUpdateReconnectDiagnostics((current) => ({
          ...current,
          currentConnectivity: {
            status: resultingConnectivityStatus,
            updatedAt: detectedAt,
          },
          lastReconnect: {
            detected: trigger === "reconnect",
            detectedAt,
            previousConnectivityStatus,
            resultingConnectivityStatus,
          },
        }));

        return reconnectSessionAndRecordsRef.current(trigger);
      },
      shouldSync() {
        return reconnectShouldSyncRef.current();
      },
    });

    reconnectSyncControllerRef.current = controller;

    return () => {
      controller.dispose();
      reconnectSyncControllerRef.current = null;
    };
  }, [persistStateUpdateReconnectDiagnostics, setRecordsReconnectRefreshKey]);

  useEffect(() => {
    if (status !== "authenticated" && status !== "offline") {
      return;
    }

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

    reconnectSyncControllerRef.current?.handleConnectivityStatus(connectivityStatus);

    return () => {
      clearTimeout(timer);
    };
  }, [connectivityStatus, persistStateUpdateReconnectDiagnostics, status]);

  return {
    reconnectSessionAndRecords,
    syncPendingRecords,
  };
}
