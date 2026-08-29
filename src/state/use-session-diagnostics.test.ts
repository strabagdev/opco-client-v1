import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emptyStateUpdateReconnectDiagnostics,
  markInterruptedReadinessActivity,
  mergeStateUpdateReconnectDiagnosticsForPersistence,
  shouldShowStateUpdateDiagnostics,
} from "./use-session-diagnostics";

describe("session diagnostics controller helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps diagnostics observation opt-in from the query flag", () => {
    vi.stubGlobal("window", {
      location: {
        search: "?stateUpdateDiagnostics=1",
      },
    });

    expect(shouldShowStateUpdateDiagnostics()).toBe(true);
  });

  it("does not enable diagnostics observation on mount without the query flag", () => {
    vi.stubGlobal("window", {
      location: {
        search: "?recordsDiagnostics=1",
      },
    });

    expect(shouldShowStateUpdateDiagnostics()).toBe(false);
  });

  it("merges connectivity writes over persisted diagnostics instead of empty remount state", () => {
    const persisted = {
      currentConnectivity: {
        status: "offline" as const,
        updatedAt: "2026-08-28T10:00:00.000Z",
      },
      lastReconnect: {
        detected: true,
        detectedAt: "2026-08-28T10:00:00.000Z",
        previousConnectivityStatus: "offline" as const,
        resultingConnectivityStatus: "online" as const,
      },
      lastStateUpdateActivity: {
        completedAt: "2026-08-28T10:00:13.000Z",
        lastRequestDiagnostics: null,
        operationsCompleted: 1,
        operationsFailed: 0,
        result: "reconciled_success" as const,
        startedAt: "2026-08-28T10:00:00.000Z",
        syncRunId: "sync_reconnect_1",
        timeoutOccurred: true,
        trigger: "snapshot_reconciliation" as const,
        type: "snapshot_reconciliation" as const,
      },
      lastStateUpdateSync: null,
      lastVisibleErrorEvent: {
        clearedAt: "2026-08-28T10:00:14.000Z",
        durationMs: 12000,
        errorCode: "OpcoNetworkError",
        httpStatus: null,
        method: "GET",
        occurredAt: "2026-08-28T10:00:01.000Z",
        operation: "refresh",
        pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/attendance",
        resolution: "cleared_after_success" as const,
        syncRunId: "sync_reconnect_1",
        timeoutOccurred: true,
      },
    };

    expect(mergeStateUpdateReconnectDiagnosticsForPersistence({
      current: emptyStateUpdateReconnectDiagnostics,
      persisted,
      updater: (current) => ({
        ...current,
        currentConnectivity: {
          status: "online",
          updatedAt: "2026-08-28T10:00:15.000Z",
        },
      }),
    })).toMatchObject({
      currentConnectivity: { status: "online" },
      lastReconnect: { detected: true },
      lastStateUpdateActivity: { type: "snapshot_reconciliation", result: "reconciled_success" },
      lastVisibleErrorEvent: { operation: "refresh", resolution: "cleared_after_success" },
    });
  });

  it("marks a persisted reconnecting readiness run without READY_CHECK history as interrupted", () => {
    const telemetry = markInterruptedReadinessActivity({
      ...emptyStateUpdateReconnectDiagnostics,
      lastStateUpdateActivity: {
        completedAt: "2026-08-29T10:00:00.000Z",
        lastRequestDiagnostics: null,
        operationsCompleted: 0,
        operationsFailed: 0,
        result: "reconnecting",
        startedAt: "2026-08-29T10:00:00.000Z",
        syncRunId: "sync_orphaned_ready",
        timeoutOccurred: false,
        trigger: "ready_check",
        type: "ready_check",
      },
      requestHistory: [],
    }, "2026-08-29T10:05:00.000Z");

    expect(telemetry.lastStateUpdateActivity).toMatchObject({
      completedAt: "2026-08-29T10:05:00.000Z",
      result: "interrupted",
      syncRunId: "sync_orphaned_ready",
      type: "ready_check",
    });
  });

  it("does not interrupt a reconnecting readiness run that has READY_CHECK history", () => {
    const telemetry = markInterruptedReadinessActivity({
      ...emptyStateUpdateReconnectDiagnostics,
      lastStateUpdateActivity: {
        completedAt: "2026-08-29T10:00:00.000Z",
        lastRequestDiagnostics: null,
        operationsCompleted: 0,
        operationsFailed: 0,
        result: "reconnecting",
        startedAt: "2026-08-29T10:00:00.000Z",
        syncRunId: "sync_ready_started",
        timeoutOccurred: false,
        trigger: "ready_check",
        type: "ready_check",
      },
      requestHistory: [{
        abortControllerTriggered: false,
        diagnosticOperation: "READY_CHECK",
        diagnosticRequestId: "opco_diag_ready",
        diagnosticSyncRunId: "sync_ready_started",
        errorCode: null,
        fetchResolvedAt: null,
        httpStatus: null,
        interpretation: "unknown",
        method: "GET",
        pathTemplate: "/api/v1/ready",
        requestCompletedAt: "2026-08-29T10:00:01.000Z",
        requestDurationMs: 1000,
        requestStartedAt: "2026-08-29T10:00:00.000Z",
        responseBodyStartedAt: null,
        responseParsedAt: null,
        responseRequestId: null,
        responseStarted: false,
        serverTiming: [],
        timeoutMs: 2500,
      }],
    }, "2026-08-29T10:05:00.000Z");

    expect(telemetry.lastStateUpdateActivity?.result).toBe("reconnecting");
  });
});
