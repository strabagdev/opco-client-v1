import { describe, expect, it } from "vitest";

import { SyncTelemetry } from "@/lib/sync-telemetry";

import {
  getRecordsCacheBannerMessage,
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

  it("shows the offline cache notice only from current connectivity", () => {
    expect(getRecordsCacheBannerMessage({
      connectivityStatus: "offline",
      fromCache: true,
      isLoading: false,
    })).toBe("Sin conexion. Datos guardados localmente.");
    expect(getRecordsCacheBannerMessage({
      connectivityStatus: "online",
      fromCache: true,
      isLoading: false,
    })).toBe("Datos guardados localmente.");
    expect(getRecordsCacheBannerMessage({
      connectivityStatus: "online",
      fromCache: true,
      isLoading: true,
    })).toBe("Actualizando datos...");
    expect(getRecordsCacheBannerMessage({
      connectivityStatus: "online",
      fromCache: false,
      isLoading: false,
    })).toBeNull();
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

  it("keeps offline cache and pending status primary even when records telemetry has an error", () => {
    const offlineBanner = getRecordsCacheBannerMessage({
      connectivityStatus: "offline",
      fromCache: true,
      isLoading: false,
    });
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

    expect(offlineBanner).toBe("Sin conexion. Datos guardados localmente.");
    expect(syncProblem).toBe(false);
  });

  it("converges after reconnect success without requiring a remount", () => {
    const offlineBanner = getRecordsCacheBannerMessage({
      connectivityStatus: "offline",
      fromCache: true,
      isLoading: false,
    });
    const onlineBanner = getRecordsCacheBannerMessage({
      connectivityStatus: "online",
      fromCache: false,
      isLoading: false,
    });
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

    expect(offlineBanner).toBe("Sin conexion. Datos guardados localmente.");
    expect(onlineBanner).toBeNull();
    expect(staleHistoricalError).toBe(false);
  });
});
