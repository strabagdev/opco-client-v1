import { describe, expect, it } from "vitest";

import {
  getRecordsDiagnosticsRows,
  getRecordsFailedOperationDiagnosticsSections,
  getRecordsFailedOperationsNotice,
  getSyncDiagnosticsRows,
} from "./sync-diagnostics";

declare const require: (id: string) => { readFileSync: (path: string, encoding: string) => string };

describe("records renderer diagnostics presentation", () => {
  it("keeps inline diagnostics panels out of the experience content", () => {
    const { readFileSync } = require("fs");
    const source = readFileSync("src/renderers/records/RecordsRenderer.tsx", "utf8");

    expect(source).not.toContain("Diagnostico de sincronizacion");
    expect(source).not.toContain("Diagnostico de records");
    expect(source).not.toContain("syncDiagnostics");
    expect(source).not.toContain("recordsDiagnostics");
  });
});

describe("records sync diagnostics", () => {
  it("shows sync timestamps without exposing owner keys or payloads", () => {
    const telemetry = {
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
    } as const;

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

  it("keeps sync error telemetry available for diagnostics", () => {
    const rows = getSyncDiagnosticsRows({
      summary: {
        conflictCount: 0,
        failedCount: 0,
        pendingCount: 1,
        syncingCount: 0,
      },
      telemetry: {
        contractId: "contract_1",
        entityTypeId: "entity_sensitive_abcdef",
        lastFullRefreshCompletedAt: null,
        lastPushCompletedAt: null,
        lastReconcileCompletedAt: null,
        lastSuccessfulSyncAt: null,
        lastSyncAttemptAt: "2026-08-30T08:00:00.000Z",
        lastSyncErrorAt: "2026-08-30T08:00:01.000Z",
        lastSyncErrorCode: "NETWORK",
        lastSyncErrorPhase: "refreshing",
        ownerKey: "org_secret:user_secret",
        syncPhase: "error",
      },
    });

    expect(rows).toContainEqual(["Estado actual", "error"]);
    expect(rows).toContainEqual(["Ultimo error", "NETWORK"]);
    expect(rows).toContainEqual(["Fase del error", "refreshing"]);
  });

  it("formats durable failed RECORDS operations even when telemetry is unavailable", () => {
    const telemetryRows = getSyncDiagnosticsRows({
      summary: {
        conflictCount: 0,
        failedCount: 1,
        pendingCount: 0,
        syncingCount: 0,
      },
      telemetry: null,
    });
    const sections = getRecordsFailedOperationDiagnosticsSections([
      {
        entityTypeId: "entity_personas_sensitive_abcdef",
        lastErrorCode: "VALIDATION_ERROR",
        lastErrorMessage: "El campo requerido falta.",
        localRecordId: "local_record_sensitive_123456",
        operation: "UPDATE",
        retryCount: 1,
        serverRecordId: "server_record_sensitive_654321",
        syncErrorCode: "VALIDATION_ERROR",
        syncErrorMessage: "El campo requerido falta.",
        syncStatus: "failed",
        updatedAt: "2026-09-02T10:20:00.000Z",
      },
    ]);
    const rendered = JSON.stringify(sections);

    expect(telemetryRows).toContainEqual(["Ultimo error", "none"]);
    expect(telemetryRows).toContainEqual(["Errores", "1"]);
    expect(sections[0]?.title).toBe("#1");
    expect(sections[0]?.rows).toContainEqual(["Operacion", "UPDATE"]);
    expect(sections[0]?.rows).toContainEqual(["Codigo", "VALIDATION_ERROR"]);
    expect(sections[0]?.rows).toContainEqual(["Mensaje", "El campo requerido falta."]);
    expect(sections[0]?.rows).toContainEqual(["Entidad", "...abcdef"]);
    expect(sections[0]?.rows).toContainEqual(["Registro", "...654321"]);
    expect(rendered).not.toContain("entity_personas_sensitive_abcdef");
    expect(rendered).not.toContain("server_record_sensitive_654321");
    expect(rendered).not.toContain("local_record_sensitive_123456");
  });

  it("explains retained failed RECORDS separately from pending operations", () => {
    expect(getRecordsFailedOperationsNotice({
      conflictCount: 0,
      failedCount: 1,
      pendingCount: 0,
      syncingCount: 0,
    })).toBe("Los errores quedan retenidos para revision o reintento manual.");

    expect(getRecordsFailedOperationsNotice({
      conflictCount: 0,
      failedCount: 0,
      pendingCount: 0,
      syncingCount: 0,
    })).toBeNull();
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
      outboxConsistency: {
        issueCounts: {
          INCONSISTENT_COMPLETION: 0,
          ORPHANED_LOCAL_INTENT: 1,
          ORPHANED_OUTBOX: 0,
        },
        issues: [{
          code: "ORPHANED_LOCAL_INTENT",
          contract: "fp_contract",
          entity: "fp_entity",
          localRecord: "fp_local",
          operation: "none",
          operationId: null,
          owner: "fp_owner",
          syncStatus: "pending_update",
        }],
        ok: false,
        scope: {
          contract: "fp_contract",
          entity: "fp_entity",
          owner: "fp_owner",
          scope: "fp_scope",
        },
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
    expect(rows).toContainEqual(["outboxConsistency", "ISSUE"]);
    expect(rows).toContainEqual(["orphanedLocalIntent", "1"]);
    expect(rows).toContainEqual(["renderer records", "25"]);
    expect(rows).toContainEqual(["search", "empty"]);
    expect(rendered).not.toContain("org_sensitive:user_brenda");
    expect(rendered).not.toContain("entity_personas_sensitive");
  });
});
