import { describe, expect, it, vi } from "vitest";

import { createReconnectSyncController } from "./reconnect-sync";
import {
  getOperationalCoreReadyRecoveryDelayMs,
  isRecoverableAuthRefreshError,
  isSessionLifecycleScopeCurrent,
  OPERATIONAL_CORE_READY_PROBE_BACKOFF_MS,
  OPERATIONAL_CORE_READY_PROBE_MAX_ATTEMPTS,
  OPERATIONAL_CORE_READY_PROBE_TIMEOUT_MS,
  OPERATIONAL_CORE_READY_RECOVERY_BACKOFF_MS,
  probeOperationalCoreReadiness,
  shouldScheduleOperationalCoreReadyRecovery,
  shouldRefreshAccessTokenForSync,
  shouldGatePendingSyncWithOperationalCoreReady,
  shouldRunOnlinePendingSyncForReadyScope,
  shouldRunForegroundPendingSync,
} from "./pending-work-lifecycle-logic";
import { OpcoApiError, OpcoNetworkError } from "../lib/opco-api";

describe("pending work lifecycle guards", () => {
  it("runs foreground sync only when returning active online without an in-flight sync", () => {
    expect(shouldRunForegroundPendingSync({
      connectivityStatus: "online",
      hasInFlightSync: false,
      nextAppState: "active",
      previousAppState: "background",
    })).toBe(true);

    expect(shouldRunForegroundPendingSync({
      connectivityStatus: "offline",
      hasInFlightSync: false,
      nextAppState: "active",
      previousAppState: "background",
    })).toBe(false);

    expect(shouldRunForegroundPendingSync({
      connectivityStatus: "online",
      hasInFlightSync: true,
      nextAppState: "active",
      previousAppState: "background",
    })).toBe(false);

    expect(shouldRunForegroundPendingSync({
      connectivityStatus: "online",
      hasInFlightSync: false,
      nextAppState: "active",
      previousAppState: "active",
    })).toBe(false);
  });

  it("prevents stale lifecycle runs from applying after logout or contract switch", () => {
    const runScope = {
      ownerKey: "org_1:user_1",
      selectedContractId: "contract_1",
      token: "token_1",
    };

    expect(isSessionLifecycleScopeCurrent(runScope, runScope)).toBe(true);
    expect(isSessionLifecycleScopeCurrent(runScope, { ...runScope, token: null })).toBe(false);
    expect(isSessionLifecycleScopeCurrent(runScope, { ...runScope, selectedContractId: "contract_2" })).toBe(false);
    expect(isSessionLifecycleScopeCurrent(runScope, { ...runScope, ownerKey: "org_1:user_2" })).toBe(false);
  });

  it("runs an online pending sync catch-up once session scope is ready", () => {
    expect(shouldRunOnlinePendingSyncForReadyScope({
      connectivityStatus: "online",
      hasInFlightSync: false,
      ownerKey: "org_1:user_1",
      selectedContractId: "contract_1",
      status: "authenticated",
      token: "token_1",
    })).toBe(true);

    expect(shouldRunOnlinePendingSyncForReadyScope({
      connectivityStatus: "online",
      hasInFlightSync: false,
      ownerKey: null,
      selectedContractId: "contract_1",
      status: "authenticated",
      token: "token_1",
    })).toBe(false);

    expect(shouldRunOnlinePendingSyncForReadyScope({
      connectivityStatus: "online",
      hasInFlightSync: false,
      ownerKey: "org_1:user_1",
      selectedContractId: null,
      status: "authenticated",
      token: "token_1",
    })).toBe(false);

    expect(shouldRunOnlinePendingSyncForReadyScope({
      connectivityStatus: "online",
      hasInFlightSync: true,
      ownerKey: "org_1:user_1",
      selectedContractId: "contract_1",
      status: "authenticated",
      token: "token_1",
    })).toBe(false);
  });

  it("gates lifecycle reconnect triggers behind Operational Core readiness", () => {
    expect(shouldGatePendingSyncWithOperationalCoreReady("reconnect")).toBe(true);
    expect(shouldGatePendingSyncWithOperationalCoreReady("unknown-to-online")).toBe(true);
    expect(shouldGatePendingSyncWithOperationalCoreReady("startup-with-pending")).toBe(true);
    expect(shouldGatePendingSyncWithOperationalCoreReady("foreground/resume")).toBe(true);
    expect(shouldGatePendingSyncWithOperationalCoreReady("manual-retry")).toBe(false);
  });

  it("refreshes access tokens for sync only when the JWT is expired or close to expiration", () => {
    const nowMs = Date.parse("2026-08-29T10:00:00.000Z");

    expect(shouldRefreshAccessTokenForSync(jwtExpiringAt("2026-08-29T11:00:00.000Z"), nowMs)).toBe(false);
    expect(shouldRefreshAccessTokenForSync(jwtExpiringAt("2026-08-29T10:04:59.000Z"), nowMs)).toBe(true);
    expect(shouldRefreshAccessTokenForSync(jwtExpiringAt("2026-08-29T09:59:59.000Z"), nowMs)).toBe(true);
    expect(shouldRefreshAccessTokenForSync("opaque-token", nowMs)).toBe(false);
  });

  it("treats temporary auth refresh failures as recoverable session state", () => {
    expect(isRecoverableAuthRefreshError(new OpcoNetworkError("timeout"))).toBe(true);
    expect(isRecoverableAuthRefreshError(new OpcoApiError("Servicio temporalmente no disponible.", "DB_UNAVAILABLE", 503))).toBe(true);
    expect(isRecoverableAuthRefreshError(new OpcoApiError("Servicio temporalmente no disponible.", "SERVER_UNAVAILABLE", 503))).toBe(true);
    expect(isRecoverableAuthRefreshError(new OpcoApiError("Refresh token no valido", "REFRESH_TOKEN_REUSED", 401))).toBe(false);
    expect(isRecoverableAuthRefreshError(new OpcoApiError("Refresh token expirado", "REFRESH_TOKEN_EXPIRED", 401))).toBe(false);
  });

  it("probes /ready with a short timeout and shared syncRunId", async () => {
    const getReady = vi.fn(async () => ({ ok: true }));

    const result = await probeOperationalCoreReadiness({
      api: { getReady },
      syncRunId: "sync_reconnect_1",
    });

    expect(result).toEqual({ attempts: 1, ready: true });
    expect(getReady).toHaveBeenCalledWith({
      diagnosticAttemptNumber: 1,
      diagnosticOperation: "READY_CHECK",
      diagnosticSyncRunId: "sync_reconnect_1",
      timeoutMs: OPERATIONAL_CORE_READY_PROBE_TIMEOUT_MS,
    });
  });

  it("bounds readiness retries before allowing business sync", async () => {
    const sleeps: number[] = [];
    const getReady = vi
      .fn()
      .mockRejectedValueOnce(new Error("not yet"))
      .mockRejectedValueOnce(new Error("still warming"))
      .mockResolvedValueOnce({ ok: true });

    const result = await probeOperationalCoreReadiness({
      api: { getReady },
      sleep: async (durationMs) => {
        sleeps.push(durationMs);
      },
      syncRunId: "sync_reconnect_2",
    });

    expect(result).toEqual({ attempts: 3, ready: true });
    expect(getReady).toHaveBeenCalledTimes(OPERATIONAL_CORE_READY_PROBE_MAX_ATTEMPTS);
    expect(sleeps).toEqual([...OPERATIONAL_CORE_READY_PROBE_BACKOFF_MS]);
  });

  it("keeps all readiness retry attempts correlated with the same syncRunId", async () => {
    const getReady = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ ok: true });

    const result = await probeOperationalCoreReadiness({
      api: { getReady },
      sleep: async () => undefined,
      syncRunId: "sync_retry_attempts",
    });

    expect(result).toEqual({ attempts: 2, ready: true });
    expect(getReady).toHaveBeenCalledTimes(2);
    expect(getReady).toHaveBeenNthCalledWith(1, {
      diagnosticAttemptNumber: 1,
      diagnosticOperation: "READY_CHECK",
      diagnosticSyncRunId: "sync_retry_attempts",
      timeoutMs: OPERATIONAL_CORE_READY_PROBE_TIMEOUT_MS,
    });
    expect(getReady).toHaveBeenNthCalledWith(2, {
      diagnosticAttemptNumber: 2,
      diagnosticOperation: "READY_CHECK",
      diagnosticSyncRunId: "sync_retry_attempts",
      timeoutMs: OPERATIONAL_CORE_READY_PROBE_TIMEOUT_MS,
    });
  });

  it("returns not ready without throwing when /ready never confirms", async () => {
    const sleeps: number[] = [];
    const getReady = vi.fn(async () => {
      throw new Error("railway still reconnecting");
    });

    const result = await probeOperationalCoreReadiness({
      api: { getReady },
      sleep: async (durationMs) => {
        sleeps.push(durationMs);
      },
      syncRunId: "sync_reconnect_3",
    });

    expect(result).toEqual({ attempts: 3, ready: false });
    expect(getReady).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([500, 1_000]);
  });

  it("uses a bounded recovery schedule after exhausted readiness cycles", () => {
    expect(getOperationalCoreReadyRecoveryDelayMs(0)).toBe(OPERATIONAL_CORE_READY_RECOVERY_BACKOFF_MS[0]);
    expect(getOperationalCoreReadyRecoveryDelayMs(1)).toBe(OPERATIONAL_CORE_READY_RECOVERY_BACKOFF_MS[1]);
    expect(getOperationalCoreReadyRecoveryDelayMs(2)).toBe(OPERATIONAL_CORE_READY_RECOVERY_BACKOFF_MS[2]);
    expect(getOperationalCoreReadyRecoveryDelayMs(3)).toBe(OPERATIONAL_CORE_READY_RECOVERY_BACKOFF_MS[3]);
    expect(getOperationalCoreReadyRecoveryDelayMs(4)).toBe(OPERATIONAL_CORE_READY_RECOVERY_BACKOFF_MS[3]);
    expect(getOperationalCoreReadyRecoveryDelayMs(20)).toBe(OPERATIONAL_CORE_READY_RECOVERY_BACKOFF_MS[3]);
    expect(getOperationalCoreReadyRecoveryDelayMs(-1)).toBeNull();
  });

  it("keeps a future recovery attempt guaranteed after the third cycle while conditions remain valid", () => {
    expect(getOperationalCoreReadyRecoveryDelayMs(3)).toBe(60_000);
    expect(getOperationalCoreReadyRecoveryDelayMs(4)).toBe(60_000);
    expect(shouldScheduleOperationalCoreReadyRecovery({
      appLifecycleState: "active",
      connectivityStatus: "online",
      hasRecoveryTimer: false,
      hasRunActive: false,
      isScopeCurrent: true,
      pendingWorkExists: true,
    })).toBe(true);
  });

  it("does not schedule recovery when pending is gone, offline, backgrounded, or already active", () => {
    const base = {
      appLifecycleState: "active" as const,
      connectivityStatus: "online" as const,
      hasRecoveryTimer: false,
      hasRunActive: false,
      isScopeCurrent: true,
      pendingWorkExists: true,
    };

    expect(shouldScheduleOperationalCoreReadyRecovery({ ...base, pendingWorkExists: false })).toBe(false);
    expect(shouldScheduleOperationalCoreReadyRecovery({ ...base, connectivityStatus: "offline" })).toBe(false);
    expect(shouldScheduleOperationalCoreReadyRecovery({ ...base, appLifecycleState: "background" })).toBe(false);
    expect(shouldScheduleOperationalCoreReadyRecovery({ ...base, hasRecoveryTimer: true })).toBe(false);
    expect(shouldScheduleOperationalCoreReadyRecovery({ ...base, hasRunActive: true })).toBe(false);
    expect(shouldScheduleOperationalCoreReadyRecovery({ ...base, isScopeCurrent: false })).toBe(false);
  });

  it("allows a new online transition to retry after a previous readiness run failed", async () => {
    vi.useFakeTimers();
    try {
      const runSync = vi.fn()
        .mockRejectedValueOnce(new Error("ready timeout"))
        .mockResolvedValueOnce(undefined);
      const shouldSync = vi.fn(async () => true);
      const controller = createReconnectSyncController({
        debounceMs: 100,
        runSync,
        shouldSync,
      });

      controller.handleConnectivityStatus("offline");
      controller.handleConnectivityStatus("online");
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();

      expect(runSync).toHaveBeenCalledOnce();

      controller.handleConnectivityStatus("offline");
      controller.handleConnectivityStatus("online");
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();

      expect(shouldSync).toHaveBeenCalledTimes(2);
      expect(runSync).toHaveBeenCalledTimes(2);
      expect(runSync).toHaveBeenLastCalledWith({
        previousConnectivityStatus: "offline",
        resultingConnectivityStatus: "online",
        trigger: "reconnect",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

function jwtExpiringAt(iso: string) {
  const payload = { exp: Math.floor(Date.parse(iso) / 1000) };
  const encoded = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

  return `header.${encoded}.signature`;
}
