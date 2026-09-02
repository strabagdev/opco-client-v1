import { beforeEach, describe, expect, it, vi } from "vitest";

import { PendingOperation } from "../lib/offline-records";
import { LocalDatabaseUnavailableError } from "../lib/local-db-recovery";
import { EntityRecord, EntityRecordValue, OpcoApiError, OpcoNetworkError } from "../lib/opco-api";
import { SyncTelemetry, SyncTelemetryScope, emptySyncTelemetry } from "../lib/sync-telemetry";
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
      getEntityRecord: vi.fn(),
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
      getEntityRecord: vi.fn(async () => ({
        record: record("record_1", { estado: "remoto" }),
      })),
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

  it("sends normalized relation ids already stored in the UPDATE payload", async () => {
    store.operations = [
      operation({
        localRecordId: "record_1",
        operation: "UPDATE",
        payload: {
          values: {
            cargo: "cargo_1",
            responsables: ["a", "b"],
          },
        },
        serverRecordId: "record_1",
      }),
    ];
    const api = {
      createEntityRecord: vi.fn(),
      getEntityRecord: vi.fn(async () => ({
        record: record("record_1", { cargo: "cargo_old" }),
      })),
      updateEntityRecord: vi.fn(async () => ({
        record: record("record_1", { cargo: "cargo_1", responsables: ["a", "b"] }),
      })),
    };

    await syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(api.updateEntityRecord).toHaveBeenCalledWith("token_1", "contract_1", "entity_1", "record_1", {
      values: {
        cargo: "cargo_1",
        responsables: ["a", "b"],
      },
    });
  });

  it("detects UPDATE conflicts before PATCH and keeps local values out of remote overwrite", async () => {
    store.remoteUpdatedAt = "2026-08-20T10:00:00.000Z";
    store.operations = [
      operation({
        localRecordId: "record_1",
        operation: "UPDATE",
        payload: { values: { estado: "local" } },
        serverRecordId: "record_1",
      }),
    ];
    const api = {
      createEntityRecord: vi.fn(),
      getEntityRecord: vi.fn(async () => ({
        record: {
          ...record("record_1", { estado: "opco" }),
          updatedAt: "2026-08-20T11:00:00.000Z",
        },
      })),
      updateEntityRecord: vi.fn(),
    };

    const result = await syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(result.conflicts).toBe(1);
    expect(api.updateEntityRecord).not.toHaveBeenCalled();
    expect(store.conflicts[0].record.values).toEqual({ estado: "opco" });
  });

  it("treats old cache without remote_updated_at as a conflict instead of patching blindly", async () => {
    store.remoteUpdatedAt = null;
    store.operations = [
      operation({
        localRecordId: "record_1",
        operation: "UPDATE",
        payload: { values: { estado: "local" } },
        serverRecordId: "record_1",
      }),
    ];
    const api = {
      createEntityRecord: vi.fn(),
      getEntityRecord: vi.fn(async () => ({
        record: record("record_1", { estado: "opco" }),
      })),
      updateEntityRecord: vi.fn(),
    };

    const result = await syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(result.conflicts).toBe(1);
    expect(api.updateEntityRecord).not.toHaveBeenCalled();
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
      getEntityRecord: vi.fn(),
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
      getEntityRecord: vi.fn(),
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
      getEntityRecord: vi.fn(),
      updateEntityRecord: vi.fn(),
    };

    await Promise.all([
      syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" }),
      syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" }),
      syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" }),
    ]);

    expect(api.createEntityRecord).toHaveBeenCalledOnce();
  });

  it("records push attempt and completion telemetry", async () => {
    store.operations = [operation({ localRecordId: "local_1", operation: "CREATE" })];
    const api = {
      createEntityRecord: vi.fn(async () => ({ record: record("record_1", { codigo: "EQ-1" }) })),
      getEntityRecord: vi.fn(),
      updateEntityRecord: vi.fn(),
    };

    await syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    const telemetry = await store.getSyncTelemetry({ contractId: "contract_1", entityTypeId: "entity_1", ownerKey: "org_1:user_1" });

    expect(telemetry).toMatchObject({
      lastSyncErrorCode: null,
      lastSyncErrorPhase: null,
      syncPhase: "idle",
    });
    expect(telemetry?.lastSyncAttemptAt).toBeTruthy();
    expect(telemetry?.lastPushCompletedAt).toBeTruthy();
  });

  it("records push failure telemetry without dropping pending operations", async () => {
    store.operations = [operation({ localRecordId: "local_1", operation: "CREATE" })];
    const api = {
      createEntityRecord: vi.fn(async () => {
        throw new OpcoNetworkError();
      }),
      getEntityRecord: vi.fn(),
      updateEntityRecord: vi.fn(),
    };

    await syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    const telemetry = await store.getSyncTelemetry({ contractId: "contract_1", entityTypeId: "entity_1", ownerKey: "org_1:user_1" });

    expect(telemetry).toMatchObject({
      lastPushCompletedAt: null,
      lastSyncErrorCode: "NETWORK",
      lastSyncErrorPhase: "pushing",
      syncPhase: "error",
    });
    expect(await store.listPendingOperations("org_1:user_1")).toHaveLength(1);
  });

  it("clears the current telemetry error on the next successful push", async () => {
    store.operations = [operation({ localRecordId: "local_1", operation: "CREATE" })];
    const api = {
      createEntityRecord: vi
        .fn()
        .mockRejectedValueOnce(new OpcoNetworkError())
        .mockResolvedValueOnce({ record: record("record_1", { codigo: "EQ-1" }) }),
      getEntityRecord: vi.fn(),
      updateEntityRecord: vi.fn(),
    };

    await syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });
    await syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    const telemetry = await store.getSyncTelemetry({ contractId: "contract_1", entityTypeId: "entity_1", ownerKey: "org_1:user_1" });

    expect(telemetry).toMatchObject({
      lastSyncErrorCode: null,
      lastSyncErrorPhase: null,
      syncPhase: "idle",
    });
  });

  it("does not update push telemetry for another entity type in the same contract", async () => {
    store.operations = [operation({ entityTypeId: "personas", localRecordId: "local_1", operation: "CREATE" })];
    const api = {
      createEntityRecord: vi.fn(async () => ({ record: record("record_1", { codigo: "P-1" }) })),
      getEntityRecord: vi.fn(),
      updateEntityRecord: vi.fn(),
    };

    await syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    await expect(
      store.getSyncTelemetry({ contractId: "contract_1", entityTypeId: "materiales", ownerKey: "org_1:user_1" }),
    ).resolves.toBeNull();
    await expect(
      store.getSyncTelemetry({ contractId: "contract_1", entityTypeId: "personas", ownerKey: "org_1:user_1" }),
    ).resolves.toMatchObject({ lastPushCompletedAt: expect.any(String) });
  });

  it("records SQLite sync failures without marking push success", async () => {
    store.operations = [operation({ localRecordId: "local_1", operation: "CREATE" })];
    store.markPendingOperationSyncing = vi.fn(async () => {
      throw new LocalDatabaseUnavailableError("STORAGE_UNAVAILABLE");
    });
    store.retryPendingOperation = vi.fn(async () => undefined);
    const api = {
      createEntityRecord: vi.fn(),
      getEntityRecord: vi.fn(),
      updateEntityRecord: vi.fn(),
    };

    await syncPendingRecordsOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    await expect(
      store.getSyncTelemetry({ contractId: "contract_1", entityTypeId: "entity_1", ownerKey: "org_1:user_1" }),
    ).resolves.toMatchObject({
      lastPushCompletedAt: null,
      lastSuccessfulSyncAt: null,
      lastSyncErrorCode: "SQLITE",
      lastSyncErrorPhase: "pushing",
      syncPhase: "error",
    });
  });
});

function record(id: string, values: Record<string, EntityRecordValue>): EntityRecord {
  return {
    displayName: String(Object.values(values)[0] ?? "Registro"),
    id,
    updatedAt: "2026-08-20T12:00:00.000Z",
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
  conflicts: { code: string; message: string; operation: PendingOperation; record: EntityRecord }[] = [];
  failed: { code: string; message: string; operation: PendingOperation }[] = [];
  operations: PendingOperation[] = [];
  remoteUpdatedAt: string | null = "2026-08-20T12:00:00.000Z";
  retried: { code: string; message: string; operation: PendingOperation }[] = [];
  syncing: string[] = [];
  telemetry = new Map<string, SyncTelemetry>();

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

  async markPendingOperationConflict(operationItem: PendingOperation, remoteRecord: EntityRecord, code: string, message: string) {
    this.conflicts.push({ code, message, operation: operationItem, record: remoteRecord });
  }

  async readRecordRemoteUpdatedAt() {
    return this.remoteUpdatedAt;
  }

  async retryPendingOperation(operationItem: PendingOperation, code: string, message: string) {
    this.retried.push({ code, message, operation: operationItem });
  }

  async getSyncTelemetry(scope: SyncTelemetryScope) {
    return this.telemetry.get(telemetryKey(scope)) ?? null;
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

  private ensureTelemetry(scope: SyncTelemetryScope) {
    const keyValue = telemetryKey(scope);
    const current = this.telemetry.get(keyValue) ?? emptySyncTelemetry(scope);

    this.telemetry.set(keyValue, current);

    return current;
  }
}

function telemetryKey(scope: SyncTelemetryScope) {
  return `${scope.ownerKey}:${scope.contractId}:${scope.entityTypeId}`;
}
