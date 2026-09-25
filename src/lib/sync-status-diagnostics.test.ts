import { describe, expect, it } from "vitest";

import { buildSyncStatusDiagnostics, fingerprintSyncDiagnosticScope, formatActiveDuration, formatSyncStatusDiagnosticsCopy, updateSyncStatusHistory, type SyncStatusDiagnosticsInput } from "./sync-status-diagnostics";

const baseInput: SyncStatusDiagnosticsInput = {
  connectivity: { checkedAt: "2026-09-17T12:00:00.000Z", status: "online" },
  conflicts: 0,
  errors: 0,
  experience: {
    activeRuns: [],
    appViewId: null,
    appViewTitle: null,
    appViewType: null,
    errorCode: null,
    result: "idle",
    scopeKey: null,
    updatedAt: null,
  },
  indicator: { accessibilityLabel: "Listo", label: "Listo", state: "online" },
  offlinePreparation: { activeInCurrentRuntime: false, completedAt: null, startedAt: null, status: null },
  pendingCount: 0,
  readiness: { active: false, checkedAt: null, failed: false, reason: null, runId: null, startedAt: null },
  readIssue: false,
  session: { restoring: false, status: "authenticated" },
  sync: { active: false, completedAt: null, lastSuccessAt: null, result: null, runId: null, startedAt: null },
  writeFeedback: null,
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

  it("distinguishes completed and failed offline preparation without runtime activity", () => {
    const completed = buildSyncStatusDiagnostics({
      ...baseInput,
      offlinePreparation: { activeInCurrentRuntime: false, completedAt: "2026-09-19T10:00:00.000Z", startedAt: "2026-09-19T09:59:00.000Z", status: "completed" },
    });
    const failed = buildSyncStatusDiagnostics({
      ...baseInput,
      offlinePreparation: { activeInCurrentRuntime: false, completedAt: "2026-09-19T10:00:00.000Z", startedAt: "2026-09-19T09:59:00.000Z", status: "failed" },
    });

    expect(completed.checklist.find((item) => item.id === "offline-preparation")?.state).toBe("Correcto");
    expect(failed.checklist.find((item) => item.id === "offline-preparation")?.state).toBe("Error");
    expect(completed.activities).not.toContain("Preparación offline");
    expect(failed.activities).not.toContain("Preparación offline");
    expect(failed.reason).toContain("preparación offline quedó incompleta");
  });

  it("keeps send failure priority while retaining offline preparation detail", () => {
    const result = buildSyncStatusDiagnostics({
      ...baseInput,
      errors: 1,
      indicator: { accessibilityLabel: "Requiere atención", label: "Requiere atención", state: "error" },
      offlinePreparation: {
        activeInCurrentRuntime: false,
        completedAt: "2026-09-22T10:00:10.000Z",
        startedAt: "2026-09-22T10:00:00.000Z",
        status: "failed",
      },
    });

    expect(result.indicator.state).toBe("error");
    expect(result.checklist.find((item) => item.id === "problems")?.state).toBe("Error");
    expect(result.checklist.find((item) => item.id === "offline-preparation")?.state).toBe("Error");
  });

  it("keeps header reason, experience checklist, and copied diagnostics coherent", () => {
    const experience = {
      activeRuns: [
        { id: "experience-run-1", startedAt: "2026-09-18T00:00:00.000Z" },
        { id: "experience-run-2", startedAt: "2026-09-18T00:00:01.000Z" },
      ],
      appViewId: "view-panel",
      appViewTitle: "Panel operativo",
      appViewType: "PANEL" as const,
      errorCode: null,
      result: "running" as const,
      scopeKey: "safe-scope",
      updatedAt: "2026-09-18T00:00:01.000Z",
    };
    const indicator = { accessibilityLabel: "Actualizando Panel operativo", label: "Actualizando Panel operativo…", state: "working" as const };
    const diagnostics = buildSyncStatusDiagnostics({ ...baseInput, experience, indicator });
    const copied = formatSyncStatusDiagnosticsCopy(diagnostics, { events: [], scopeKey: "safe-scope" });

    expect(diagnostics.reason).toContain("Panel operativo");
    expect(diagnostics.checklist.find((item) => item.id === "experience")).toMatchObject({ count: 2, state: "En curso" });
    expect(copied).toContain("Experiencia visible: En curso");
    expect(copied).toContain("experience-run-1");
    expect(copied).not.toMatch(/token|payload|field value/i);
  });

  it("copies the live SQLite operation and waiters without SQL or values", () => {
    const diagnostics = buildSyncStatusDiagnostics(baseInput);
    const copied = formatSyncStatusDiagnosticsCopy(diagnostics, { events: [], scopeKey: "safe-scope" }, {
      active: {
        completedAt: null,
        durationMs: 56_000,
        enqueuedAt: "2026-09-19T12:00:00.000Z",
        id: "sqlite-7",
        name: "transaction:attendance-snapshot",
        startedAt: "2026-09-19T12:00:00.001Z",
        status: "running",
      },
      hasDatabasePromise: true,
      hasMigrationPromise: false,
      recent: [],
      storageStatus: "ready",
      waiting: Array.from({ length: 10 }, (_, index) => ({
        completedAt: null,
        durationMs: 55_999,
        enqueuedAt: "2026-09-19T12:00:00.002Z",
        id: `sqlite-${index + 8}`,
        name: "read:app_metadata" as const,
        startedAt: null,
        status: "waiting" as const,
      })),
      waitingByName: {
        "read:app_metadata": 1747,
        "read:pending_operations": 2,
        "write:app_metadata": 859,
        "write:sync_telemetry": 4,
      },
      waitingOmitted: 2602,
      waitingTotal: 2612,
    });

    expect(copied).toContain("Activa: sqlite-7; nombre=transaction:attendance-snapshot");
    expect(copied).toContain("nombre=read:app_metadata");
    expect(copied).toContain("duración=56000ms");
    expect(copied).toContain("En espera (2612): read:app_metadata=1747");
    expect(copied).toContain("write:app_metadata=859");
    expect(copied).toContain("Muestra pendientes (10; omitidas=2602)");
    expect(copied.match(/nombre=read:app_metadata/g)).toHaveLength(10);
    expect(copied).not.toMatch(/SELECT|INSERT|payload|token/i);
  });

  it("includes the scoped write result without calling a local save a completed sync", () => {
    const diagnostics = buildSyncStatusDiagnostics({
      ...baseInput,
      indicator: { accessibilityLabel: "Guardado localmente", label: "Guardado localmente · 1 cambio pendiente", state: "pending" },
      pendingCount: 1,
      writeFeedback: {
        appViewId: "view-people",
        appViewTitle: "Personas",
        id: "write-feedback-1",
        kind: "local-saved",
        recordedAt: "2026-09-18T10:00:00.000Z",
        scopeKey: "safe-scope",
      },
    });
    const writeResult = diagnostics.checklist.find((item) => item.id === "write-result");
    expect(writeResult).toMatchObject({ state: "Pendiente" });
    expect(writeResult?.detail).toContain("no implica sincronización");
    expect(formatSyncStatusDiagnosticsCopy(diagnostics, { events: [], scopeKey: "scope" })).toContain("Resultado de escritura: Pendiente");
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
        next: buildSyncStatusDiagnostics({ ...baseInput, pendingCount: index % 2, indicator: { accessibilityLabel: "state", label: index % 2 ? "Cambios pendientes" : "Listo", state: index % 2 ? "pending" : "online" } }),
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
