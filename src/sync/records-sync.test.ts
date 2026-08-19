import { beforeEach, describe, expect, it, vi } from "vitest";

import { PendingOperation } from "../lib/offline-records";
import { EntityRecord, EntityRecordValue, OpcoApiError, OpcoNetworkError } from "../lib/opco-api";
import { RecordsSyncStore, syncPendingRecordsOnce } from "./records-sync";

let store: MemorySyncStore;

beforeEach(() => {
  store = new MemorySyncStore();
});

describe("records sync engine", () => {
  it("syncs CREATE with the original clientRequestId and assigns server_id", async () => {
    store.operations = [
      operation({
        clientRequestId: "request_original",
        localRecordId: "local_1",
        operation: "CREATE",
        payload: { clientRequestId: "request_original", values: { codigo: "EQ-1" } },
      }),
    ];
    const api = {
      createEntityRecord: vi.fn(async (_token: string, _contractId: string, _entityTypeId: string, input) => ({
        record: record("record_1", input.values),
      })),
      updateEntityRecord: vi.fn(),
    };

    const result = await syncPendingRecordsOnce({
      api,
      ownerKey: "org_1:user_1",
      store,
      token: "token_1",
    });

    expect(result.completed).toBe(1);
    expect(api.createEntityRecord).toHaveBeenCalledWith("token_1", "contract_1", "entity_1", {
      clientRequestId: "request_original",
      values: { codigo: "EQ-1" },
    });
    expect(store.completed[0].record.id).toBe("record_1");
  });

  it("syncs UPDATE against server_id", async () => {
    store.operations = [
      operation({
        localRecordId: "record_1",
        operation: "UPDATE",
        payload: { values: { estado: "operativo" } },
        serverRecordId: "record_1",
      }),
    ];
    const api = {
      createEntityRecord: vi.fn(),
      updateEntityRecord: vi.fn(async () => ({
        record: record("record_1", { estado: "operativo" }),
      })),
    };

    await syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(api.updateEntityRecord).toHaveBeenCalledWith("token_1", "contract_1", "entity_1", "record_1", {
      values: { estado: "operativo" },
    });
    expect(store.completed).toHaveLength(1);
  });

  it("keeps pending operations for network errors and server 5xx", async () => {
    store.operations = [
      operation({ localRecordId: "local_1", operation: "CREATE" }),
      operation({ localRecordId: "local_2", operation: "CREATE" }),
    ];
    const api = {
      createEntityRecord: vi
        .fn()
        .mockRejectedValueOnce(new OpcoNetworkError())
        .mockRejectedValueOnce(new OpcoApiError("Servidor caido.", "SERVER_ERROR", 500)),
      updateEntityRecord: vi.fn(),
    };

    const result = await syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(result.retriable).toBe(2);
    expect(store.retried.map((item) => item.code)).toEqual(["NETWORK", "SERVER_ERROR"]);
    expect(store.failed).toEqual([]);
  });

  it("marks validation and idempotency conflicts as failed without dropping the operation", async () => {
    store.operations = [
      operation({ localRecordId: "local_1", operation: "CREATE" }),
      operation({ localRecordId: "local_2", operation: "CREATE" }),
    ];
    const api = {
      createEntityRecord: vi
        .fn()
        .mockRejectedValueOnce(new OpcoApiError("Validacion.", "VALIDATION_ERROR", 400))
        .mockRejectedValueOnce(new OpcoApiError("Conflicto.", "IDEMPOTENCY_CONFLICT", 409)),
      updateEntityRecord: vi.fn(),
    };

    const result = await syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(result.failed).toBe(2);
    expect(store.failed.map((item) => item.code)).toEqual(["VALIDATION_ERROR", "IDEMPOTENCY_CONFLICT"]);
    expect(store.completed).toEqual([]);
  });

  it("runs as a single-flight sync", async () => {
    store.operations = [operation({ localRecordId: "local_1", operation: "CREATE" })];
    const api = {
      createEntityRecord: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));

        return { record: record("record_1", { codigo: "EQ-1" }) };
      }),
      updateEntityRecord: vi.fn(),
    };

    await Promise.all([
      syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" }),
      syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" }),
      syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" }),
    ]);

    expect(api.createEntityRecord).toHaveBeenCalledOnce();
  });
});

function record(id: string, values: Record<string, EntityRecordValue>): EntityRecord {
  return {
    displayName: String(Object.values(values)[0] ?? "Registro"),
    id,
    values,
  };
}

function operation(partial: Partial<PendingOperation> & Pick<PendingOperation, "localRecordId" | "operation">): PendingOperation {
  return {
    attempts: 0,
    clientRequestId: partial.clientRequestId ?? "request_1",
    contractId: "contract_1",
    createdAt: "2026-01-01T00:00:00.000Z",
    entityTypeId: "entity_1",
    id: `${partial.operation}_${partial.localRecordId}`,
    lastErrorCode: null,
    lastErrorMessage: null,
    ownerKey: "org_1:user_1",
    payload: partial.payload ?? { clientRequestId: "request_1", values: { codigo: "EQ-1" } },
    serverRecordId: partial.serverRecordId ?? null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

class MemorySyncStore implements RecordsSyncStore {
  completed: { operation: PendingOperation; record: EntityRecord }[] = [];
  failed: { code: string; message: string; operation: PendingOperation }[] = [];
  operations: PendingOperation[] = [];
  retried: { code: string; message: string; operation: PendingOperation }[] = [];
  syncing: string[] = [];

  async completePendingOperation(operationItem: PendingOperation, recordItem: EntityRecord) {
    this.completed.push({ operation: operationItem, record: recordItem });
  }

  async failPendingOperation(operationItem: PendingOperation, code: string, message: string) {
    this.failed.push({ code, message, operation: operationItem });
  }

  async listPendingOperations(ownerKey: string) {
    return this.operations.filter((operationItem) => operationItem.ownerKey === ownerKey);
  }

  async markPendingOperationSyncing(operationId: string) {
    this.syncing.push(operationId);
  }

  async retryPendingOperation(operationItem: PendingOperation, code: string, message: string) {
    this.retried.push({ code, message, operation: operationItem });
  }
}
