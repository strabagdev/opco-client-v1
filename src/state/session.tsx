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
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { buildOwnerKey, loadAppViewsWithCache } from "@/lib/app-navigation-cache";
import { prewarmAssignedAppViewsOnce } from "@/lib/app-view-prewarm";
import { useConnectivityStatus } from "@/lib/connectivity";
import { selectContractId } from "@/lib/contract-selection";
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
import { createReconnectSyncController, ReconnectSyncController } from "@/state/reconnect-sync";
import { syncPendingRecordsOnce } from "@/sync/records-sync";
import * as tokenStorage from "@/lib/token-storage";

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
  refreshRecordsSyncSummary(): Promise<void>;
  selectedContractId: string | null;
  setSelectedContractId(contractId: string | null): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  status: SessionStatus;
  syncPendingRecords(): Promise<void>;
  token: string | null;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const emptyRecordsSyncSummary: RecordsSyncSummary = {
  conflictCount: 0,
  failedCount: 0,
  pendingCount: 0,
  syncingCount: 0,
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
  const [recordsSyncSummary, setRecordsSyncSummary] = useState<RecordsSyncSummary>(emptyRecordsSyncSummary);
  const [selectedContractIdState, setSelectedContractIdState] = useState<string | null>(null);
  const connectivityStatus = useConnectivityStatus();
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

        await tokenStorage.setSessionOwnerKey(nextOwnerKey);
        await definitionCache.upsertContextSnapshot(nextOwnerKey, currentMe, nextContext, new Date().toISOString());
        setContext(nextContext);
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

  const syncPendingRecords = useCallback(async () => {
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
    } finally {
      await refreshPendingRecordsCount();
    }
  }, [api, definitionCache, ownerKey, refreshPendingRecordsCount, token]);
  const reconnectSessionAndRecordsRef = useRef(syncPendingRecords);
  const reconnectSyncControllerRef = useRef<ReconnectSyncController | null>(null);

  const reconnectSessionAndRecords = useCallback(async () => {
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
    await refreshPendingRecordsCount();
  }, [api, definitionCache, refreshPendingRecordsCount, selectedContractIdState, token]);

  useEffect(() => {
    reconnectSessionAndRecordsRef.current = reconnectSessionAndRecords;
  }, [reconnectSessionAndRecords]);

  useEffect(() => {
    const controller = createReconnectSyncController({
      onSynced() {
        setRecordsReconnectRefreshKey((key) => key + 1);
      },
      runSync() {
        return reconnectSessionAndRecordsRef.current();
      },
    });

    reconnectSyncControllerRef.current = controller;

    return () => {
      controller.dispose();
      reconnectSyncControllerRef.current = null;
    };
  }, []);

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
    if (status !== "authenticated" && status !== "offline") {
      return;
    }

    reconnectSyncControllerRef.current?.handleConnectivityStatus(connectivityStatus);
  }, [connectivityStatus, status]);

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

    await tokenStorage.setSessionOwnerKey(nextOwnerKey);
    await definitionCache.upsertContextSnapshot(nextOwnerKey, nextMe, nextContext, new Date().toISOString());

    setToken(loginResponse.accessToken);
    setMe(nextMe);
    setContext(nextContext);
    setStatus("authenticated");
    void syncPendingRecordsOnce({
      api,
      ownerKey: nextOwnerKey,
      store: definitionCache,
      token: loginResponse.accessToken,
    }).finally(refreshPendingRecordsCount);
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
        refreshRecordsSyncSummary: refreshPendingRecordsCount,
        selectedContractId: selectedContractIdState,
        setSelectedContractId,
        signIn,
        signOut,
        status,
        syncPendingRecords,
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
        children
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
