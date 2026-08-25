import { beforeEach, describe, expect, it } from "vitest";

import {
  OfflineRecordStore,
  PendingOperation,
  fingerprintRecordsScope,
  loadRecordWithOfflineCache,
  loadRecordsWithOfflineCache,
  refreshEntityRecordsCache,
} from "./offline-records";
import { EntityRecord, EntityRecordValue, OpcoApiError, OpcoNetworkError } from "./opco-api";
import { SyncTelemetry, SyncTelemetryScope, emptySyncTelemetry } from "./sync-telemetry";

const scope = {
  contractId: "contract_1",
  entityTypeId: "entity_1",
  ownerKey: "org_1:user_1",
};

let store: MemoryRecordStore;

beforeEach(() => {
  store = new MemoryRecordStore();
});

describe("offline records cache", () => {
  it("stores remote records and reads them back from cache", async () => {
    await store.upsertRemoteRecords({
      ...scope,
      records: [record("record_1", "Equipo 1", { codigo: "EQ-1" })],
    });

    const result = await store.listCachedRecords(scope);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      id: "record_1",
      serverId: "record_1",
      syncStatus: "synced",
    });
  });

  it("falls back to cached records when remote listing fails by network", async () => {
    await store.upsertRemoteRecords({
      ...scope,
      records: [record("record_1", "Equipo 1", { codigo: "EQ-1" })],
    });

    const result = await loadRecordsWithOfflineCache({
      ...scope,
      api: {
        getEntityRecords: async () => {
          throw new OpcoNetworkError();
        },
      },
      store,
      token: "token_1",
    });

    expect(result.offline).toBe(true);
    expect(result.records[0].id).toBe("record_1");
  });

  it("falls back to cached detail when remote detail fails by network", async () => {
    await store.upsertRemoteRecords({
      ...scope,
      records: [record("record_1", "Equipo 1", { codigo: "EQ-1" })],
    });

    const result = await loadRecordWithOfflineCache({
      ...scope,
      api: {
        getEntityRecord: async () => {
          throw new OpcoNetworkError();
        },
      },
      recordId: "record_1",
      store,
      token: "token_1",
    });

    expect(result.offline).toBe(true);
    expect(result.fromCache).toBe(true);
    expect(result.record?.id).toBe("record_1");
  });

  it("does not use synced cached detail when the API returns an auth error", async () => {
    await store.upsertRemoteRecords({
      ...scope,
      records: [record("record_1", "Equipo 1", { codigo: "EQ-1" })],
    });

    await expect(
      loadRecordWithOfflineCache({
        ...scope,
        api: {
          getEntityRecord: async () => {
            throw new OpcoApiError("Token invalido.", "TOKEN_INVALID", 401);
          },
        },
        recordId: "record_1",
        store,
        token: "token_1",
      }),
    ).rejects.toMatchObject({ code: "TOKEN_INVALID", status: 401 });
  });

  it("does not lose pending local records when remote records refresh", async () => {
    await store.createLocalRecord({
      ...scope,
      clientRequestId: "request_1",
      localId: "local_1",
      values: { codigo: "LOCAL" },
    });

    await loadRecordsWithOfflineCache({
      ...scope,
      api: {
        getEntityRecords: async () => ({
          pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
          records: [record("record_1", "Equipo 1", { codigo: "EQ-1" })],
        }),
      },
      store,
      token: "token_1",
    });

    const result = await store.listCachedRecords(scope);

    expect(result.records.map((item) => item.id).sort()).toEqual(["local_1", "record_1"]);
  });

  it("removes synced records missing from a completed full remote refresh", async () => {
    await store.upsertRemoteRecords({
      ...scope,
      records: [
        record("record_1", "Equipo 1", { codigo: "EQ-1" }),
        record("record_2", "Equipo 2", { codigo: "EQ-2" }),
        record("record_3", "Equipo 3", { codigo: "EQ-3" }),
      ],
    });

    await refreshEntityRecordsCache({
      ...scope,
      api: {
        getEntityRecords: async () => ({
          pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
          records: [
            record("record_1", "Equipo 1", { codigo: "EQ-1" }),
            record("record_3", "Equipo 3", { codigo: "EQ-3" }),
          ],
        }),
      },
      store,
      token: "token_1",
    });

    const result = await store.listCachedRecords(scope);

    expect(result.records.map((item) => item.id).sort()).toEqual(["record_1", "record_3"]);
  });

  it("removes all synced records when a completed full remote refresh is empty", async () => {
    await store.upsertRemoteRecords({
      ...scope,
      records: Array.from({ length: 10 }, (_, index) =>
        record(`record_${index + 1}`, `Equipo ${index + 1}`, { codigo: `EQ-${index + 1}` }),
      ),
    });

    await refreshEntityRecordsCache({
      ...scope,
      api: {
        getEntityRecords: async () => ({
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 },
          records: [],
        }),
      },
      store,
      token: "token_1",
    });

    const result = await store.listCachedRecords(scope);

    expect(result.records).toEqual([]);
  });

  it("keeps pending local records when a completed full remote refresh is empty", async () => {
    await store.upsertRemoteRecords({
      ...scope,
      records: [record("record_1", "Equipo 1", { codigo: "EQ-1" })],
    });
    await store.createLocalRecord({
      ...scope,
      clientRequestId: "request_1",
      localId: "local_1",
      values: { codigo: "LOCAL" },
    });

    await refreshEntityRecordsCache({
      ...scope,
      api: {
        getEntityRecords: async () => ({
          pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 },
          records: [],
        }),
      },
      store,
      token: "token_1",
    });

    const result = await store.listCachedRecords(scope);

    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ id: "local_1", syncStatus: "pending_create" });
  });

  it("does not reconcile destructive cache cleanup when a full remote refresh fails mid-pagination", async () => {
    await store.upsertRemoteRecords({
      ...scope,
      records: [
        record("record_1", "Equipo 1", { codigo: "EQ-1" }),
        record("record_2", "Equipo 2", { codigo: "EQ-2" }),
      ],
    });

    await expect(
      refreshEntityRecordsCache({
        ...scope,
        api: {
          getEntityRecords: async (_token, _contractId, _entityTypeId, query) => {
            if (query?.page === 2) {
              throw new OpcoApiError("Fallo remoto.", "SERVER_ERROR", 500);
            }

            return {
              pagination: { page: 1, pageSize: 100, total: 2, totalPages: 2 },
              records: [record("record_1", "Equipo 1", { codigo: "EQ-1" })],
            };
          },
        },
        store,
        token: "token_1",
      }),
    ).rejects.toMatchObject({ code: "SERVER_ERROR" });

    const result = await store.listCachedRecords(scope);

    expect(result.records.map((item) => item.id).sort()).toEqual(["record_1", "record_2"]);
    const telemetry = await store.getSyncTelemetry(scope);

    expect(telemetry).toMatchObject({
      lastFullRefreshCompletedAt: null,
      lastSyncErrorCode: "SERVER",
      lastSyncErrorPhase: "refreshing",
      syncPhase: "error",
    });
  });

  it("reconciles a 388-record remote snapshot across four refresh pages", async () => {
    const remoteRecords = Array.from({ length: 388 }, (_, index) =>
      record(`persona_${index + 1}`, `Persona ${index + 1}`, {
        nombre: `Persona ${index + 1}`,
      }),
    );
    const requestedPages: number[] = [];
    const diagnosticsSnapshots: unknown[] = [];

    await refreshEntityRecordsCache({
      ...scope,
      entityTypeId: "personas",
      api: {
        getEntityRecords: async (_token, _contractId, _entityTypeId, query) => {
          const page = query?.page ?? 1;
          const pageSize = query?.pageSize ?? 100;
          const start = (page - 1) * pageSize;

          requestedPages.push(page);

          return {
            pagination: {
              page,
              pageSize,
              total: remoteRecords.length,
              totalPages: Math.ceil(remoteRecords.length / pageSize),
            },
            records: remoteRecords.slice(start, start + pageSize),
          };
        },
      },
      onDiagnostics: (diagnostics) => diagnosticsSnapshots.push(diagnostics),
      store,
      token: "token_1",
    });

    const result = await store.listCachedRecords({ ...scope, entityTypeId: "personas" });
    const telemetry = await store.getSyncTelemetry({ ...scope, entityTypeId: "personas" });

    expect(requestedPages).toEqual([1, 2, 3, 4]);
    expect(diagnosticsSnapshots).toHaveLength(2);
    expect(diagnosticsSnapshots[1]).toMatchObject({
      afterReconcile: {
        synced: 388,
        total: 388,
      },
      afterUpsert: {
        synced: 388,
        total: 388,
      },
      beforeRender: {
        synced: 388,
        total: 388,
      },
      lastHttpStatus: 200,
      pages: [
        { count: 100, page: 1, pageSize: 100 },
        { count: 100, page: 2, pageSize: 100 },
        { count: 100, page: 3, pageSize: 100 },
        { count: 88, page: 4, pageSize: 100 },
      ],
      recordsFetched: 388,
      remoteTotal: 388,
      totalPages: 4,
      writeScope: fingerprintRecordsScope({ ...scope, entityTypeId: "personas" }),
      reconcileScope: fingerprintRecordsScope({ ...scope, entityTypeId: "personas" }),
      readScope: fingerprintRecordsScope({ ...scope, entityTypeId: "personas" }),
    });
    expect(result.pagination.total).toBe(388);
    expect(result.records).toHaveLength(388);
    expect(telemetry).toMatchObject({
      lastSyncErrorCode: null,
      syncPhase: "idle",
    });
  });

  it("records refresh and reconcile completion telemetry", async () => {
    await refreshEntityRecordsCache({
      ...scope,
      api: {
        getEntityRecords: async () => ({
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
          records: [record("record_1", "Equipo 1", { codigo: "EQ-1" })],
        }),
      },
      store,
      token: "token_1",
    });

    const telemetry = await store.getSyncTelemetry(scope);

    expect(telemetry).toMatchObject({
      lastSyncErrorCode: null,
      lastSyncErrorPhase: null,
      syncPhase: "idle",
    });
    expect(telemetry?.lastFullRefreshCompletedAt).toBeTruthy();
    expect(telemetry?.lastReconcileCompletedAt).toBeTruthy();
    expect(telemetry?.lastSuccessfulSyncAt).toBe(telemetry?.lastReconcileCompletedAt);
  });

  it("does not mark a remote refresh successful when reconcile leaves an impossible empty local snapshot", async () => {
    store.forceEmptyReconcileDiagnostics = true;

    await expect(refreshEntityRecordsCache({
      ...scope,
      api: {
        getEntityRecords: async () => ({
          pagination: { page: 1, pageSize: 100, total: 388, totalPages: 1 },
          records: [record("persona_1", "Persona 1", { nombre: "Persona 1" })],
        }),
      },
      store,
      token: "token_1",
    })).rejects.toThrow("cache local quedo sin registros sincronizados");

    const telemetry = await store.getSyncTelemetry(scope);

    expect(telemetry).toMatchObject({
      lastSuccessfulSyncAt: null,
      lastSyncErrorCode: "SQLITE",
      lastSyncErrorPhase: "reconciling",
      syncPhase: "error",
    });
  });

  it("records offline refresh as error without pretending success", async () => {
    await store.upsertRemoteRecords({
      ...scope,
      records: [record("record_1", "Equipo 1", { codigo: "EQ-1" })],
    });

    const result = await refreshEntityRecordsCache({
      ...scope,
      api: {
        getEntityRecords: async () => {
          throw new OpcoNetworkError();
        },
      },
      store,
      token: "token_1",
    });
    const telemetry = await store.getSyncTelemetry(scope);

    expect(result.offline).toBe(true);
    expect(telemetry).toMatchObject({
      lastSuccessfulSyncAt: null,
      lastSyncErrorCode: "NETWORK",
      lastSyncErrorPhase: "refreshing",
      syncPhase: "error",
    });
  });

  it("can suppress known-offline network refresh telemetry noise", async () => {
    await store.upsertRemoteRecords({
      ...scope,
      records: [record("record_1", "Equipo 1", { codigo: "EQ-1" })],
    });

    await refreshEntityRecordsCache({
      ...scope,
      api: {
        getEntityRecords: async () => {
          throw new OpcoNetworkError();
        },
      },
      store,
      suppressNetworkTelemetry: true,
      token: "token_1",
    });

    await expect(store.getSyncTelemetry(scope)).resolves.toBeNull();
  });

  it("isolates sync telemetry by owner key", async () => {
    await refreshEntityRecordsCache({
      ...scope,
      api: {
        getEntityRecords: async () => ({
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
          records: [record("record_1", "Equipo 1", { codigo: "EQ-1" })],
        }),
      },
      store,
      token: "token_1",
    });

    await expect(store.getSyncTelemetry({ ...scope, ownerKey: "org_1:user_2" })).resolves.toBeNull();
  });

  it("keeps successful sync timestamps independent between entity types in the same contract", async () => {
    await refreshEntityRecordsCache({
      ...scope,
      entityTypeId: "personas",
      api: {
        getEntityRecords: async () => ({
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
          records: [record("persona_1", "Persona 1", { nombre: "Ana" })],
        }),
      },
      store,
      token: "token_1",
    });

    const personas = await store.getSyncTelemetry({ ...scope, entityTypeId: "personas" });
    const materiales = await store.getSyncTelemetry({ ...scope, entityTypeId: "materiales" });

    expect(personas?.lastSuccessfulSyncAt).toBeTruthy();
    expect(materiales).toBeNull();
  });

  it("refresh failure affects only the current entity type telemetry", async () => {
    await refreshEntityRecordsCache({
      ...scope,
      entityTypeId: "personas",
      api: {
        getEntityRecords: async () => ({
          pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
          records: [record("persona_1", "Persona 1", { nombre: "Ana" })],
        }),
      },
      store,
      token: "token_1",
    });

    await expect(
      refreshEntityRecordsCache({
        ...scope,
        entityTypeId: "materiales",
        api: {
          getEntityRecords: async () => {
            throw new OpcoApiError("Fallo remoto.", "SERVER_ERROR", 500);
          },
        },
        store,
        token: "token_1",
      }),
    ).rejects.toMatchObject({ code: "SERVER_ERROR" });

    await expect(store.getSyncTelemetry({ ...scope, entityTypeId: "personas" })).resolves.toMatchObject({
      syncPhase: "idle",
      lastSyncErrorCode: null,
    });
    await expect(store.getSyncTelemetry({ ...scope, entityTypeId: "materiales" })).resolves.toMatchObject({
      syncPhase: "error",
      lastSyncErrorPhase: "refreshing",
    });
  });

  it("restores telemetry for the current app view entity type", async () => {
    store.telemetry.set(telemetryKey({ ...scope, entityTypeId: "personas" }), {
      ...emptySyncTelemetry({ ...scope, entityTypeId: "personas" }),
      lastSuccessfulSyncAt: "2026-08-24T16:32:00.000Z",
      syncPhase: "idle",
    });
    store.telemetry.set(telemetryKey({ ...scope, entityTypeId: "materiales" }), {
      ...emptySyncTelemetry({ ...scope, entityTypeId: "materiales" }),
      lastSuccessfulSyncAt: "2026-08-24T15:01:00.000Z",
      syncPhase: "idle",
    });

    await expect(store.getSyncTelemetry({ ...scope, entityTypeId: "personas" })).resolves.toMatchObject({
      entityTypeId: "personas",
      lastSuccessfulSyncAt: "2026-08-24T16:32:00.000Z",
    });
  });

  it("creates offline records immediately with a pending CREATE", async () => {
    const created = await store.createLocalRecord({
      ...scope,
      clientRequestId: "request_1",
      localId: "local_1",
      values: { codigo: "EQ-local" },
    });

    expect(created).toMatchObject({ id: "local_1", serverId: null, syncStatus: "pending_create" });
    expect(await store.countPendingOperations(scope.ownerKey)).toBe(1);
    expect((await store.listPendingOperations(scope.ownerKey))[0].clientRequestId).toBe("request_1");
  });

  it("merges updates into a pending CREATE instead of adding UPDATE", async () => {
    await store.createLocalRecord({
      ...scope,
      clientRequestId: "request_1",
      localId: "local_1",
      values: { codigo: "EQ-local" },
    });

    await store.updateLocalRecord({
      ...scope,
      recordId: "local_1",
      values: { estado: "operativo" },
    });

    const operations = await store.listPendingOperations(scope.ownerKey);

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ clientRequestId: "request_1", operation: "CREATE" });
    expect(operations[0].payload.values).toMatchObject({ codigo: "EQ-local", estado: "operativo" });
  });

  it("consolidates multiple UPDATE operations into the final state", async () => {
    await store.upsertRemoteRecords({
      ...scope,
      records: [record("record_1", "Equipo 1", { codigo: "EQ-1", estado: "nuevo" })],
    });

    await store.updateLocalRecord({ ...scope, recordId: "record_1", values: { estado: "operativo" } });
    await store.updateLocalRecord({ ...scope, recordId: "record_1", values: { estado: "mantencion" } });

    const operations = await store.listPendingOperations(scope.ownerKey);

    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ operation: "UPDATE", serverRecordId: "record_1" });
    expect(operations[0].payload.values).toMatchObject({ codigo: "EQ-1", estado: "mantencion" });
  });

  it("stores remote updatedAt as base version and keeps it during local edits", async () => {
    await store.upsertRemoteRecords({
      ...scope,
      records: [record("record_1", "Equipo 1", { codigo: "EQ-1", estado: "nuevo" })],
    });

    const base = await store.getCachedRecord({ ...scope, recordId: "record_1" });

    await store.updateLocalRecord({ ...scope, recordId: "record_1", values: { estado: "local" } });

    const edited = await store.getCachedRecord({ ...scope, recordId: "record_1" });

    expect(base?.remoteUpdatedAt).toBe("2026-08-20T12:00:00.000Z");
    expect(edited?.remoteUpdatedAt).toBe("2026-08-20T12:00:00.000Z");
    expect(edited?.values).toMatchObject({ estado: "local" });
  });

  it("resolves conflict with local by refreshing base and returning to pending update", async () => {
    await store.upsertRemoteRecords({
      ...scope,
      records: [record("record_1", "Equipo 1", { codigo: "EQ-1", estado: "opco" })],
    });
    await store.updateLocalRecord({ ...scope, recordId: "record_1", values: { estado: "local" } });

    const existing = await store.getCachedRecord({ ...scope, recordId: "record_1" });

    store.records.set(key(scope.ownerKey, scope.contractId, scope.entityTypeId, existing!.localId), {
      ...existing!,
      conflictRemoteUpdatedAt: "2026-08-20T13:00:00.000Z",
      conflictRemoteValues: { codigo: "EQ-1", estado: "opco" },
      syncStatus: "conflict",
    });

    const resolved = await store.resolveRecordConflictWithLocal({
      ...scope,
      api: {
        getEntityRecord: async () => ({ record: { ...record("record_1", "Equipo 1", { estado: "opco-2" }), updatedAt: "2026-08-20T14:00:00.000Z" } }),
      },
      recordId: "record_1",
      token: "token_1",
    });

    expect(resolved.syncStatus).toBe("pending_update");
    expect(resolved.remoteUpdatedAt).toBe("2026-08-20T14:00:00.000Z");
    expect(resolved.values).toMatchObject({ estado: "local" });
  });

  it("resolves conflict with remote by discarding local update and removing pending operation", async () => {
    await store.upsertRemoteRecords({
      ...scope,
      records: [record("record_1", "Equipo 1", { codigo: "EQ-1", estado: "opco" })],
    });
    await store.updateLocalRecord({ ...scope, recordId: "record_1", values: { estado: "local" } });

    const existing = await store.getCachedRecord({ ...scope, recordId: "record_1" });

    store.records.set(key(scope.ownerKey, scope.contractId, scope.entityTypeId, existing!.localId), {
      ...existing!,
      conflictRemoteUpdatedAt: "2026-08-20T13:00:00.000Z",
      conflictRemoteValues: { codigo: "EQ-1", estado: "opco" },
      syncStatus: "conflict",
    });

    const resolved = await store.resolveRecordConflictWithRemote({
      ...scope,
      api: {
        getEntityRecord: async () => ({ record: { ...record("record_1", "Equipo 1", { estado: "opco-2" }), updatedAt: "2026-08-20T14:00:00.000Z" } }),
      },
      recordId: "record_1",
      token: "token_1",
    });

    expect(resolved.syncStatus).toBe("synced");
    expect(resolved.values).toEqual({ estado: "opco-2" });
    expect(await store.listPendingOperations(scope.ownerKey)).toEqual([]);
  });

  it("retries failed records manually and reports summary counts", async () => {
    await store.createLocalRecord({
      ...scope,
      clientRequestId: "request_1",
      localId: "local_1",
      values: { codigo: "LOCAL" },
    });
    const existing = await store.getCachedRecord({ ...scope, recordId: "local_1" });

    store.records.set(key(scope.ownerKey, scope.contractId, scope.entityTypeId, existing!.localId), {
      ...existing!,
      syncErrorMessage: "Fallo",
      syncStatus: "failed",
    });

    expect((await store.getRecordsSyncSummary(scope)).failedCount).toBe(1);

    const retried = await store.retryFailedRecord({ ...scope, recordId: "local_1" });

    expect(retried.syncStatus).toBe("pending_create");
    expect((await store.getRecordsSyncSummary(scope)).pendingCount).toBe(1);
  });

  it("isolates records by owner key", async () => {
    await store.upsertRemoteRecords({
      ...scope,
      records: [record("record_1", "Equipo 1", { codigo: "A" })],
    });

    const otherUser = await store.listCachedRecords({ ...scope, ownerKey: "org_1:user_2" });

    expect(otherUser.records).toEqual([]);
  });
});

function record(id: string, displayName: string, values: Record<string, EntityRecordValue>): EntityRecord {
  return {
    displayName,
    id,
    updatedAt: "2026-08-20T12:00:00.000Z",
    values,
  };
}

class MemoryRecordStore implements OfflineRecordStore {
  forceEmptyReconcileDiagnostics = false;
  records = new Map<string, Awaited<ReturnType<OfflineRecordStore["createLocalRecord"]>>>();
  operations = new Map<string, PendingOperation>();
  telemetry = new Map<string, SyncTelemetry>();

  async countPendingOperations(ownerKey: string) {
    return [...this.operations.values()].filter((operation) => operation.ownerKey === ownerKey).length;
  }

  async createLocalRecord(input: Parameters<OfflineRecordStore["createLocalRecord"]>[0]) {
    const localId = input.localId ?? "local_generated";
    const now = new Date().toISOString();
    const cached = {
      displayName: String(Object.values(input.values)[0] ?? "Registro sin nombre"),
      id: localId,
      localId,
      remoteUpdatedAt: null,
      serverId: null,
      syncStatus: "pending_create" as const,
      updatedAt: now,
      values: input.values,
    };

    this.records.set(key(input.ownerKey, input.contractId, input.entityTypeId, localId), cached);
    this.operations.set(`CREATE:${localId}`, {
      attempts: 0,
      clientRequestId: input.clientRequestId ?? "request_generated",
      contractId: input.contractId,
      createdAt: now,
      entityTypeId: input.entityTypeId,
      id: `CREATE:${localId}`,
      lastErrorCode: null,
      lastErrorMessage: null,
      localRecordId: localId,
      operation: "CREATE",
      ownerKey: input.ownerKey,
      payload: {
        clientRequestId: input.clientRequestId,
        values: input.values,
      },
      serverRecordId: null,
      updatedAt: now,
    });

    return cached;
  }

  async getCachedRecord(input: Parameters<OfflineRecordStore["getCachedRecord"]>[0]) {
    return (
      [...this.records.values()].find(
        (item) =>
          item.localId === input.recordId &&
          item.localId.startsWith("local_") &&
          this.recordMatches(item, input.ownerKey, input.contractId, input.entityTypeId),
      ) ??
      [...this.records.values()].find(
        (item) =>
          (item.localId === input.recordId || item.serverId === input.recordId) &&
          this.recordMatches(item, input.ownerKey, input.contractId, input.entityTypeId),
      ) ??
      null
    );
  }

  async listCachedRecords(input: Parameters<OfflineRecordStore["listCachedRecords"]>[0]) {
    const records = [...this.records.values()].filter((item) =>
      this.recordMatches(item, input.ownerKey, input.contractId, input.entityTypeId),
    );

    return {
      fromCache: true,
      offline: false,
      pagination: { page: 1, pageSize: 25, total: records.length, totalPages: 1 },
      records,
    };
  }

  async updateLocalRecord(input: Parameters<OfflineRecordStore["updateLocalRecord"]>[0]) {
    const existing = await this.getCachedRecord(input);

    if (!existing) {
      throw new Error("missing");
    }

    const values = { ...existing.values, ...input.values };
    const cached = {
      ...existing,
      displayName: String(Object.values(values)[0] ?? existing.displayName),
      syncStatus: this.operations.has(`CREATE:${existing.localId}`) ? ("pending_create" as const) : ("pending_update" as const),
      values,
    };

    this.records.set(key(input.ownerKey, input.contractId, input.entityTypeId, existing.localId), cached);

    const createOperation = this.operations.get(`CREATE:${existing.localId}`);

    if (createOperation) {
      createOperation.payload.values = values;
      return cached;
    }

    this.operations.set(`UPDATE:${existing.localId}`, {
      attempts: 0,
      clientRequestId: "update_request",
      contractId: input.contractId,
      createdAt: new Date().toISOString(),
      entityTypeId: input.entityTypeId,
      id: `UPDATE:${existing.localId}`,
      lastErrorCode: null,
      lastErrorMessage: null,
      localRecordId: existing.localId,
      operation: "UPDATE",
      ownerKey: input.ownerKey,
      payload: { values },
      serverRecordId: existing.serverId,
      updatedAt: new Date().toISOString(),
    });

    return cached;
  }

  async upsertRemoteRecords(input: Parameters<OfflineRecordStore["upsertRemoteRecords"]>[0]) {
    input.records.forEach((remote) => {
      this.records.set(key(input.ownerKey, input.contractId, input.entityTypeId, remote.id), {
        ...remote,
        localId: remote.id,
        remoteUpdatedAt: remote.updatedAt,
        serverId: remote.id,
        syncStatus: "synced",
      });
    });
  }

  async reconcileRemoteRecordsSnapshot(input: Parameters<OfflineRecordStore["reconcileRemoteRecordsSnapshot"]>[0]) {
    await this.upsertRemoteRecords(input);
    const afterUpsert = await this.getRecordCacheStatusCounts(input);

    const seenServerIds = new Set(input.records.map((remote) => remote.id));

    [...this.records.entries()].forEach(([recordKey, cached]) => {
      if (!this.recordMatches(cached, input.ownerKey, input.contractId, input.entityTypeId)) {
        return;
      }

      if (cached.syncStatus !== "synced") {
        return;
      }

      if (cached.serverId && seenServerIds.has(cached.serverId)) {
        return;
      }

      this.records.delete(recordKey);
    });

    const scopeFingerprint = fingerprintRecordsScope(input);
    const afterReconcile = this.forceEmptyReconcileDiagnostics
      ? { conflict: 0, failed: 0, pendingCreate: 0, pendingUpdate: 0, synced: 0, total: 0 }
      : await this.getRecordCacheStatusCounts(input);

    return {
      afterReconcile,
      afterUpsert,
      reconcileScope: scopeFingerprint,
      writeScope: scopeFingerprint,
    };
  }

  async listPendingOperations(ownerKey: string) {
    return [...this.operations.values()].filter((operation) => operation.ownerKey === ownerKey);
  }

  async getRecordsSyncSummary(input: Parameters<OfflineRecordStore["getRecordsSyncSummary"]>[0]) {
    const records = [...this.records.entries()]
      .filter(([recordKey]) => recordKey.startsWith(`${input.ownerKey}:${input.contractId}:`))
      .map(([, recordItem]) => recordItem);
    const count = (...statuses: string[]) => records.filter((item) => statuses.includes(item.syncStatus)).length;

    return {
      conflictCount: count("conflict"),
      failedCount: count("failed"),
      pendingCount: count("pending_create", "pending_update"),
      syncingCount: count("syncing"),
    };
  }

  async getRecordCacheStatusCounts(input: Parameters<OfflineRecordStore["getRecordCacheStatusCounts"]>[0]) {
    const records = [...this.records.values()].filter((item) =>
      this.recordMatches(item, input.ownerKey, input.contractId, input.entityTypeId),
    );
    const count = (...statuses: string[]) => records.filter((item) => statuses.includes(item.syncStatus)).length;

    return {
      conflict: count("conflict"),
      failed: count("failed"),
      pendingCreate: count("pending_create"),
      pendingUpdate: count("pending_update"),
      synced: count("synced"),
      total: records.length,
    };
  }

  async listProblemRecords(input: Parameters<OfflineRecordStore["listProblemRecords"]>[0]) {
    return [...this.records.values()].filter((item) =>
      this.recordMatches(item, input.ownerKey, input.contractId, input.entityTypeId) &&
      (item.syncStatus === "failed" || item.syncStatus === "conflict")
    );
  }

  async getSyncTelemetry(scopeInput: SyncTelemetryScope) {
    return this.telemetry.get(telemetryKey(scopeInput)) ?? null;
  }

  async markSyncError(input: SyncTelemetryScope & { code: SyncTelemetry["lastSyncErrorCode"]; phase: NonNullable<SyncTelemetry["lastSyncErrorPhase"]> }) {
    const current = this.ensureTelemetry(input);

    this.telemetry.set(telemetryKey(input), {
      ...current,
      lastSyncErrorAt: new Date().toISOString(),
      lastSyncErrorCode: input.code,
      lastSyncErrorPhase: input.phase,
      syncPhase: "error",
    });
  }

  async markSyncPhase(input: SyncTelemetryScope & { attemptedAt?: string; phase: SyncTelemetry["syncPhase"] }) {
    const current = this.ensureTelemetry(input);

    this.telemetry.set(telemetryKey(input), {
      ...current,
      lastSyncAttemptAt: input.attemptedAt ?? current.lastSyncAttemptAt,
      lastSyncErrorAt: null,
      lastSyncErrorCode: null,
      lastSyncErrorPhase: null,
      syncPhase: input.phase,
    });
  }

  async markSyncPhaseCompleted(input: SyncTelemetryScope & { phase: NonNullable<SyncTelemetry["lastSyncErrorPhase"]> }) {
    const current = this.ensureTelemetry(input);
    const now = new Date().toISOString();

    this.telemetry.set(telemetryKey(input), {
      ...current,
      lastFullRefreshCompletedAt: input.phase === "refreshing" ? now : current.lastFullRefreshCompletedAt,
      lastPushCompletedAt: input.phase === "pushing" ? now : current.lastPushCompletedAt,
      lastReconcileCompletedAt: input.phase === "reconciling" ? now : current.lastReconcileCompletedAt,
      lastSuccessfulSyncAt: input.phase === "reconciling" ? now : current.lastSuccessfulSyncAt,
      lastSyncErrorAt: null,
      lastSyncErrorCode: null,
      lastSyncErrorPhase: null,
      syncPhase: "idle",
    });
  }

  async retryFailedRecord(input: Parameters<OfflineRecordStore["retryFailedRecord"]>[0]) {
    const existing = await this.getCachedRecord(input);

    if (!existing) {
      throw new Error("missing");
    }

    const cached = {
      ...existing,
      syncStatus: this.operations.has(`CREATE:${existing.localId}`) ? ("pending_create" as const) : ("pending_update" as const),
      syncErrorCode: null,
      syncErrorMessage: null,
    };

    this.records.set(key(input.ownerKey, input.contractId, input.entityTypeId, existing.localId), cached);

    return cached;
  }

  async resolveRecordConflictWithLocal(input: Parameters<OfflineRecordStore["resolveRecordConflictWithLocal"]>[0]) {
    const existing = await this.getCachedRecord(input);

    if (!existing) {
      throw new Error("missing");
    }

    const remote = await input.api.getEntityRecord(input.token, input.contractId, input.entityTypeId, existing.serverId ?? existing.id);
    const cached = {
      ...existing,
      conflictRemoteDisplayName: null,
      conflictRemoteUpdatedAt: null,
      conflictRemoteValues: null,
      remoteUpdatedAt: remote.record.updatedAt,
      syncStatus: "pending_update" as const,
      syncErrorCode: null,
      syncErrorMessage: null,
    };

    this.records.set(key(input.ownerKey, input.contractId, input.entityTypeId, existing.localId), cached);

    return cached;
  }

  async resolveRecordConflictWithRemote(input: Parameters<OfflineRecordStore["resolveRecordConflictWithRemote"]>[0]) {
    const existing = await this.getCachedRecord(input);

    if (!existing) {
      throw new Error("missing");
    }

    const remote = await input.api.getEntityRecord(input.token, input.contractId, input.entityTypeId, existing.serverId ?? existing.id);
    const cached = {
      ...existing,
      conflictRemoteDisplayName: null,
      conflictRemoteUpdatedAt: null,
      conflictRemoteValues: null,
      displayName: remote.record.displayName,
      remoteUpdatedAt: remote.record.updatedAt,
      syncStatus: "synced" as const,
      syncErrorCode: null,
      syncErrorMessage: null,
      updatedAt: remote.record.updatedAt,
      values: remote.record.values,
    };

    this.operations.delete(`UPDATE:${existing.localId}`);
    this.records.set(key(input.ownerKey, input.contractId, input.entityTypeId, existing.localId), cached);

    return cached;
  }

  private recordMatches(
    record: { localId: string },
    ownerKey: string,
    contractId: string,
    entityTypeId: string,
  ) {
    return this.records.has(key(ownerKey, contractId, entityTypeId, record.localId));
  }

  private ensureTelemetry(scopeInput: SyncTelemetryScope) {
    const keyValue = telemetryKey(scopeInput);
    const current = this.telemetry.get(keyValue) ?? emptySyncTelemetry(scopeInput);

    this.telemetry.set(keyValue, current);

    return current;
  }
}

function key(ownerKey: string, contractId: string, entityTypeId: string, localId: string) {
  return `${ownerKey}:${contractId}:${entityTypeId}:${localId}`;
}

function telemetryKey(scopeInput: SyncTelemetryScope) {
  return `${scopeInput.ownerKey}:${scopeInput.contractId}:${scopeInput.entityTypeId}`;
}
