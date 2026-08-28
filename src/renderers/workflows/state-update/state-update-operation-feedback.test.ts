import { describe, expect, it } from "vitest";

import {
  hideStateUpdateTimeoutAfterConfirmedSync,
  resolveStateUpdateOperationFeedback,
} from "./state-update-operation-feedback";
import { StateUpdateLastSyncTelemetry } from "@/lib/state-update-offline";

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

  it("shows syncing feedback for pending work after reconnect", () => {
    expect(resolveStateUpdateOperationFeedback({
      connectivityStatus: "online",
      pendingCount: 1,
    })).toMatchObject({
      message: "Sincronizando con Opco...",
      phase: "SYNCING",
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
    timeoutOccurred: false,
    trigger: "reconnect",
  };
}
