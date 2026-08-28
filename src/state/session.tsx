import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Alert, AppState, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { buildOwnerKey, loadAppViewsWithCache } from "@/lib/app-navigation-cache";
import { prewarmAssignedAppViewsOnce } from "@/lib/app-view-prewarm";
import { useConnectivityStatus } from "@/lib/connectivity";
import { selectContractId } from "@/lib/contract-selection";
import {
  createStateUpdateDiagnosticApi,
  createStateUpdateDiagnosticEvents,
  createStateUpdateDiagnosticStore,
} from "@/diagnostics/state-update-route-logic";
import {
  getLocalDatabase,
  getLocalDatabaseRecoverySummary,
  getLocalDatabaseStorageState,
  LocalDatabase,
  resetLocalDatabaseAfterConfirmation,
  retryLocalDatabaseInitialization,
  subscribeLocalDatabaseStorageState,
} from "@/lib/local-db";
import {
  formatLocalStorageResetWarning,
  isLocalDatabaseUnavailableError,
  LocalDatabaseUnavailableCause,
  LocalDatabaseRecoverySummary,
  LocalDatabaseStorageState,
} from "@/lib/local-db-recovery";
import { RecordsSyncSummary } from "@/lib/offline-records";
import { ContextResponse, createOpcoApi, MeResponse, OpcoApi, OpcoNetworkError } from "@/lib/opco-api";
import { restoreSession } from "@/lib/session-logic";
import { persistSelectedContractId, readPersistedContractId } from "@/lib/session-persistence";
import {
  mergeStateUpdateSyncDiagnosticsTelemetry,
  StateUpdateOutboxDiagnostics,
  StateUpdateSyncDiagnosticsTelemetry,
  StateUpdateSyncTrigger,
} from "@/lib/state-update-offline";
import { createReconnectSyncController, ReconnectSyncController } from "@/state/reconnect-sync";
import { shouldEmitStateUpdateRefresh } from "@/state/state-update-refresh";
import { syncPendingRecordsOnce } from "@/sync/records-sync";
import { StateUpdateSyncStore, syncPendingStateUpdatesOnce } from "@/sync/state-update-sync";
import * as tokenStorage from "@/lib/token-storage";

export { abbreviateDiagnosticValue } from "@/diagnostics/state-update-route-logic";

type SessionStatus = "loading" | "anonymous" | "authenticated" | "offline";

type SessionContextValue = {
  api: OpcoApi;
  context: ContextResponse | null;
  definitionCache: LocalDatabase;
  me: MeResponse | null;
  ownerKey: string | null;
  pendingRecordsCount: number;
  localDatabaseStorageState: LocalDatabaseStorageState;
  localStorageRecoveryNotice: string | null;
  recordsReconnectRefreshKey: number;
  recordsSyncSummary: RecordsSyncSummary;
  recordStateUpdateSyncRun(input: {
    completedAt?: string;
    ownerKey?: string;
    operationsSelected: number;
    result: Awaited<ReturnType<typeof syncPendingStateUpdatesOnce>>;
    startedAt: string;
    trigger: StateUpdateSyncTrigger;
  }): Promise<void>;
  refreshRecordsSyncSummary(): Promise<void>;
  selectedContractId: string | null;
  setSelectedContractId(contractId: string | null): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  stateUpdateReconnectRefreshKey: number;
  stateUpdateReconnectDiagnostics: StateUpdateReconnectDiagnostics;
  signOut(): Promise<void>;
  status: SessionStatus;
  syncPendingRecords(): Promise<void>;
  syncPendingStateUpdatesWithTelemetry(input: {
    api?: Pick<OpcoApi, "saveStateUpdateWorkflow"> & Partial<Pick<OpcoApi, "getStateUpdateWorkflow">>;
    ownerKey?: string;
    store?: StateUpdateSyncStore;
    token?: string;
    trigger: StateUpdateSyncTrigger;
  }): Promise<{
    completedAt: string;
    operationsSelected: number;
    result: Awaited<ReturnType<typeof syncPendingStateUpdatesOnce>>;
    startedAt: string;
  } | null>;
  token: string | null;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const emptyRecordsSyncSummary: RecordsSyncSummary = {
  conflictCount: 0,
  failedCount: 0,
  pendingCount: 0,
  syncingCount: 0,
};

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

const emptyStateUpdateReconnectDiagnostics: StateUpdateReconnectDiagnostics = {
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

export function SessionProvider({ children }: PropsWithChildren) {
  const definitionCache = useMemo(() => getLocalDatabase(), []);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [localDatabaseStorageState, setLocalDatabaseStorageState] = useState<LocalDatabaseStorageState>(
    getLocalDatabaseStorageState,
  );
  const [localStorageRecoveryNotice, setLocalStorageRecoveryNotice] = useState<string | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [pendingRecordsCount, setPendingRecordsCount] = useState(0);
  const [recordsReconnectRefreshKey, setRecordsReconnectRefreshKey] = useState(0);
  const [stateUpdateReconnectRefreshKey, setStateUpdateReconnectRefreshKey] = useState(0);
  const [recordsSyncSummary, setRecordsSyncSummary] = useState<RecordsSyncSummary>(emptyRecordsSyncSummary);
  const [selectedContractIdState, setSelectedContractIdState] = useState<string | null>(null);
  const [stateUpdateDiagnostics, setStateUpdateDiagnostics] = useState<StateUpdateOutboxDiagnostics | null>(null);
  const [stateUpdateDiagnosticsError, setStateUpdateDiagnosticsError] = useState<string | null>(null);
  const [stateUpdateDiagnosticRun, setStateUpdateDiagnosticRun] = useState<StateUpdateDiagnosticRun | null>(null);
  const [isStateUpdateDiagnosticSyncing, setIsStateUpdateDiagnosticSyncing] = useState(false);
  const [stateUpdateReconnectDiagnostics, setStateUpdateReconnectDiagnostics] =
    useState<StateUpdateReconnectDiagnostics>(emptyStateUpdateReconnectDiagnostics);
  const connectivityStatus = useConnectivityStatus();
  const showStateUpdateDiagnostics = shouldShowStateUpdateDiagnostics();
  const ownerKey = me && context ? buildOwnerKey(me, context) : null;
  const api = useMemo(
    () =>
      createOpcoApi({
        onSessionInvalid() {
          setToken(null);
          setMe(null);
          setContext(null);
          setStatus("anonymous");
        },
        onSessionRefreshed(tokens) {
          setToken(tokens.accessToken);
        },
        platformOS: Platform.OS,
        tokenStore: tokenStorage,
      }),
    [],
  );

  useEffect(
    () =>
      subscribeLocalDatabaseStorageState(() => {
        setLocalDatabaseStorageState(getLocalDatabaseStorageState());
      }),
    [],
  );

  const retryLocalStorage = useCallback(async () => {
    await retryLocalDatabaseInitialization();
    setBootstrapAttempt((attempt) => attempt + 1);
    setStatus("loading");
  }, []);

  const resetLocalStorage = useCallback(async () => {
    await resetLocalDatabaseAfterConfirmation({ confirmed: true });
    setMe(null);
    setContext(null);
    setSelectedContractIdState(null);
    setRecordsSyncSummary(emptyRecordsSyncSummary);
    setPendingRecordsCount(0);
    setRecordsReconnectRefreshKey((key) => key + 1);
    setLocalStorageRecoveryNotice(
      connectivityStatus === "offline" ? "Conectate para volver a descargar los datos." : null,
    );
    setBootstrapAttempt((attempt) => attempt + 1);
    setStatus("loading");
  }, [connectivityStatus]);

  const loadContext = useCallback(
    async (accessToken: string, currentMe: MeResponse) => {
      try {
        const nextContext = await api.getContext(accessToken);
        const nextOwnerKey = buildOwnerKey(currentMe, nextContext);
        const persistedContractId = await readPersistedContractId(definitionCache, nextOwnerKey);
        const nextContractId = selectContractId(nextContext.contracts, persistedContractId);

        await tokenStorage.setSessionOwnerKey(nextOwnerKey);
        await definitionCache.upsertContextSnapshot(nextOwnerKey, currentMe, nextContext, new Date().toISOString());
        setContext(nextContext);
        setSelectedContractIdState(nextContractId);
      } catch (error) {
        if (!(error instanceof OpcoNetworkError)) {
          return;
        }

        const cachedOwnerKey = await tokenStorage.getSessionOwnerKey();
        const cached = cachedOwnerKey ? await definitionCache.getContextSnapshot(cachedOwnerKey) : null;

        if (cached && cached.me.user.id === currentMe.user.id) {
          setMe(cached.me);
          setContext(cached.context);
        }

        setStatus("offline");
      }
    },
    [api, definitionCache],
  );

  const refreshPendingRecordsCount = useCallback(async () => {
    if (!ownerKey || !selectedContractIdState) {
      setPendingRecordsCount(0);
      setRecordsSyncSummary(emptyRecordsSyncSummary);
      return;
    }

    try {
      const [count, summary] = await Promise.all([
        definitionCache.countPendingOperations(ownerKey),
        definitionCache.getRecordsSyncSummary({
          contractId: selectedContractIdState,
          ownerKey,
        }),
      ]);

      setPendingRecordsCount(count);
      setRecordsSyncSummary(summary);
    } catch {
      setPendingRecordsCount(0);
      setRecordsSyncSummary(emptyRecordsSyncSummary);
    }
  }, [definitionCache, ownerKey, selectedContractIdState]);

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
      operationsAttempted: result.operationsAttempted,
      operationsCompleted: result.completed,
      operationsFailed,
      operationsSelected,
      reconciledAfterTimeout: result.reconciledAfterTimeout,
      startedAt,
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
  }: {
    api?: Pick<OpcoApi, "saveStateUpdateWorkflow"> & Partial<Pick<OpcoApi, "getStateUpdateWorkflow">>;
    ownerKey?: string;
    store?: StateUpdateSyncStore;
    token?: string;
    trigger: StateUpdateSyncTrigger;
  }) => {
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
  }, [api, definitionCache, ownerKey, recordStateUpdateSyncRun, token]);

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

  const syncPendingRecords = useCallback(async (trigger: StateUpdateSyncTrigger = "manual-retry") => {
    if (!token || !ownerKey) {
      return;
    }

    try {
      await syncPendingRecordsOnce({
        api,
        ownerKey,
        store: definitionCache,
        token,
      });
      await syncPendingStateUpdatesWithTelemetry({
        trigger,
      });
      if (showStateUpdateDiagnostics) {
        await refreshStateUpdateDiagnostics();
      }
    } finally {
      await refreshPendingRecordsCount();
    }
  }, [api, definitionCache, ownerKey, refreshPendingRecordsCount, refreshStateUpdateDiagnostics, showStateUpdateDiagnostics, syncPendingStateUpdatesWithTelemetry, token]);
  const reconnectSessionAndRecordsRef = useRef(syncPendingRecords);
  const reconnectShouldSyncRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false));
  const reconnectSyncControllerRef = useRef<ReconnectSyncController | null>(null);
  const foregroundResumeSyncPromiseRef = useRef<Promise<void> | null>(null);

  const reconnectSessionAndRecords = useCallback(async (trigger: StateUpdateSyncTrigger = "reconnect") => {
    if (!token) {
      return;
    }

    let nextToken = token;

    try {
      const refreshed = await api.refreshSession();

      nextToken = refreshed.accessToken;
      setToken(nextToken);
    } catch (error) {
      if (!(error instanceof OpcoNetworkError)) {
        throw error;
      }
    }

    const nextMe = await api.getMe(nextToken);
    const nextContext = await api.getContext(nextToken);
    const nextOwnerKey = buildOwnerKey(nextMe, nextContext);

    await tokenStorage.setSessionOwnerKey(nextOwnerKey);
    await definitionCache.upsertContextSnapshot(nextOwnerKey, nextMe, nextContext, new Date().toISOString());
    setMe(nextMe);
    setContext(nextContext);
    setStatus("authenticated");

    const nextContractId = selectContractId(nextContext.contracts, selectedContractIdState ?? await readPersistedContractId(definitionCache, nextOwnerKey));

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

    await syncPendingRecordsOnce({
      api,
      ownerKey: nextOwnerKey,
      store: definitionCache,
      token: nextToken,
    });
    await syncPendingStateUpdatesWithTelemetry({
      ownerKey: nextOwnerKey,
      token: nextToken,
      trigger,
    });
    if (showStateUpdateDiagnostics) {
      await refreshStateUpdateDiagnostics();
    }
    await refreshPendingRecordsCount();
  }, [api, definitionCache, refreshPendingRecordsCount, refreshStateUpdateDiagnostics, selectedContractIdState, showStateUpdateDiagnostics, syncPendingStateUpdatesWithTelemetry, token]);

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
      const resumed = previousAppState !== "active" && nextAppState === "active";

      previousAppState = nextAppState;

      if (!resumed || connectivityStatus !== "online" || foregroundResumeSyncPromiseRef.current) {
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
  }, [persistStateUpdateReconnectDiagnostics]);

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      try {
        const restored = await restoreSession(tokenStorage, api, definitionCache);

        if (!isMounted) {
          return;
        }

        if (restored.status === "authenticated") {
          setToken(restored.token);
          setMe(restored.me);
          setStatus("authenticated");
          void loadContext(restored.token, restored.me);
          return;
        }

        if (restored.status === "offline") {
          setToken(restored.token);
          if (restored.snapshot) {
            setMe(restored.snapshot.me);
            setContext(restored.snapshot.context);
            setSelectedContractIdState(await readPersistedContractId(definitionCache, restored.snapshot.ownerKey));
          }
          setStatus("offline");
          return;
        }

        setStatus("anonymous");
      } catch (error) {
        if (isMounted) {
          if (isLocalDatabaseUnavailableError(error)) {
            return;
          }

          setStatus("anonymous");
        }
      }
    }

    void bootstrap();

    return () => {
      isMounted = false;
    };
  }, [api, bootstrapAttempt, definitionCache, loadContext]);

  useEffect(() => {
    async function refreshCount() {
      await refreshPendingRecordsCount();
    }

    void refreshCount();
  }, [refreshPendingRecordsCount]);

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

  useEffect(() => {
    let isMounted = true;

    async function loadPersistedContractId() {
      const persistedContractId = await readPersistedContractId(definitionCache, ownerKey);

      if (isMounted) {
        setSelectedContractIdState(persistedContractId);
      }
    }

    void loadPersistedContractId();

    return () => {
      isMounted = false;
    };
  }, [definitionCache, ownerKey]);

  async function signIn(email: string, password: string) {
    const loginResponse = await api.login(email, password);

    if (Platform.OS !== "web" && !loginResponse.refreshToken) {
      throw new Error("Opco no devolvio refresh token para la sesion nativa.");
    }

    await tokenStorage.setSession({
      accessToken: loginResponse.accessToken,
      refreshToken: loginResponse.refreshToken,
    });

    const nextMe = await api.getMe(loginResponse.accessToken);
    const nextContext = await api.getContext(loginResponse.accessToken);
    const nextOwnerKey = buildOwnerKey(nextMe, nextContext);
    const nextContractId = selectContractId(nextContext.contracts, await readPersistedContractId(definitionCache, nextOwnerKey));

    await tokenStorage.setSessionOwnerKey(nextOwnerKey);
    await definitionCache.upsertContextSnapshot(nextOwnerKey, nextMe, nextContext, new Date().toISOString());

    setToken(loginResponse.accessToken);
    setMe(nextMe);
    setContext(nextContext);
    setSelectedContractIdState(nextContractId);
    setStatus("authenticated");
    void syncPendingRecordsOnce({
      api,
      ownerKey: nextOwnerKey,
      store: definitionCache,
      token: loginResponse.accessToken,
    })
      .then(async () => {
      await syncPendingStateUpdatesWithTelemetry({
        ownerKey: nextOwnerKey,
        token: loginResponse.accessToken,
        trigger: "startup-with-pending",
      });
      })
      .finally(refreshPendingRecordsCount);
  }

  async function signOut() {
    const refreshToken = await tokenStorage.getRefreshToken();

    try {
      await api.logout(refreshToken);
    } catch {
      // Local logout must not be blocked by network or remote revocation failures.
    }

    await tokenStorage.clearSession();
    void persistSelectedContractId(definitionCache, null);
    void definitionCache.clearNavigationCache();
    setToken(null);
    setMe(null);
    setContext(null);
    setSelectedContractIdState(null);
    setStatus("anonymous");
  }

  async function setSelectedContractId(contractId: string | null) {
    setSelectedContractIdState(contractId);
    await persistSelectedContractId(definitionCache, contractId, ownerKey);

    if (contractId && ownerKey && token && status === "authenticated") {
      try {
        const result = await loadAppViewsWithCache({
          api,
          cache: definitionCache,
          contractId,
          ownerKey,
          token,
        });

        if (!result.offline) {
          void prewarmAssignedAppViewsOnce({
            api,
            appViews: result.views,
            contractId,
            ownerKey,
            store: definitionCache,
            token,
          });
        }
      } catch {
        // Home owns visible navigation errors; prewarm must not block contract selection.
      }
    }
  }

  return (
    <SessionContext.Provider
      value={{
        api,
        context,
        definitionCache,
        me,
        ownerKey,
        pendingRecordsCount,
        localDatabaseStorageState,
        localStorageRecoveryNotice,
        recordsReconnectRefreshKey,
        recordsSyncSummary,
        recordStateUpdateSyncRun,
        refreshRecordsSyncSummary: refreshPendingRecordsCount,
        selectedContractId: selectedContractIdState,
        setSelectedContractId,
        signIn,
        stateUpdateReconnectRefreshKey,
        stateUpdateReconnectDiagnostics,
        signOut,
        status,
        syncPendingRecords,
        syncPendingStateUpdatesWithTelemetry,
        token,
      }}
    >
      {localDatabaseStorageState.status === "unavailable" ? (
        <LocalStorageRecoveryScreen
          getRecoverySummary={getLocalDatabaseRecoverySummary}
          onResetConfirmed={resetLocalStorage}
          onRetry={retryLocalStorage}
        />
      ) : (
        <>
          {children}
          {showStateUpdateDiagnostics ? (
            <StateUpdateDiagnosticsPanel
              diagnostics={stateUpdateDiagnostics}
              error={stateUpdateDiagnosticsError}
              isSyncing={isStateUpdateDiagnosticSyncing}
              onRefresh={refreshStateUpdateDiagnostics}
              onRetryFailed={retryFailedStateUpdateDiagnostics}
              onSyncNow={runStateUpdateDiagnosticSync}
              reconnect={stateUpdateReconnectDiagnostics}
              run={stateUpdateDiagnosticRun}
            />
          ) : null}
        </>
      )}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);

  if (!value) {
    throw new Error("useSession debe usarse dentro de SessionProvider.");
  }

  return value;
}

function LocalStorageRecoveryScreen({
  getRecoverySummary,
  onResetConfirmed,
  onRetry,
}: {
  getRecoverySummary(): Promise<LocalDatabaseRecoverySummary>;
  onResetConfirmed(): Promise<void>;
  onRetry(): Promise<void>;
}) {
  const { localDatabaseStorageState } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [summary, setSummary] = useState<LocalDatabaseRecoverySummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const isAccessHandleBusy =
    localDatabaseStorageState.status === "unavailable" && localDatabaseStorageState.cause === "ACCESS_HANDLE_BUSY";
  const showDiagnostics = shouldShowLocalStorageDiagnostics();

  const refreshSummary = useCallback(async () => {
    if (!showDiagnostics) {
      return;
    }

    try {
      const nextSummary = await getRecoverySummary();

      setSummary(nextSummary);
      setSummaryError(null);
    } catch {
      setSummary(null);
      setSummaryError("summary unavailable");
    }
  }, [getRecoverySummary, showDiagnostics]);

  useEffect(() => {
    if (!showDiagnostics) {
      return;
    }

    let isMounted = true;

    getRecoverySummary()
      .then((nextSummary) => {
        if (isMounted) {
          setSummary(nextSummary);
          setSummaryError(null);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSummary(null);
          setSummaryError("summary unavailable");
        }
      });

    return () => {
      isMounted = false;
    };
  }, [getRecoverySummary, showDiagnostics]);

  async function retry() {
    setError(null);
    setIsRetrying(true);

    try {
      await onRetry();
    } catch {
      setError("Todavia no pudimos abrir los datos guardados.");
      await refreshSummary();
    } finally {
      setIsRetrying(false);
    }
  }

  async function requestReset() {
    setError(null);
    const summary = await getRecoverySummary();
    const message = formatLocalStorageResetWarning(summary);

    Alert.alert("Restablecer datos locales", message, [
      { style: "cancel", text: "Cancelar" },
      {
        onPress: () => {
          void reset();
        },
        style: "destructive",
        text: "Restablecer",
      },
    ]);
  }

  async function reset() {
    setIsResetting(true);

    try {
      await onResetConfirmed();
    } catch {
      setError("No pudimos restablecer los datos locales. Intenta nuevamente.");
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <View style={storageStyles.screen}>
      <View style={storageStyles.panel}>
        <Text style={storageStyles.title}>
          {isAccessHandleBusy
            ? "Opco Client ya esta abierto en otra pestana."
            : "No pudimos abrir los datos guardados en este dispositivo."}
        </Text>
        <Text style={storageStyles.body}>
          {isAccessHandleBusy
            ? "Cierra las otras pestanas o ventanas de Opco Client y luego reintenta. No es necesario restablecer los datos locales."
            : "Puedes reintentar sin borrar nada. Restablecer datos locales elimina la cache de este dispositivo y puede borrar cambios no sincronizados."}
        </Text>
        {error ? <Text style={storageStyles.error}>{error}</Text> : null}
        {showDiagnostics ? (
          <LocalStorageDiagnostics summary={summary} summaryError={summaryError} />
        ) : null}
        <Pressable disabled={isRetrying || isResetting} onPress={retry} style={storageStyles.primaryButton}>
          {isRetrying ? <ActivityIndicator color="#ffffff" /> : <Text style={storageStyles.primaryText}>Reintentar</Text>}
        </Pressable>
        {isAccessHandleBusy ? null : (
          <Pressable disabled={isRetrying || isResetting} onPress={requestReset} style={storageStyles.dangerButton}>
            {isResetting ? (
              <ActivityIndicator color="#b42318" />
            ) : (
              <Text style={storageStyles.dangerText}>Restablecer datos locales</Text>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

function shouldShowLocalStorageDiagnostics() {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    return true;
  }

  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).get("localStorageDiagnostics") === "1";
}

function shouldShowStateUpdateDiagnostics() {
  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).get("stateUpdateDiagnostics") === "1";
}

export function StateUpdateDiagnosticsPanel({
  diagnostics,
  error,
  isSyncing,
  onRefresh,
  onRetryFailed,
  onSyncNow,
  reconnect,
  run,
  variant = "overlay",
}: {
  diagnostics: StateUpdateOutboxDiagnostics | null;
  error: string | null;
  isSyncing: boolean;
  onRefresh(): Promise<void>;
  onRetryFailed?(manualRetryToken?: string | null): Promise<void>;
  onSyncNow(): Promise<void>;
  reconnect: StateUpdateReconnectDiagnostics;
  run: StateUpdateDiagnosticRun | null;
  variant?: "embedded" | "overlay";
}) {
  const summary = diagnostics?.summary;
  const currentConnectivityRows: [string, string | number | boolean | null][] = [
    ["status", reconnect.currentConnectivity.status],
    ["updatedAt", reconnect.currentConnectivity.updatedAt ?? "none"],
  ];
  const lastReconnectRows: [string, string | number | boolean | null][] = [
    ["detected", reconnect.lastReconnect.detected],
    ["detectedAt", reconnect.lastReconnect.detectedAt ?? "none"],
    ["from", reconnect.lastReconnect.previousConnectivityStatus ?? "none"],
    ["to", reconnect.lastReconnect.resultingConnectivityStatus ?? "none"],
  ];
  const lastStateUpdateSyncRows: [string, string | number | boolean | null][] = reconnect.lastStateUpdateSync ? [
    ["trigger", reconnect.lastStateUpdateSync.trigger],
    ["startedAt", reconnect.lastStateUpdateSync.startedAt],
    ["completedAt", reconnect.lastStateUpdateSync.completedAt ?? "none"],
    ["operationsSelected", reconnect.lastStateUpdateSync.operationsSelected],
    ["operationsAttempted", reconnect.lastStateUpdateSync.operationsAttempted],
    ["operationsCompleted", reconnect.lastStateUpdateSync.operationsCompleted],
    ["operationsFailed", reconnect.lastStateUpdateSync.operationsFailed],
    ["reconciledAfterTimeout", reconnect.lastStateUpdateSync.reconciledAfterTimeout],
    ["result", reconnect.lastStateUpdateSync.result],
  ] : [
    ["trigger", "none"],
    ["startedAt", "none"],
    ["completedAt", "none"],
    ["operationsSelected", 0],
    ["operationsAttempted", 0],
    ["operationsCompleted", 0],
    ["operationsFailed", 0],
    ["reconciledAfterTimeout", false],
    ["result", "none"],
  ];
  const summaryRows: [string, string | number][] = [
    ["consistency", diagnostics?.consistency ?? "loading"],
    ["STATE_UPDATE total local", summary?.stateUpdateTotalLocal ?? "loading"],
    ["workflow local records", summary?.localTotal ?? "loading"],
    ["attendance-derived pending", summary?.attendanceDerivedPendingCount ?? "loading"],
    ["remote snapshot repairable", summary?.remoteSnapshotRepairable ?? "loading"],
    ["orphaned local change", summary?.orphanedLocalChange ?? "loading"],
    ["eligibleForAutoSync", summary?.eligibleForAutoSync ?? "loading"],
    ["syncing", summary?.syncing ?? "loading"],
    ["failed", summary?.failed ?? "loading"],
    ["conflict", summary?.conflict ?? "loading"],
    ["pending_create", summary?.pendingCreate ?? "loading"],
    ["pending_update", summary?.pendingUpdate ?? "loading"],
    ["local synced", summary?.localSynced ?? "loading"],
    ["local syncing", summary?.localSyncing ?? "loading"],
    ["local failed", summary?.localFailed ?? "loading"],
    ["local conflict", summary?.localConflict ?? "loading"],
    ["local pending_create", summary?.localPendingCreate ?? "loading"],
    ["local pending_update", summary?.localPendingUpdate ?? "loading"],
  ];

  return (
    <View style={variant === "embedded" ? diagnosticsPanelStyles.embeddedShell : diagnosticsPanelStyles.shell}>
      <ScrollView style={diagnosticsPanelStyles.scroll}>
        <View style={diagnosticsPanelStyles.header}>
          <Text style={diagnosticsPanelStyles.title}>STATE_UPDATE diagnostics</Text>
          <View style={diagnosticsPanelStyles.actions}>
            <Pressable onPress={onRefresh} style={diagnosticsPanelStyles.button}>
              <Text style={diagnosticsPanelStyles.buttonText}>Refrescar</Text>
            </Pressable>
            <Pressable disabled={isSyncing} onPress={onSyncNow} style={[diagnosticsPanelStyles.button, isSyncing ? diagnosticsPanelStyles.buttonDisabled : null]}>
              <Text style={diagnosticsPanelStyles.buttonText}>{isSyncing ? "Sincronizando" : "Intentar sincronizar ahora"}</Text>
            </Pressable>
            {onRetryFailed && (summary?.failed ?? 0) > 0 ? (
              <Pressable disabled={isSyncing} onPress={() => onRetryFailed(null)} style={[diagnosticsPanelStyles.button, isSyncing ? diagnosticsPanelStyles.buttonDisabled : null]}>
                <Text style={diagnosticsPanelStyles.buttonText}>Reintentar errores</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        {error ? <Text style={diagnosticsPanelStyles.error}>{error}</Text> : null}
        <DiagnosticsRows rows={summaryRows} />
        <Text style={diagnosticsPanelStyles.sectionTitle}>Current connectivity</Text>
        <DiagnosticsRows rows={currentConnectivityRows} />
        <Text style={diagnosticsPanelStyles.sectionTitle}>Last reconnect</Text>
        <DiagnosticsRows rows={lastReconnectRows} />
        <Text style={diagnosticsPanelStyles.sectionTitle}>Last STATE_UPDATE sync</Text>
        <DiagnosticsRows rows={lastStateUpdateSyncRows} />
        <Text style={diagnosticsPanelStyles.sectionTitle}>Operations</Text>
        {!diagnostics ? (
          <Text style={diagnosticsPanelStyles.empty}>Loading operations...</Text>
        ) : diagnostics.operations.length ? diagnostics.operations.map((operation, index) => (
          <View key={`${operation.clientRequestId}:${index}`} style={diagnosticsPanelStyles.operation}>
            <Text style={diagnosticsPanelStyles.operationTitle}>#{index + 1}</Text>
            {onRetryFailed && operation.manualRetryable && operation.manualRetryToken ? (
              <Pressable disabled={isSyncing} onPress={() => onRetryFailed(operation.manualRetryToken)} style={[diagnosticsPanelStyles.button, isSyncing ? diagnosticsPanelStyles.buttonDisabled : null]}>
                <Text style={diagnosticsPanelStyles.buttonText}>Reintentar</Text>
              </Pressable>
            ) : null}
            <DiagnosticsRows
              rows={[
                ["sync_status", operation.syncStatus],
                ["operation_type", operation.operationType],
                ["retryable", operation.retryable],
                ["appView", operation.appViewFingerprint],
                ["contract", operation.contractFingerprint],
                ["subject", operation.subjectFingerprint],
                ["date", operation.date ?? "none"],
                ["clientRequestId", operation.clientRequestId],
                ["retryCount", operation.retryCount],
                ["lastErrorCode", operation.lastErrorCode ?? "none"],
                ["lastErrorPhase", operation.lastErrorPhase ?? "none"],
                ["lastHttpStatus", operation.lastHttpStatus ?? "not stored"],
                ["lastBackendErrorCode", operation.lastBackendErrorCode ?? "none"],
                ["updatedAt local", operation.updatedAt],
                ["payloadSchema", operation.payloadSchema],
                ["stateValues count", operation.stateValuesCount],
                ["extraValues count", operation.extraValuesCount],
                ["AppView actual", operation.appViewResolved],
                ["workflowKey", operation.config.workflowKey ?? "none"],
                ["definition kind", operation.config.definitionKind],
                ["stateFields", operation.config.stateFieldsCount],
                ["status option", String(operation.config.statusOptionResolved)],
                ["matching states", operation.config.matchingStateValuesCount],
                ["missing states", operation.config.missingStateValuesCount],
                ["source/target", operation.config.sourceTargetConfigured],
                ["extra fields", operation.config.extraFieldsCount],
              ]}
            />
          </View>
        )) : <Text style={diagnosticsPanelStyles.empty}>No local STATE_UPDATE operations.</Text>}
        <Text style={diagnosticsPanelStyles.sectionTitle}>Workflow Local Records</Text>
        {!diagnostics ? (
          <Text style={diagnosticsPanelStyles.empty}>Loading local records...</Text>
        ) : diagnostics.localRecords.length ? diagnostics.localRecords.map((record, index) => (
          <View key={`${record.localRecordFingerprint}:${index}`} style={diagnosticsPanelStyles.operation}>
            <Text style={diagnosticsPanelStyles.operationTitle}>local #{index + 1}</Text>
            <DiagnosticsRows
              rows={[
                ["sync_status", record.syncStatus],
                ["has pending op", record.hasPendingOperation],
                ["appView", record.appViewFingerprint],
                ["contract", record.contractFingerprint],
                ["subject", record.subjectFingerprint],
                ["date", record.date ?? "none"],
                ["local record", record.localRecordFingerprint],
                ["remote/server exists", record.remoteRecordExists],
                ["recoveryState", record.recoveryState],
                ["stateValues count", record.stateValuesCount],
                ["lastErrorCode", record.lastErrorCode ?? "none"],
                ["AppView actual", record.appViewResolved],
                ["workflowKey", record.workflowKey ?? "none"],
                ["updatedAt local", record.updatedAt],
              ]}
            />
          </View>
        )) : <Text style={diagnosticsPanelStyles.empty}>No workflow local records.</Text>}
        <Text style={diagnosticsPanelStyles.sectionTitle}>Diagnostic Run</Text>
        {run ? (
          <>
            <DiagnosticsRows
              rows={[
                ["invokedAt", run.invokedAt],
                ["operationsSelected", run.operationsSelected],
                ["operationsAttempted", run.operationsAttempted],
                ["operationsCompleted", run.operationsCompleted],
                ["operationsFailed", run.operationsFailed],
              ]}
            />
            {run.rows.map((row, index) => (
              <View key={`${row.clientRequestId}:${index}`} style={diagnosticsPanelStyles.operation}>
                <Text style={diagnosticsPanelStyles.operationTitle}>run #{index + 1}</Text>
                <DiagnosticsRows
                  rows={[
                    ["clientRequestId", row.clientRequestId],
                    ["selectedForSync", row.selectedForSync],
                    ["requestAttempted", row.requestAttempted],
                    ["endpoint", row.endpoint],
                    ["requestStartedAt", row.requestStartedAt ?? "none"],
                    ["fetchResolvedAt", row.fetchResolvedAt ?? "none"],
                    ["responseBodyStartedAt", row.responseBodyStartedAt ?? "none"],
                    ["responseParsedAt", row.responseParsedAt ?? "none"],
                    ["requestCompletedAt", row.requestCompletedAt ?? "none"],
                    ["timeoutMs", row.requestTimeoutMs ?? "none"],
                    ["requestDurationMs", row.requestDurationMs ?? "none"],
                    ["AbortController triggered", row.requestAbortControllerTriggered ?? "unknown"],
                    ["responseStarted", row.responseStarted ?? "unknown"],
                    ["HTTP status", row.httpStatus ?? "none"],
                    ["result/error", row.result],
                    ["final sync_status", row.finalSyncStatus],
                  ]}
                />
              </View>
            ))}
          </>
        ) : (
          <Text style={diagnosticsPanelStyles.empty}>No diagnostic run yet.</Text>
        )}
      </ScrollView>
    </View>
  );
}

function DiagnosticsRows({ rows }: { rows: [string, string | number | boolean | null][] }) {
  return (
    <View style={diagnosticsPanelStyles.rows}>
      {rows.map(([label, value]) => (
        <View key={label} style={diagnosticsPanelStyles.row}>
          <Text style={diagnosticsPanelStyles.label}>{label}</Text>
          <Text style={diagnosticsPanelStyles.value}>{String(value)}</Text>
        </View>
      ))}
    </View>
  );
}


function LocalStorageDiagnostics({
  summary,
  summaryError,
}: {
  summary: LocalDatabaseRecoverySummary | null;
  summaryError: string | null;
}) {
  const { localDatabaseStorageState } = useSession();
  const rows: [string, string | number | boolean][] = localDatabaseStorageState.status === "unavailable"
    ? [
        ["errorCode", localDatabaseStorageState.errorCode],
        ["cause", localDatabaseStorageState.cause],
        ["phase", getLocalDatabaseFailurePhase(localDatabaseStorageState.cause)],
        ["technicalMessage", localDatabaseStorageState.technicalMessage || "none"],
        ["retryable", localDatabaseStorageState.retryable],
        ["destructiveRecoveryAvailable", localDatabaseStorageState.destructiveRecoveryAvailable],
        ["summary", summaryError ?? (summary ? "available" : "loading")],
        ["pendingCreate", summary?.pendingCreateCount ?? "none"],
        ["pendingUpdate", summary?.pendingUpdateCount ?? "none"],
        ["failed", summary?.failedCount ?? "none"],
        ["conflict", summary?.conflictCount ?? "none"],
        ["totalAtRisk", summary?.totalAtRiskCount ?? "none"],
      ]
    : [["status", localDatabaseStorageState.status]];

  return (
    <View style={storageStyles.diagnostics}>
      <Text style={storageStyles.diagnosticsTitle}>Diagnostico SQLite</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={storageStyles.diagnosticsRow}>
          <Text style={storageStyles.diagnosticsLabel}>{label}</Text>
          <Text style={storageStyles.diagnosticsValue}>{String(value)}</Text>
        </View>
      ))}
    </View>
  );
}

function getLocalDatabaseFailurePhase(cause: LocalDatabaseUnavailableCause) {
  if (cause === "ACCESS_HANDLE_BUSY") {
    return "OPFS Access Handle";
  }

  if (cause === "OPEN_FAILED" || cause === "STORAGE_UNAVAILABLE" || cause === "CORRUPTION_SUSPECTED") {
    return "openDatabaseAsync";
  }

  if (cause === "MIGRATION_FAILED") {
    return "migration";
  }

  return "unknown";
}

const diagnosticsPanelStyles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  button: {
    backgroundColor: "#135d66",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "800",
  },
  empty: {
    color: "#466068",
    fontSize: 12,
  },
  embeddedShell: {
    backgroundColor: "#ffffff",
    borderColor: "#9fb8b8",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    padding: 12,
  },
  error: {
    color: "#b42318",
    fontSize: 12,
    fontWeight: "800",
  },
  header: {
    gap: 8,
  },
  label: {
    color: "#466068",
    fontSize: 11,
    fontWeight: "800",
  },
  operation: {
    borderColor: "#d0dede",
    borderRadius: 6,
    borderWidth: 1,
    gap: 6,
    padding: 8,
  },
  operationTitle: {
    color: "#0f3036",
    fontSize: 12,
    fontWeight: "800",
  },
  row: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  rows: {
    gap: 4,
  },
  scroll: {
    maxHeight: 520,
  },
  sectionTitle: {
    color: "#0f3036",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 6,
  },
  shell: {
    backgroundColor: "#ffffff",
    borderColor: "#9fb8b8",
    borderRadius: 8,
    borderWidth: 1,
    bottom: 12,
    left: 12,
    maxWidth: 520,
    padding: 12,
    position: "absolute",
    right: 12,
    zIndex: 50,
  },
  title: {
    color: "#0f3036",
    fontSize: 14,
    fontWeight: "900",
  },
  value: {
    color: "#0f3036",
    flexShrink: 1,
    fontFamily: Platform.OS === "web" ? "monospace" : undefined,
    fontSize: 11,
    textAlign: "right",
  },
});

const storageStyles = StyleSheet.create({
  body: {
    color: "#466068",
    lineHeight: 22,
  },
  dangerButton: {
    alignItems: "center",
    borderColor: "#fda29b",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  dangerText: {
    color: "#b42318",
    fontWeight: "800",
  },
  diagnostics: {
    backgroundColor: "#eef4f4",
    borderRadius: 8,
    gap: 6,
    padding: 12,
  },
  diagnosticsLabel: {
    color: "#466068",
    fontSize: 12,
    fontWeight: "800",
  },
  diagnosticsRow: {
    gap: 4,
  },
  diagnosticsTitle: {
    color: "#0f3036",
    fontSize: 13,
    fontWeight: "800",
  },
  diagnosticsValue: {
    color: "#0f3036",
    fontSize: 12,
  },
  error: {
    color: "#b42318",
    fontWeight: "700",
  },
  panel: {
    gap: 14,
    maxWidth: 460,
    width: "100%",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#135d66",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  primaryText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  screen: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  title: {
    color: "#0f3036",
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 28,
  },
});
