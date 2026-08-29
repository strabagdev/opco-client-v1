import { ConnectivityStatus } from "../lib/connectivity";
import { OpcoApi } from "../lib/opco-api";
import { StateUpdateSyncTrigger } from "../lib/state-update-offline";

type AppLifecycleState = "active" | "background" | "inactive" | "unknown" | "extension";

export type SessionLifecycleScope = {
  ownerKey: string | null;
  selectedContractId: string | null;
  token: string | null;
};

export const OPERATIONAL_CORE_READY_PROBE_TIMEOUT_MS = 2_500;
export const OPERATIONAL_CORE_READY_PROBE_MAX_ATTEMPTS = 3;
export const OPERATIONAL_CORE_READY_PROBE_BACKOFF_MS = [500, 1_000] as const;

export type OperationalCoreReadinessProbeResult = {
  attempts: number;
  ready: boolean;
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

export function shouldGatePendingSyncWithOperationalCoreReady(trigger: StateUpdateSyncTrigger) {
  return trigger === "reconnect" ||
    trigger === "unknown-to-online" ||
    trigger === "startup-with-pending" ||
    trigger === "foreground/resume";
}

export async function probeOperationalCoreReadiness({
  api,
  maxAttempts = OPERATIONAL_CORE_READY_PROBE_MAX_ATTEMPTS,
  probeTimeoutMs = OPERATIONAL_CORE_READY_PROBE_TIMEOUT_MS,
  sleep = defaultSleep,
  syncRunId = null,
}: {
  api: Pick<OpcoApi, "getReady">;
  maxAttempts?: number;
  probeTimeoutMs?: number;
  sleep?: (durationMs: number) => Promise<void>;
  syncRunId?: string | null;
}): Promise<OperationalCoreReadinessProbeResult> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await api.getReady({
        diagnosticOperation: "READY_CHECK",
        diagnosticSyncRunId: syncRunId,
        timeoutMs: probeTimeoutMs,
      });

      return { attempts: attempt, ready: true };
    } catch {
      if (attempt >= maxAttempts) {
        return { attempts: attempt, ready: false };
      }

      await sleep(OPERATIONAL_CORE_READY_PROBE_BACKOFF_MS[attempt - 1] ?? OPERATIONAL_CORE_READY_PROBE_BACKOFF_MS.at(-1) ?? 0);
    }
  }

  return { attempts: maxAttempts, ready: false };
}

function defaultSleep(durationMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
