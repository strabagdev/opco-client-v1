import { ConnectivityStatus } from "../lib/connectivity";

type AppLifecycleState = "active" | "background" | "inactive" | "unknown" | "extension";

export type SessionLifecycleScope = {
  ownerKey: string | null;
  selectedContractId: string | null;
  token: string | null;
};

export function isSessionLifecycleScopeCurrent(runScope: SessionLifecycleScope, currentScope: SessionLifecycleScope) {
  return runScope.token !== null &&
    runScope.token === currentScope.token &&
    runScope.ownerKey === currentScope.ownerKey &&
    runScope.selectedContractId === currentScope.selectedContractId;
}

export function shouldRunForegroundPendingSync({
  connectivityStatus,
  hasInFlightSync,
  nextAppState,
  previousAppState,
}: {
  connectivityStatus: ConnectivityStatus;
  hasInFlightSync: boolean;
  nextAppState: AppLifecycleState;
  previousAppState: AppLifecycleState;
}) {
  return previousAppState !== "active" &&
    nextAppState === "active" &&
    connectivityStatus === "online" &&
    !hasInFlightSync;
}

export function shouldRunOnlinePendingSyncForReadyScope({
  connectivityStatus,
  hasInFlightSync,
  ownerKey,
  selectedContractId,
  status,
  token,
}: {
  connectivityStatus: ConnectivityStatus;
  hasInFlightSync: boolean;
  ownerKey: string | null;
  selectedContractId: string | null;
  status: "loading" | "anonymous" | "authenticated" | "offline";
  token: string | null;
}) {
  return (status === "authenticated" || status === "offline") &&
    connectivityStatus === "online" &&
    Boolean(ownerKey) &&
    Boolean(selectedContractId) &&
    Boolean(token) &&
    !hasInFlightSync;
}
