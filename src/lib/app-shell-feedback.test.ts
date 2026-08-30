import { describe, expect, it } from "vitest";

import {
  formatPendingWorkMessage,
  resolveAppShellPersistentFeedback,
  resolveAppShellSuccessToast,
  type AppShellFeedbackInput,
} from "./app-shell-feedback";

const baseInput: AppShellFeedbackInput = {
  connectivityStatus: "online",
  hasConflict: false,
  hasError: false,
  isAuthSessionRestoring: false,
  isOperationalCoreReadinessChecking: false,
  isPendingWorkSyncing: false,
  localStorageRecoveryNotice: null,
  offlineReadiness: "ready",
  pendingCount: 0,
};

describe("app shell feedback", () => {
  it("occupies no global feedback space when there is no real message", () => {
    expect(resolveAppShellPersistentFeedback(baseInput)).toBeNull();
  });

  it("prioritizes errors over success/info conditions", () => {
    expect(resolveAppShellPersistentFeedback({
      ...baseInput,
      hasError: true,
      isPendingWorkSyncing: true,
      pendingCount: 1,
    })).toEqual({
      id: "sync-error",
      message: "Hay un error pendiente de revisar.",
      tone: "error",
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
    });

    expect(formatPendingWorkMessage(2)).toBe("2 registros por sincronizar");
  });

  it("shows offline as persistent feedback without pending work", () => {
    expect(resolveAppShellPersistentFeedback({
      ...baseInput,
      connectivityStatus: "offline",
    })).toEqual({
      id: "offline",
      message: "Sin conexion. Los registros se guardan en este dispositivo.",
      tone: "warning",
    });
  });

  it("shows real sync and auth phases as persistent feedback", () => {
    expect(resolveAppShellPersistentFeedback({
      ...baseInput,
      isPendingWorkSyncing: true,
      pendingCount: 1,
    })?.message).toBe("Sincronizando con Opco...");

    expect(resolveAppShellPersistentFeedback({
      ...baseInput,
      isAuthSessionRestoring: true,
    })?.message).toBe("Restableciendo sesion con Opco...");
  });

  it("creates transient success feedback only for completed sync work", () => {
    expect(resolveAppShellSuccessToast({
      operationsCompleted: 1,
      result: "success",
    })).toEqual({
      id: "sync-success",
      message: "Sincronizacion completada.",
      tone: "success",
    });

    expect(resolveAppShellSuccessToast({
      operationsCompleted: 0,
      result: "success",
    })).toBeNull();
  });
});
