import { describe, expect, it } from "vitest";

import { formatLocalStorageResetWarning, isAccessHandleBusyError, sanitizeLocalDatabaseErrorMessage } from "./local-db-recovery";

describe("local database recovery copy", () => {
  it("shows the number of local changes at risk before reset", () => {
    expect(
      formatLocalStorageResetWarning({
        canCount: true,
        conflictCount: 1,
        failedCount: 2,
        pendingCreateCount: 3,
        pendingUpdateCount: 4,
        totalAtRiskCount: 10,
      }),
    ).toBe(
      "Hay 10 cambios locales que aun no se han sincronizado. Si restableces los datos locales, se perderan.",
    );
  });

  it("does not expose internal SQLite details when the risk count is unavailable", () => {
    const message = formatLocalStorageResetWarning({
      canCount: false,
      conflictCount: 0,
      failedCount: 0,
      pendingCreateCount: 0,
      pendingUpdateCount: 0,
      totalAtRiskCount: 0,
    });

    expect(message).toContain("No pudimos contar los cambios locales");
    expect(message).not.toContain("OPFS");
    expect(message).not.toContain("MIGRATION_FAILED");
  });

  it("detects OPFS Access Handle contention without treating every storage error as corruption", () => {
    const error = new Error(
      "Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.",
    );
    error.name = "NoModificationAllowedError";

    expect(isAccessHandleBusyError(error)).toBe(true);
  });

  it("sanitizes technical SQLite messages before displaying diagnostics", () => {
    const message = sanitizeLocalDatabaseErrorMessage(
      new Error("NoModificationAllowedError: /home/user/private/opco-client.db createSyncAccessHandle https://secret.example/token"),
    );

    expect(message).toContain("NoModificationAllowedError");
    expect(message).toContain("createSyncAccessHandle");
    expect(message).not.toContain("/home/user/private");
    expect(message).not.toContain("https://secret.example");
  });
});
