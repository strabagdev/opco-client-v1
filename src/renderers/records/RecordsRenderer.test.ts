import { describe, expect, it } from "vitest";

import { SyncTelemetry } from "@/lib/sync-telemetry";

import { getRecordsDiagnosticsRows, getSyncDiagnosticsRows } from "./sync-diagnostics";

describe("records sync diagnostics", () => {
  it("shows sync timestamps without exposing owner keys or payloads", () => {
    const telemetry: SyncTelemetry = {
      contractId: "contract_1",
      entityTypeId: "entity_sensitive_abcdef",
      lastFullRefreshCompletedAt: "2026-08-24T16:03:00.000Z",
      lastPushCompletedAt: "2026-08-24T16:02:00.000Z",
      lastReconcileCompletedAt: "2026-08-24T16:04:00.000Z",
      lastSuccessfulSyncAt: "2026-08-24T16:04:00.000Z",
      lastSyncAttemptAt: "2026-08-24T16:01:00.000Z",
      lastSyncErrorAt: null,
      lastSyncErrorCode: null,
      lastSyncErrorPhase: null,
      ownerKey: "org_secret:user_secret",
      syncPhase: "idle",
    };

    const rows = getSyncDiagnosticsRows({
      summary: {
        conflictCount: 1,
        failedCount: 2,
        pendingCount: 3,
        syncingCount: 0,
      },
      telemetry,
    });
    const rendered = JSON.stringify(rows);

    expect(rows).toContainEqual(["Ultima sincronizacion exitosa", "2026-08-24T16:04:00.000Z"]);
    expect(rows).toContainEqual(["Entity scope", "...abcdef"]);
    expect(rendered).not.toContain("org_secret:user_secret");
    expect(rendered).not.toContain("entity_sensitive_abcdef");
    expect(rendered).not.toContain("record_");
    expect(rendered).not.toContain("payload");
  });
});

describe("records diagnostics", () => {
  it("shows remote/local/renderer counts without exposing full scopes", () => {
    const rows = getRecordsDiagnosticsRows({
      appViewId: "view_personas_sensitive",
      connectivityStatus: "online",
      contractId: "contract_andes_sensitive",
      entityTypeId: "entity_personas_sensitive",
      error: null,
      isLoading: false,
      local: {
        conflict: 0,
        failed: 0,
        pendingCreate: 0,
        pendingUpdate: 0,
        synced: 388,
        total: 388,
      },
      ownerKey: "org_sensitive:user_brenda",
      page: 1,
      refresh: {
        afterReconcile: {
          conflict: 0,
          failed: 0,
          pendingCreate: 0,
          pendingUpdate: 0,
          synced: 388,
          total: 388,
        },
        beforeRefresh: {
          conflict: 0,
          failed: 0,
          pendingCreate: 0,
          pendingUpdate: 0,
          synced: 0,
          total: 0,
        },
        lastHttpStatus: 200,
        pages: [
          { count: 100, page: 1, pageSize: 100 },
          { count: 100, page: 2, pageSize: 100 },
          { count: 100, page: 3, pageSize: 100 },
          { count: 88, page: 4, pageSize: 100 },
        ],
        recordsFetched: 388,
        remoteTotal: 388,
        totalPages: 4,
      },
      rendererRecords: 25,
      search: "",
      sessionStatus: "authenticated",
    }, null);
    const rendered = JSON.stringify(rows);

    expect(rows).toContainEqual(["remoteTotal", "388"]);
    expect(rows).toContainEqual(["pagesFetched", "1:100, 2:100, 3:100, 4:88"]);
    expect(rows).toContainEqual(["local total", "388"]);
    expect(rows).toContainEqual(["renderer records", "25"]);
    expect(rows).toContainEqual(["search", "empty"]);
    expect(rendered).not.toContain("org_sensitive:user_brenda");
    expect(rendered).not.toContain("entity_personas_sensitive");
  });
});
