import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppViewDefinitionCache, CachedAppViewDefinition, UpsertAppViewDefinitionInput } from "./app-view-definitions-cache";
import { prewarmAssignedAppViewsOnce } from "./app-view-prewarm";
import { EntityDefinition, OpcoNetworkError } from "./opco-api";
import { appViewsFixture, entityDefinitionFixture } from "../test/fixtures";

describe("app view prewarm", () => {
  let store: MemoryPrewarmStore;

  beforeEach(() => {
    store = new MemoryPrewarmStore();
  });

  it("prepares records definitions and attendance statuses without downloading records", async () => {
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
      getEntityDefinition: vi.fn(async () => ({ entity: entityDefinitionFixture })),
      getEntityRecords: vi.fn(),
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
    expect(api.getEntityRecords).not.toHaveBeenCalled();
    await expect(store.getAppViewDefinition("org_1:user_1", "contract_1", "view_records")).resolves.toMatchObject({
      definition: { kind: "records" },
      status: "ready",
    });
    await expect(store.getAppViewDefinition("org_1:user_1", "contract_1", "view_workflow")).resolves.toMatchObject({
      definition: {
        kind: "attendance",
        statuses: [
          { isDefaultCheckIn: true, label: "Presente", optionId: "status_present" },
          { isDefaultCheckIn: false, label: "Ausente", optionId: "status_absent" },
        ],
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
      getEntityDefinition: vi.fn(async () => ({ entity: entityDefinitionFixture })),
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

    expect(api.getEntityDefinition).toHaveBeenCalledOnce();
  });

  it("keeps a previous ready definition when a later prewarm hits a network error", async () => {
    const api = {
      getAttendanceWorkflow: vi.fn(async () => {
        throw new OpcoNetworkError();
      }),
      getEntityDefinition: vi
        .fn()
        .mockResolvedValueOnce({ entity: entityDefinitionFixture })
        .mockRejectedValueOnce(new OpcoNetworkError()),
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
      getEntityDefinition: vi.fn(async () => ({ entity: entityDefinitionFixture })),
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
}
