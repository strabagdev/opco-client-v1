import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppViewDefinitionCache, CachedAppViewDefinition, UpsertAppViewDefinitionInput } from "./app-view-definitions-cache";
import {
  OFFLINE_PREPARATION_SLOW_THRESHOLD_MS,
  OfflinePreparationDiagnostics,
  prewarmAssignedAppViewsOnce,
} from "./app-view-prewarm";
import { CachedEntityRecord } from "./offline-records";
import { EntityDefinition, EntityRecord, OpcoNetworkError } from "./opco-api";
import { emptySyncTelemetry, SyncErrorPhase, SyncPhase, SyncTelemetry, SyncTelemetryScope } from "./sync-telemetry";
import { appViewsFixture, entityDefinitionFixture } from "../test/fixtures";

describe("app view prewarm", () => {
  let store: MemoryPrewarmStore;

  beforeEach(() => {
    store = new MemoryPrewarmStore();
    vi.useRealTimers();
  });

  it("prepares records definitions and attendance statuses, then prefetches attendance source records", async () => {
    const api = {
      getAttendanceWorkflow: vi.fn(async () => ({
        appView: { id: "view_workflow", name: "Tomar asistencia", slug: "tomar-asistencia" },
        date: "2026-08-25",
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
    expect(api.getAttendanceWorkflow).toHaveBeenCalledOnce();
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
      },
      status: "ready",
    });
  });

  it("does not duplicate concurrent prewarm triggers for the same owner and contract", async () => {
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

    expect(api.getAttendanceWorkflow).toHaveBeenCalledOnce();
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
