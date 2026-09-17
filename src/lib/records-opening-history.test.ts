import { describe, expect, it } from "vitest";

import {
  formatRecordsOpeningPerformanceCopy,
  interruptUnfinishedRecordsOpenings,
  type RecordsOpeningMeasurement,
  upsertRecordsOpeningHistory,
} from "./records-opening-history";

describe("RECORDS opening performance history", () => {
  it("retains the newest 20 measurements and removes the oldest", () => {
    const history = Array.from({ length: 21 }, (_, index) => measurement(index))
      .reduce(upsertRecordsOpeningHistory, [] as RecordsOpeningMeasurement[]);

    expect(history).toHaveLength(20);
    expect(history[0].id).toBe("opening_20");
    expect(history.at(-1)?.id).toBe("opening_1");
  });

  it("updates one opening in place instead of duplicating stage writes", () => {
    const initial = measurement(1, { result: "in_progress" });
    const completed = { ...initial, remoteRefreshMs: 450, result: "completed" as const };
    const history = upsertRecordsOpeningHistory(
      upsertRecordsOpeningHistory([], initial),
      completed,
    );

    expect(history).toEqual([completed]);
  });

  it("marks unfinished persisted openings as interrupted after reload", () => {
    expect(interruptUnfinishedRecordsOpenings([
      measurement(1, { result: "in_progress" }),
      measurement(2, { result: "completed" }),
    ])).toMatchObject([
      { result: "interrupted" },
      { result: "completed" },
    ]);
  });

  it("keeps concurrent openings and their cancelled or error outcomes separate", () => {
    const history = [
      measurement(1, { result: "cancelled" }),
      measurement(2, { errorCode: "NETWORK", result: "error" }),
    ].reduce(upsertRecordsOpeningHistory, [] as RecordsOpeningMeasurement[]);

    expect(history).toMatchObject([
      { errorCode: "NETWORK", id: "opening_2", result: "error" },
      { id: "opening_1", result: "cancelled" },
    ]);
  });

  it("copies safe metadata and timings without operational scope or record data", () => {
    const copied = formatRecordsOpeningPerformanceCopy([measurement(1)]);

    expect(copied).toContain("Personas");
    expect(copied).toContain("Primeras filas: 14 ms");
    expect(copied).not.toContain("ownerKey");
    expect(copied).not.toContain("contractId");
    expect(copied).not.toContain("token");
    expect(copied).not.toContain("payload");
    expect(copied).not.toContain("record values");
  });
});

function measurement(index: number, overrides: Partial<RecordsOpeningMeasurement> = {}): RecordsOpeningMeasurement {
  return {
    appViewId: `view_${index}`,
    appViewTitle: "Personas",
    coverage: "complete",
    errorCode: null,
    id: `opening_${index}`,
    localReadMs: 10,
    preparationMs: 2,
    processedCount: 25,
    remoteRefreshMs: 400,
    result: "completed",
    shownCount: 25,
    source: "local",
    startedAt: new Date(Date.UTC(2026, 8, 17, 12, 0, index)).toISOString(),
    timeToFirstRowsMs: 14,
    ...overrides,
  };
}
