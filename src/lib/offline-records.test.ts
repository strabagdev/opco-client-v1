import { beforeEach, describe, expect, it } from "vitest";

import {
  OfflineRecordStore,
  PendingOperation,
  loadRecordWithOfflineCache,
  loadRecordsWithOfflineCache,
} from "./offline-records";
import { EntityRecord, EntityRecordValue, OpcoApiError, OpcoNetworkError } from "./opco-api";

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
    values,
  };
}

class MemoryRecordStore implements OfflineRecordStore {
  records = new Map<string, Awaited<ReturnType<OfflineRecordStore["createLocalRecord"]>>>();
  operations = new Map<string, PendingOperation>();

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
      serverId: null,
      syncStatus: "pending_create" as const,
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
        serverId: remote.id,
        syncStatus: "synced",
      });
    });
  }

  async listPendingOperations(ownerKey: string) {
    return [...this.operations.values()].filter((operation) => operation.ownerKey === ownerKey);
  }

  private recordMatches(
    record: { localId: string },
    ownerKey: string,
    contractId: string,
    entityTypeId: string,
  ) {
    return this.records.has(key(ownerKey, contractId, entityTypeId, record.localId));
  }
}

function key(ownerKey: string, contractId: string, entityTypeId: string, localId: string) {
  return `${ownerKey}:${contractId}:${entityTypeId}:${localId}`;
}
