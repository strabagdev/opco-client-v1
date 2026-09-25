import { describe, expect, it } from "vitest";

import {
  classifyAppShellVisibleErrorEvent,
  formatPendingWorkMessage,
  formatSyncConflictNotice,
  resolveAppShellPersistentFeedback,
  resolveAppShellSuccessToast,
  resolveAppShellStatusIndicator,
  shouldRenderAppShellFeedbackBand,
  shouldShowAppShellFeedbackSpinner,
  type AppShellFeedbackInput,
} from "./app-shell-feedback";

const baseInput: AppShellFeedbackInput = {
  connectivityStatus: "online",
  hasConflict: false,
  hasError: false,
  isAuthSessionRestoring: false,
  isOfflinePreparationRunning: false,
  isOperationalCoreReadinessChecking: false,
  isPendingWorkSyncing: false,
  localStorageRecoveryNotice: null,
  offlineReadiness: "ready",
  pendingCount: 0,
};

function resolvePreviousStatusIndicator(input: AppShellFeedbackInput) {
  if (input.localStorageRecoveryNotice || input.hasError || input.hasConflict) {
    return "error";
  }

  if (
    input.isAuthSessionRestoring ||
    input.isOfflinePreparationRunning ||
    input.isOperationalCoreReadinessChecking ||
    input.isPendingWorkSyncing
  ) {
    return "working";
  }

  return input.connectivityStatus === "online" ? "online" : "offline";
}

describe("app shell feedback", () => {
  it("occupies no global feedback space when there is no real message", () => {
    const feedback = resolveAppShellPersistentFeedback(baseInput);

    expect(feedback).toBeNull();
    expect(shouldRenderAppShellFeedbackBand(feedback)).toBe(false);
    expect(shouldShowAppShellFeedbackSpinner(feedback)).toBe(false);
  });

  it("prioritizes errors over success/info conditions", () => {
    expect(resolveAppShellPersistentFeedback({
      ...baseInput,
      hasError: true,
      isPendingWorkSyncing: true,
      pendingCount: 1,
    })).toEqual({
      id: "sync-error",
      message: "Un cambio no pudo sincronizarse.",
      tone: "error",
      visual: "error",
    });
  });

  it("shows durable pending work as persistent feedback", () => {
    expect(resolveAppShellPersistentFeedback({
      ...baseInput,
      pendingCount: 1,
    })).toEqual({
      id: "pending-work",
      message: "Cambios guardados. Se sincronizaran al recuperar conexion.",
      tone: "info",
      visual: "info",
    });

    expect(formatPendingWorkMessage(2)).toBe("Cambios guardados. Se sincronizaran al recuperar conexion.");
  });

  it("shows offline as persistent feedback without pending work", () => {
    expect(resolveAppShellPersistentFeedback({
      ...baseInput,
      connectivityStatus: "offline",
    })).toEqual({
      id: "offline",
      message: "Trabajando sin conexion",
      tone: "info",
      visual: "info",
    });
  });

  it("shows read connectivity issues without treating them as durable sync errors", () => {
    expect(resolveAppShellPersistentFeedback({
      ...baseInput,
      hasReadConnectivityIssue: true,
    })).toEqual({
      id: "read-connectivity-issue",
      message: "Conexion inestable. Mostrando datos guardados.",
      tone: "info",
      visual: "info",
    });
  });

  it("prioritizes durable sync errors over transient read connectivity issues", () => {
    expect(resolveAppShellPersistentFeedback({
      ...baseInput,
      hasError: true,
      hasReadConnectivityIssue: true,
      syncErrorCount: 2,
    })).toEqual({
      id: "sync-error",
      message: "2 cambios no pudieron sincronizarse.",
      tone: "error",
      visual: "error",
    });
  });

  it("formats conflicts as changes requiring review", () => {
    expect(resolveAppShellPersistentFeedback({
      ...baseInput,
      hasConflict: true,
      syncConflictCount: 1,
    })).toMatchObject({
      id: "sync-conflict",
      message: "1 cambio requiere revision.",
    });
    expect(formatSyncConflictNotice(3)).toBe("3 cambios requieren revision.");
  });

  it("classifies unresolved visible errors by operation and method", () => {
    expect(classifyAppShellVisibleErrorEvent({
      operation: "load-day",
      resolution: "unresolved",
    })).toBe("read");
    expect(classifyAppShellVisibleErrorEvent({
      method: "GET",
      operation: "save",
      resolution: "unresolved",
    })).toBe("read");
    expect(classifyAppShellVisibleErrorEvent({
      method: "POST",
      operation: "save",
      resolution: "unresolved",
    })).toBe("write");
    expect(classifyAppShellVisibleErrorEvent({
      operation: "sync",
      resolution: "unresolved",
    })).toBe("sync");
    expect(classifyAppShellVisibleErrorEvent({
      operation: "load-day",
      resolution: "cleared_after_success",
    })).toBeNull();
  });

  it("shows real sync and auth phases as persistent feedback", () => {
    const syncFeedback = resolveAppShellPersistentFeedback({
      ...baseInput,
      isPendingWorkSyncing: true,
      pendingCount: 1,
    });
    const authFeedback = resolveAppShellPersistentFeedback({
      ...baseInput,
      isAuthSessionRestoring: true,
    });

    expect(syncFeedback?.message).toBe("Sincronizando con Opco...");
    expect(syncFeedback?.visual).toBe("loading");
    expect(shouldShowAppShellFeedbackSpinner(syncFeedback)).toBe(true);
    expect(authFeedback?.message).toBe("Restableciendo sesion con Opco...");
    expect(authFeedback?.visual).toBe("loading");
    expect(shouldShowAppShellFeedbackSpinner(authFeedback)).toBe(true);
  });

  it("uses loading feedback only for active process messages", () => {
    const reconnecting = resolveAppShellPersistentFeedback({
      ...baseInput,
      isOperationalCoreReadinessChecking: true,
    });

    expect(reconnecting).toMatchObject({
      id: "reconnecting",
      message: "Reconectando con Opco...",
      visual: "loading",
    });
    expect(shouldShowAppShellFeedbackSpinner(reconnecting)).toBe(true);
  });

  it("does not show offline preparation loading when no prewarm is active", () => {
    expect(resolveAppShellPersistentFeedback({
      ...baseInput,
      isOfflinePreparationRunning: false,
      offlineReadiness: "data-missing",
    })).toBeNull();
  });

  it("does not duplicate offline preparation state in the global feedback band", () => {
    const running = resolveAppShellPersistentFeedback({
      ...baseInput,
      isOfflinePreparationRunning: true,
      offlinePreparationStatus: "running",
      offlineReadiness: "preparing",
    });
    const interrupted = resolveAppShellPersistentFeedback({
      ...baseInput,
      isOfflinePreparationRunning: false,
      offlinePreparationStatus: "running",
      offlineReadiness: "preparing",
    });
    const failed = resolveAppShellPersistentFeedback({
      ...baseInput,
      isOfflinePreparationRunning: false,
      offlinePreparationStatus: "failed",
      offlineReadiness: "data-missing",
    });
    const completed = resolveAppShellPersistentFeedback({
      ...baseInput,
      isOfflinePreparationRunning: false,
      offlinePreparationStatus: "completed",
      offlineReadiness: "ready",
    });

    expect(running).toBeNull();
    expect(interrupted).toBeNull();
    expect(failed).toBeNull();
    expect(completed).toBeNull();
    expect(shouldShowAppShellFeedbackSpinner(interrupted)).toBe(false);
    expect(shouldShowAppShellFeedbackSpinner(failed)).toBe(false);
  });

  it("does not show a spinner for success, warning, error, or static info feedback", () => {
    expect(shouldShowAppShellFeedbackSpinner({
      id: "success",
      message: "Success",
      tone: "success",
      visual: "success",
    })).toBe(false);
    expect(shouldShowAppShellFeedbackSpinner({
      id: "warning",
      message: "Warning",
      tone: "warning",
      visual: "warning",
    })).toBe(false);
    expect(shouldShowAppShellFeedbackSpinner({
      id: "error",
      message: "Error",
      tone: "error",
      visual: "error",
    })).toBe(false);
    expect(shouldShowAppShellFeedbackSpinner({
      id: "info",
      message: "Info",
      tone: "info",
      visual: "info",
    })).toBe(false);
  });

  it("creates transient success feedback only for completed sync work", () => {
    expect(resolveAppShellSuccessToast({
      operationsCompleted: 1,
      result: "success",
    })).toEqual({
      id: "sync-success",
      message: "Sincronizacion completada.",
      tone: "success",
      visual: "success",
    });
    expect(shouldShowAppShellFeedbackSpinner(resolveAppShellSuccessToast({
      operationsCompleted: 1,
      result: "success",
    }))).toBe(false);

    expect(resolveAppShellSuccessToast({
      operationsCompleted: 0,
      result: "success",
    })).toBeNull();
  });

  it("resolves the header status indicator for online idle state", () => {
    expect(resolveAppShellStatusIndicator(baseInput)).toEqual({
      accessibilityLabel: "Listo",
      label: "Listo",
      state: "online",
    });
  });

  it("resolves the header status indicator for offline connectivity", () => {
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      connectivityStatus: "offline",
    })).toEqual({
      accessibilityLabel: "Sin conexion",
      label: "Sin conexión",
      state: "offline",
    });
  });

  it("shows active offline preparation in the header and stops animating after failure", () => {
    const observedCandidate = {
      ...baseInput,
      isOfflinePreparationRunning: true,
    };

    expect(resolvePreviousStatusIndicator(observedCandidate)).toBe("working");
    expect(resolveAppShellStatusIndicator(observedCandidate)).toMatchObject({
      label: "Preparando uso offline…",
      state: "working",
    });
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      offlinePreparationStatus: "failed",
    })).toMatchObject({
      label: "Preparación offline incompleta",
      state: "pending",
    });
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      offlinePreparationStatus: "completed",
    })).toMatchObject({ label: "Listo", state: "online" });
  });

  it("keeps send errors above offline preparation while diagnostics retain both", () => {
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      hasError: true,
      offlinePreparationStatus: "failed",
    })).toMatchObject({ label: "Requiere atención", state: "error" });
  });

  it("returns to an offline warning after a scoped save confirmation expires", () => {
    const writeFeedback = {
      appViewId: "view-people",
      appViewTitle: "Personas",
      id: "write-feedback-1",
      kind: "local-saved" as const,
      recordedAt: "2026-09-22T10:00:00.000Z",
      scopeKey: "safe-scope",
    };

    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      offlinePreparationStatus: "failed",
      writeFeedback,
    }).label).toBe("Guardado localmente");
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      offlinePreparationStatus: "failed",
      writeFeedback: null,
    }).label).toBe("Preparación offline incompleta");
  });

  it("identifies each real active operation and stops animating when it finishes", () => {
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      isOperationalCoreReadinessChecking: true,
    })).toEqual({
      accessibilityLabel: "Comprobando disponibilidad de Opco",
      label: "Comprobando disponibilidad",
      state: "working",
    });
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      isPendingWorkSyncing: true,
    })).toEqual({
      accessibilityLabel: "Sincronizando cambios pendientes",
      label: "Sincronizando cambios…",
      state: "working",
    });
    expect(resolvePreviousStatusIndicator({
      ...baseInput,
      isPendingWorkSyncing: true,
    })).toBe("working");
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      isAuthSessionRestoring: true,
    })).toEqual({
      accessibilityLabel: "Restableciendo sesion con Opco",
      label: "Restaurando sesión",
      state: "working",
    });
    expect(resolveAppShellStatusIndicator(baseInput).state).toBe("online");
  });

  it("does not animate for periodic reads, retained errors, or durable pending work", () => {
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      hasReadConnectivityIssue: true,
    }).state).toBe("online");
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      pendingCount: 2,
    })).toEqual({
      accessibilityLabel: "2 cambios pendientes",
      label: "2 cambios pendientes",
      state: "pending",
    });
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      hasError: true,
    }).state).toBe("error");
    expect(resolvePreviousStatusIndicator({
      ...baseInput,
      hasError: true,
      isOfflinePreparationRunning: true,
    })).toBe("error");
  });

  it("keeps offline visible when a previously active process is reported", () => {
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      connectivityStatus: "offline",
      isPendingWorkSyncing: true,
    })).toEqual({
      accessibilityLabel: "Sin conexion",
      label: "Sin conexión",
      state: "offline",
    });
  });

  it("prioritizes active errors over every other indicator state", () => {
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      connectivityStatus: "offline",
      hasError: true,
      isPendingWorkSyncing: true,
    })).toEqual({
      accessibilityLabel: "Problema de conexion o sincronizacion",
      label: "Requiere atención",
      state: "error",
    });
  });

  it.each([
    ["sync conflict", { hasConflict: true }, "Requiere atención"],
    ["local recovery", { localStorageRecoveryNotice: "Recuperación necesaria" }, "Requiere atención"],
    ["one pending change", { pendingCount: 1 }, "1 cambio pendiente"],
  ])("maps %s to the visible label without changing indicator priority", (_case, input, label) => {
    expect(resolveAppShellStatusIndicator({ ...baseInput, ...input }).label).toBe(label);
  });

  it("shows visible experience refreshes, combines pending work, and returns idle after success", () => {
    const activeExperience = {
      activeRuns: [{ id: "experience-run-1", startedAt: "2026-09-18T00:00:00.000Z" }],
      appViewId: "view-protocols",
      appViewTitle: "Protocolos",
      appViewType: "RECORDS" as const,
      errorCode: null,
      result: "running" as const,
      scopeKey: "safe-scope",
      updatedAt: "2026-09-18T00:00:00.000Z",
    };

    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      experienceActivity: activeExperience,
    })).toMatchObject({ label: "Actualizando Protocolos…", state: "working" });
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      experienceActivity: activeExperience,
      pendingCount: 2,
    })).toMatchObject({ label: "Actualizando Protocolos… · 2 cambios pendientes", state: "working" });
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      experienceActivity: { ...activeExperience, activeRuns: [], result: "success" },
    })).toMatchObject({ label: "Listo", state: "online" });
  });

  it("keeps offline and retained experience failures above read activity", () => {
    const failedExperience = {
      activeRuns: [],
      appViewId: "view-panel",
      appViewTitle: "Resumen",
      appViewType: "PANEL" as const,
      errorCode: "PANEL_PARTIAL_LOAD_FAILED",
      result: "partial" as const,
      scopeKey: "safe-scope",
      updatedAt: "2026-09-18T00:00:00.000Z",
    };
    expect(resolveAppShellStatusIndicator({ ...baseInput, experienceActivity: failedExperience })).toMatchObject({
      label: "Requiere atención",
      state: "error",
    });
    expect(resolveAppShellStatusIndicator({ ...baseInput, connectivityStatus: "offline", pendingCount: 2 })).toMatchObject({
      label: "Sin conexión · 2 cambios pendientes",
      state: "offline",
    });
  });

  it("keeps a confirmed local save visible over a concurrent read and includes pending work", () => {
    const writeFeedback = {
      appViewId: "view-people",
      appViewTitle: "Personas",
      id: "write-feedback-1",
      kind: "local-saved" as const,
      recordedAt: "2026-09-18T10:00:00.000Z",
      scopeKey: "safe-scope",
    };
    const experienceActivity = {
      activeRuns: [{ id: "experience-run-1", startedAt: "2026-09-18T10:00:01.000Z" }],
      appViewId: "view-people",
      appViewTitle: "Personas",
      appViewType: "RECORDS" as const,
      errorCode: null,
      result: "running" as const,
      scopeKey: "safe-scope",
      updatedAt: "2026-09-18T10:00:01.000Z",
    };

    expect(resolveAppShellStatusIndicator({ ...baseInput, experienceActivity, pendingCount: 2, writeFeedback })).toMatchObject({
      label: "Guardado localmente · 2 cambios pendientes",
      state: "pending",
    });
  });

  it("distinguishes local save, active send, server confirmation, and failed sync", () => {
    const writeFeedback = {
      appViewId: "view-people",
      appViewTitle: "Personas",
      id: "write-feedback-1",
      kind: "local-saved" as const,
      recordedAt: "2026-09-18T10:00:00.000Z",
      scopeKey: "safe-scope",
    };
    expect(resolveAppShellStatusIndicator({ ...baseInput, isPendingWorkSyncing: true, pendingCount: 1, writeFeedback }).label)
      .toBe("Guardado localmente · Sincronizando cambios… · 1 cambio pendiente");
    expect(resolveAppShellStatusIndicator({ ...baseInput, syncConfirmationVisible: true })).toMatchObject({
      label: "Sincronización confirmada",
      state: "online",
    });
    expect(resolveAppShellStatusIndicator({ ...baseInput, hasError: true, syncConfirmationVisible: true, writeFeedback }).label)
      .toBe("Requiere atención");
    expect(resolveAppShellStatusIndicator({ ...baseInput, hasConflict: true, writeFeedback }).label)
      .toBe("Requiere atención");
  });
});
