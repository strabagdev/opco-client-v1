import { describe, expect, it, vi } from "vitest";

import {
  cacheAttendanceRemoteSnapshot,
  deriveAttendanceMonthStatus,
  hasSuccessfulAttendanceDayHydration,
} from "./attendance-snapshot-cache";
import { AttendanceResponse } from "./opco-api";

describe("Attendance snapshot cache", () => {
  it("persists a full remote day snapshot and marks the date hydrated", async () => {
    const store = {
      markAttendanceDaySnapshotHydrated: vi.fn(async () => undefined),
      upsertStateUpdateSnapshot: vi.fn(async () => ({ staleSyncedRemoved: 2 })),
    };

    const result = await cacheAttendanceRemoteSnapshot({
      appViewId: "view_attendance",
      config: { statusFieldId: "status_field" },
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
      response: attendanceResponse({
        latest: [{
          attendanceRecordId: "attendance_1",
          person: { displayName: "Ana", id: "person_1" },
          statusLabel: "Presente",
          statusOptionId: "present_option",
          updatedAt: "2026-08-31T12:00:00.000Z",
        }],
        summary: { totalRegistered: 1 },
      }),
      store,
    });

    expect(store.upsertStateUpdateSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      appViewId: "view_attendance",
      complete: true,
      date: "2026-08-31",
      targetEntityTypeId: "entity_attendance",
    }));
    expect(store.markAttendanceDaySnapshotHydrated).toHaveBeenCalledWith(expect.objectContaining({
      appViewId: "view_attendance",
      date: "2026-08-31",
      targetEntityTypeId: "entity_attendance",
    }));
    expect(result).toMatchObject({
      complete: true,
      staleSyncedRemoved: 2,
    });
    expect(result.lastSuccessfulRefreshAt).toEqual(expect.any(String));
  });

  it("persists a partial remote snapshot without marking the date hydrated", async () => {
    const store = {
      markAttendanceDaySnapshotHydrated: vi.fn(async () => undefined),
      upsertStateUpdateSnapshot: vi.fn(async () => ({ staleSyncedRemoved: 0 })),
    };

    const result = await cacheAttendanceRemoteSnapshot({
      appViewId: "view_attendance",
      config: { statusFieldId: "status_field" },
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
      response: attendanceResponse({
        latest: [{
          attendanceRecordId: "attendance_1",
          person: { displayName: "Ana", id: "person_1" },
          statusLabel: "Presente",
          statusOptionId: "present_option",
          updatedAt: "2026-08-31T12:00:00.000Z",
        }],
        summary: { totalRegistered: 2 },
      }),
      snapshotComplete: false,
      store,
    });

    expect(store.upsertStateUpdateSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      complete: false,
    }));
    expect(store.markAttendanceDaySnapshotHydrated).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      complete: false,
      lastSuccessfulRefreshAt: null,
    });
  });

  it("treats only metadata with a timestamp as hydrated", () => {
    expect(hasSuccessfulAttendanceDayHydration(null)).toBe(false);
    expect(hasSuccessfulAttendanceDayHydration({ lastSuccessfulRefreshAt: "" })).toBe(false);
    expect(hasSuccessfulAttendanceDayHydration({ lastSuccessfulRefreshAt: "2026-08-31T12:00:00.000Z" })).toBe(true);
  });

  it("derives complete month status when every date has a full snapshot", () => {
    expect(deriveAttendanceMonthStatus([
      { lastSuccessfulRefreshAt: "2026-08-01T12:00:00.000Z" },
      { lastSuccessfulRefreshAt: "2026-08-02T12:00:00.000Z" },
    ])).toBe("complete");
  });

  it("derives partial month status when at least one date is missing", () => {
    expect(deriveAttendanceMonthStatus([
      { lastSuccessfulRefreshAt: "2026-08-01T12:00:00.000Z" },
      null,
    ])).toBe("partial");
  });

  it("derives none month status when no dates have a full snapshot", () => {
    expect(deriveAttendanceMonthStatus([null, undefined])).toBe("none");
  });
});

function attendanceResponse(overrides: Partial<AttendanceResponse> = {}): AttendanceResponse {
  return {
    appView: { id: "view_attendance", name: "Asistencia", slug: "asistencia" },
    date: "2026-08-31",
    items: [],
    latest: [],
    sourceEntityType: { id: "entity_people", name: "Personas" },
    statuses: [
      { isDefaultCheckIn: true, label: "Presente", optionId: "present_option" },
    ],
    summary: { totalRegistered: 0 },
    targetEntityType: { id: "entity_attendance", name: "Asistencias" },
    ...overrides,
  };
}
