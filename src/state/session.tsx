import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { getLocalDatabase, LocalDatabase } from "@/lib/local-db";
import { ContextResponse, createOpcoApi, MeResponse, OpcoApi } from "@/lib/opco-api";
import { restoreSession } from "@/lib/session-logic";
import { persistSelectedContractId, readPersistedContractId } from "@/lib/session-persistence";
import * as tokenStorage from "@/lib/token-storage";

type SessionStatus = "loading" | "anonymous" | "authenticated" | "offline";

type SessionContextValue = {
  api: OpcoApi;
  context: ContextResponse | null;
  definitionCache: LocalDatabase;
  me: MeResponse | null;
  selectedContractId: string | null;
  setSelectedContractId(contractId: string | null): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  status: SessionStatus;
  token: string | null;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const api = useMemo(() => createOpcoApi(), []);
  const definitionCache = useMemo(() => getLocalDatabase(), []);
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [context, setContext] = useState<ContextResponse | null>(null);
  const [selectedContractIdState, setSelectedContractIdState] = useState<string | null>(null);

  const loadContext = useCallback(
    async (accessToken: string) => {
      try {
        const nextContext = await api.getContext(accessToken);
        setContext(nextContext);
      } catch {
        setStatus("offline");
      }
    },
    [api],
  );

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      try {
        const restored = await restoreSession(tokenStorage, api);

        if (!isMounted) {
          return;
        }

        if (restored.status === "authenticated") {
          setToken(restored.token);
          setMe(restored.me);
          setStatus("authenticated");
          void loadContext(restored.token);
          return;
        }

        if (restored.status === "offline") {
          setToken(restored.token);
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
  }, [api, loadContext]);

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

    await tokenStorage.setToken(loginResponse.accessToken);

    const nextMe = await api.getMe(loginResponse.accessToken);
    const nextContext = await api.getContext(loginResponse.accessToken);

    setToken(loginResponse.accessToken);
    setMe(nextMe);
    setContext(nextContext);
    setStatus("authenticated");
  }

  async function signOut() {
    await tokenStorage.deleteToken();
    void persistSelectedContractId(definitionCache, null);
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
        selectedContractId: selectedContractIdState,
        setSelectedContractId,
        signIn,
        signOut,
        status,
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
