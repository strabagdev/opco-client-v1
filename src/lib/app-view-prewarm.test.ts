import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppViewDefinitionCache, CachedAppViewDefinition, UpsertAppViewDefinitionInput } from "./app-view-definitions-cache";
import { prewarmAssignedAppViewsOnce } from "./app-view-prewarm";
import { CachedEntityRecord } from "./offline-records";
import { EntityDefinition, EntityRecord, OpcoNetworkError } from "./opco-api";
import { appViewsFixture, entityDefinitionFixture } from "../test/fixtures";

describe("app view prewarm", () => {
  let store: MemoryPrewarmStore;

  beforeEach(() => {
    store = new MemoryPrewarmStore();
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
  records = new Map<string, CachedEntityRecord[]>();

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
}
