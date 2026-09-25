import { describe, expect, it } from "vitest";

import { SyncTelemetry } from "@/lib/sync-telemetry";

import {
  getRecordsInlineSyncSummary,
  getRecordsListErrorMessage,
  getRecordsSyncProblemMessage,
  resolveRecordsSearchForScopeChange,
  shouldShowRecordsSyncProblem,
} from "./records-renderer-state";

describe("records renderer state", () => {
  const baseTelemetry: SyncTelemetry = {
    contractId: "contract_1",
    entityTypeId: "entity_1",
    lastFullRefreshCompletedAt: null,
    lastPushCompletedAt: null,
    lastReconcileCompletedAt: null,
    lastSuccessfulSyncAt: null,
    lastSyncAttemptAt: null,
    lastSyncErrorAt: null,
    lastSyncErrorCode: null,
    lastSyncErrorPhase: null,
    ownerKey: "org_1:user_1",
    syncPhase: "idle",
  };

  it("clears a residual search when navigation switches from Equipos to Personas", () => {
    expect(
      resolveRecordsSearchForScopeChange({
        currentSearch: {
          debouncedSearch: "EQ-",
          searchText: "EQ-",
        },
        nextScope: {
          appViewId: "view_personas",
          entityTypeId: "entity_personas",
        },
        previousScope: {
          appViewId: "view_equipos",
          entityTypeId: "entity_equipos",
        },
      }),
    ).toEqual({
      debouncedSearch: "",
      searchText: "",
    });
  });

  it("does not keep a sync problem visible after telemetry returns to idle", () => {
    expect(shouldShowRecordsSyncProblem({
      connectivityStatus: "online",
      telemetry: {
        ...baseTelemetry,
        lastSyncErrorAt: "2026-08-30T08:00:00.000Z",
        lastSyncErrorCode: "NETWORK",
        lastSyncErrorPhase: "refreshing",
        lastSuccessfulSyncAt: "2026-08-30T08:01:00.000Z",
        syncPhase: "idle",
      },
    })).toBe(false);
  });

  it("shows a sync problem only for a current online records sync error", () => {
    const errorTelemetry = {
      ...baseTelemetry,
      lastSyncErrorAt: "2026-08-30T08:00:00.000Z",
      lastSyncErrorCode: "NETWORK" as const,
      lastSyncErrorPhase: "refreshing" as const,
      syncPhase: "error" as const,
    };

    expect(shouldShowRecordsSyncProblem({
      connectivityStatus: "online",
      telemetry: errorTelemetry,
    })).toBe(true);
    expect(shouldShowRecordsSyncProblem({
      connectivityStatus: "offline",
      telemetry: errorTelemetry,
    })).toBe(false);
    expect(shouldShowRecordsSyncProblem({
      connectivityStatus: "unknown",
      telemetry: errorTelemetry,
    })).toBe(false);
  });

  it("distinguishes read failures from failures sending local changes", () => {
    expect(getRecordsSyncProblemMessage({
      connectivityStatus: "online",
      telemetry: {
        ...baseTelemetry,
        lastSyncErrorPhase: "refreshing",
        syncPhase: "error",
      },
    })).toBe("Problema al actualizar registros");

    expect(getRecordsSyncProblemMessage({
      connectivityStatus: "online",
      telemetry: {
        ...baseTelemetry,
        lastSyncErrorPhase: "pushing",
        syncPhase: "error",
      },
    })).toBe("Problema al enviar cambios");
  });

  it("removes the read warning after a successful refresh returns telemetry to idle", () => {
    expect(getRecordsSyncProblemMessage({
      connectivityStatus: "online",
      telemetry: {
        ...baseTelemetry,
        lastSuccessfulSyncAt: "2026-09-22T17:01:50.000Z",
        syncPhase: "idle",
      },
    })).toBeNull();
  });

  it("keeps offline cache and pending status primary even when records telemetry has an error", () => {
    const syncProblem = shouldShowRecordsSyncProblem({
      connectivityStatus: "offline",
      telemetry: {
        ...baseTelemetry,
        lastSyncErrorAt: "2026-08-30T08:00:00.000Z",
        lastSyncErrorCode: "NETWORK",
        lastSyncErrorPhase: "refreshing",
        syncPhase: "error",
      },
    });

    expect(syncProblem).toBe(false);
  });

  it("converges after reconnect success without requiring a remount", () => {
    const staleHistoricalError = shouldShowRecordsSyncProblem({
      connectivityStatus: "online",
      telemetry: {
        ...baseTelemetry,
        lastSyncErrorAt: "2026-08-30T08:00:00.000Z",
        lastSyncErrorCode: "NETWORK",
        lastSyncErrorPhase: "refreshing",
        lastSuccessfulSyncAt: "2026-08-30T08:01:00.000Z",
        syncPhase: "idle",
      },
    });

    expect(staleHistoricalError).toBe(false);
  });

  it("uses a user-facing list load error instead of leaking refresh internals", () => {
    expect(getRecordsListErrorMessage(new Error("El refresco remoto devolvio registros, pero el cache local quedo sin registros sincronizados.")))
      .toBe("No pudimos cargar la lista de personas");
  });

  it("keeps inline records sync messaging distinct from the global error count", () => {
    expect(getRecordsInlineSyncSummary({
      conflictCount: 0,
      failedCount: 6,
      pendingCount: 0,
      syncingCount: 0,
    })).toBe("Hay cambios que requieren revision.");

    expect(getRecordsInlineSyncSummary({
      conflictCount: 0,
      failedCount: 6,
      pendingCount: 2,
      syncingCount: 1,
    })).toBe("2 pendientes · 1 sincronizando");
  });
});
