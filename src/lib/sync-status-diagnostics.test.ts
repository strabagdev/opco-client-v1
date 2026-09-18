import { describe, expect, it } from "vitest";

import { buildSyncStatusDiagnostics, fingerprintSyncDiagnosticScope, formatActiveDuration, formatSyncStatusDiagnosticsCopy, updateSyncStatusHistory, type SyncStatusDiagnosticsInput } from "./sync-status-diagnostics";

const baseInput: SyncStatusDiagnosticsInput = {
  connectivity: { checkedAt: "2026-09-17T12:00:00.000Z", status: "online" },
  conflicts: 0,
  errors: 0,
  indicator: { accessibilityLabel: "Online", label: "Al día", state: "online" },
  offlinePreparation: { activeInCurrentRuntime: false, completedAt: null, startedAt: null, status: null },
  pendingCount: 0,
  readiness: { active: false, checkedAt: null, failed: false, reason: null, runId: null, startedAt: null },
  readIssue: false,
  session: { restoring: false, status: "authenticated" },
  sync: { active: false, completedAt: null, lastSuccessAt: null, result: null, runId: null, startedAt: null },
};

describe("sync status diagnostics", () => {
  it("describes online idle and unknown timestamps without assuming a completed sync", () => {
    const result = buildSyncStatusDiagnostics(baseInput);
    expect(result.reason).toContain("Online");
    expect(result.lastSuccessfulSyncAt).toBeNull();
    expect(result.checklist.find((item) => item.id === "readiness")?.state).toBe("Sin comprobar");
    expect(formatSyncStatusDiagnosticsCopy(result, { events: [], scopeKey: "scope" })).toContain("Última sincronización exitosa: Sin información");
  });

  it.each([
    ["offline", { ...baseInput, connectivity: { checkedAt: null, status: "offline" as const }, indicator: { accessibilityLabel: "Sin conexión", label: "Sin conexión" as const, state: "offline" as const } }],
    ["session restore", { ...baseInput, session: { restoring: true, status: "loading" as const }, indicator: { accessibilityLabel: "Restaurando", label: "Restaurando sesión" as const, state: "working" as const } }],
    ["readiness", { ...baseInput, readiness: { active: true, checkedAt: null, failed: false, reason: null, runId: "run_ready", startedAt: "2026-09-17T12:01:00.000Z" }, indicator: { accessibilityLabel: "Readiness", label: "Comprobando disponibilidad" as const, state: "working" as const } }],
    ["sync", { ...baseInput, pendingCount: 1, sync: { active: true, completedAt: null, lastSuccessAt: null, result: null, runId: "run_sync", startedAt: "2026-09-17T12:02:00.000Z" }, indicator: { accessibilityLabel: "Sync", label: "Sincronizando" as const, state: "working" as const } }],
  ])("represents %s from real source values", (_label, input) => {
    const result = buildSyncStatusDiagnostics(input);
    expect(result.indicator).toBe(input.indicator);
    expect(result.reason).not.toBe("");
  });

  it("distinguishes readiness failure, noop, pending work, retained problems, and concurrent activity", () => {
    const result = buildSyncStatusDiagnostics({
      ...baseInput,
      conflicts: 1,
      errors: 2,
      pendingCount: 3,
      offlinePreparation: { activeInCurrentRuntime: true, completedAt: null, startedAt: "2026-09-17T12:00:00.000Z", status: "running" },
      readiness: { active: false, checkedAt: "2026-09-17T12:01:00.000Z", failed: true, reason: "ready_failed", runId: "run_ready", startedAt: null },
      session: { restoring: true, status: "authenticated" },
      sync: { active: true, completedAt: "2026-09-17T11:00:00.000Z", lastSuccessAt: null, result: "noop", runId: "run_sync", startedAt: "2026-09-17T12:02:00.000Z" },
      indicator: { accessibilityLabel: "Problema", label: "Requiere atención", state: "error" },
    });
    expect(result.activities).toEqual(["Restauración de sesión", "Envío de cambios", "Preparación offline"]);
    expect(result.checklist.find((item) => item.id === "readiness")?.state).toBe("Error");
    expect(result.checklist.find((item) => item.id === "problems")?.count).toBe(3);
    expect(result.checklist.find((item) => item.id === "send")?.state).toBe("En curso");
  });

  it("treats a terminal noop as no applicable transfer, not complete synchronization", () => {
    const result = buildSyncStatusDiagnostics({
      ...baseInput,
      sync: { active: false, completedAt: "2026-09-17T12:05:00.000Z", lastSuccessAt: null, result: "noop", runId: "run_noop", startedAt: "2026-09-17T12:04:59.000Z" },
    });
    expect(result.checklist.find((item) => item.id === "send")?.state).toBe("No aplica");
    expect(result.checklist.find((item) => item.id === "receive")?.state).toBe("No aplica");
    expect(result.lastSuccessfulSyncAt).toBeNull();
  });

  it("marks persisted offline preparation as pending rather than active", () => {
    const result = buildSyncStatusDiagnostics({
      ...baseInput,
      offlinePreparation: { activeInCurrentRuntime: false, completedAt: null, startedAt: "2026-09-16T12:00:00.000Z", status: "running" },
    });
    expect(result.activities).toEqual([]);
    expect(result.checklist.find((item) => item.id === "offline-preparation")).toMatchObject({
      activeSince: null,
      state: "Pendiente",
    });
  });

  it("records transitions once, caps history, isolates scopes, and sanitizes copied reasons", () => {
    const diagnostics = buildSyncStatusDiagnostics(baseInput);
    const first = updateSyncStatusHistory({ at: "2026-09-17T12:00:00.000Z", current: { events: [], scopeKey: null }, next: diagnostics, scopeKey: "user-a:contract-a" });
    const duplicate = updateSyncStatusHistory({ at: "2026-09-17T12:00:01.000Z", current: first, next: diagnostics, scopeKey: "user-a:contract-a" });
    expect(duplicate.events).toHaveLength(first.events.length);

    let history = duplicate;
    for (let index = 0; index < 60; index += 1) {
      history = updateSyncStatusHistory({
        at: `2026-09-17T12:${String(index).padStart(2, "0")}:00.000Z`,
        current: history,
        next: buildSyncStatusDiagnostics({ ...baseInput, pendingCount: index % 2, indicator: { accessibilityLabel: "state", label: index % 2 ? "Cambios pendientes" : "Al día", state: index % 2 ? "pending" : "online" } }),
        runIds: { Indicador: "run-safe" },
        scopeKey: "user-a:contract-a",
      });
    }
    expect(history.events).toHaveLength(50);

    const isolated = updateSyncStatusHistory({ at: "2026-09-17T13:00:00.000Z", current: history, next: diagnostics, scopeKey: "user-b:contract-b" });
    expect(isolated.events.every((event) => event.at === "2026-09-17T13:00:00.000Z")).toBe(true);
    const copied = formatSyncStatusDiagnosticsCopy(diagnostics, isolated);
    expect(copied).toContain("Estado actual: Correcto");
    expect(copied).toContain("Indicador");
    expect(copied).not.toMatch(/token|payload|field value/i);
    expect(fingerprintSyncDiagnosticScope("owner-sensitive", "contract-sensitive")).toMatch(/^sync_scope_[0-9a-f]{8}$/);
    expect(fingerprintSyncDiagnosticScope("owner-sensitive", "contract-sensitive")).not.toContain("sensitive");
    expect(formatActiveDuration("2026-09-17T12:00:00.000Z", Date.parse("2026-09-17T12:00:42.000Z"))).toBe("42s");
    expect(updateSyncStatusHistory({ at: "2026-09-17T13:01:00.000Z", current: isolated, next: diagnostics, scopeKey: null })).toEqual({ events: [], scopeKey: null });
  });
});
