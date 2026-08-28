import { describe, expect, it } from "vitest";

import {
  getLocalDatabaseFailurePhase,
  getLocalDatabaseRecoveryGuidance,
} from "./local-database-recovery-logic";

describe("local database recovery controller helpers", () => {
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
