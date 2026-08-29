import { describe, expect, it } from "vitest";

import { AttendanceBatchResult, AttendanceStatusOption } from "@/lib/opco-api";

import {
  ATTENDANCE_SEARCH_DEBOUNCE_MS,
  attendanceResponseToStateUpdateItems,
  firstBlockingAttendanceResult,
  formatLocalDateInput,
  hasSuccessfulAttendanceResult,
  isAttendanceRemoteSnapshotComplete,
  mergeAttendanceLatestWithLocalOverlay,
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

  it("treats Attendance latest as complete only when it covers the registered total within the backend limit", () => {
    expect(isAttendanceRemoteSnapshotComplete({
      latest: [{
        attendanceRecordId: "attendance_1",
        person: { displayName: "Persona 1", id: "person_1" },
        statusLabel: "Presente",
        statusOptionId: "present_option",
        updatedAt: "2026-08-26T10:00:00.000Z",
      }],
      summary: { totalRegistered: 1 },
    })).toBe(true);
    expect(isAttendanceRemoteSnapshotComplete({
      latest: Array.from({ length: 10 }, (_, index) => ({
        attendanceRecordId: `attendance_${index + 1}`,
        person: { displayName: `Persona ${index + 1}`, id: `person_${index + 1}` },
        statusLabel: "Presente",
        statusOptionId: "present_option",
        updatedAt: "2026-08-26T10:00:00.000Z",
      })),
      summary: { totalRegistered: 10 },
    })).toBe(true);
    expect(isAttendanceRemoteSnapshotComplete({
      latest: Array.from({ length: 10 }, (_, index) => ({
        attendanceRecordId: `attendance_${index + 1}`,
        person: { displayName: `Persona ${index + 1}`, id: `person_${index + 1}` },
        statusLabel: "Presente",
        updatedAt: "2026-08-26T10:00:00.000Z",
        statusOptionId: "present_option",
      })),
      summary: { totalRegistered: 25 },
    })).toBe(false);
    expect(isAttendanceRemoteSnapshotComplete({
      latest: [],
      summary: { totalRegistered: 0 },
    })).toBe(true);
  });

  it("hydrates state-update cache from three latest records when initial Attendance load has no searched items", () => {
    const items = attendanceResponseToStateUpdateItems({
      appView: { id: "view_attendance", name: "Asistencia", slug: "asistencia" },
      date: "2026-08-26",
      items: [],
      latest: [
        {
          attendanceRecordId: "attendance_1",
          person: { displayName: "Persona 1", id: "person_1" },
          statusLabel: "Presente",
          statusOptionId: "present_option",
          updatedAt: "2026-08-26T12:00:00.000Z",
        },
        {
          attendanceRecordId: "attendance_2",
          person: { displayName: "Persona 2", id: "person_2" },
          statusLabel: "Ausente",
          statusOptionId: "absent_option",
          updatedAt: "2026-08-26T12:05:00.000Z",
        },
        {
          attendanceRecordId: "attendance_3",
          person: { displayName: "Persona 3", id: "person_3" },
          statusLabel: "Presente",
          statusOptionId: "present_option",
          updatedAt: "2026-08-26T12:10:00.000Z",
        },
      ],
      sourceEntityType: { id: "personas", name: "Personas" },
      statuses,
      summary: { totalRegistered: 3 },
      targetEntityType: { id: "attendance", name: "Attendance" },
    }, {
      observationFieldId: "observation",
      statusFieldId: "status",
    });

    expect(items).toHaveLength(3);
    expect(items.map((item) => item.current?.recordId)).toEqual(["attendance_1", "attendance_2", "attendance_3"]);
    expect(items.map((item) => item.current?.stateValues[0])).toEqual([
      { fieldId: "status", label: "Presente", optionId: "present_option" },
      { fieldId: "status", label: "Ausente", optionId: "absent_option" },
      { fieldId: "status", label: "Presente", optionId: "present_option" },
    ]);
  });

  it("prefers latest over stale roster item state when hydrating the Attendance day", () => {
    const items = attendanceResponseToStateUpdateItems({
      appView: { id: "view_attendance", name: "Asistencia", slug: "asistencia" },
      date: "2026-08-26",
      items: [{
        attendance: {
          observation: null,
          recordId: "attendance_old",
          statusLabel: "Ausente",
          statusOptionId: "absent_option",
          updatedAt: "2026-08-26T10:00:00.000Z",
        },
        person: { displayName: "Persona 1", id: "person_1" },
      }],
      latest: [{
        attendanceRecordId: "attendance_latest",
        person: { displayName: "Persona 1", id: "person_1" },
        statusLabel: "Presente",
        statusOptionId: "present_option",
        updatedAt: "2026-08-26T12:00:00.000Z",
      }],
      sourceEntityType: { id: "personas", name: "Personas" },
      statuses,
      summary: { totalRegistered: 1 },
      targetEntityType: { id: "attendance", name: "Attendance" },
    }, {
      statusFieldId: "status",
    });

    expect(items).toHaveLength(1);
    expect(items[0].current).toMatchObject({
      recordId: "attendance_latest",
      stateValues: [{ fieldId: "status", label: "Presente", optionId: "present_option" }],
    });
  });

  it("keeps unresolved local attendance intent visible over a stale remote snapshot", () => {
    const remoteLatest = Array.from({ length: 4 }, (_, index) => ({
      attendanceRecordId: `remote_attendance_${index + 1}`,
      person: { displayName: `Persona ${index + 1}`, id: `person_${index + 1}` },
      statusLabel: "Presente",
      statusOptionId: "present_option",
      updatedAt: `2026-08-28T12:0${index}:00.000Z`,
    }));
    const pendingLocal = {
      attendanceRecordId: "state_update_attendance_2026_08_28_person_5",
      person: { displayName: "Persona 5", id: "person_5" },
      statusLabel: "Presente (por sincronizar)",
      statusOptionId: "present_option",
      updatedAt: "2026-08-28T12:04:00.000Z",
    };

    expect(mergeAttendanceLatestWithLocalOverlay(remoteLatest, [...remoteLatest, pendingLocal])).toHaveLength(5);
    expect(mergeAttendanceLatestWithLocalOverlay(remoteLatest, [pendingLocal])).toHaveLength(5);
  });

  it("dedupes local attendance intent when the remote snapshot confirms it", () => {
    const remoteLatest = Array.from({ length: 5 }, (_, index) => ({
      attendanceRecordId: `remote_attendance_${index + 1}`,
      person: { displayName: `Persona ${index + 1}`, id: `person_${index + 1}` },
      statusLabel: "Presente",
      statusOptionId: "present_option",
      updatedAt: `2026-08-28T12:0${index}:00.000Z`,
    }));
    const localConfirmed = {
      attendanceRecordId: "state_update_attendance_2026_08_28_person_5",
      person: { displayName: "Persona 5", id: "person_5" },
      statusLabel: "Presente",
      statusOptionId: "present_option",
      updatedAt: "2026-08-28T12:04:00.000Z",
    };

    const visible = mergeAttendanceLatestWithLocalOverlay(remoteLatest, [localConfirmed]);

    expect(visible).toHaveLength(5);
    expect(visible.filter((item) => item.person.id === "person_5")).toHaveLength(1);
  });
});
