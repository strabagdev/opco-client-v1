import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";

import { useConnectivityStatus } from "@/lib/connectivity";
import { getLocalDatabase, LocalDatabase } from "@/lib/local-db";
import { RecordsSyncSummary } from "@/lib/offline-records";
import { ContextResponse, createOpcoApi, MeResponse, OpcoApi, OpcoNetworkError } from "@/lib/opco-api";
import { restoreSession } from "@/lib/session-logic";
import { persistSelectedContractId, readPersistedContractId } from "@/lib/session-persistence";
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
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [pendingRecordsCount, setPendingRecordsCount] = useState(0);
  const [recordsSyncSummary, setRecordsSyncSummary] = useState<RecordsSyncSummary>(emptyRecordsSyncSummary);
  const [selectedContractIdState, setSelectedContractIdState] = useState<string | null>(null);
  const connectivityStatus = useConnectivityStatus();
  const ownerKey = me && context ? `${context.organization.id}:${me.user.id}` : null;
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

  const loadContext = useCallback(
    async (accessToken: string, currentMe: MeResponse) => {
      try {
        const nextContext = await api.getContext(accessToken);
        await definitionCache.upsertContextSnapshot(currentMe, nextContext, new Date().toISOString());
        setContext(nextContext);
      } catch (error) {
        if (!(error instanceof OpcoNetworkError)) {
          return;
        }

        const cached = await definitionCache.getContextSnapshot();

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
          }
          setStatus("offline");
          return;
        }

        setStatus("anonymous");
      } catch {
        if (isMounted) {
          setStatus("anonymous");
        }
      }
    }

    void bootstrap();

    return () => {
      isMounted = false;
    };
  }, [api, definitionCache, loadContext]);

  useEffect(() => {
    async function refreshCount() {
      await refreshPendingRecordsCount();
    }

    void refreshCount();
  }, [refreshPendingRecordsCount]);

  useEffect(() => {
    if ((status === "authenticated" || status === "offline") && connectivityStatus === "online") {
      void syncPendingRecords();
    }
  }, [connectivityStatus, status, syncPendingRecords]);

  useEffect(() => {
    let isMounted = true;

    async function loadPersistedContractId() {
      const persistedContractId = await readPersistedContractId(definitionCache);

      if (isMounted) {
        setSelectedContractIdState(persistedContractId);
      }
    }

    void loadPersistedContractId();

    return () => {
      isMounted = false;
    };
  }, [definitionCache]);

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
    await definitionCache.upsertContextSnapshot(nextMe, nextContext, new Date().toISOString());

    setToken(loginResponse.accessToken);
    setMe(nextMe);
    setContext(nextContext);
    setStatus("authenticated");
    void syncPendingRecordsOnce({
      api,
      ownerKey: `${nextContext.organization.id}:${nextMe.user.id}`,
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
    await persistSelectedContractId(definitionCache, contractId);
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
      {children}
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
