import { describe, expect, it } from "vitest";

import { formatLocalStorageResetWarning } from "./local-db-recovery";

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
});
