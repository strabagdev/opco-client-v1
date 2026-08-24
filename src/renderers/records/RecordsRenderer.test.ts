import { describe, expect, it } from "vitest";

import { SyncTelemetry } from "@/lib/sync-telemetry";

import { getSyncDiagnosticsRows } from "./sync-diagnostics";

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
