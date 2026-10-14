import { describe, expect, it, vi } from "vitest";

import {
  cacheAttendanceRemoteSnapshot,
  deriveAttendanceMonthStatus,
  hasSuccessfulAttendanceDayHydration,
  refreshAttendanceDaySnapshot,
} from "./attendance-snapshot-cache";
import { AttendanceResponse } from "./opco-api";

describe("Attendance snapshot cache", () => {
  it("persists a full remote day snapshot and marks the date hydrated", async () => {
    const store = {
      markAttendanceDaySnapshotHydrated: vi.fn(async () => undefined),
      upsertStateUpdateSnapshot: vi.fn(async () => ({ staleSyncedRemoved: 2, contentVerified: true })),
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
      upsertStateUpdateSnapshot: vi.fn(async () => ({ staleSyncedRemoved: 0, contentVerified: true })),
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

  it("marks a valid empty Attendance day as hydrated", async () => {
    const store = {
      markAttendanceDaySnapshotHydrated: vi.fn(async () => undefined),
      upsertStateUpdateSnapshot: vi.fn(async () => ({ staleSyncedRemoved: 0, contentVerified: true })),
    };

    const result = await cacheAttendanceRemoteSnapshot({
      appViewId: "view_attendance",
      config: { statusFieldId: "status_field" },
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
      response: attendanceResponse(),
      store,
    });

    expect(store.upsertStateUpdateSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      complete: true,
      items: [],
    }));
    expect(store.markAttendanceDaySnapshotHydrated).toHaveBeenCalledOnce();
    expect(result.complete).toBe(true);
  });

  it("keeps received observation from current when latest repeats the same event sparsely", async () => {
    const store = { markAttendanceDaySnapshotHydrated: vi.fn(async () => undefined),
      upsertStateUpdateSnapshot: vi.fn(async () => ({ staleSyncedRemoved: 0, contentVerified: true })) };
    const event = { recordId: "event", statusOptionId: "present_option", statusLabel: "Presente", observation: null, updatedAt: "2026-08-31T12:00:00Z" };
    await cacheAttendanceRemoteSnapshot({ appViewId: "view_attendance", contractId: "contract_1", ownerKey: "owner",
      config: { statusFieldId: "status_field", observationFieldId: "observation" }, store,
      response: attendanceResponse({ items: [{ person: { id: "person", displayName: "Synthetic" }, attendance: event }],
        latest: [{ attendanceRecordId: "event", person: { id: "person", displayName: "Synthetic" }, statusOptionId: event.statusOptionId, statusLabel: event.statusLabel, updatedAt: event.updatedAt }], summary: { totalRegistered: 1 } }) });
    expect(store.upsertStateUpdateSnapshot).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ current: expect.objectContaining({ extraValues: { observation: null } }) })] }));
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


describe("Attendance post-sync day recovery", () => {
  const scope = { appViewId: "view_attendance", contractId: "contract_1", ownerKey: "org_1:user_1", date: "2026-08-31", config: { statusFieldId: "status_field" }, token: "test-only" };
  it("fetches configured Observation from current before certifying a complete day", async () => {
    const event = { attendanceRecordId: "event", person: { id: "person", displayName: "Synthetic" }, statusOptionId: "present_option", statusLabel: "Presente", updatedAt: "2026-08-31T12:00:00Z" };
    const day = attendanceResponse({ latest: [event], summary: { totalRegistered: 1 } });
    const api = { getAttendanceWorkflow: vi.fn().mockResolvedValueOnce(day).mockResolvedValueOnce({ ...day, items: [{ person: event.person, attendance: { recordId: "event", statusOptionId: event.statusOptionId, statusLabel: event.statusLabel, updatedAt: event.updatedAt, observation: null } }] }) };
    const store = { upsertStateUpdateSnapshot: vi.fn().mockResolvedValueOnce({ staleSyncedRemoved: 0, contentVerified: false }).mockResolvedValueOnce({ staleSyncedRemoved: 0, contentVerified: true }), markAttendanceDaySnapshotHydrated: vi.fn(async () => {}) };
    expect((await refreshAttendanceDaySnapshot({ ...scope, config: { ...scope.config, observationFieldId: "observation" }, api, store, isCurrent: () => true }))?.hydration.complete).toBe(true);
    expect(api.getAttendanceWorkflow.mock.calls.map(call => call[3])).toEqual([{ date: scope.date }, { date: scope.date, personRecordId: "person" }]);
    expect(store.upsertStateUpdateSnapshot.mock.calls[1][0].items[0].current.extraValues).toEqual({ observation: null });
    expect(store.markAttendanceDaySnapshotHydrated).toHaveBeenCalledTimes(1);
  });
  it("persists concurrent recoveries for the same scope despite superseded presentation", async () => {
    const pending: ((value: AttendanceResponse) => void)[] = [];
    const api = { getAttendanceWorkflow: vi.fn(() => new Promise<AttendanceResponse>(resolve => pending.push(resolve))) };
    const store = { upsertStateUpdateSnapshot: vi.fn(async () => ({ staleSyncedRemoved: 0, contentVerified: true })), markAttendanceDaySnapshotHydrated: vi.fn(async () => {}) };
    const first = refreshAttendanceDaySnapshot({ ...scope, api, store, isCurrent: () => true });
    const second = refreshAttendanceDaySnapshot({ ...scope, api, store, isCurrent: () => true });
    pending[1](attendanceResponse());
    expect((await second)?.hydration.complete).toBe(true);
    pending[0](attendanceResponse());
    expect((await first)?.hydration.complete).toBe(true);
    expect(store.markAttendanceDaySnapshotHydrated).toHaveBeenCalledTimes(2);
    for (const [saved] of store.markAttendanceDaySnapshotHydrated.mock.calls as unknown as [Record<string, unknown>][]) {
      expect(saved).toMatchObject({ ownerKey: scope.ownerKey, contractId: scope.contractId, appViewId: scope.appViewId, date: scope.date });
    }
  });
  it("does not certify an interrupted Observation lookup and permits a later recovery", async () => {
    const event = { attendanceRecordId: "event", person: { id: "person", displayName: "Synthetic" }, statusOptionId: "present_option", statusLabel: "Presente", updatedAt: "2026-08-31T12:00:00Z" };
    const day = attendanceResponse({ latest: [event], summary: { totalRegistered: 1 } });
    const current = { ...day, items: [{ person: event.person, attendance: { recordId: event.attendanceRecordId, statusOptionId: event.statusOptionId, statusLabel: event.statusLabel, updatedAt: event.updatedAt, observation: null } }] };
    let active = true;
    const api = { getAttendanceWorkflow: vi.fn().mockResolvedValueOnce(day).mockImplementationOnce(async () => { active = false; return current; }).mockResolvedValueOnce(day).mockResolvedValueOnce(current) };
    const store = { upsertStateUpdateSnapshot: vi.fn().mockResolvedValueOnce({ contentVerified: false, staleSyncedRemoved: 0 }).mockResolvedValueOnce({ contentVerified: false, staleSyncedRemoved: 0 }).mockResolvedValueOnce({ contentVerified: true, staleSyncedRemoved: 0 }), markAttendanceDaySnapshotHydrated: vi.fn(async () => {}) };
    const input = { ...scope, config: { ...scope.config, observationFieldId: "observation" }, api, store, isCurrent: () => active };
    expect(await refreshAttendanceDaySnapshot(input)).toBeNull();
    expect(store.markAttendanceDaySnapshotHydrated).not.toHaveBeenCalled();
    expect(store.upsertStateUpdateSnapshot).toHaveBeenCalledTimes(1);
    active = true;
    expect((await refreshAttendanceDaySnapshot(input))?.hydration.complete).toBe(true);
    expect(store.markAttendanceDaySnapshotHydrated).toHaveBeenCalledTimes(1);
    expect(api.getAttendanceWorkflow).toHaveBeenCalledTimes(4);
  });
  it("refuses to certify a complete page when required content remains unverified", async () => {
    const api = { getAttendanceWorkflow: vi.fn(async () => attendanceResponse()) };
    const store = { upsertStateUpdateSnapshot: vi.fn(async () => ({ staleSyncedRemoved: 0, contentVerified: false })), markAttendanceDaySnapshotHydrated: vi.fn() };
    await expect(refreshAttendanceDaySnapshot({ ...scope, api, store, isCurrent: () => true })).rejects.toThrow("contenido completo");
    expect(store.markAttendanceDaySnapshotHydrated).not.toHaveBeenCalled();
  });
  it("propagates the real read failure without writing or certifying anything", async () => {
    const failure = new Error("real day read failure");
    const api = { getAttendanceWorkflow: vi.fn(async () => { throw failure; }) };
    const store = { upsertStateUpdateSnapshot: vi.fn(), markAttendanceDaySnapshotHydrated: vi.fn() };
    await expect(refreshAttendanceDaySnapshot({ ...scope, api, store, isCurrent: () => true })).rejects.toBe(failure);
    expect(store.upsertStateUpdateSnapshot).not.toHaveBeenCalled();
    expect(store.markAttendanceDaySnapshotHydrated).not.toHaveBeenCalled();
  });
  it("does not persist a late response after changing scope", async () => {
    const api = { getAttendanceWorkflow: vi.fn(async () => attendanceResponse()) };
    const store = { upsertStateUpdateSnapshot: vi.fn(), markAttendanceDaySnapshotHydrated: vi.fn() };
    expect(await refreshAttendanceDaySnapshot({ ...scope, api, store, isCurrent: () => false })).toBeNull();
    expect(store.upsertStateUpdateSnapshot).not.toHaveBeenCalled();
  });
  it("rejects a response for another date before persisting its content", async () => {
    const api = { getAttendanceWorkflow: vi.fn(async () => attendanceResponse({ date: "2026-09-01" })) };
    const store = { upsertStateUpdateSnapshot: vi.fn(), markAttendanceDaySnapshotHydrated: vi.fn() };
    await expect(refreshAttendanceDaySnapshot({ ...scope, api, store, isCurrent: () => true })).rejects.toThrow("fecha diferente");
    expect(store.upsertStateUpdateSnapshot).not.toHaveBeenCalled();
    expect(store.markAttendanceDaySnapshotHydrated).not.toHaveBeenCalled();
  });
  it("does not certify partial data or a persistence failure", async () => {
    const api = { getAttendanceWorkflow: vi.fn(async () => attendanceResponse({ summary: { totalRegistered: 11 } })) };
    const store = { upsertStateUpdateSnapshot: vi.fn(async () => ({ staleSyncedRemoved: 0, contentVerified: true })), markAttendanceDaySnapshotHydrated: vi.fn(async () => {}) };
    expect((await refreshAttendanceDaySnapshot({ ...scope, api, store, isCurrent: () => true }))?.hydration.complete).toBe(false);
    expect(store.markAttendanceDaySnapshotHydrated).not.toHaveBeenCalled();
    store.upsertStateUpdateSnapshot.mockRejectedValueOnce(new Error("SQLite persistence failed"));
    await expect(refreshAttendanceDaySnapshot({ ...scope, api, store, isCurrent: () => true })).rejects.toThrow("SQLite persistence failed");
    expect(store.markAttendanceDaySnapshotHydrated).not.toHaveBeenCalled();
  });
});
