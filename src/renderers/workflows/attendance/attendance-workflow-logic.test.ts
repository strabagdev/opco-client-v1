import { describe, expect, it } from "vitest";

import { AttendanceBatchResult, AttendanceStatusOption } from "@/lib/opco-api";

import {
  ATTENDANCE_SEARCH_DEBOUNCE_MS,
  firstBlockingAttendanceResult,
  formatLocalDateInput,
  hasSuccessfulAttendanceResult,
  mergeAttendanceStatuses,
  normalizeAttendanceSearch,
  selectDefaultCheckInStatus,
  shouldSearchAttendancePeople,
  shiftLocalDate,
  splitStatusButtons,
} from "./attendance-workflow-logic";

const statuses: AttendanceStatusOption[] = [
  { isDefaultCheckIn: false, label: "Ausente", optionId: "absent_option" },
  { isDefaultCheckIn: true, label: "Presente", optionId: "present_option" },
  { isDefaultCheckIn: false, label: "Atraso", optionId: "late_option" },
];

describe("attendance workflow logic", () => {
  it("keeps local date math in YYYY-MM-DD without UTC conversion", () => {
    expect(formatLocalDateInput(new Date(2026, 7, 22))).toBe("2026-08-22");
    expect(shiftLocalDate("2026-08-01", -1)).toBe("2026-07-31");
    expect(shiftLocalDate("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("uses the backend default check-in status and keeps other statuses dynamic", () => {
    expect(selectDefaultCheckInStatus(statuses)).toEqual({
      isDefaultCheckIn: true,
      label: "Presente",
      optionId: "present_option",
    });
    expect(splitStatusButtons(statuses)).toEqual({
      defaultStatus: { isDefaultCheckIn: true, label: "Presente", optionId: "present_option" },
      otherStatuses: [
        { isDefaultCheckIn: false, label: "Ausente", optionId: "absent_option" },
        { isDefaultCheckIn: false, label: "Atraso", optionId: "late_option" },
      ],
    });
  });

  it("falls back to the first status when no default is configured", () => {
    const noDefault = statuses.map((status) => ({ ...status, isDefaultCheckIn: false }));

    expect(selectDefaultCheckInStatus(noDefault)?.optionId).toBe("absent_option");
  });

  it("keeps dynamic statuses when a partial attendance refresh returns no options", () => {
    const merged = mergeAttendanceStatuses(statuses, []);

    expect(merged).toHaveLength(3);
    expect(selectDefaultCheckInStatus(merged)?.optionId).toBe("present_option");
  });

  it("does not search or show roster results for empty search text", () => {
    expect(ATTENDANCE_SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(250);
    expect(ATTENDANCE_SEARCH_DEBOUNCE_MS).toBeLessThanOrEqual(400);
    expect(normalizeAttendanceSearch("  ana  ")).toBe("ana");
    expect(shouldSearchAttendancePeople("   ")).toBe(false);
    expect(shouldSearchAttendancePeople("ana")).toBe(true);
  });

  it("classifies successful, error, and conflict batch results", () => {
    const results: AttendanceBatchResult[] = [
      { personRecordId: "person_1", recordId: "attendance_1", result: "UNCHANGED" },
      {
        existing: {
          recordId: "attendance_2",
          statusLabel: "Presente",
          statusOptionId: "present_option",
          updatedAt: "2026-08-22T12:00:00.000Z",
        },
        personRecordId: "person_2",
        requested: { statusLabel: "Atraso", statusOptionId: "late_option" },
        result: "CONFLICT",
      },
    ];

    expect(hasSuccessfulAttendanceResult(results)).toBe(true);
    expect(firstBlockingAttendanceResult(results)).toMatchObject({ personRecordId: "person_2", result: "CONFLICT" });
    expect(firstBlockingAttendanceResult([
      { code: "INVALID", message: "Persona invalida.", personRecordId: "person_3", result: "ERROR" },
    ])).toMatchObject({ result: "ERROR" });
  });
});
