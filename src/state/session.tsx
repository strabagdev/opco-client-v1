import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { buildOwnerKey, loadAppViewsWithCache } from "@/lib/app-navigation-cache";
import { prewarmAssignedAppViewsOnce } from "@/lib/app-view-prewarm";
import { useConnectivityStatus } from "@/lib/connectivity";
import { selectContractId } from "@/lib/contract-selection";
import {
  getLocalDatabase,
  LocalDatabase,
} from "@/lib/local-db";
import {
  formatLocalStorageResetWarning,
  isLocalDatabaseUnavailableError,
  LocalDatabaseRecoverySummary,
  LocalDatabaseStorageState,
} from "@/lib/local-db-recovery";
import { RecordsSyncSummary } from "@/lib/offline-records";
import { ContextResponse, createOpcoApi, MeResponse, OpcoApi, OpcoNetworkError } from "@/lib/opco-api";
import { restoreSession } from "@/lib/session-logic";
import { persistSelectedContractId, readPersistedContractId } from "@/lib/session-persistence";
import {
  StateUpdateOutboxDiagnostics,
  StateUpdateSyncTrigger,
} from "@/lib/state-update-offline";
import {
  getLocalDatabaseFailurePhase,
  getLocalDatabaseRecoveryGuidance,
  useLocalDatabaseRecovery,
} from "@/state/use-local-database-recovery";
import { usePendingWorkLifecycle } from "@/state/use-pending-work-lifecycle";
import {
  shouldShowStateUpdateDiagnostics,
  StateUpdateDiagnosticRun,
  StateUpdateReconnectDiagnostics,
  useSessionDiagnostics,
} from "@/state/use-session-diagnostics";
import { syncPendingWork } from "@/sync/pending-work-sync";
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
    syncRunId?: string;
    token?: string;
    trigger: StateUpdateSyncTrigger;
  }): Promise<{
    completedAt: string;
    operationsSelected: number;
    result: Awaited<ReturnType<typeof syncPendingStateUpdatesOnce>>;
    startedAt: string;
    syncRunId: string;
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

export type { StateUpdateDiagnosticRun, StateUpdateReconnectDiagnostics } from "@/state/use-session-diagnostics";

export function SessionProvider({ children }: PropsWithChildren) {
  const definitionCache = useMemo(() => getLocalDatabase(), []);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [pendingRecordsCount, setPendingRecordsCount] = useState(0);
  const [recordsReconnectRefreshKey, setRecordsReconnectRefreshKey] = useState(0);
  const [stateUpdateReconnectRefreshKey, setStateUpdateReconnectRefreshKey] = useState(0);
  const [recordsSyncSummary, setRecordsSyncSummary] = useState<RecordsSyncSummary>(emptyRecordsSyncSummary);
  const [selectedContractIdState, setSelectedContractIdState] = useState<string | null>(null);
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

  const {
    getRecoverySummary,
    localDatabaseStorageState,
    localStorageRecoveryNotice,
    resetLocalStorage,
    retryLocalStorage,
  } = useLocalDatabaseRecovery({
    connectivityStatus,
    emptyRecordsSyncSummary,
    setBootstrapAttempt,
    setContext,
    setMe,
    setPendingRecordsCount,
    setRecordsReconnectRefreshKey,
    setRecordsSyncSummary,
    setSelectedContractIdState,
    setStatus,
  });

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

  const {
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
  } = useSessionDiagnostics({
    api,
    connectivityStatus,
    definitionCache,
    ownerKey,
    setStateUpdateReconnectRefreshKey,
    showStateUpdateDiagnostics,
    token,
  });

  const { syncPendingRecords } = usePendingWorkLifecycle({
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
    shouldShowStateUpdateDiagnostics: showStateUpdateDiagnostics,
    status,
    syncPendingStateUpdatesWithTelemetry,
    token,
  });

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
    void syncPendingWork({
      api,
      ownerKey: nextOwnerKey,
      recordsStore: definitionCache,
      syncStateUpdates: syncPendingStateUpdatesWithTelemetry,
      token: loginResponse.accessToken,
      trigger: "startup-with-pending",
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
          getRecoverySummary={getRecoverySummary}
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
  const guidance = getLocalDatabaseRecoveryGuidance(localDatabaseStorageState);
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
          {guidance.title}
        </Text>
        <Text style={storageStyles.body}>
          {guidance.body}
        </Text>
        {error ? <Text style={storageStyles.error}>{error}</Text> : null}
        {showDiagnostics ? (
          <LocalStorageDiagnostics summary={summary} summaryError={summaryError} />
        ) : null}
        <Pressable disabled={isRetrying || isResetting} onPress={retry} style={storageStyles.primaryButton}>
          {isRetrying ? <ActivityIndicator color="#ffffff" /> : <Text style={storageStyles.primaryText}>Reintentar</Text>}
        </Pressable>
        {guidance.canRequestDestructiveReset ? (
          <Pressable disabled={isRetrying || isResetting} onPress={requestReset} style={storageStyles.dangerButton}>
            {isResetting ? (
              <ActivityIndicator color="#b42318" />
            ) : (
              <Text style={storageStyles.dangerText}>Restablecer datos locales</Text>
            )}
          </Pressable>
        ) : null}
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
    ["syncRunId", reconnect.lastStateUpdateSync.syncRunId ?? "none"],
    ["startedAt", reconnect.lastStateUpdateSync.startedAt],
    ["completedAt", reconnect.lastStateUpdateSync.completedAt ?? "none"],
    ["operationsSelected", reconnect.lastStateUpdateSync.operationsSelected],
    ["operationsAttempted", reconnect.lastStateUpdateSync.operationsAttempted],
    ["operationsCompleted", reconnect.lastStateUpdateSync.operationsCompleted],
    ["operationsFailed", reconnect.lastStateUpdateSync.operationsFailed],
    ["reconciledAfterTimeout", reconnect.lastStateUpdateSync.reconciledAfterTimeout],
    ["timeoutOccurred", reconnect.lastStateUpdateSync.timeoutOccurred],
    ["requestStartedAt", reconnect.lastStateUpdateSync.lastRequestDiagnostics?.requestStartedAt ?? "none"],
    ["fetchResolvedAt", reconnect.lastStateUpdateSync.lastRequestDiagnostics?.fetchResolvedAt ?? "none"],
    ["responseBodyStartedAt", reconnect.lastStateUpdateSync.lastRequestDiagnostics?.responseBodyStartedAt ?? "none"],
    ["responseParsedAt", reconnect.lastStateUpdateSync.lastRequestDiagnostics?.responseParsedAt ?? "none"],
    ["requestDurationMs", reconnect.lastStateUpdateSync.lastRequestDiagnostics?.requestDurationMs ?? "none"],
    ["timeoutMs", reconnect.lastStateUpdateSync.lastRequestDiagnostics?.timeoutMs ?? "none"],
    ["abortControllerTriggered", reconnect.lastStateUpdateSync.lastRequestDiagnostics?.abortControllerTriggered ?? "none"],
    ["httpStatus", reconnect.lastStateUpdateSync.lastRequestDiagnostics?.httpStatus ?? "none"],
    ["pathTemplate", reconnect.lastStateUpdateSync.lastRequestDiagnostics?.pathTemplate ?? "none"],
    ["result", reconnect.lastStateUpdateSync.result],
  ] : [
    ["trigger", "none"],
    ["syncRunId", "none"],
    ["startedAt", "none"],
    ["completedAt", "none"],
    ["operationsSelected", 0],
    ["operationsAttempted", 0],
    ["operationsCompleted", 0],
    ["operationsFailed", 0],
    ["reconciledAfterTimeout", false],
    ["timeoutOccurred", false],
    ["requestStartedAt", "none"],
    ["fetchResolvedAt", "none"],
    ["responseBodyStartedAt", "none"],
    ["responseParsedAt", "none"],
    ["requestDurationMs", "none"],
    ["timeoutMs", "none"],
    ["abortControllerTriggered", "none"],
    ["httpStatus", "none"],
    ["pathTemplate", "none"],
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
