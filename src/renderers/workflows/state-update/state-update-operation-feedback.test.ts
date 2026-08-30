import { describe, expect, it } from "vitest";

import {
  createStateUpdateVisibleErrorDiagnostics,
  hideStateUpdateTimeoutAfterConfirmedSync,
  resolveStateUpdateOperationFeedback,
  stateUpdateRefreshErrorMessage,
} from "./state-update-operation-feedback";
import { OpcoNetworkError } from "../../../lib/opco-api";
import type { StateUpdateLastSyncTelemetry } from "../../../lib/state-update-offline";

describe("state update operation feedback", () => {
  it("shows offline saved feedback for unresolved local intent while offline", () => {
    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "offline",
      pendingCount: 1,
    })).toMatchObject({
      message: "Guardado en este dispositivo.",
      phase: "OFFLINE_SAVED",
    });
  });

  it("shows pending feedback for durable pending work before the sync engine starts", () => {
    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      pendingCount: 1,
    })).toMatchObject({
      message: "Pendiente de sincronizacion.",
      phase: "PENDING",
    });
  });

  it("shows syncing feedback only while the sync engine is active", () => {
    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      isSyncing: true,
      pendingCount: 1,
    })).toMatchObject({
      message: "Sincronizando con Opco...",
      phase: "SYNCING",
    });
  });

  it("shows reconnecting feedback while Operational Core readiness is being checked", () => {
    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      isReadinessChecking: true,
      lastActivity: {
        result: "reconnecting",
        type: "ready_check",
      },
      pendingCount: 1,
    })).toMatchObject({
      message: "Reconectando con Opco...",
      phase: "RECONNECTING",
    });
  });

  it("does not keep reconnecting feedback from historical readiness telemetry", () => {
    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      lastActivity: {
        result: "reconnecting",
        type: "ready_check",
      },
      pendingCount: 1,
    })).toMatchObject({
      message: "Pendiente de sincronizacion.",
      phase: "PENDING",
    });
  });

  it("keeps pending intent visible without a definitive write error when readiness fails", () => {
    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      lastActivity: {
        result: "ready_failed",
        type: "ready_check",
      },
      pendingCount: 1,
    })).toMatchObject({
      message: "Pendiente de sincronizacion.",
      phase: "PENDING",
    });
  });

  it("does not show a network error as a write failure when only readiness failed", () => {
    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      lastActivity: {
        result: "ready_failed",
        type: "ready_check",
      },
      pendingCount: 1,
      visibleError: "OpcoNetworkError",
    })).toMatchObject({
      message: "Pendiente de sincronizacion.",
      phase: "PENDING",
    });
  });

  it("shows session restoring feedback only while auth refresh is active", () => {
    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      isAuthSessionRestoring: true,
      lastActivity: {
        result: "auth_pending",
        type: "auth_refresh",
      },
      pendingCount: 1,
    })).toMatchObject({
      message: "Restableciendo sesion con Opco...",
      phase: "RESTORING_SESSION",
    });

    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      lastActivity: {
        result: "auth_timeout",
        type: "auth_refresh",
      },
      pendingCount: 1,
    })).toMatchObject({
      message: "Pendiente de sincronizacion.",
      phase: "PENDING",
    });
  });

  it("does not show a definitive timeout error while confirmation is still pending", () => {
    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      lastSync: {
        ...lastSync(),
        operationsFailed: 0,
        timeoutOccurred: true,
      },
      pendingCount: 1,
    })).toMatchObject({
      message: "Confirmando con Opco...",
      phase: "CONFIRMING",
    });
  });

  it("returns idle after timeout when remote reconciliation confirmed the write", () => {
    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      lastSync: {
        ...lastSync(),
        reconciledAfterTimeout: true,
        result: "reconciled_success",
        timeoutOccurred: true,
      },
      pendingCount: 0,
    })).toMatchObject({
      message: null,
      phase: "IDLE",
    });
  });

  it("does not show syncing when no pending work exists", () => {
    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      isSyncing: true,
      pendingCount: 0,
    })).toMatchObject({
      message: null,
      phase: "IDLE",
    });
  });

  it("returns non-loading feedback after terminal reconnect outcomes when no runtime operation is active", () => {
    for (const result of ["ready_failed", "cancelled_scope_changed", "interrupted", "ready_confirmed", "sync_started"]) {
      expect(resolveStateUpdateOperationFeedback({
        connectivityStatus: "online",
        lastActivity: {
          result,
          type: "ready_check",
        },
        pendingCount: 1,
      })).toMatchObject({
        message: "Pendiente de sincronizacion.",
        phase: "PENDING",
      });
    }
  });

  it("does not keep auth, sync, or readiness loading feedback after their active flags are false", () => {
    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      lastActivity: {
        result: "auth_timeout",
        type: "auth_refresh",
      },
      pendingCount: 1,
    }).phase).toBe("PENDING");
    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      isReadinessChecking: false,
      lastActivity: {
        result: "reconnecting",
        type: "ready_check",
      },
      pendingCount: 1,
    }).phase).toBe("PENDING");
    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      isSyncing: false,
      pendingCount: 1,
    }).phase).toBe("PENDING");
  });

  it("shows unresolved error when timeout could not be confirmed", () => {
    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      lastSync: {
        ...lastSync(),
        operationsFailed: 1,
        result: "failed",
        timeoutOccurred: true,
      },
      pendingCount: 1,
    })).toMatchObject({
      message: "No fue posible confirmar el cambio con Opco.",
      phase: "UNRESOLVED_ERROR",
    });
  });

  it("treats conflict and failed states as terminal feedback without a stale spinner", () => {
    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      hasConflict: true,
      pendingCount: 1,
    }).phase).toBe("CONFLICT");

    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      pendingCount: 0,
      visibleError: "Error funcional.",
    }).phase).toBe("FAILED");
  });

  it("hides a stale timeout after a reconciled success but keeps refresh errors visible", () => {
    const confirmed = {
      ...lastSync(),
      reconciledAfterTimeout: true,
      result: "reconciled_success" as const,
      timeoutOccurred: true,
    };

    expect(hideStateUpdateTimeoutAfterConfirmedSync({
      error: "La solicitud a Opco agoto el tiempo de espera.",
      lastSync: confirmed,
      pendingCount: 0,
    })).toBe(true);
    expect(hideStateUpdateTimeoutAfterConfirmedSync({
      error: "No fue posible cargar asistencia.",
      lastSync: confirmed,
      pendingCount: 0,
    })).toBe(false);
  });

  it("identifies a GET refresh timeout without treating it as a write failure", () => {
    const error = timeoutError("GET", "/api/v1/contracts/:contractId/views/:appViewId/workflow/attendance");

    expect(stateUpdateRefreshErrorMessage(error)).toBe("No se pudo actualizar la vista. Intenta actualizar nuevamente.");
    expect(createStateUpdateVisibleErrorDiagnostics({
      error,
      operation: "refresh",
      resolution: "refresh_failed",
      syncRunId: "sync_abc123",
    })).toMatchObject({
      errorCode: "OpcoNetworkError",
      method: "GET",
      occurredAt: "2026-08-28T12:00:00.000Z",
      operation: "refresh",
      pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/attendance",
      resolution: "refresh_failed",
      syncRunId: "sync_abc123",
      timeoutOccurred: true,
    });
  });

  it("keeps write success independent from a later GET refresh timeout", () => {
    const writeFeedback = resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      lastSync: {
        ...lastSync(),
        operationsCompleted: 1,
        result: "success",
      },
      pendingCount: 0,
      successMessage: "Cambio registrado.",
    });

    expect(writeFeedback).toMatchObject({
      message: "Cambio registrado.",
      phase: "SUCCESS",
    });
    expect(stateUpdateRefreshErrorMessage(
      timeoutError("GET", "/api/v1/contracts/:contractId/views/:appViewId/workflow/attendance"),
    )).toBe("No se pudo actualizar la vista. Intenta actualizar nuevamente.");
  });

  it("does not create STATE_UPDATE sync telemetry semantics for a plain GET attendance timeout", () => {
    const diagnostics = createStateUpdateVisibleErrorDiagnostics({
      error: timeoutError("GET", "/api/v1/contracts/:contractId/views/:appViewId/workflow/attendance"),
      operation: "load-day",
    });

    expect(diagnostics).toMatchObject({
      method: "GET",
      operation: "load-day",
      pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/attendance",
      syncRunId: null,
      timeoutOccurred: true,
    });
  });
});

function lastSync(): StateUpdateLastSyncTelemetry {
  return {
    completedAt: "2026-08-28T12:00:12.000Z",
    lastRequestDiagnostics: null,
    operationsAttempted: 1,
    operationsCompleted: 0,
    operationsFailed: 0,
    operationsSelected: 1,
    reconciledAfterTimeout: false,
    result: "success",
    startedAt: "2026-08-28T12:00:00.000Z",
    syncRunId: "sync_abc123",
    timeoutOccurred: false,
    trigger: "reconnect",
  };
}

function timeoutError(method: string, pathTemplate: string) {
  return new OpcoNetworkError("La solicitud a Opco agoto el tiempo de espera.", {
    abortControllerTriggered: true,
    fetchResolvedAt: null,
    httpStatus: null,
    method,
    pathTemplate,
    requestCompletedAt: "2026-08-28T12:00:12.000Z",
    requestDurationMs: 12000,
    requestStartedAt: "2026-08-28T12:00:00.000Z",
    responseBodyStartedAt: null,
    responseParsedAt: null,
    responseStarted: false,
    timeoutMs: 12000,
  });
}
