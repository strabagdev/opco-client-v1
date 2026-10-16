import { describe, expect, it } from "vitest";
import { normalizeOfflinePreparationDiagnostics } from "./app-view-prewarm";
import { offlinePreparationFailureRows } from "./offline-preparation-diagnostic";

declare const require: (id: string) => { readFileSync: (path: string, encoding: string) => string };

describe("offline preparation failure detail", () => {
  it("connects the existing PWA detail and synchronization copy to the current preparation context", () => {
    const source = require("fs").readFileSync("app/(app)/_layout.tsx", "utf8");
    expect(source).toContain("diagnostics: offlinePreparationDiagnostics,");
    expect(source).toContain("...offlinePreparationFailureRows(diagnostics)");
    expect(source).toContain("formatSyncStatusDiagnosticsCopy(diagnostics, history, getSQLiteDiagnostics())");
  });
  it("does not reconstruct a historical failure from lastAppView or counters", () => {
    const old = normalizeOfflinePreparationDiagnostics({ status: "failed", appViews: { completed: 11, failed: 1, running: 0, total: 11 } });
    expect(offlinePreparationFailureRows(old).flat().join(" ")).toContain("Detalle no conservado");
    expect(offlinePreparationFailureRows(null).flat().join(" ")).toContain("Sin ejecución registrada");
  });
  it("distinguishes a new run with no failed experiences from legacy missing detail", () => {
    const current = normalizeOfflinePreparationDiagnostics({ status: "completed", failedAppViews: [] });
    expect(offlinePreparationFailureRows(current).flat().join(" ")).toContain("Sin fallos de AppView registrados");
  });
});
