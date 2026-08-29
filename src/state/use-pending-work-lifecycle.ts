import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { buildOwnerKey, loadAppViewsWithCache } from "../lib/app-navigation-cache";
import { prewarmAssignedAppViewsOnce } from "../lib/app-view-prewarm";
import { ConnectivityStatus } from "../lib/connectivity";
import { selectContractId } from "../lib/contract-selection";
import { LocalDatabase } from "../lib/local-db";
import { AUTH_REFRESH_TIMEOUT_MS, ContextResponse, MeResponse, OpcoApi, OpcoNetworkError } from "../lib/opco-api";
import { readPersistedContractId } from "../lib/session-persistence";
import { StateUpdateSyncTrigger } from "../lib/state-update-offline";
import { createReconnectSyncController, ReconnectSyncController } from "./reconnect-sync";
import { StateUpdateReconnectDiagnostics } from "./use-session-diagnostics";
import { createSyncRunId, syncPendingWork } from "../sync/pending-work-sync";
import { StateUpdateSyncStore, syncPendingStateUpdatesOnce } from "../sync/state-update-sync";
import * as tokenStorage from "../lib/token-storage";
import {
  isSessionLifecycleScopeCurrent,
  isRecoverableAuthRefreshError,
  getOperationalCoreReadyRecoveryDelayMs,
  probeOperationalCoreReadiness,
  SessionLifecycleScope,
  shouldScheduleOperationalCoreReadyRecovery,
  shouldRunOnlinePendingSyncForReadyScope,
  shouldRunForegroundPendingSync,
  shouldGatePendingSyncWithOperationalCoreReady,
  shouldRefreshAccessTokenForSync,
} from "./pending-work-lifecycle-logic";

type SessionStatus = "loading" | "anonymous" | "authenticated" | "offline";

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
  const onlineReadyScopeSyncPromiseRef = useRef<Promise<void> | null>(null);
  const activePendingWorkRunKeyRef = useRef<string | null>(null);
  const persistStateUpdateReconnectDiagnosticsRef = useRef(persistStateUpdateReconnectDiagnostics);
  const reconnectPreflightRef = useRef<{
    debounceStartedAt: string;
    reconnectDetectedAt: string;
    syncRunId: string;
    trigger: StateUpdateSyncTrigger;
  } | null>(null);
  const readinessRecoveryRef = useRef<{
    attempts: number;
    scopeKey: string;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const setRecordsReconnectRefreshKeyRef = useRef(setRecordsReconnectRefreshKey);
  const appLifecycleStateRef = useRef(AppState.currentState);
  const [isPendingWorkSyncing, setIsPendingWorkSyncing] = useState(false);
  const [isAuthSessionRestoring, setIsAuthSessionRestoring] = useState(false);
  const [isOperationalCoreReadinessChecking, setIsOperationalCoreReadinessChecking] = useState(false);
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

  useEffect(() => {
    persistStateUpdateReconnectDiagnosticsRef.current = persistStateUpdateReconnectDiagnostics;
  }, [persistStateUpdateReconnectDiagnostics]);

  useEffect(() => {
    setRecordsReconnectRefreshKeyRef.current = setRecordsReconnectRefreshKey;
  }, [setRecordsReconnectRefreshKey]);

  const markStateUpdateActivity = useCallback(async ({
    result,
    startedAt,
    syncRunId,
    trigger,
    type,
  }: {
    result: "auth_pending" | "auth_timeout" | "cancelled_scope_changed" | "interrupted" | "ready_confirmed" | "ready_failed" | "reconnecting" | "sync_started";
    startedAt: string;
    syncRunId: string;
    trigger: StateUpdateSyncTrigger | "auth_refresh" | "ready_check" | "reconnect";
    type: "auth_refresh" | "ready_check" | "reconnect";
  }) => {
    const completedAt = new Date().toISOString();

    await persistStateUpdateReconnectDiagnostics((current) => {
      const lastRequestDiagnostics = (current.requestHistory ?? [])
        .slice()
        .reverse()
        .find((request) => request.diagnosticSyncRunId === syncRunId) ?? null;

      return {
        ...current,
        currentConnectivity: {
          status: connectivityStatus,
          updatedAt: completedAt,
        },
        lastStateUpdateActivity: {
          completedAt,
          lastRequestDiagnostics,
          operationsCompleted: 0,
          operationsFailed: result === "ready_failed" ? 1 : 0,
          result,
          startedAt,
          syncRunId,
          timeoutOccurred: lastRequestDiagnostics?.abortControllerTriggered === true,
          trigger,
          type,
        },
      };
    });
  }, [connectivityStatus, persistStateUpdateReconnectDiagnostics]);

  const updateReconnectPreflight = useCallback((
    syncRunId: string,
    updater: (current: NonNullable<StateUpdateReconnectDiagnostics["lastReconnectPreflight"]>) => NonNullable<StateUpdateReconnectDiagnostics["lastReconnectPreflight"]>,
  ) => {
    void persistStateUpdateReconnectDiagnosticsRef.current((current) => {
      const previous = current.lastReconnectPreflight?.syncRunId === syncRunId
        ? current.lastReconnectPreflight
        : null;
      const base = previous ?? {
        completedAt: null,
        countPendingOperationsDurationMs: null,
        debounceCompletedAt: null,
        debounceDurationMs: null,
        debounceStartedAt: null,
        listPendingStateUpdateOperationsDurationMs: null,
        readinessAttempts: null,
        readinessCompletedAt: null,
        readinessDurationMs: null,
        readinessStartedAt: null,
        reconnectDetectedAt: null,
        runSyncStartedAt: null,
        shouldSyncCompletedAt: null,
        shouldSyncDurationMs: null,
        shouldSyncResult: null,
        shouldSyncStartedAt: null,
        syncRunId,
        trigger: "other",
      };

      return {
        ...current,
        lastReconnectPreflight: updater(base),
      };
    });
  }, []);

  const clearReadinessRecoveryTimer = useCallback(({ resetAttempts = false }: { resetAttempts?: boolean } = {}) => {
    const recovery = readinessRecoveryRef.current;

    if (!recovery) {
      return;
    }

    if (recovery.timer) {
      clearTimeout(recovery.timer);
    }

    readinessRecoveryRef.current = resetAttempts ? null : {
      ...recovery,
      timer: null,
    };
  }, []);

  const scheduleReadinessRecovery = useCallback((runScope: SessionLifecycleScope) => {
    const isScopeCurrent = Boolean(runScope.ownerKey && runScope.selectedContractId && runScope.token) &&
      isSessionLifecycleScopeCurrent(runScope, latestSessionScopeRef.current);
    const current = readinessRecoveryRef.current;

    if (current?.timer) {
      return;
    }

    if (!shouldScheduleOperationalCoreReadyRecovery({
      appLifecycleState: appLifecycleStateRef.current,
      connectivityStatus,
      hasRecoveryTimer: false,
      hasRunActive: Boolean(activePendingWorkRunKeyRef.current),
      isScopeCurrent,
      pendingWorkExists: true,
    })) {
      clearReadinessRecoveryTimer({ resetAttempts: true });
      return;
    }

    const scopeKey = `${runScope.ownerKey}:${runScope.selectedContractId}:${runScope.token}`;
    const attempts = current?.scopeKey === scopeKey ? current.attempts : 0;

    const delayMs = getOperationalCoreReadyRecoveryDelayMs(attempts);

    if (delayMs === null) {
      return;
    }
    const timer = setTimeout(() => {
      const latestScope = latestSessionScopeRef.current;

      readinessRecoveryRef.current = {
        attempts: attempts + 1,
        scopeKey,
        timer: null,
      };

      if (
        connectivityStatus !== "online" ||
        appLifecycleStateRef.current !== "active" ||
        latestScope.ownerKey !== runScope.ownerKey ||
        latestScope.selectedContractId !== runScope.selectedContractId ||
        latestScope.token !== runScope.token
      ) {
        clearReadinessRecoveryTimer({ resetAttempts: true });
        return;
      }

      const recoveryStartedAt = new Date().toISOString();
      const syncRunId = createSyncRunId();

      reconnectPreflightRef.current = {
        debounceStartedAt: recoveryStartedAt,
        reconnectDetectedAt: recoveryStartedAt,
        syncRunId,
        trigger: "startup-with-pending",
      };
      updateReconnectPreflight(syncRunId, (current) => ({
        ...current,
        debounceStartedAt: recoveryStartedAt,
        reconnectDetectedAt: recoveryStartedAt,
        syncRunId,
        trigger: "startup-with-pending",
      }));

      void reconnectShouldSyncRef.current()
        .then((shouldSync) => {
          if (!shouldSync) {
            clearReadinessRecoveryTimer({ resetAttempts: true });
            return undefined;
          }

          return reconnectSessionAndRecordsRef.current("startup-with-pending");
        })
        .catch(() => undefined);
    }, delayMs);

    readinessRecoveryRef.current = {
      attempts: attempts + 1,
      scopeKey,
      timer,
    };
  }, [clearReadinessRecoveryTimer, connectivityStatus, updateReconnectPreflight]);

  const runPendingWorkAfterReadiness = useCallback(async ({
    ownerKey: runOwnerKey,
    runScope,
    syncRunId,
    token: runToken,
    trigger,
  }: {
    ownerKey: string;
    runScope: SessionLifecycleScope;
    syncRunId: string;
    token: string;
    trigger: StateUpdateSyncTrigger;
  }) => {
    const runKey = `${runOwnerKey}:${runScope.selectedContractId ?? "none"}:${runToken}`;

    if (activePendingWorkRunKeyRef.current === runKey) {
      return "already-running";
    }

    activePendingWorkRunKeyRef.current = runKey;
    try {
      let syncToken = runToken;

      if (shouldGatePendingSyncWithOperationalCoreReady(trigger)) {
        const startedAt = new Date().toISOString();

        updateReconnectPreflight(syncRunId, (current) => ({
          ...current,
          readinessStartedAt: startedAt,
        }));
        await markStateUpdateActivity({
          result: "reconnecting",
          startedAt,
          syncRunId,
          trigger: "ready_check",
          type: "ready_check",
        });

        if (!isSessionLifecycleScopeCurrent(runScope, latestSessionScopeRef.current)) {
          await markStateUpdateActivity({
            result: "cancelled_scope_changed",
            startedAt,
            syncRunId,
            trigger: "ready_check",
            type: "ready_check",
          });
          return "cancelled";
        }

        setIsOperationalCoreReadinessChecking(true);
        let readiness;
        try {
          readiness = await probeOperationalCoreReadiness({ api, syncRunId });
        } catch {
          const completedAt = new Date().toISOString();
          updateReconnectPreflight(syncRunId, (current) => ({
            ...current,
            completedAt,
            readinessCompletedAt: completedAt,
            readinessDurationMs: Date.parse(completedAt) - Date.parse(startedAt),
          }));
          await markStateUpdateActivity({
            result: "interrupted",
            startedAt,
            syncRunId,
            trigger: "ready_check",
            type: "ready_check",
          });
          return "blocked";
        } finally {
          setIsOperationalCoreReadinessChecking(false);
        }

        const readinessCompletedAt = new Date().toISOString();
        updateReconnectPreflight(syncRunId, (current) => ({
          ...current,
          completedAt: readinessCompletedAt,
          readinessAttempts: readiness.attempts,
          readinessCompletedAt,
          readinessDurationMs: Date.parse(readinessCompletedAt) - Date.parse(startedAt),
        }));

        if (!readiness.ready) {
          await markStateUpdateActivity({
            result: "ready_failed",
            startedAt,
            syncRunId,
            trigger: "ready_check",
            type: "ready_check",
          });
          return "readiness-blocked";
        }

        await markStateUpdateActivity({
          result: "ready_confirmed",
          startedAt,
          syncRunId,
          trigger: "ready_check",
          type: "ready_check",
        });

        if (shouldRefreshAccessTokenForSync(syncToken)) {
          await markStateUpdateActivity({
            result: "auth_pending",
            startedAt,
            syncRunId,
            trigger: "auth_refresh",
            type: "auth_refresh",
          });
          setIsAuthSessionRestoring(true);
          try {
            const refreshed = await api.refreshSession({
              diagnosticSyncRunId: syncRunId,
              timeoutMs: AUTH_REFRESH_TIMEOUT_MS,
            });

            syncToken = refreshed.accessToken;
            runScope.token = syncToken;
            latestSessionScopeRef.current = {
              ...latestSessionScopeRef.current,
              token: syncToken,
            };
            setToken(syncToken);
          } catch (error) {
            const result = error instanceof OpcoNetworkError && error.diagnostics?.abortControllerTriggered
              ? "auth_timeout"
              : "auth_pending";

            if (isRecoverableAuthRefreshError(error)) {
              await markStateUpdateActivity({
                result,
                startedAt,
                syncRunId,
                trigger: "auth_refresh",
                type: "auth_refresh",
              });
              return "blocked";
            }

            await markStateUpdateActivity({
              result: "auth_pending",
              startedAt,
              syncRunId,
              trigger: "auth_refresh",
              type: "auth_refresh",
            });
            throw error;
          } finally {
            setIsAuthSessionRestoring(false);
          }
        }

        if (!isSessionLifecycleScopeCurrent(runScope, latestSessionScopeRef.current)) {
          await markStateUpdateActivity({
            result: "cancelled_scope_changed",
            startedAt,
            syncRunId,
            trigger: "ready_check",
            type: "ready_check",
          });
          return "cancelled";
        }

        await markStateUpdateActivity({
          result: "sync_started",
          startedAt,
          syncRunId,
          trigger: "ready_check",
          type: "ready_check",
        });
      }

      setIsPendingWorkSyncing(true);
      try {
        await syncPendingWork({
          api,
          ownerKey: runOwnerKey,
          recordsStore: definitionCache,
          syncRunId,
          syncStateUpdates: syncPendingStateUpdatesWithTelemetry,
          token: syncToken,
          trigger,
        });
        clearReadinessRecoveryTimer({ resetAttempts: true });
        return "completed";
      } finally {
        setIsPendingWorkSyncing(false);
      }
    } finally {
      if (activePendingWorkRunKeyRef.current === runKey) {
        activePendingWorkRunKeyRef.current = null;
      }
    }
  }, [api, clearReadinessRecoveryTimer, definitionCache, markStateUpdateActivity, setToken, syncPendingStateUpdatesWithTelemetry, updateReconnectPreflight]);

  const syncPendingRecords = useCallback(async (trigger: StateUpdateSyncTrigger = "manual-retry") => {
    if (!token || !ownerKey) {
      return;
    }

    const runScope = {
      ownerKey,
      selectedContractId: selectedContractIdState,
      token,
    };
    const syncRunId = createSyncRunId();

    try {
      await runPendingWorkAfterReadiness({
        ownerKey,
        runScope,
        syncRunId,
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
    ownerKey,
    refreshPendingRecordsCount,
    refreshStateUpdateDiagnostics,
    runPendingWorkAfterReadiness,
    selectedContractIdState,
    shouldShowStateUpdateDiagnostics,
    token,
  ]);

  const reconnectSessionAndRecords = useCallback(async (trigger: StateUpdateSyncTrigger = "reconnect") => {
    if (!token) {
      return;
    }

    let nextToken = token;
    let pendingWorkAlreadyHandled = false;
    const preflight = reconnectPreflightRef.current?.trigger === trigger ? reconnectPreflightRef.current : null;
    const syncRunId = preflight?.syncRunId ?? createSyncRunId();
    updateReconnectPreflight(syncRunId, (current) => ({
      ...current,
      debounceCompletedAt: current.debounceCompletedAt ?? new Date().toISOString(),
      runSyncStartedAt: new Date().toISOString(),
    }));
    const runScope = {
      ownerKey,
      selectedContractId: selectedContractIdState,
      token,
    };

    if (ownerKey && selectedContractIdState) {
      const syncResult = await runPendingWorkAfterReadiness({
        ownerKey,
        runScope,
        syncRunId,
        token,
        trigger,
      });

      nextToken = latestSessionScopeRef.current.token ?? token;

      if (syncResult === "readiness-blocked") {
        scheduleReadinessRecovery(runScope);
        return;
      }

      if (syncResult === "blocked" || syncResult === "cancelled") {
        return;
      }

      pendingWorkAlreadyHandled = syncResult === "completed" || syncResult === "already-running";
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
    runScope.ownerKey = nextOwnerKey;
    runScope.selectedContractId = nextContractId;
    latestSessionScopeRef.current = {
      ownerKey: nextOwnerKey,
      selectedContractId: nextContractId,
      token: nextToken,
    };

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

    if (!pendingWorkAlreadyHandled) {
      const syncResult = await runPendingWorkAfterReadiness({
        ownerKey: nextOwnerKey,
        runScope,
        syncRunId,
        token: nextToken,
        trigger,
      });

      if (syncResult === "readiness-blocked") {
        scheduleReadinessRecovery(runScope);
      }
    }
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
    shouldShowStateUpdateDiagnostics,
    runPendingWorkAfterReadiness,
    scheduleReadinessRecovery,
    token,
    updateReconnectPreflight,
  ]);

  useEffect(() => {
    reconnectSessionAndRecordsRef.current = reconnectSessionAndRecords;
  }, [reconnectSessionAndRecords]);

  const hasReconnectPendingWork = useCallback(async () => {
    if (!ownerKey) {
      return false;
    }

    const preflight = reconnectPreflightRef.current;
    const startedAt = new Date();
    const startedMs = Date.now();
    const recordsStartedMs = Date.now();
    const recordsCountPromise = definitionCache.countPendingOperations(ownerKey)
      .then((count) => ({
        count,
        durationMs: Date.now() - recordsStartedMs,
      }));
    const stateUpdateStartedMs = Date.now();
    const stateUpdateOperationsPromise = definitionCache.listPendingStateUpdateOperations(ownerKey)
      .then((operations) => ({
        durationMs: Date.now() - stateUpdateStartedMs,
        operations,
      }));
    const [recordsResult, stateUpdateResult] = await Promise.all([
      recordsCountPromise,
      stateUpdateOperationsPromise,
    ]);
    const completedAt = new Date().toISOString();
    const shouldSync = recordsResult.count > 0 || stateUpdateResult.operations.length > 0;

    if (preflight) {
      updateReconnectPreflight(preflight.syncRunId, (current) => ({
        ...current,
        countPendingOperationsDurationMs: recordsResult.durationMs,
        debounceCompletedAt: current.debounceCompletedAt ?? startedAt.toISOString(),
        debounceDurationMs: current.debounceStartedAt ? Date.parse(startedAt.toISOString()) - Date.parse(current.debounceStartedAt) : null,
        listPendingStateUpdateOperationsDurationMs: stateUpdateResult.durationMs,
        shouldSyncCompletedAt: completedAt,
        shouldSyncDurationMs: Date.now() - startedMs,
        shouldSyncResult: shouldSync,
        shouldSyncStartedAt: startedAt.toISOString(),
      }));
    }

    return shouldSync;
  }, [definitionCache, ownerKey, updateReconnectPreflight]);

  useEffect(() => {
    reconnectShouldSyncRef.current = hasReconnectPendingWork;
  }, [hasReconnectPendingWork]);

  useEffect(() => {
    const scopeKey = ownerKey && selectedContractIdState && token
      ? `${ownerKey}:${selectedContractIdState}:${token}`
      : null;

    if (!shouldRunOnlinePendingSyncForReadyScope({
      connectivityStatus,
      hasInFlightSync: Boolean(onlineReadyScopeSyncPromiseRef.current),
      ownerKey,
      selectedContractId: selectedContractIdState,
      status,
      token,
    }) || !scopeKey || appLifecycleStateRef.current !== "active") {
      return;
    }

    const runScope = {
      ownerKey,
      selectedContractId: selectedContractIdState,
      token,
    };

    onlineReadyScopeSyncPromiseRef.current = reconnectShouldSyncRef.current()
      .then((shouldSync) => {
        if (!shouldSync) {
          return undefined;
        }
        return reconnectSessionAndRecordsRef.current("startup-with-pending");
      })
      .catch(() => undefined)
      .finally(() => {
        if (isSessionLifecycleScopeCurrent(runScope, latestSessionScopeRef.current)) {
          onlineReadyScopeSyncPromiseRef.current = null;
        }
      });
  }, [connectivityStatus, ownerKey, selectedContractIdState, status, token]);

  useEffect(() => {
    if (status !== "authenticated" && status !== "offline") {
      return;
    }

    let previousAppState = AppState.currentState;
    appLifecycleStateRef.current = previousAppState;
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      const lastAppState = previousAppState;

      previousAppState = nextAppState;
      appLifecycleStateRef.current = nextAppState;

      if (nextAppState !== "active") {
        clearReadinessRecoveryTimer({ resetAttempts: false });
        return;
      }

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
  }, [clearReadinessRecoveryTimer, connectivityStatus, status]);

  useEffect(() => {
    const controller = createReconnectSyncController({
      onDetected({ previousConnectivityStatus, resultingConnectivityStatus, trigger }) {
        const detectedAt = new Date().toISOString();
        const syncRunId = createSyncRunId();

        clearReadinessRecoveryTimer({ resetAttempts: true });
        reconnectPreflightRef.current = {
          debounceStartedAt: detectedAt,
          reconnectDetectedAt: detectedAt,
          syncRunId,
          trigger,
        };

        void persistStateUpdateReconnectDiagnosticsRef.current((current) => ({
          ...current,
          currentConnectivity: {
            status: resultingConnectivityStatus,
            updatedAt: detectedAt,
          },
          lastReconnect: {
            detected: true,
            detectedAt,
            previousConnectivityStatus,
            resultingConnectivityStatus,
          },
          lastReconnectPreflight: {
            completedAt: null,
            countPendingOperationsDurationMs: null,
            debounceCompletedAt: null,
            debounceDurationMs: null,
            debounceStartedAt: detectedAt,
            listPendingStateUpdateOperationsDurationMs: null,
            readinessAttempts: null,
            readinessCompletedAt: null,
            readinessDurationMs: null,
            readinessStartedAt: null,
            reconnectDetectedAt: detectedAt,
            runSyncStartedAt: null,
            shouldSyncCompletedAt: null,
            shouldSyncDurationMs: null,
            shouldSyncResult: null,
            shouldSyncStartedAt: null,
            syncRunId,
            trigger,
          },
        }));
      },
      onSynced() {
        setRecordsReconnectRefreshKeyRef.current((key) => key + 1);
      },
      runSync({ trigger }) {
        return reconnectSessionAndRecordsRef.current(trigger);
      },
      shouldSync() {
        return reconnectShouldSyncRef.current();
      },
    });

    reconnectSyncControllerRef.current = controller;

    return () => {
      controller.dispose();
      clearReadinessRecoveryTimer({ resetAttempts: true });
      reconnectSyncControllerRef.current = null;
    };
  }, [clearReadinessRecoveryTimer]);

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

    if (connectivityStatus !== "online") {
      clearReadinessRecoveryTimer({ resetAttempts: true });
    }

    return () => {
      clearTimeout(timer);
    };
  }, [clearReadinessRecoveryTimer, connectivityStatus, persistStateUpdateReconnectDiagnostics, status]);

  return {
    isAuthSessionRestoring,
    isOperationalCoreReadinessChecking,
    isPendingWorkSyncing,
    reconnectSessionAndRecords,
    syncPendingRecords,
  };
}
