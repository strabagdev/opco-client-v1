import { describe, expect, it } from "vitest";
import { shellStatusPresentation, coreConnectionSince, resolveShellOperationalStatus } from "./shell-status-presentation";
import type { AppShellStatusIndicator, AppShellFeedbackInput } from "./app-shell-feedback";
import type { StateUpdateRequestHistoryEvent } from "./state-update-offline";
const context = { conflicts: 0, hasSyncError: false, hasReadError: false, storageRecovery: false };
const indicator = (state: AppShellStatusIndicator["state"], label: string): AppShellStatusIndicator => ({ state, label, accessibilityLabel: label });
describe("shell status wording preserves the existing resolver's meaning", () => {
  it("does not certify synchronization or coverage merely because no activity is running", () => {
    expect(shellStatusPresentation(indicator("online", "Listo"), context)).toEqual({ label: "Sin operaciones en curso", neutral: true });
  });
  it.each(["Cambios sincronizados", "Guardado en este dispositivo", "Actualizando datos", "Preparando datos", "Sin conexión", "2 cambios pendientes"]) ("keeps the resolver wording %s", label => {
    expect(shellStatusPresentation(indicator("pending", label), context)).toEqual({ label, neutral: false });
  });
  it("names a known conflict without calling it a connection failure", () => {
    expect(shellStatusPresentation(indicator("error", "Revisar"), { ...context, conflicts: 1 }).label).toBe("1 conflicto pendiente");
  });
  it("does not mask a retained read error with a conflict count", () => {
    expect(shellStatusPresentation(indicator("error", "No se pudo actualizar"), { ...context, conflicts: 2, hasReadError: true }).label).toBe("No se pudo actualizar");
  });
  it("distinguishes send failures, combined problems and local recovery", () => {
    expect(shellStatusPresentation(indicator("error", "Revisar"), { ...context, hasSyncError: true }).label).toBe("Error al enviar cambios");
    expect(shellStatusPresentation(indicator("error", "Revisar"), { ...context, hasSyncError: true, conflicts: 2 }).label).toBe("Errores y conflictos pendientes");
    expect(shellStatusPresentation(indicator("error", "Revisar"), { ...context, storageRecovery: true }).label).toBe("Revisar datos locales");
  });
});

const epoch = "2026-11-11T04:00:00.000Z";
const response = (overrides: Partial<StateUpdateRequestHistoryEvent> = {}): StateUpdateRequestHistoryEvent => ({
  abortControllerTriggered: false, fetchResolvedAt: epoch, httpStatus: 200, operationResult: "success", pathTemplate: "/api/v1/ready",
  requestCompletedAt: "2026-11-11T04:00:01.000Z", requestDurationMs: 1000, requestStartedAt: epoch,
  responseBodyStartedAt: epoch, responseParsedAt: "2026-11-11T04:00:01.000Z", responseStarted: true, timeoutMs: 12000,
  interpretation: "success", ...overrides,
});
const baseInput = (overrides: Partial<Parameters<typeof resolveShellOperationalStatus>[0]> = {}): Parameters<typeof resolveShellOperationalStatus>[0] => ({
  connectivityStatus: "online", connectionSince: epoch, requestHistory: [response()], pendingKnown: true,
  hasConflict: false, hasError: false, isAuthSessionRestoring: false, isOfflinePreparationRunning: false,
  isOperationalCoreReadinessChecking: false, isPendingWorkSyncing: false, offlineReadiness: "ready", pendingCount: 0, ...overrides,
});
const feedback = (kind: "local-saved" | "server-confirmed"): AppShellFeedbackInput["writeFeedback"] => ({
  kind, id: "feedback", appViewId: "fixture", appViewTitle: "Fixture", scopeKey: "synthetic-scope", recordedAt: epoch,
});
describe("independent connection and pending-write presentation", () => {
  it("keeps a Core response valid when an ACK advances diagnostic updatedAt", () => {
    const connectionSince = coreConnectionSince({
      currentConnectivity: { status: "online", updatedAt: "2026-11-11T04:00:05.000Z" },
      lastReconnect: { detected: true, detectedAt: epoch, previousConnectivityStatus: "offline", resultingConnectivityStatus: "online" },
    });
    expect(resolveShellOperationalStatus(baseInput({ connectionSince })).connection.label).toBe("Online");
  });
  it("does not claim an epoch from metadata that has not observed reconnection", () => {
    expect(coreConnectionSince({ currentConnectivity: { status: "offline", updatedAt: epoch }, lastReconnect: { detected: true, detectedAt: epoch, previousConnectivityStatus: "online", resultingConnectivityStatus: "offline" } })).toBeNull();
  });
  it("does not inherit Online from the previous document's persisted evidence", () => {
    const connectionSince = coreConnectionSince({ currentConnectivity: { status: "online", updatedAt: epoch }, lastReconnect: { detected: true, detectedAt: epoch, previousConnectivityStatus: "offline", resultingConnectivityStatus: "online" } }, "2026-11-11T04:01:00.000Z");
    expect(resolveShellOperationalStatus(baseInput({ connectionSince })).connection.kind).toBe("unknown");
  });
  it("uses the current view's observed connectivity epoch if persisted reconnect tracking is absent", () => {
    const connectionSince = coreConnectionSince({ currentConnectivity: { status: "online", updatedAt: "2026-11-11T04:00:05.000Z" }, lastReconnect: { detected: false, detectedAt: null, previousConnectivityStatus: null, resultingConnectivityStatus: null } }, epoch);
    expect(resolveShellOperationalStatus(baseInput({ connectionSince })).connection.kind).toBe("online");
    expect(resolveShellOperationalStatus(baseInput({ connectionSince: coreConnectionSince({ currentConnectivity: { status: "online", updatedAt: epoch }, lastReconnect: { detected: false, detectedAt: null, previousConnectivityStatus: null, resultingConnectivityStatus: null } }, "2026-11-11T04:00:02.000Z") })).connection.kind).toBe("unknown");
  });
  it.each([
    [{}, "Online", "Sin pendientes"],
    [{ isPendingWorkSyncing: true, pendingCount: 3 }, "Online", "Sincronizando"],
    [{ pendingCount: 3 }, "Online", "3 pendientes"],
    [{ pendingCount: 1 }, "Online", "1 pendiente"],
    [{ connectivityStatus: "offline", pendingCount: 3 }, "Offline", "3 pendientes"],
    [{ connectivityStatus: "offline" }, "Offline", "Sin pendientes"],
    [{ writeFeedback: feedback("server-confirmed") }, "Online", "Sincronizado"],
  ] as const)("separates the two axes: %j", (overrides, connection, sync) => {
    const model = resolveShellOperationalStatus(baseInput(overrides));
    expect(model.connection.label).toBe(connection); expect(model.sync.label).toBe(sync);
  });
  it("never treats browser online, idle, a toast or completed preparation as a Core check or ACK", () => {
    const m = resolveShellOperationalStatus(baseInput({ requestHistory: [], syncConfirmationVisible: true, offlinePreparationStatus: "completed" }));
    expect(m.connection.kind).toBe("unknown"); expect(m.sync.label).toBe("Sin pendientes");
    expect(JSON.stringify(m)).not.toContain("Sin operaciones en curso");
  });
  it("does not present an old confirmed write as current synchronization while offline", () => {
    expect(resolveShellOperationalStatus(baseInput({ connectivityStatus: "offline", writeFeedback: feedback("server-confirmed") })).sync.label).toBe("Sin pendientes");
  });
  it("does not invent a zero count before local reads succeed", () => {
    expect(resolveShellOperationalStatus(baseInput({ pendingKnown: false })).sync.label).toBe("Pendientes sin comprobar");
  });
  it("does not turn reads or offline preparation into pending-write synchronization", () => {
    const m = resolveShellOperationalStatus(baseInput({ isOfflinePreparationRunning: true }));
    expect(m.sync.kind).toBe("idle"); expect(m.notice).toBe("Preparando uso offline");
  });
  it("keeps a confirmed connection stable during background checks; checks without evidence show Conectando", () => {
    expect(resolveShellOperationalStatus(baseInput({ isOperationalCoreReadinessChecking: true })).connection.label).toBe("Online");
    expect(resolveShellOperationalStatus(baseInput({ isOperationalCoreReadinessChecking: true, requestHistory: [] })).connection.label).toBe("Conectando");
    expect(resolveShellOperationalStatus(baseInput({ isOperationalCoreReadinessChecking: true, connectivityStatus: "offline" })).connection.label).toBe("Offline");
  });
  it("does not use persisted responses or responses started before reconnection as current evidence", () => {
    expect(resolveShellOperationalStatus(baseInput({ connectionSince: "2026-11-11T04:00:02.000Z" })).connection.kind).toBe("unknown");
    expect(resolveShellOperationalStatus(baseInput({ connectionSince: null })).connection.kind).toBe("unknown");
  });
  it("retains a newer request outcome when an older request finishes late", () => {
    const newer = response({ requestStartedAt: "2026-11-11T04:00:02.000Z", requestCompletedAt: "2026-11-11T04:00:03.000Z" });
    const oldFailure = response({ httpStatus: null, operationResult: "network_error", requestCompletedAt: "2026-11-11T04:00:04.000Z" });
    expect(resolveShellOperationalStatus(baseInput({ requestHistory: [newer, oldFailure] })).connection.label).toBe("Online");
  });
  it.each([null, 503])("a transport/readiness failure (%s) is independent of the outbox", httpStatus => {
    const model = resolveShellOperationalStatus(baseInput({ requestHistory: [response({ httpStatus })], pendingCount: 3 }));
    expect(model.connection.label).toBe("Offline"); expect(model.sync.label).toBe("3 pendientes");
  });
  it.each([400, 401, 403, 409, 422])("HTTP %d is a Core response, not a network disconnection", httpStatus => {
    expect(resolveShellOperationalStatus(baseInput({ requestHistory: [response({ httpStatus })] })).connection.label).toBe("Online");
  });
  it("conflicts and send errors do not falsify connectivity", () => {
    const conflict = resolveShellOperationalStatus(baseInput({ hasConflict: true, syncConflictCount: 1 }));
    expect(conflict.connection.label).toBe("Online"); expect(conflict.sync.label).toBe("1 conflicto");
    const error = resolveShellOperationalStatus(baseInput({ hasError: true, pendingCount: 1 }));
    expect(error.connection.label).toBe("Online"); expect(error.sync.label).toBe("Error de sincronización");
  });
  it("projects disconnect, pending work, reconnect, send and ACK without changing the inputs", () => {
    const sequence = [baseInput({ connectivityStatus: "offline", pendingCount: 1, writeFeedback: feedback("local-saved") }),
      baseInput({ requestHistory: [], isOperationalCoreReadinessChecking: true, pendingCount: 1 }),
      baseInput({ isPendingWorkSyncing: true, pendingCount: 1 }), baseInput({ writeFeedback: feedback("server-confirmed") })];
    const original = JSON.stringify(sequence);
    expect(sequence.map(x => resolveShellOperationalStatus(x).sync.kind)).toEqual(["pending", "pending", "syncing", "synced"]);
    expect(JSON.stringify(sequence)).toBe(original);
  });
});
