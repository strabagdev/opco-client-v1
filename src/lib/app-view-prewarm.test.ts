import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppViewDefinitionCache, CachedAppViewDefinition, UpsertAppViewDefinitionInput } from "./app-view-definitions-cache";
import {
  ATTENDANCE_MONTH_PREWARM_CONCURRENCY,
  OFFLINE_PREPARATION_SLOW_THRESHOLD_MS,
  OfflinePreparationDiagnostics,
  prewarmAssignedAppViewsOnce,
} from "./app-view-prewarm";
import { CachedEntityRecord } from "./offline-records";
import { AppView, AttendanceResponse, EntityDefinition, EntityRecord, OpcoNetworkError, StateUpdateResponse } from "./opco-api";
import { emptySyncTelemetry, SyncErrorPhase, SyncPhase, SyncTelemetry, SyncTelemetryScope } from "./sync-telemetry";
import { appViewsFixture, entityDefinitionFixture } from "../test/fixtures";
import { AttendanceDaySnapshotHydration, AttendanceDaySnapshotScope, UpsertStateUpdateSnapshotInput } from "./state-update-offline";
import { currentMonthDateKeys } from "./attendance-snapshot-cache";

describe("app view prewarm", () => {
  let store: MemoryPrewarmStore;

  beforeEach(() => {
    store = new MemoryPrewarmStore();
    vi.useRealTimers();
  });

  it("prepares records definitions, attendance statuses, source records, and the current month snapshots", async () => {
    const api = {
      getAttendanceWorkflow: vi.fn(async (_token, _contractId, _appViewId, query: { date: string }) => ({
        appView: { id: "view_workflow", name: "Tomar asistencia", slug: "tomar-asistencia" },
        contextFields: [{
          id: "shift_field",
          key: "turno",
          name: "Turno",
          options: [{ label: "Día", optionId: "shift_day", order: 0, value: "dia" }],
          required: true,
          type: "SELECT" as const,
        }],
        date: query.date,
        items: [],
        latest: [],
        sourceEntityType: { id: "entity_people", name: "Personas" },
        statuses: [
          { isDefaultCheckIn: true, label: "Presente", optionId: "status_present" },
          { isDefaultCheckIn: false, label: "Ausente", optionId: "status_absent" },
        ],
        summary: { totalRegistered: 0 },
        targetEntityType: { id: "entity_attendance", name: "Asistencias" },
      })),
      getStateUpdateWorkflow: vi.fn(),
      getEntityDefinition: vi.fn(async () => ({ entity: entityDefinitionFixture })),
      getEntityRecords: vi.fn(async (_token, _contractId, entityTypeId: string, query?: { page?: number; pageSize?: number }) => ({
        pagination: { page: query?.page ?? 1, pageSize: query?.pageSize ?? 100, total: entityTypeId === "entity_people" ? 1 : 0, totalPages: 1 },
        records: entityTypeId === "entity_people"
          ? [{ displayName: "Ana", id: "person_1", updatedAt: "2026-08-25T12:00:00.000Z", values: { nombre: "Ana" } }]
          : [],
      })),
    };

    await prewarmAssignedAppViewsOnce({
      api,
      appViews: appViewsFixture,
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
      store,
      token: "token_1",
    });

    expect(api.getEntityDefinition).toHaveBeenCalledWith("token_1", "contract_1", "entity_1");
    expect(api.getAttendanceWorkflow).toHaveBeenCalledTimes(currentMonthDateKeys(new Date()).length);
    expect(api.getEntityRecords).toHaveBeenCalledWith("token_1", "contract_1", "entity_people", {
      page: 1,
      pageSize: 100,
    });
    await expect(store.getAppViewDefinition("org_1:user_1", "contract_1", "view_records")).resolves.toMatchObject({
      definition: { kind: "records" },
      status: "ready",
    });
    await expect(store.getAppViewDefinition("org_1:user_1", "contract_1", "view_workflow")).resolves.toMatchObject({
      definition: {
        kind: "state-update",
        stateFields: [{
          defaultOptionId: "status_present",
          fieldId: "field_attendance_status",
        }],
        extraFields: [{
          id: "shift_field",
          name: "Turno",
          options: [{
            value: "dia",
          }],
          required: true,
          type: "SELECT",
        }],
      },
      status: "ready",
    });
    const monthDates = currentMonthDateKeys(new Date());

    expect(store.snapshots).toHaveLength(monthDates.length);
    expect(store.snapshots[0]).toMatchObject({
      appViewId: "view_workflow",
      complete: true,
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
      targetEntityTypeId: "entity_attendance",
    });
    expect([...store.snapshots.map((snapshot) => snapshot.date)].sort()).toEqual([...monthDates].sort());
    expect(api.getEntityRecords).toHaveBeenCalledTimes(1);
    await expect(store.getAttendanceDaySnapshotHydration({
      appViewId: "view_workflow",
      contractId: "contract_1",
      date: monthDates[0],
      ownerKey: "org_1:user_1",
      targetEntityTypeId: "entity_attendance",
    })).resolves.toMatchObject({
      lastSuccessfulRefreshAt: expect.any(String),
    });
  });

  it("caches partial Attendance prewarm days without marking them as fully hydrated", async () => {
    const api = {
      getAttendanceWorkflow: vi.fn(async (_token, _contractId, _appViewId, query: { date: string }) => ({
        appView: { id: "view_workflow", name: "Tomar asistencia", slug: "tomar-asistencia" },
        date: query.date,
        items: [],
        latest: [{
          attendanceRecordId: "attendance_1",
          person: { displayName: "Ana", id: "person_1" },
          statusLabel: "Presente",
          statusOptionId: "status_present",
          updatedAt: "2026-08-25T12:00:00.000Z",
        }],
        sourceEntityType: { id: "entity_people", name: "Personas" },
        statuses: [
          { isDefaultCheckIn: true, label: "Presente", optionId: "status_present" },
        ],
        summary: { totalRegistered: 2 },
        targetEntityType: { id: "entity_attendance", name: "Asistencias" },
      })),
      getStateUpdateWorkflow: vi.fn(),
      getEntityDefinition: vi.fn(async () => ({ entity: entityDefinitionFixture })),
      getEntityRecords: vi.fn(async (_token, _contractId, _entityTypeId, query?: { page?: number; pageSize?: number }) => ({
        pagination: { page: query?.page ?? 1, pageSize: query?.pageSize ?? 100, total: 1, totalPages: 1 },
        records: [{ displayName: "Ana", id: "person_1", updatedAt: "2026-08-25T12:00:00.000Z", values: { nombre: "Ana" } }],
      })),
    };

    await prewarmAssignedAppViewsOnce({
      api,
      appViews: [appViewsFixture[1]],
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
      store,
      token: "token_1",
    });

    const monthDates = currentMonthDateKeys(new Date());

    expect(store.snapshots).toHaveLength(monthDates.length);
    expect(store.snapshots.every((snapshot) => snapshot.complete === false)).toBe(true);
    expect(store.snapshots[0]).toMatchObject({
      complete: false,
    });
    await expect(store.getAttendanceDaySnapshotHydration({
      appViewId: "view_workflow",
      contractId: "contract_1",
      date: monthDates[0],
      ownerKey: "org_1:user_1",
      targetEntityTypeId: "entity_attendance",
    })).resolves.toBeNull();
  });

  it("builds current month date keys without including adjacent months", () => {
    expect(currentMonthDateKeys(new Date(2026, 1, 14))).toEqual([
      "2026-02-01",
      "2026-02-02",
      "2026-02-03",
      "2026-02-04",
      "2026-02-05",
      "2026-02-06",
      "2026-02-07",
      "2026-02-08",
      "2026-02-09",
      "2026-02-10",
      "2026-02-11",
      "2026-02-12",
      "2026-02-13",
      "2026-02-14",
      "2026-02-15",
      "2026-02-16",
      "2026-02-17",
      "2026-02-18",
      "2026-02-19",
      "2026-02-20",
      "2026-02-21",
      "2026-02-22",
      "2026-02-23",
      "2026-02-24",
      "2026-02-25",
      "2026-02-26",
      "2026-02-27",
      "2026-02-28",
    ]);
    expect(currentMonthDateKeys(new Date(2028, 1, 14))).toHaveLength(29);
  });

  it("limits concurrent Attendance month requests", async () => {
    let attendanceCalls = 0;
    let activeMonthRequests = 0;
    let maxMonthRequests = 0;
    const api = {
      getAttendanceWorkflow: vi.fn(async (_token, _contractId, _appViewId, query: { date: string }) => {
        attendanceCalls += 1;

        if (attendanceCalls > 1) {
          activeMonthRequests += 1;
          maxMonthRequests = Math.max(maxMonthRequests, activeMonthRequests);
          await new Promise((resolve) => setTimeout(resolve, 0));
          activeMonthRequests -= 1;
        }

        return attendanceWorkflowResponse(query.date);
      }),
      getStateUpdateWorkflow: vi.fn(),
      getEntityDefinition: vi.fn(async () => ({ entity: entityDefinitionFixture })),
      getEntityRecords: vi.fn(async (_token, _contractId, _entityTypeId, query?: { page?: number; pageSize?: number }) => ({
        pagination: { page: query?.page ?? 1, pageSize: query?.pageSize ?? 100, total: 1, totalPages: 1 },
        records: [{ displayName: "Ana", id: "person_1", updatedAt: "2026-08-25T12:00:00.000Z", values: { nombre: "Ana" } }],
      })),
    };

    await prewarmAssignedAppViewsOnce({
      api,
      appViews: [appViewsFixture[1]],
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
      store,
      token: "token_1",
    });

    expect(maxMonthRequests).toBeLessThanOrEqual(ATTENDANCE_MONTH_PREWARM_CONCURRENCY);
    expect(maxMonthRequests).toBeGreaterThan(1);
  });

  it("continues hydrating other Attendance month days when one day fails", async () => {
    const monthDates = currentMonthDateKeys(new Date());
    const failedDate = monthDates.find((date) => date !== formatLocalDateInput(new Date())) ?? monthDates[0];
    const api = {
      getAttendanceWorkflow: vi.fn(async (_token, _contractId, _appViewId, query: { date: string }) => {
        if (query.date === failedDate) {
          throw new Error("day failed");
        }

        return attendanceWorkflowResponse(query.date);
      }),
      getStateUpdateWorkflow: vi.fn(),
      getEntityDefinition: vi.fn(async () => ({ entity: entityDefinitionFixture })),
      getEntityRecords: vi.fn(async (_token, _contractId, _entityTypeId, query?: { page?: number; pageSize?: number }) => ({
        pagination: { page: query?.page ?? 1, pageSize: query?.pageSize ?? 100, total: 1, totalPages: 1 },
        records: [{ displayName: "Ana", id: "person_1", updatedAt: "2026-08-25T12:00:00.000Z", values: { nombre: "Ana" } }],
      })),
    };

    await prewarmAssignedAppViewsOnce({
      api,
      appViews: [appViewsFixture[1]],
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
      store,
      token: "token_1",
    });

    expect(store.snapshots.map((snapshot) => snapshot.date)).not.toContain(failedDate);
    expect(store.snapshots).toHaveLength(monthDates.length - 1);
    await expect(store.getAttendanceDaySnapshotHydration({
      appViewId: "view_workflow",
      contractId: "contract_1",
      date: failedDate,
      ownerKey: "org_1:user_1",
      targetEntityTypeId: "entity_attendance",
    })).resolves.toBeNull();
    await expect(store.getAttendanceDaySnapshotHydration({
      appViewId: "view_workflow",
      contractId: "contract_1",
      date: monthDates.find((date) => date !== failedDate)!,
      ownerKey: "org_1:user_1",
      targetEntityTypeId: "entity_attendance",
    })).resolves.toMatchObject({
      lastSuccessfulRefreshAt: expect.any(String),
    });
  });

  it("does not duplicate concurrent prewarm triggers for the same owner and contract", async () => {
    const api = {
      getAttendanceWorkflow: vi.fn(async (_token, _contractId, _appViewId, query: { date: string }) => ({
        appView: { id: "view_workflow", name: "Tomar asistencia", slug: "tomar-asistencia" },
        date: query.date,
        items: [],
        latest: [],
        sourceEntityType: { id: "entity_people", name: "Personas" },
        statuses: [],
        summary: { totalRegistered: 0 },
        targetEntityType: { id: "entity_attendance", name: "Asistencias" },
      })),
      getStateUpdateWorkflow: vi.fn(),
      getEntityDefinition: vi.fn(async () => ({ entity: entityDefinitionFixture })),
      getEntityRecords: vi.fn(async (_token, _contractId, _entityTypeId, query?: { page?: number; pageSize?: number }) => ({
        pagination: { page: query?.page ?? 1, pageSize: query?.pageSize ?? 100, total: 0, totalPages: 1 },
        records: [],
      })),
    };

    await Promise.all([
      prewarmAssignedAppViewsOnce({
        api,
        appViews: appViewsFixture,
        contractId: "contract_1",
        ownerKey: "org_1:user_1",
        store,
        token: "token_1",
      }),
      prewarmAssignedAppViewsOnce({
        api,
        appViews: appViewsFixture,
        contractId: "contract_1",
        ownerKey: "org_1:user_1",
        store,
        token: "token_1",
      }),
    ]);

    expect(api.getAttendanceWorkflow).toHaveBeenCalledTimes(currentMonthDateKeys(new Date()).length);
    expect(api.getEntityDefinition).toHaveBeenCalledTimes(2);
  });

  it("records sanitized prewarm telemetry from running to completed", async () => {
    const telemetry: OfflinePreparationDiagnostics[] = [];
    const api = {
      getAttendanceWorkflow: vi.fn(),
      getStateUpdateWorkflow: vi.fn(),
      getEntityDefinition: vi.fn(async () => ({ entity: entityDefinitionFixture })),
      getEntityRecords: vi.fn(),
    };

    await prewarmAssignedAppViewsOnce({
      api,
      appViews: [appViewsFixture[0]],
      contractId: "contract_1",
      onTelemetry: (diagnostics) => {
        telemetry.push(diagnostics);
      },
      ownerKey: "org_1:user_1",
      store,
      token: "token_1",
    });

    expect(telemetry[0]).toMatchObject({
      appViews: { completed: 0, failed: 0, running: 1, total: 1 },
      status: "running",
    });
    expect(telemetry.at(-1)).toMatchObject({
      appViews: { completed: 1, failed: 0, running: 0, total: 1 },
      status: "completed",
    });
    expect(telemetry.at(-1)?.lastAppView?.fingerprint).toMatch(/^fp_/);
    expect(JSON.stringify(telemetry)).not.toContain("view_records");
    await expect(store.getOfflinePreparationDiagnostics("org_1:user_1")).resolves.toMatchObject({
      status: "completed",
    });
  });

  it("identifies a slow AppView stage without changing prewarm behavior", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T10:00:00.000Z"));
    const api = {
      getAttendanceWorkflow: vi.fn(),
      getStateUpdateWorkflow: vi.fn(),
      getEntityDefinition: vi.fn(async () => {
        vi.setSystemTime(new Date(Date.now() + OFFLINE_PREPARATION_SLOW_THRESHOLD_MS + 1));
        return { entity: entityDefinitionFixture };
      }),
      getEntityRecords: vi.fn(),
    };

    await prewarmAssignedAppViewsOnce({
      api,
      appViews: [appViewsFixture[0]],
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
      store,
      token: "token_1",
    });

    expect(store.offlinePreparationDiagnostics?.slow).toBe(true);
    expect(store.offlinePreparationDiagnostics?.slowestStages[0]).toMatchObject({
      stage: "definition_load",
    });
  });

  it("records failed AppViews without hiding completed ones", async () => {
    const api = {
      getAttendanceWorkflow: vi.fn(),
      getStateUpdateWorkflow: vi.fn(),
      getEntityDefinition: vi
        .fn()
        .mockResolvedValueOnce({ entity: entityDefinitionFixture })
        .mockRejectedValueOnce(new Error("boom")),
      getEntityRecords: vi.fn(),
    };

    await prewarmAssignedAppViewsOnce({
      api,
      appViews: [appViewsFixture[0], { ...appViewsFixture[0], id: "view_failed" }],
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
      store,
      token: "token_1",
    });

    expect(store.offlinePreparationDiagnostics).toMatchObject({
      appViews: { completed: 2, failed: 1, running: 0, total: 2 },
      status: "failed",
    });
  });

  it("does not let telemetry failures block the actual prewarm", async () => {
    store.failTelemetry = true;
    const api = {
      getAttendanceWorkflow: vi.fn(),
      getStateUpdateWorkflow: vi.fn(),
      getEntityDefinition: vi.fn(async () => ({ entity: entityDefinitionFixture })),
      getEntityRecords: vi.fn(),
    };

    await prewarmAssignedAppViewsOnce({
      api,
      appViews: [appViewsFixture[0]],
      contractId: "contract_1",
      onTelemetry: () => {
        throw new Error("diagnostics unavailable");
      },
      ownerKey: "org_1:user_1",
      store,
      token: "token_1",
    });

    await expect(store.getAppViewDefinition("org_1:user_1", "contract_1", "view_records")).resolves.toMatchObject({
      status: "ready",
    });
  });

  it("marks an empty Attendance source hydration as a successful full refresh", async () => {
    const api = {
      getAttendanceWorkflow: vi.fn(async () => ({
        appView: { id: "view_workflow", name: "Tomar asistencia", slug: "tomar-asistencia" },
        date: "2026-08-25",
        items: [],
        latest: [],
        sourceEntityType: { id: "entity_people", name: "Personas" },
        statuses: [],
        summary: { totalRegistered: 0 },
        targetEntityType: { id: "entity_attendance", name: "Asistencias" },
      })),
      getStateUpdateWorkflow: vi.fn(),
      getEntityDefinition: vi.fn(async () => ({ entity: entityDefinitionFixture })),
      getEntityRecords: vi.fn(async (_token, _contractId, _entityTypeId, query?: { page?: number; pageSize?: number }) => ({
        pagination: { page: query?.page ?? 1, pageSize: query?.pageSize ?? 100, total: 0, totalPages: 1 },
        records: [],
      })),
    };

    await prewarmAssignedAppViewsOnce({
      api,
      appViews: [appViewsFixture[1]],
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
      store,
      token: "token_1",
    });

    await expect(store.getSyncTelemetry({
      contractId: "contract_1",
      entityTypeId: "entity_people",
      ownerKey: "org_1:user_1",
    })).resolves.toMatchObject({
      lastFullRefreshCompletedAt: expect.any(String),
      lastSuccessfulSyncAt: expect.any(String),
      syncPhase: "idle",
    });
  });

  it("keeps a previous ready definition when a later prewarm hits a network error", async () => {
    const api = {
      getAttendanceWorkflow: vi.fn(async () => {
        throw new OpcoNetworkError();
      }),
      getStateUpdateWorkflow: vi.fn(),
      getEntityDefinition: vi
        .fn()
        .mockResolvedValueOnce({ entity: entityDefinitionFixture })
        .mockRejectedValueOnce(new OpcoNetworkError()),
      getEntityRecords: vi.fn(async (_token, _contractId, _entityTypeId, query?: { page?: number; pageSize?: number }) => ({
        pagination: { page: query?.page ?? 1, pageSize: query?.pageSize ?? 100, total: 0, totalPages: 1 },
        records: [],
      })),
    };

    await prewarmAssignedAppViewsOnce({
      api,
      appViews: [appViewsFixture[0]],
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
      store,
      token: "token_1",
    });
    await prewarmAssignedAppViewsOnce({
      api,
      appViews: [appViewsFixture[0]],
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
      store,
      token: "token_1",
    });

    await expect(store.getAppViewDefinition("org_1:user_1", "contract_1", "view_records")).resolves.toMatchObject({
      definition: { kind: "records" },
      status: "ready",
    });
  });

  it("stores subject-only state-update definitions with normalized empty collections", async () => {
    const stateUpdateView: AppView = {
      config: {
        historyMode: "append",
        sourceEntityTypeId: "procedures",
        stateFields: [{ fieldId: "field_status", required: true }],
        subjectFieldId: "field_procedure",
        targetEntityTypeId: "versions",
        uniqueness: "subject",
        workflowKey: "state-update",
      },
      icon: "workflow",
      id: "view_state_update",
      name: "Versionado",
      slug: "versionado",
      sortOrder: 5,
      type: "WORKFLOW",
    };
    const api = {
      getAttendanceWorkflow: vi.fn(),
      getStateUpdateWorkflow: vi.fn(async () => ({
        appView: { id: "view_state_update", name: "Versionado", slug: "versionado" },
        historyMode: "append",
        sourceEntityType: { id: "procedures", name: "Procedimientos" },
        subjectFieldId: "field_procedure",
        targetEntityType: { id: "versions", name: "Versionado" },
        uniqueness: "subject",
      }) as StateUpdateResponse),
      getEntityDefinition: vi.fn(async () => ({ entity: entityDefinitionFixture })),
      getEntityRecords: vi.fn(async (_token, _contractId, _entityTypeId, query?: { page?: number; pageSize?: number }) => ({
        pagination: { page: query?.page ?? 1, pageSize: query?.pageSize ?? 100, total: 0, totalPages: 1 },
        records: [],
      })),
    };

    await prewarmAssignedAppViewsOnce({
      api,
      appViews: [stateUpdateView],
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
      store,
      token: "token_1",
    });

    expect(api.getStateUpdateWorkflow).toHaveBeenCalledWith("token_1", "contract_1", "view_state_update", {
      date: undefined,
    });
    await expect(store.getAppViewDefinition("org_1:user_1", "contract_1", "view_state_update")).resolves.toMatchObject({
      definition: {
        dateFieldId: undefined,
        extraFields: [],
        historyMode: "append",
        kind: "state-update",
        sourceEntityTypeId: "procedures",
        stateFields: [],
        subjectFieldId: "field_procedure",
        targetEntityTypeId: "versions",
        uniqueness: "subject",
      },
      status: "ready",
    });
  });

  it("isolates definitions by owner and contract and reconciles revoked AppViews", async () => {
    const api = {
      getAttendanceWorkflow: vi.fn(async () => ({
        appView: { id: "view_workflow", name: "Tomar asistencia", slug: "tomar-asistencia" },
        date: "2026-08-25",
        items: [],
        latest: [],
        sourceEntityType: { id: "entity_people", name: "Personas" },
        statuses: [],
        summary: { totalRegistered: 0 },
        targetEntityType: { id: "entity_attendance", name: "Asistencias" },
      })),
      getStateUpdateWorkflow: vi.fn(),
      getEntityDefinition: vi.fn(async () => ({ entity: entityDefinitionFixture })),
      getEntityRecords: vi.fn(async (_token, _contractId, _entityTypeId, query?: { page?: number; pageSize?: number }) => ({
        pagination: { page: query?.page ?? 1, pageSize: query?.pageSize ?? 100, total: 0, totalPages: 1 },
        records: [],
      })),
    };

    await prewarmAssignedAppViewsOnce({
      api,
      appViews: appViewsFixture,
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
      store,
      token: "token_1",
    });
    await prewarmAssignedAppViewsOnce({
      api,
      appViews: [appViewsFixture[0]],
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
      store,
      token: "token_1",
    });

    await expect(store.getAppViewDefinition("org_1:user_2", "contract_1", "view_records")).resolves.toBeNull();
    await expect(store.getAppViewDefinition("org_1:user_1", "contract_2", "view_records")).resolves.toBeNull();
    await expect(store.getAppViewDefinition("org_1:user_1", "contract_1", "view_workflow")).resolves.toBeNull();
    await expect(store.getAppViewDefinition("org_1:user_1", "contract_1", "view_records")).resolves.toMatchObject({
      status: "ready",
    });
  });
});

class MemoryPrewarmStore implements AppViewDefinitionCache {
  definitions = new Map<string, CachedAppViewDefinition>();
  entityDefinitions = new Map<string, EntityDefinition>();
  failTelemetry = false;
  offlinePreparationDiagnostics: OfflinePreparationDiagnostics | null = null;
  records = new Map<string, CachedEntityRecord[]>();
  snapshots: UpsertStateUpdateSnapshotInput[] = [];
  attendanceHydration = new Map<string, AttendanceDaySnapshotHydration>();
  telemetry = new Map<string, SyncTelemetry>();

  async getOfflinePreparationDiagnostics(_ownerKey: string) {
    return this.offlinePreparationDiagnostics;
  }

  async setOfflinePreparationDiagnostics(_ownerKey: string, diagnostics: OfflinePreparationDiagnostics) {
    if (this.failTelemetry) {
      throw new Error("telemetry unavailable");
    }

    this.offlinePreparationDiagnostics = diagnostics;
  }

  async getAppViewDefinition(ownerKey: string, contractId: string, appViewId: string) {
    return this.definitions.get(`${ownerKey}:${contractId}:${appViewId}`) ?? null;
  }

  async listAppViewDefinitions(ownerKey: string, contractId: string) {
    return [...this.definitions.values()].filter(
      (definition) => definition.ownerKey === ownerKey && definition.contractId === contractId,
    );
  }

  async reconcileAppViewDefinitions(ownerKey: string, contractId: string, assignedAppViewIds: string[]) {
    for (const [key, definition] of this.definitions) {
      if (
        definition.ownerKey === ownerKey &&
        definition.contractId === contractId &&
        !assignedAppViewIds.includes(definition.appViewId)
      ) {
        this.definitions.delete(key);
      }
    }
  }

  async upsertAppViewDefinition(input: UpsertAppViewDefinitionInput) {
    this.definitions.set(`${input.ownerKey}:${input.contractId}:${input.appViewId}`, {
      appViewId: input.appViewId,
      appViewType: input.appViewType,
      contractId: input.contractId,
      definition: input.definition,
      lastPreparedAt: input.lastPreparedAt,
      ownerKey: input.ownerKey,
      status: input.status,
      workflowKey: input.workflowKey ?? null,
    });
  }

  async upsertEntityDefinition(
    contractId: string,
    entityTypeId: string,
    definition: EntityDefinition,
    _syncedAt: string,
  ) {
    this.entityDefinitions.set(`${contractId}:${entityTypeId}`, definition);
  }

  async listCachedRecords({
    contractId,
    entityTypeId,
    ownerKey,
    page = 1,
    pageSize = 25,
  }: {
    contractId: string;
    entityTypeId: string;
    ownerKey: string;
    page?: number;
    pageSize?: number;
  }) {
    const records = this.records.get(`${ownerKey}:${contractId}:${entityTypeId}`) ?? [];

    return {
      fromCache: true,
      offline: false,
      pagination: {
        page,
        pageSize,
        total: records.length,
        totalPages: Math.max(1, Math.ceil(records.length / pageSize)),
      },
      records: records.slice((page - 1) * pageSize, page * pageSize),
    };
  }

  async reconcileRemoteRecordsSnapshot({
    contractId,
    entityTypeId,
    ownerKey,
    records,
  }: {
    contractId: string;
    entityTypeId: string;
    ownerKey: string;
    records: EntityRecord[];
  }) {
    this.records.set(`${ownerKey}:${contractId}:${entityTypeId}`, records.map((record) => ({
      ...record,
      conflictRemoteDisplayName: null,
      conflictRemoteUpdatedAt: null,
      conflictRemoteValues: null,
      localId: record.id,
      remoteUpdatedAt: record.updatedAt,
      serverId: record.id,
      syncErrorCode: null,
      syncErrorMessage: null,
      syncStatus: "synced",
    })));
  }

  async upsertStateUpdateSnapshot(input: UpsertStateUpdateSnapshotInput) {
    this.snapshots.push(input);

    return { staleSyncedRemoved: input.complete ? 1 : 0 };
  }

  async getAttendanceDaySnapshotHydration(input: AttendanceDaySnapshotScope) {
    return this.attendanceHydration.get(attendanceHydrationKey(input)) ?? null;
  }

  async markAttendanceDaySnapshotHydrated(input: AttendanceDaySnapshotScope & { refreshedAt?: string }) {
    this.attendanceHydration.set(attendanceHydrationKey(input), {
      lastSuccessfulRefreshAt: input.refreshedAt ?? new Date().toISOString(),
    });
  }

  async getSyncTelemetry(scope: SyncTelemetryScope) {
    return this.telemetry.get(telemetryKey(scope)) ?? null;
  }

  async markSyncPhase(input: SyncTelemetryScope & { attemptedAt?: string; phase: SyncPhase }) {
    const current = this.telemetry.get(telemetryKey(input)) ?? emptySyncTelemetry(input);

    this.telemetry.set(telemetryKey(input), {
      ...current,
      lastSyncAttemptAt: input.attemptedAt ?? new Date().toISOString(),
      syncPhase: input.phase,
    });
  }

  async markSyncPhaseCompleted(input: SyncTelemetryScope & { completedAt?: string; phase: SyncErrorPhase }) {
    const current = this.telemetry.get(telemetryKey(input)) ?? emptySyncTelemetry(input);
    const completedAt = input.completedAt ?? new Date().toISOString();

    this.telemetry.set(telemetryKey(input), {
      ...current,
      lastFullRefreshCompletedAt: input.phase === "refreshing" ? completedAt : current.lastFullRefreshCompletedAt,
      lastReconcileCompletedAt: input.phase === "reconciling" ? completedAt : current.lastReconcileCompletedAt,
      lastSuccessfulSyncAt: input.phase === "reconciling" ? completedAt : current.lastSuccessfulSyncAt,
      lastSyncErrorAt: null,
      lastSyncErrorCode: null,
      lastSyncErrorPhase: null,
      syncPhase: "idle",
    });
  }
}

function telemetryKey(scope: SyncTelemetryScope) {
  return `${scope.ownerKey}:${scope.contractId}:${scope.entityTypeId}`;
}

function attendanceHydrationKey(scope: AttendanceDaySnapshotScope) {
  return `${scope.ownerKey}:${scope.contractId}:${scope.appViewId}:${scope.targetEntityTypeId}:${scope.date}`;
}

function attendanceWorkflowResponse(date: string): AttendanceResponse {
  return {
    appView: { id: "view_workflow", name: "Tomar asistencia", slug: "tomar-asistencia" },
    date,
    items: [],
    latest: [],
    sourceEntityType: { id: "entity_people", name: "Personas" },
    statuses: [
      { isDefaultCheckIn: true, label: "Presente", optionId: "status_present" },
    ],
    summary: { totalRegistered: 0 },
    targetEntityType: { id: "entity_attendance", name: "Asistencias" },
  };
}

function formatLocalDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
