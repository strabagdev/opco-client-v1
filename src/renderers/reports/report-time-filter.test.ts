import { describe, expect, it } from "vitest";

import {
  initialReportPeriod,
  monthDays,
  monthToRange,
  normalizeReportTimeFilter,
  reportPeriodToRange,
  shiftMonth,
} from "./report-time-filter";

describe("report time filter", () => {
  it("falls back old REPORT configs to editable current-month RANGE", () => {
    const period = initialReportPeriod({}, new Date(2026, 7, 15));

    expect(normalizeReportTimeFilter({})).toEqual({
      allowChange: true,
      defaultPeriod: "CURRENT_MONTH",
      mode: "RANGE",
    });
    expect(period).toEqual({
      mode: "RANGE",
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(reportPeriodToRange(period)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("calculates MONTH from/to including leap-year February", () => {
    expect(monthToRange("2026-08")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(monthToRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthDays("2024-02")).toHaveLength(29);
    expect(monthDays("2026-04")).toHaveLength(30);
  });

  it("moves to previous and next month across years", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("keeps allowChange false in normalized config", () => {
    expect(normalizeReportTimeFilter({
      timeFilter: {
        allowChange: false,
        defaultPeriod: "CURRENT_MONTH",
        mode: "MONTH",
      },
    })).toEqual({
      allowChange: false,
      defaultPeriod: "CURRENT_MONTH",
      mode: "MONTH",
    });
  });
});
