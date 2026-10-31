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

// Same rows feed the existing screen and the copied diagnostic.
it("exposes terminal persistence failure and recovery correlation without arbitrary payloads", () => {
  const value = normalizeOfflinePreparationDiagnostics({ status: "completed", diagnosticWrite: "failed", recoveryOf: "prewarm-100-1", runErrorCode: "RECOVERY_FAILED", failedAppViews: [] });
  const text = offlinePreparationFailureRows(value).flat().join(" ");
  expect(text).toContain("No se pudo guardar"); expect(text).toContain("prewarm-100-1"); expect(text).toContain("RECOVERY_FAILED");
  const unknown = normalizeOfflinePreparationDiagnostics({ status: "failed", runErrorCode: "secret-token" as never });
  expect(offlinePreparationFailureRows(unknown).flat().join(" ")).not.toContain("secret-token");
});
