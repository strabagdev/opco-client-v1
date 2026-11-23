import { describe, expect, it } from "vitest";

import {
  getLocalDatabaseFailurePhase,
  getLocalDatabaseRecoveryGuidance,
} from "./local-database-recovery-logic";

describe("local database recovery controller helpers", () => {
  it("retains CLOSE_FAILED content and discloses draft loss before a full reload", () => {
    const guidance = getLocalDatabaseRecoveryGuidance({
      cause: "CLOSE_FAILED", destructiveRecoveryAvailable: false,
      errorCode: "SQLITE_UNAVAILABLE", retryable: true, retryRequiresReload: true,
      status: "unavailable", technicalMessage: "SQLITE_CLOSE_OUTCOME_UNCONFIRMED",
    });
    expect(guidance.preserveMountedContent).toBe(true);
    expect(guidance.reloadConfirmation?.title).toContain("Recargar");
    expect(guidance.reloadConfirmation?.body).toContain("toda la página");
    expect(guidance.reloadConfirmation?.body).toContain("sin guardar");
    expect(guidance.reloadConfirmation?.body).toContain("Cancelar mantiene el formulario");
    expect(guidance.canRequestDestructiveReset).toBe(false);
  });

  it("does not add reload confirmation to native close failure or initial opening failures", () => {
    for (const cause of ["OPEN_FAILED", "ACCESS_HANDLE_BUSY", "CLOSE_FAILED"] as const) {
      const guidance = getLocalDatabaseRecoveryGuidance({
        cause, destructiveRecoveryAvailable: false, errorCode: "SQLITE_UNAVAILABLE",
        retryable: true, status: "unavailable", technicalMessage: "Synthetic failure",
      });
      expect(guidance.reloadConfirmation).toBeNull();
      expect(guidance.preserveMountedContent).toBe(cause === "CLOSE_FAILED");
    }
  });

  it("keeps ACCESS_HANDLE_BUSY retry-first and without destructive reset as the first solution", () => {
    const guidance = getLocalDatabaseRecoveryGuidance({
      cause: "ACCESS_HANDLE_BUSY",
      destructiveRecoveryAvailable: false,
      errorCode: "SQLITE_UNAVAILABLE",
      retryable: true,
      status: "unavailable",
      technicalMessage: "createSyncAccessHandle",
    });

    expect(guidance.isAccessHandleBusy).toBe(true);
    expect(guidance.canRequestDestructiveReset).toBe(false);
    expect(guidance.title).toContain("otra pestana");
  });

  it("allows explicit destructive reset only for non-busy unavailable storage", () => {
    const guidance = getLocalDatabaseRecoveryGuidance({
      cause: "OPEN_FAILED",
      destructiveRecoveryAvailable: true,
      errorCode: "SQLITE_UNAVAILABLE",
      retryable: true,
      status: "unavailable",
      technicalMessage: "open failed",
    });

    expect(guidance.isAccessHandleBusy).toBe(false);
    expect(guidance.canRequestDestructiveReset).toBe(true);
    expect(guidance.body).toContain("cambios no sincronizados");
  });

  it("classifies recovery phases without exposing technical paths", () => {
    expect(getLocalDatabaseFailurePhase("ACCESS_HANDLE_BUSY")).toBe("OPFS Access Handle");
    expect(getLocalDatabaseFailurePhase("OPEN_FAILED")).toBe("openDatabaseAsync");
    expect(getLocalDatabaseFailurePhase("STORAGE_UNAVAILABLE")).toBe("openDatabaseAsync");
    expect(getLocalDatabaseFailurePhase("CORRUPTION_SUSPECTED")).toBe("openDatabaseAsync");
    expect(getLocalDatabaseFailurePhase("MIGRATION_FAILED")).toBe("migration");
    expect(getLocalDatabaseFailurePhase("UNKNOWN")).toBe("unknown");
  });
});
