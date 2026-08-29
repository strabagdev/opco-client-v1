import { ConnectivityStatus } from "../lib/connectivity";
import { OpcoApi, OpcoApiError, OpcoNetworkError } from "../lib/opco-api";
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
export const OPERATIONAL_CORE_READY_RECOVERY_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000] as const;
export const ACCESS_TOKEN_SYNC_REFRESH_MARGIN_MS = 5 * 60 * 1000;

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

export function getSessionLifecycleScopeMismatchReason(
  runScope: SessionLifecycleScope,
  currentScope: SessionLifecycleScope,
) {
  if (runScope.ownerKey !== currentScope.ownerKey) {
    return "owner_changed";
  }

  if (runScope.selectedContractId !== currentScope.selectedContractId) {
    return "contract_changed";
  }

  if (runScope.token === null || runScope.token !== currentScope.token) {
    return "token_changed";
  }

  return "current";
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

export function getOperationalCoreReadyRecoveryDelayMs(attempts: number) {
  if (!Number.isInteger(attempts) || attempts < 0) {
    return null;
  }

  return OPERATIONAL_CORE_READY_RECOVERY_BACKOFF_MS[attempts] ??
    OPERATIONAL_CORE_READY_RECOVERY_BACKOFF_MS[OPERATIONAL_CORE_READY_RECOVERY_BACKOFF_MS.length - 1];
}

export function shouldScheduleOperationalCoreReadyRecovery({
  appLifecycleState,
  connectivityStatus,
  hasRecoveryTimer,
  hasRunActive,
  isScopeCurrent,
  pendingWorkExists,
}: {
  appLifecycleState: AppLifecycleState;
  connectivityStatus: ConnectivityStatus;
  hasRecoveryTimer: boolean;
  hasRunActive: boolean;
  isScopeCurrent: boolean;
  pendingWorkExists: boolean;
}) {
  return connectivityStatus === "online" &&
    appLifecycleState === "active" &&
    pendingWorkExists &&
    isScopeCurrent &&
    !hasRecoveryTimer &&
    !hasRunActive;
}

export function shouldRefreshAccessTokenForSync(
  token: string,
  nowMs = Date.now(),
  refreshMarginMs = ACCESS_TOKEN_SYNC_REFRESH_MARGIN_MS,
) {
  const expiresAtMs = readJwtExpirationMs(token);

  if (!expiresAtMs) {
    return false;
  }

  return expiresAtMs - nowMs <= refreshMarginMs;
}

export function planPostReadinessPendingWork({
  currentScope,
  nowMs = Date.now(),
  refreshMarginMs = ACCESS_TOKEN_SYNC_REFRESH_MARGIN_MS,
  runScope,
  token,
}: {
  currentScope: SessionLifecycleScope;
  nowMs?: number;
  refreshMarginMs?: number;
  runScope: SessionLifecycleScope;
  token: string;
}) {
  const scopeCheckAfterReadiness = getSessionLifecycleScopeMismatchReason(runScope, currentScope);

  if (scopeCheckAfterReadiness !== "current") {
    return {
      authDecision: null,
      nextAction: "cancelled_scope_changed",
      scopeCheckAfterReadiness,
    } as const;
  }

  const authDecision = shouldRefreshAccessTokenForSync(token, nowMs, refreshMarginMs)
    ? "refresh_required"
    : "token_valid";

  return {
    authDecision,
    nextAction: authDecision === "refresh_required" ? "auth_refresh" : "sync_pending_work",
    scopeCheckAfterReadiness,
  } as const;
}

export function isRecoverableAuthRefreshError(error: unknown) {
  return error instanceof OpcoNetworkError ||
    (error instanceof OpcoApiError && (error.status >= 500 || error.code === "DB_UNAVAILABLE"));
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
        diagnosticAttemptNumber: attempt,
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

function readJwtExpirationMs(token: string) {
  const [, payload] = token.split(".");

  if (!payload) {
    return null;
  }

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
    const decoded = globalThis.atob?.(padded);

    if (!decoded) {
      return null;
    }

    const parsed = JSON.parse(decoded) as { exp?: unknown };

    return typeof parsed.exp === "number" && Number.isFinite(parsed.exp) ? parsed.exp * 1000 : null;
  } catch {
    return null;
  }
}
