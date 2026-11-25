import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { appViewsAuthorizationScope, buildOwnerKey, createAppViewsReadEvent, loadAppViewsWithCache, type AppViewsReadEvent } from "../lib/app-navigation-cache";
import { OfflinePreparationDiagnostics, prewarmAssignedAppViewsOnce, invalidateHomePreparation } from "../lib/app-view-prewarm";
import { ConnectivityStatus } from "../lib/connectivity";
import { selectContractId } from "../lib/contract-selection";
import { LocalDatabase } from "../lib/local-db";
import { AUTH_REFRESH_TIMEOUT_MS, ContextResponse, MeResponse, OpcoApi, OpcoNetworkError } from "../lib/opco-api";
import { readPersistedContractId } from "../lib/session-persistence";
import { mergeStateUpdateReconnectPreflightTelemetryPatch, StateUpdateSyncTrigger, upsertStateUpdateReconnectRunHistory } from "../lib/state-update-offline";
import { createReconnectSyncController, ReconnectSyncController } from "./reconnect-sync";
import { StateUpdateReconnectDiagnostics } from "./use-session-diagnostics";
import { createSyncRunId, syncPendingWork, SyncPendingWorkPhaseEvent } from "../sync/pending-work-sync";
import { StateUpdateSyncStore, syncPendingStateUpdatesOnce } from "../sync/state-update-sync";
import * as tokenStorage from "../lib/token-storage";
import {
  isSessionLifecycleScopeCurrent,
  shouldRevalidateAssignedPreparation,
  getSessionLifecycleScopeMismatchReason,
  isRecoverableAuthRefreshError,
  getOperationalCoreReadyRecoveryDelayMs,
  planPostReadinessPendingWork,
  probeOperationalCoreReadiness,
  SessionLifecycleScope,
  shouldScheduleOperationalCoreReadyRecovery,
  shouldRunOnlinePendingSyncForReadyScope,
  shouldRunForegroundPendingSync,
  shouldGatePendingSyncWithOperationalCoreReady,
} from "./pending-work-lifecycle-logic";

function lifecycleScopeKey(scope: SessionLifecycleScope) {
  return JSON.stringify([scope.ownerKey, scope.selectedContractId, scope.token, scope.authGeneration ?? "legacy"]);
}
type RunTicket = { key: string; active: boolean; settled: Promise<void>; stateOnly: boolean; reevaluationRequested: boolean };

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
  recordOfflinePreparationDiagnostics(diagnostics: OfflinePreparationDiagnostics): void;
  persistStateUpdateReconnectDiagnostics(
    updater: (current: StateUpdateReconnectDiagnostics) => StateUpdateReconnectDiagnostics,
  ): Promise<void>;
  refreshPendingRecordsCount(): Promise<void>;
  refreshStateUpdateDiagnostics(): Promise<void>;
  selectedContractIdState: string | null;
  setContext(value: ContextResponse): void;
  setMe(value: MeResponse): void;
  setRecordsReconnectRefreshKey(updater: (key: number) => number, readEvent?: AppViewsReadEvent): void;
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
  recordOfflinePreparationDiagnostics,
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
  const reconnectSessionAndRecordsRef = useRef<(trigger?: StateUpdateSyncTrigger, onViewsRevalidated?: (event: AppViewsReadEvent) => void) => Promise<void | false>>(
    () => Promise.resolve(),
  );
  const reconnectShouldSyncRef = useRef<(isEvaluationCurrent?: () => boolean) => Promise<boolean>>(() => Promise.resolve(false));
  const reconnectSyncControllerRef = useRef<ReconnectSyncController | null>(null);
  const foregroundResumeSyncPromiseRef = useRef<Promise<void> | null>(null);
  const onlineReadyScopeSyncPromiseRef = useRef<Promise<void> | null>(null);
  const activePendingWorkRunRef = useRef<RunTicket | null>(null);
  const persistStateUpdateReconnectDiagnosticsRef = useRef(persistStateUpdateReconnectDiagnostics);
  const reconnectDiagnosticsQueueActiveRef = useRef(true);
  const reconnectDiagnosticsQueueScopeRef = useRef("none");
  const reconnectDiagnosticsWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
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
  const connectivityRef = useRef(connectivityStatus);
  useEffect(() => { connectivityRef.current = connectivityStatus; }, [connectivityStatus]);
  const authGeneration = api.getAuthSessionGeneration?.();
  const currentScopeKey = lifecycleScopeKey({ authGeneration, ownerKey, selectedContractId: selectedContractIdState, token });
  const [activity, setActivity] = useState({ scopeKey: currentScopeKey, syncing: false, auth: false, readiness: false });
  const isPendingWorkSyncing = activity.scopeKey === currentScopeKey && activity.syncing;
  const isAuthSessionRestoring = activity.scopeKey === currentScopeKey && activity.auth;
  const isOperationalCoreReadinessChecking = activity.scopeKey === currentScopeKey && activity.readiness;
  const latestSessionScopeRef = useRef<SessionLifecycleScope>({
    authGeneration,
    ownerKey,
    selectedContractId: selectedContractIdState,
    token,
  });

  const readCurrentScope = useCallback(() => ({ ...latestSessionScopeRef.current, authGeneration: api.getAuthSessionGeneration?.() }), [api]);

  useEffect(() => {
    latestSessionScopeRef.current = {
      authGeneration,
      ownerKey,
      selectedContractId: selectedContractIdState,
      token,
    };
  }, [authGeneration, ownerKey, selectedContractIdState, token]);

  useEffect(() => {
    persistStateUpdateReconnectDiagnosticsRef.current = persistStateUpdateReconnectDiagnostics;
  }, [persistStateUpdateReconnectDiagnostics]);

  useEffect(() => {
    reconnectDiagnosticsQueueActiveRef.current = true;
    reconnectDiagnosticsQueueScopeRef.current = `${ownerKey ?? "none"}:${selectedContractIdState ?? "none"}:${token ?? "none"}:${authGeneration ?? "legacy"}`;

    return () => {
      reconnectDiagnosticsQueueActiveRef.current = false;
      reconnectDiagnosticsWriteQueueRef.current = Promise.resolve();
    };
  }, [authGeneration, ownerKey, selectedContractIdState, token]);

  useEffect(() => {
    setRecordsReconnectRefreshKeyRef.current = setRecordsReconnectRefreshKey;
  }, [setRecordsReconnectRefreshKey]);

  const queueReconnectDiagnosticsUpdate = useCallback((
    updater: (current: StateUpdateReconnectDiagnostics) => StateUpdateReconnectDiagnostics,
    isCurrent: () => boolean = () => true,
  ) => {
    if (!isCurrent()) return;
    const persist = persistStateUpdateReconnectDiagnosticsRef.current;
    const scopeKey = reconnectDiagnosticsQueueScopeRef.current;

    reconnectDiagnosticsWriteQueueRef.current = reconnectDiagnosticsWriteQueueRef.current
      .catch(() => undefined)
      .then(() => {
        if (!isCurrent() || !reconnectDiagnosticsQueueActiveRef.current || reconnectDiagnosticsQueueScopeRef.current !== scopeKey) {
          return undefined;
        }

        // The persistence callback can itself await SQLite; check again at the mutation.
        return persist(current => isCurrent() && reconnectDiagnosticsQueueActiveRef.current && reconnectDiagnosticsQueueScopeRef.current === scopeKey ? updater(current) : current);
      })
      .catch(() => undefined);
  }, []);

  const markStateUpdateActivity = useCallback(({
    isCurrent = () => true,
    result,
    startedAt,
    syncRunId,
    trigger,
    type,
  }: {
    isCurrent?: () => boolean;
    result: "auth_pending" | "auth_timeout" | "cancelled_scope_changed" | "failed" | "interrupted" | "ready_confirmed" | "ready_failed" | "reconnecting" | "records_failed_before_state_update" | "sync_started";
    startedAt: string;
    syncRunId: string;
    trigger: StateUpdateSyncTrigger | "auth_refresh" | "ready_check" | "reconnect";
    type: "auth_refresh" | "ready_check" | "reconnect" | "sync";
  }) => {
    const completedAt = new Date().toISOString();

    queueReconnectDiagnosticsUpdate((current) => {
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
      }, isCurrent);
  }, [connectivityStatus, queueReconnectDiagnosticsUpdate]);

  const updateReconnectPreflight = useCallback((
    syncRunId: string,
    updater: (current: NonNullable<StateUpdateReconnectDiagnostics["lastReconnectPreflight"]>) => NonNullable<StateUpdateReconnectDiagnostics["lastReconnectPreflight"]>,
    isCurrent: () => boolean = () => true,
  ) => {
    queueReconnectDiagnosticsUpdate((current) => {
      const previous = current.lastReconnectPreflight?.syncRunId === syncRunId
        ? current.lastReconnectPreflight
        : (current.reconnectRunHistory ?? []).find((entry) => entry.syncRunId === syncRunId) ?? null;
      const base = previous ?? {
        authDecision: null,
        authRefreshCompletedAt: null,
        authRefreshStartedAt: null,
        completedAt: null,
        countPendingOperationsCount: null,
        countPendingOperationsDurationMs: null,
        debounceCompletedAt: null,
        debounceDurationMs: null,
        debounceStartedAt: null,
        listPendingStateUpdateOperationsCount: null,
        listPendingStateUpdateOperationsDurationMs: null,
        readinessAttempts: null,
        readinessCompletedAt: null,
        readinessConfirmedAt: null,
        readinessDurationMs: null,
        readinessStartedAt: null,
        reconnectDetectedAt: null,
        runSyncStartedAt: null,
        scopeCheckAfterReadiness: null,
        recordsOperationsCompleted: null,
        recordsOperationsConflicted: null,
        recordsOperationsFailed: null,
        recordsOperationsRetriable: null,
        recordsPhaseCompletedAt: null,
        recordsPhaseFailedAt: null,
        recordsPhaseResult: null,
        recordsPhaseStartedAt: null,
        stateUpdateOperationsSelected: null,
        stateUpdatePhaseCompletedAt: null,
        stateUpdatePhaseFailedAt: null,
        stateUpdatePhaseResult: null,
        stateUpdatePhaseStartedAt: null,
        shouldSyncCompletedAt: null,
        shouldSyncDurationMs: null,
        shouldSyncResult: null,
        shouldSyncStartedAt: null,
        syncPendingWorkCompletedAt: null,
        syncPendingWorkStartedAt: null,
        syncRunId,
        trigger: "other",
      };

      const nextPreflight = mergeStateUpdateReconnectPreflightTelemetryPatch(base, updater(base));

      return {
        ...current,
        lastReconnectPreflight: nextPreflight,
        reconnectRunHistory: upsertStateUpdateReconnectRunHistory(current.reconnectRunHistory, nextPreflight),
      };
    }, isCurrent);
  }, [queueReconnectDiagnosticsUpdate]);

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

  // One existing recovery wait serves readiness, transient auth and retryable business results.
  const scheduleReadinessRecovery = useCallback((scope: SessionLifecycleScope) => {
    const runScope = { ...scope };
    const isScopeCurrent = Boolean(runScope.ownerKey && runScope.selectedContractId && runScope.token) &&
      isSessionLifecycleScopeCurrent(runScope, readCurrentScope());
    // Stale observers cannot cancel another login's wait; active runs decide on completion.
    const hasScopeRunActive = Boolean(activePendingWorkRunRef.current?.active && activePendingWorkRunRef.current.key === lifecycleScopeKey(runScope));
    if (!isScopeCurrent || hasScopeRunActive) return;
    const current = readinessRecoveryRef.current;

    if (current?.timer) {
      return;
    }

    if (!shouldScheduleOperationalCoreReadyRecovery({
      appLifecycleState: appLifecycleStateRef.current,
      connectivityStatus: connectivityRef.current,
      hasRecoveryTimer: false,
      hasRunActive: hasScopeRunActive,
      isScopeCurrent,
      pendingWorkExists: true,
    })) {
      clearReadinessRecoveryTimer({ resetAttempts: true });
      return;
    }

    const scopeKey = lifecycleScopeKey(runScope);
    const attempts = current?.scopeKey === scopeKey ? current.attempts : 0;

    const delayMs = getOperationalCoreReadyRecoveryDelayMs(attempts);

    if (delayMs === null) {
      return;
    }
    const timer = setTimeout(() => {
      if (readinessRecoveryRef.current?.timer !== timer) return;
      const latestScope = readCurrentScope();

      const evaluation = { attempts: attempts + 1, scopeKey, timer: null };
      readinessRecoveryRef.current = evaluation;
      const isEvaluationCurrent = () => readinessRecoveryRef.current === evaluation &&
        isSessionLifecycleScopeCurrent(runScope, readCurrentScope());

      if (
        connectivityRef.current !== "online" ||
        appLifecycleStateRef.current !== "active" ||
        !isSessionLifecycleScopeCurrent(runScope, latestScope)
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
      }), isEvaluationCurrent);

      void reconnectShouldSyncRef.current(isEvaluationCurrent)
        .then((shouldSync) => {
          // Counting can cross logout/login, including a new login of the same owner.
          if (!isEvaluationCurrent()) return undefined;
          if (!shouldSync) {
            clearReadinessRecoveryTimer({ resetAttempts: true });
            return undefined;
          }

          if (connectivityRef.current !== "online" || appLifecycleStateRef.current !== "active" || (activePendingWorkRunRef.current?.active && activePendingWorkRunRef.current.key === scopeKey)) return undefined;
          return reconnectSessionAndRecordsRef.current("startup-with-pending").then(() => undefined);
        })
        .catch(() => undefined);
    }, delayMs);

    readinessRecoveryRef.current = {
      attempts: attempts + 1,
      scopeKey,
      timer,
    };
  }, [clearReadinessRecoveryTimer, readCurrentScope, updateReconnectPreflight]);

  const captureEligibilityAttempt = useCallback(() => {
    const scope = readCurrentScope();
    const run = activePendingWorkRunRef.current;
    const recovery = readinessRecoveryRef.current;
    return () => activePendingWorkRunRef.current === run && readinessRecoveryRef.current === recovery &&
      isSessionLifecycleScopeCurrent(scope, readCurrentScope());
  }, [readCurrentScope]);

  useEffect(() => () => clearReadinessRecoveryTimer({ resetAttempts: true }),
    [authGeneration, ownerKey, selectedContractIdState, token, clearReadinessRecoveryTimer]);

  const runPendingWorkAfterReadiness = useCallback(async ({
    ownerKey: runOwnerKey,
    runScope,
    syncRunId,
    token: runToken,
    trigger,
    stateUpdateWork,
  }: {
    ownerKey: string;
    runScope: SessionLifecycleScope;
    syncRunId: string;
    token: string;
    trigger: StateUpdateSyncTrigger;
    stateUpdateWork?: () => ReturnType<SyncPendingStateUpdatesWithTelemetry>;
  }) => {
    if (!isSessionLifecycleScopeCurrent(runScope, readCurrentScope())) return "cancelled";
    const runKey = lifecycleScopeKey(runScope);
    // Manual diagnostics shares this coordinator, not a new global HTTP mutex.
    // A combined caller waits for a manual STATE_UPDATE pass so RECORDS is not skipped.
    while (activePendingWorkRunRef.current?.active && activePendingWorkRunRef.current.key === runKey) {
      const active = activePendingWorkRunRef.current;
      if (!stateUpdateWork && !active.stateOnly) {
        active.reevaluationRequested = true;
        return "already-running";
      }
      await active.settled;
      if (!isSessionLifecycleScopeCurrent(runScope, readCurrentScope())) return "cancelled";
    }
    const previousRecovery = readinessRecoveryRef.current?.scopeKey === runKey;
    clearReadinessRecoveryTimer();
    let release!: () => void;
    const ticket: RunTicket = { key: runKey, active: true, stateOnly: Boolean(stateUpdateWork), reevaluationRequested: false, settled: new Promise<void>(resolve => { release = resolve; }) };
    activePendingWorkRunRef.current = ticket;
    const isRunCurrent = () => activePendingWorkRunRef.current === ticket && isSessionLifecycleScopeCurrent(runScope, readCurrentScope());
    const updateRunPreflight = (id: string, updater: Parameters<typeof updateReconnectPreflight>[1]) => updateReconnectPreflight(id, updater, isRunCurrent);
    const markRunActivity = (input: Parameters<typeof markStateUpdateActivity>[0]) => markStateUpdateActivity({ ...input, isCurrent: isRunCurrent });
    const publishActivity = (patch: Partial<Pick<typeof activity, "syncing" | "auth" | "readiness">>) => {
      if (isRunCurrent()) setActivity(current => isRunCurrent() ? ({ ...(current.scopeKey === ticket.key ? current : { scopeKey: ticket.key, syncing: false, auth: false, readiness: false }), ...patch }) : current);
    };
    let recover = false;
    let finished = false;
    try {
      let syncToken = runToken;

      if (shouldGatePendingSyncWithOperationalCoreReady(trigger)) {
        const startedAt = new Date().toISOString();

        await updateRunPreflight(syncRunId, (current) => ({
          ...current,
          readinessStartedAt: startedAt,
        }));
        await markRunActivity({
          result: "reconnecting",
          startedAt,
          syncRunId,
          trigger: "ready_check",
          type: "ready_check",
        });

        if (!isSessionLifecycleScopeCurrent(runScope, readCurrentScope())) {
          await updateRunPreflight(syncRunId, (current) => ({
            ...current,
            scopeCheckAfterReadiness: getSessionLifecycleScopeMismatchReason(runScope, readCurrentScope()),
          }));
          await markRunActivity({
            result: "cancelled_scope_changed",
            startedAt,
            syncRunId,
            trigger: "ready_check",
            type: "ready_check",
          });
          return "cancelled";
        }

        publishActivity({ readiness: true });
        let readiness;
        try {
          readiness = await probeOperationalCoreReadiness({ api, syncRunId });
        } catch {
          const completedAt = new Date().toISOString();
          await updateRunPreflight(syncRunId, (current) => ({
            ...current,
            completedAt,
            readinessCompletedAt: completedAt,
            readinessDurationMs: Date.parse(completedAt) - Date.parse(startedAt),
          }));
          await markRunActivity({
            result: "interrupted",
            startedAt,
            syncRunId,
            trigger: "ready_check",
            type: "ready_check",
          });
          return "blocked";
        } finally {
          publishActivity({ readiness: false });
        }

        const readinessCompletedAt = new Date().toISOString();
        await updateRunPreflight(syncRunId, (current) => ({
          ...current,
          completedAt: readinessCompletedAt,
          readinessAttempts: readiness.attempts,
          readinessCompletedAt,
          readinessDurationMs: Date.parse(readinessCompletedAt) - Date.parse(startedAt),
        }));

        if (!readiness.ready) {
          await markRunActivity({
            result: "ready_failed",
            startedAt,
            syncRunId,
            trigger: "ready_check",
            type: "ready_check",
          });
          recover = true;
          return "readiness-blocked";
        }

        await markRunActivity({
          result: "ready_confirmed",
          startedAt,
          syncRunId,
          trigger: "ready_check",
          type: "ready_check",
        });
        const postReadinessPlan = planPostReadinessPendingWork({
          currentScope: readCurrentScope(),
          runScope,
          token: syncToken,
        });
        await updateRunPreflight(syncRunId, (current) => ({
          ...current,
          authDecision: postReadinessPlan.authDecision,
          readinessConfirmedAt: readinessCompletedAt,
          scopeCheckAfterReadiness: postReadinessPlan.scopeCheckAfterReadiness,
        }));

        if (postReadinessPlan.nextAction === "cancelled_scope_changed") {
          await markRunActivity({
            result: "cancelled_scope_changed",
            startedAt,
            syncRunId,
            trigger: "ready_check",
            type: "ready_check",
          });
          return "cancelled";
        }

        if (postReadinessPlan.authDecision === "refresh_required") {
          const authRefreshStartedAt = new Date().toISOString();
          await updateRunPreflight(syncRunId, (current) => ({
            ...current,
            authRefreshStartedAt,
          }));
          await markRunActivity({
            result: "auth_pending",
            startedAt: authRefreshStartedAt,
            syncRunId,
            trigger: "auth_refresh",
            type: "auth_refresh",
          });
          publishActivity({ auth: true });
          try {
            const refreshed = await api.refreshSession({
              diagnosticSyncRunId: syncRunId,
              timeoutMs: AUTH_REFRESH_TIMEOUT_MS,
            });

            // refreshSession already guards credential persistence (C-08). Guard UI/token publication too.
            const liveScope = readCurrentScope();
            if (activePendingWorkRunRef.current !== ticket || !isSessionLifecycleScopeCurrent(
              { ...runScope, token: liveScope.token }, liveScope,
            ) || (liveScope.token !== runScope.token && liveScope.token !== refreshed.accessToken)) return "cancelled";
            syncToken = refreshed.accessToken;
            runScope.token = syncToken;
            latestSessionScopeRef.current = {
              ...latestSessionScopeRef.current,
              token: syncToken,
            };
            ticket.key = lifecycleScopeKey(runScope);
            setToken(syncToken);
            await updateRunPreflight(syncRunId, (current) => ({
              ...current,
              authRefreshCompletedAt: new Date().toISOString(),
            }));
          } catch (error) {
            await updateRunPreflight(syncRunId, (current) => ({
              ...current,
              authRefreshCompletedAt: new Date().toISOString(),
            }));
            const result = error instanceof OpcoNetworkError && error.diagnostics?.abortControllerTriggered
              ? "auth_timeout"
              : "auth_pending";

            if (isRecoverableAuthRefreshError(error)) {
              await markRunActivity({
                result,
                startedAt,
                syncRunId,
                trigger: "auth_refresh",
                type: "auth_refresh",
              });
              recover = true;
              return "blocked";
            }

            await markRunActivity({
              result: "auth_pending",
              startedAt,
              syncRunId,
              trigger: "auth_refresh",
              type: "auth_refresh",
            });
            throw error;
          } finally {
            publishActivity({ auth: false });
          }
        }

        const scopeCheckAfterReadiness = getSessionLifecycleScopeMismatchReason(runScope, readCurrentScope());
        await updateRunPreflight(syncRunId, (current) => ({
          ...current,
          scopeCheckAfterReadiness,
        }));

        if (scopeCheckAfterReadiness !== "current") {
          await markRunActivity({
            result: "cancelled_scope_changed",
            startedAt,
            syncRunId,
            trigger: "ready_check",
            type: "ready_check",
          });
          return "cancelled";
        }

        await markRunActivity({
          result: "sync_started",
          startedAt,
          syncRunId,
          trigger: "ready_check",
          type: "ready_check",
        });
      }

      if (!isRunCurrent()) return "cancelled";
      await updateRunPreflight(syncRunId, (current) => ({
        ...current,
        syncPendingWorkStartedAt: new Date().toISOString(),
      }));
      publishActivity({ syncing: true });
      let recordsFailedBeforeStateUpdate = false;
      try {
        const result = stateUpdateWork
          ? { records: { completed: 0, conflicts: 0, failed: 0, retriable: 0 }, stateUpdate: await stateUpdateWork() }
          : await syncPendingWork({
          api,
          ownerKey: runOwnerKey,
          recordsStore: definitionCache,
          syncRunId,
          syncStateUpdates: syncPendingStateUpdatesWithTelemetry,
          token: syncToken,
          trigger,
          onPhase(event) {
            if (event.phase === "records" && event.result === "failed") {
              recordsFailedBeforeStateUpdate = true;
            }
            return updateRunPreflight(syncRunId, (current) => ({
              ...current,
              ...syncPendingWorkPhaseToReconnectPreflight(event),
            }));
          },
        });
        await updateRunPreflight(syncRunId, (current) => ({
          ...current,
          syncPendingWorkCompletedAt: new Date().toISOString(),
        }));
        recover = result.records.retriable > 0 || (result.stateUpdate?.result.retriable ?? 0) > 0;
        // A completed engine snapshot may predate a new durable command, including
        // a shared login flight. Consume existing demand before checking eligibility;
        // demand arriving during the read still gets one deferred C-10 check.
        if (!recover && isRunCurrent() && (!stateUpdateWork || previousRecovery)) {
          ticket.reevaluationRequested = false;
          const pending = await reconnectShouldSyncRef.current(isRunCurrent);
          recover = pending || ticket.reevaluationRequested;
        }
        finished = true;
        return "completed";
      } catch (error) {
        await updateRunPreflight(syncRunId, (current) => ({
          ...current,
          syncPendingWorkCompletedAt: new Date().toISOString(),
        }));
        await markRunActivity({
          result: recordsFailedBeforeStateUpdate ? "records_failed_before_state_update" : "failed",
          startedAt: new Date().toISOString(),
          syncRunId,
          trigger,
          type: "sync",
        });
        throw error;
      } finally {
        publishActivity({ syncing: false });
      }
    } finally {
      // A diagnostic exception must not consume recovery already owed to RECORDS.
      if (stateUpdateWork && previousRecovery && !finished && isRunCurrent()) {
        try { recover = await reconnectShouldSyncRef.current(isRunCurrent); }
        catch { /* SQLite uncertainty never triggers a blind business replay. */ }
      }
      ticket.active = false;
      release();
      if (isRunCurrent()) {
        if (recover) scheduleReadinessRecovery(runScope);
        else if (finished) clearReadinessRecoveryTimer({ resetAttempts: true });
      }
    }
  }, [api, clearReadinessRecoveryTimer, definitionCache, markStateUpdateActivity, readCurrentScope, scheduleReadinessRecovery, setToken, syncPendingStateUpdatesWithTelemetry, updateReconnectPreflight]);

  const coordinateStateUpdateDiagnosticSync = useCallback(async (
    scope: SessionLifecycleScope,
    work: () => ReturnType<SyncPendingStateUpdatesWithTelemetry>,
  ) => {
    if (!scope.ownerKey || !scope.token) return null;
    let result: Awaited<ReturnType<SyncPendingStateUpdatesWithTelemetry>> = null;
    await runPendingWorkAfterReadiness({ ownerKey: scope.ownerKey, token: scope.token, runScope: { ...scope }, syncRunId: createSyncRunId(), trigger: "manual-retry",
      stateUpdateWork: async () => { result = await work(); return result; },
    });
    return result;
  }, [runPendingWorkAfterReadiness]);

  const syncPendingRecords = useCallback(async (trigger: StateUpdateSyncTrigger = "manual-retry") => {
    if (!token || !ownerKey) {
      return;
    }

    const runScope = {
      authGeneration,
      ownerKey,
      selectedContractId: selectedContractIdState,
      token,
    };
    const syncRunId = createSyncRunId();

    try {
      const syncResult = await runPendingWorkAfterReadiness({
        ownerKey,
        runScope,
        syncRunId,
        token,
        trigger,
      });
      if (syncResult === "completed" && isSessionLifecycleScopeCurrent(runScope, readCurrentScope())) {
        setRecordsReconnectRefreshKeyRef.current((key) => key + 1);
      }

      if (isSessionLifecycleScopeCurrent(runScope, readCurrentScope()) && shouldShowStateUpdateDiagnostics) {
        await refreshStateUpdateDiagnostics();
      }
    } finally {
      if (isSessionLifecycleScopeCurrent(runScope, readCurrentScope())) {
        await refreshPendingRecordsCount();
      }
    }
  }, [
    authGeneration,
    readCurrentScope,
    ownerKey,
    refreshPendingRecordsCount,
    refreshStateUpdateDiagnostics,
    runPendingWorkAfterReadiness,
    selectedContractIdState,
    shouldShowStateUpdateDiagnostics,
    token,
  ]);

  const reconnectSessionAndRecords = useCallback(async (trigger: StateUpdateSyncTrigger = "reconnect", onViewsRevalidated?: (event: AppViewsReadEvent) => void) => {
    if (!token) {
      return false;
    }

    let nextToken = token;
    let pendingWorkAlreadyHandled = false;
    const preflight = reconnectPreflightRef.current?.trigger === trigger ? reconnectPreflightRef.current : null;
    const syncRunId = preflight?.syncRunId ?? createSyncRunId();
    const runScope = {
      authGeneration,
      ownerKey,
      selectedContractId: selectedContractIdState,
      token,
    };

    const isReconnectCurrent = () => isSessionLifecycleScopeCurrent(runScope, readCurrentScope());
    if (!isReconnectCurrent()) return false;
    updateReconnectPreflight(syncRunId, (current) => ({ ...current,
      debounceCompletedAt: current.debounceCompletedAt ?? new Date().toISOString(), runSyncStartedAt: new Date().toISOString(),
    }), isReconnectCurrent);
    if (ownerKey && selectedContractIdState) {
      const syncResult = await runPendingWorkAfterReadiness({
        ownerKey,
        runScope,
        syncRunId,
        token,
        trigger,
      });

      if (!isReconnectCurrent()) return false;
      nextToken = runScope.token ?? token;

      if (syncResult === "readiness-blocked") return false;

      if (syncResult === "blocked" || syncResult === "cancelled") {
        return false;
      }

      pendingWorkAlreadyHandled = syncResult === "completed" || syncResult === "already-running";
    }

    if ((trigger === "reconnect" || trigger === "foreground/resume") && runScope.ownerKey && runScope.selectedContractId &&
      isSessionLifecycleScopeCurrent(runScope, readCurrentScope())) {
      invalidateHomePreparation({ store: definitionCache, ownerKey: runScope.ownerKey, contractId: runScope.selectedContractId, token: nextToken });
    }
    const nextMe = await api.getMe(nextToken);
    const nextContext = await api.getContext(nextToken);
    const nextOwnerKey = buildOwnerKey(nextMe, nextContext);

    if (!isSessionLifecycleScopeCurrent(runScope, readCurrentScope())) {
      return false;
    }

    const nextContractId = selectContractId(
      nextContext.contracts,
      selectedContractIdState ?? await readPersistedContractId(definitionCache, nextOwnerKey),
    );

    await api.commitAuthSession(authGeneration ?? api.getAuthSessionGeneration(), async () => {
      await tokenStorage.setSessionOwnerKey(nextOwnerKey);
      await definitionCache.upsertContextSnapshot(nextOwnerKey, nextMe, nextContext, new Date().toISOString());
    });
    if (!isSessionLifecycleScopeCurrent(runScope, readCurrentScope())) return false;
    setMe(nextMe); setContext(nextContext); setStatus("authenticated");
    setSelectedContractIdState(nextContractId);
    runScope.ownerKey = nextOwnerKey;
    runScope.selectedContractId = nextContractId;
    latestSessionScopeRef.current = {
      authGeneration,
      ownerKey: nextOwnerKey,
      selectedContractId: nextContractId,
      token: nextToken,
    };

    if (nextContractId) {
      const authorizationScope = appViewsAuthorizationScope(nextMe, nextContext);
      const readEvent = createAppViewsReadEvent({ api, cache: definitionCache, ownerKey: nextOwnerKey,
        contractId: nextContractId, token: nextToken, authorizationScope, invalidationKey: syncRunId });
      const appViewsResult = await loadAppViewsWithCache({
        api,
        cache: definitionCache,
        contractId: nextContractId,
        ownerKey: nextOwnerKey,
        token: nextToken,
        invalidationKey: syncRunId,
        readEvent,
        authorizationScope,
      });

      if (!appViewsResult.offline) {
        if (!isSessionLifecycleScopeCurrent(runScope, readCurrentScope())) return false;
        try { onViewsRevalidated?.(readEvent); } catch { /* Read observers never control pending-work execution. */ }
        void prewarmAssignedAppViewsOnce({
          homeListWrite: appViewsResult.cacheWrite ?? undefined,
          api,
          appViews: appViewsResult.views,
          contractId: nextContractId,
          ownerKey: nextOwnerKey,
          onTelemetry: recordOfflinePreparationDiagnostics,
          store: definitionCache,
          token: nextToken,
          trigger,
          invalidationKey: syncRunId,
          authorizationScope,
        });
      }
    }

    if (!isSessionLifecycleScopeCurrent(runScope, readCurrentScope())) {
      return false;
    }

    if (!pendingWorkAlreadyHandled) {
      await runPendingWorkAfterReadiness({
        ownerKey: nextOwnerKey,
        runScope,
        syncRunId,
        token: nextToken,
        trigger,
      });

    }
    if (!isSessionLifecycleScopeCurrent(runScope, readCurrentScope())) {
      return false;
    }

    if (shouldShowStateUpdateDiagnostics) {
      await refreshStateUpdateDiagnostics();
    }
    if (!isReconnectCurrent()) return false;
    await refreshPendingRecordsCount();
    if (!isReconnectCurrent()) return false;
  }, [
    api,
    authGeneration,
    readCurrentScope,
    definitionCache,
    ownerKey,
    recordOfflinePreparationDiagnostics,
    refreshPendingRecordsCount,
    refreshStateUpdateDiagnostics,
    selectedContractIdState,
    setContext,
    setMe,
    setSelectedContractIdState,
    setStatus,
    shouldShowStateUpdateDiagnostics,
    runPendingWorkAfterReadiness,
    token,
    updateReconnectPreflight,
  ]);

  useEffect(() => {
    reconnectSessionAndRecordsRef.current = reconnectSessionAndRecords;
  }, [reconnectSessionAndRecords]);

  const hasReconnectPendingWork = useCallback(async (isEvaluationCurrent: () => boolean = () => true) => {
    if (!ownerKey) {
      return false;
    }

    const scope = { authGeneration, ownerKey, selectedContractId: selectedContractIdState, token };
    const isCurrent = () => isEvaluationCurrent() && isSessionLifecycleScopeCurrent(scope, readCurrentScope());
    if (!isCurrent()) return false;
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

    if (!isCurrent()) return false;
    if (preflight) {
      await updateReconnectPreflight(preflight.syncRunId, (current) => ({
        ...current,
        countPendingOperationsCount: recordsResult.count,
        countPendingOperationsDurationMs: recordsResult.durationMs,
        debounceCompletedAt: current.debounceCompletedAt ?? startedAt.toISOString(),
        debounceDurationMs: current.debounceStartedAt ? Date.parse(startedAt.toISOString()) - Date.parse(current.debounceStartedAt) : null,
        listPendingStateUpdateOperationsCount: stateUpdateResult.operations.length,
        listPendingStateUpdateOperationsDurationMs: stateUpdateResult.durationMs,
        shouldSyncCompletedAt: completedAt,
        shouldSyncDurationMs: Date.now() - startedMs,
        shouldSyncResult: shouldSync,
        shouldSyncStartedAt: startedAt.toISOString(),
      }), isCurrent);
    }

    return shouldSync;
  }, [authGeneration, definitionCache, ownerKey, readCurrentScope, selectedContractIdState, token, updateReconnectPreflight]);

  useEffect(() => {
    reconnectShouldSyncRef.current = hasReconnectPendingWork;
  }, [hasReconnectPendingWork]);

  useEffect(() => {
    const scopeKey = ownerKey && selectedContractIdState && token
      ? `${ownerKey}:${selectedContractIdState}:${token}:${authGeneration ?? "legacy"}`
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
      authGeneration,
      ownerKey,
      selectedContractId: selectedContractIdState,
      token,
    };

    const isAttemptCurrent = captureEligibilityAttempt();
    const flight = reconnectShouldSyncRef.current(isAttemptCurrent)
      .then((shouldSync) => {
        if (!isAttemptCurrent() || !isSessionLifecycleScopeCurrent(runScope, readCurrentScope())) return undefined;
        if (!shouldSync) {
          return undefined;
        }
        return reconnectSessionAndRecordsRef.current("startup-with-pending").then(() => undefined);
      })
      .catch(() => undefined)
      .finally(() => {
        if (onlineReadyScopeSyncPromiseRef.current === flight) onlineReadyScopeSyncPromiseRef.current = null;
      });
    onlineReadyScopeSyncPromiseRef.current = flight;
  }, [authGeneration, captureEligibilityAttempt, connectivityStatus, ownerKey, readCurrentScope, selectedContractIdState, status, token]);

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

      const runScope = readCurrentScope();
      const isAttemptCurrent = captureEligibilityAttempt();
      const flight = reconnectShouldSyncRef.current(isAttemptCurrent)
        .then((shouldSync) => {
          if (!isAttemptCurrent() || !isSessionLifecycleScopeCurrent(runScope, readCurrentScope())) return undefined;
          if (!shouldRevalidateAssignedPreparation("foreground/resume", shouldSync)) return undefined;
          let readEvent: AppViewsReadEvent | undefined;
          return reconnectSessionAndRecordsRef.current("foreground/resume", event => { readEvent = event; }).then(result => {
            if (result !== false && isSessionLifecycleScopeCurrent(runScope, readCurrentScope())) setRecordsReconnectRefreshKeyRef.current(key => key + 1, readEvent);
          });
        })
        .catch(() => undefined)
        .finally(() => {
          if (foregroundResumeSyncPromiseRef.current === flight) foregroundResumeSyncPromiseRef.current = null;
        });
      foregroundResumeSyncPromiseRef.current = flight;
    });

    return () => {
      subscription.remove();
    };
  }, [captureEligibilityAttempt, clearReadinessRecoveryTimer, connectivityStatus, readCurrentScope, status]);

  useEffect(() => {
    let readEvent: AppViewsReadEvent | undefined;
    let controllerScope: SessionLifecycleScope | null = null;
    let isControllerAttemptCurrent = () => false;
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

        controllerScope = readCurrentScope();
        const detectedScope = controllerScope;
        queueReconnectDiagnosticsUpdate((current) => {
          const lastReconnectPreflight = {
            authDecision: null,
            authRefreshCompletedAt: null,
            authRefreshStartedAt: null,
            completedAt: null,
            countPendingOperationsCount: null,
            countPendingOperationsDurationMs: null,
            debounceCompletedAt: null,
            debounceDurationMs: null,
            debounceStartedAt: detectedAt,
            listPendingStateUpdateOperationsCount: null,
            listPendingStateUpdateOperationsDurationMs: null,
            readinessAttempts: null,
            readinessCompletedAt: null,
            readinessConfirmedAt: null,
            readinessDurationMs: null,
            readinessStartedAt: null,
            reconnectDetectedAt: detectedAt,
            runSyncStartedAt: null,
            scopeCheckAfterReadiness: null,
            shouldSyncCompletedAt: null,
            shouldSyncDurationMs: null,
            shouldSyncResult: null,
            shouldSyncStartedAt: null,
            syncPendingWorkCompletedAt: null,
            syncPendingWorkStartedAt: null,
            syncRunId,
            trigger,
          } satisfies NonNullable<StateUpdateReconnectDiagnostics["lastReconnectPreflight"]>;

          return {
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
            lastReconnectPreflight,
            reconnectRunHistory: upsertStateUpdateReconnectRunHistory(current.reconnectRunHistory, lastReconnectPreflight),
          };
        }, () => isSessionLifecycleScopeCurrent(detectedScope, readCurrentScope()));
      },
      onSynced() {
        if (!controllerScope || !isSessionLifecycleScopeCurrent(controllerScope, readCurrentScope())) return;
        setRecordsReconnectRefreshKeyRef.current((key) => key + 1, readEvent);
        readEvent = undefined;
      },
      runSync({ trigger }) {
        if (!isControllerAttemptCurrent()) return Promise.resolve(false);
        readEvent = undefined;
        return reconnectSessionAndRecordsRef.current(trigger, event => {
          readEvent = event;
          // This callback runs only after the run verified its refreshed scope.
          controllerScope = readCurrentScope();
        });
      },
      async shouldSync() {
        isControllerAttemptCurrent = captureEligibilityAttempt();
        const isCurrent = isControllerAttemptCurrent;
        const pending = await reconnectShouldSyncRef.current(isCurrent);
        return isCurrent() && shouldRevalidateAssignedPreparation(reconnectPreflightRef.current?.trigger ?? "unknown-to-online", pending);
      },
    });

    reconnectSyncControllerRef.current = controller;

    return () => {
      controller.dispose();
      clearReadinessRecoveryTimer({ resetAttempts: true });
      reconnectSyncControllerRef.current = null;
    };
  }, [captureEligibilityAttempt, clearReadinessRecoveryTimer, queueReconnectDiagnosticsUpdate, readCurrentScope]);

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
    requestPendingWorkRecovery: scheduleReadinessRecovery,
    coordinateStateUpdateDiagnosticSync,
  };
}

function syncPendingWorkPhaseToReconnectPreflight(event: SyncPendingWorkPhaseEvent) {
  if (event.phase === "records") {
    return {
      ...(event.recordsOperationsCompleted === undefined ? {} : { recordsOperationsCompleted: event.recordsOperationsCompleted }),
      ...(event.recordsOperationsConflicted === undefined ? {} : { recordsOperationsConflicted: event.recordsOperationsConflicted }),
      ...(event.recordsOperationsFailed === undefined ? {} : { recordsOperationsFailed: event.recordsOperationsFailed }),
      ...(event.recordsOperationsRetriable === undefined ? {} : { recordsOperationsRetriable: event.recordsOperationsRetriable }),
      ...(event.completedAt === undefined ? {} : { recordsPhaseCompletedAt: event.completedAt }),
      ...(event.failedAt === undefined ? {} : { recordsPhaseFailedAt: event.failedAt }),
      recordsPhaseResult: event.result === "completed" || event.result === "failed" ? event.result : null,
      ...(event.startedAt === undefined ? {} : { recordsPhaseStartedAt: event.startedAt }),
    };
  }

  return {
    ...(event.stateUpdateOperationsSelected === undefined ? {} : { stateUpdateOperationsSelected: event.stateUpdateOperationsSelected }),
    ...(event.completedAt === undefined ? {} : { stateUpdatePhaseCompletedAt: event.completedAt }),
    ...(event.failedAt === undefined ? {} : { stateUpdatePhaseFailedAt: event.failedAt }),
    stateUpdatePhaseResult: event.result === "completed" || event.result === "failed" ? event.result : null,
    ...(event.startedAt === undefined ? {} : { stateUpdatePhaseStartedAt: event.startedAt }),
  };
}
