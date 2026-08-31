import { describe, expect, it } from "vitest";

import {
  formatPendingWorkMessage,
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
      message: "1 registro por sincronizar",
      tone: "warning",
      visual: "warning",
    });

    expect(formatPendingWorkMessage(2)).toBe("2 registros por sincronizar");
  });

  it("shows offline as persistent feedback without pending work", () => {
    expect(resolveAppShellPersistentFeedback({
      ...baseInput,
      connectivityStatus: "offline",
    })).toEqual({
      id: "offline",
      message: "Modo sin conexion",
      tone: "info",
      visual: "info",
    });
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
    const offlinePreparing = resolveAppShellPersistentFeedback({
      ...baseInput,
      isOfflinePreparationRunning: true,
      offlineReadiness: "preparing",
    });
    const reconnecting = resolveAppShellPersistentFeedback({
      ...baseInput,
      isOperationalCoreReadinessChecking: true,
    });

    expect(offlinePreparing).toMatchObject({
      id: "offline-preparing",
      message: "Preparando uso sin conexion...",
      visual: "loading",
    });
    expect(reconnecting).toMatchObject({
      id: "reconnecting",
      message: "Reconectando con Opco...",
      visual: "loading",
    });
    expect(shouldShowAppShellFeedbackSpinner(offlinePreparing)).toBe(true);
    expect(shouldShowAppShellFeedbackSpinner(reconnecting)).toBe(true);
  });

  it("does not show offline preparation loading when no prewarm is active", () => {
    expect(resolveAppShellPersistentFeedback({
      ...baseInput,
      isOfflinePreparationRunning: false,
      offlineReadiness: "data-missing",
    })).toBeNull();
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
      accessibilityLabel: "Online",
      state: "online",
    });
  });

  it("resolves the header status indicator for offline connectivity", () => {
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      connectivityStatus: "offline",
    })).toEqual({
      accessibilityLabel: "Sin conexion",
      state: "offline",
    });
  });

  it("resolves active preparation, reconnect, sync, and auth restore as working", () => {
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      isOfflinePreparationRunning: true,
    }).state).toBe("working");
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      isOperationalCoreReadinessChecking: true,
    }).state).toBe("working");
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      isPendingWorkSyncing: true,
    }).state).toBe("working");
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      isAuthSessionRestoring: true,
    }).state).toBe("working");
  });

  it("prioritizes working over offline when an active process is running", () => {
    expect(resolveAppShellStatusIndicator({
      ...baseInput,
      connectivityStatus: "offline",
      isPendingWorkSyncing: true,
    })).toEqual({
      accessibilityLabel: "Sincronizando",
      state: "working",
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
      state: "error",
    });
  });
});
