import { beforeEach, describe, expect, it, vi } from "vitest";

import { __resetLocalDatabaseForTests, getLocalDatabase } from "../lib/local-db";
import { EntityRecord, OpcoNetworkError } from "../lib/opco-api";
import { syncPendingRecordsOnce } from "./records-sync";

const sqliteMock = vi.hoisted(() => ({
  deleteDatabaseAsync: vi.fn(),
  openDatabaseAsync: vi.fn(),
}));

vi.mock("expo-sqlite", () => ({
  deleteDatabaseAsync: sqliteMock.deleteDatabaseAsync,
  openDatabaseAsync: sqliteMock.openDatabaseAsync,
}));

const scope = {
  contractId: "contract_1",
  entityTypeId: "entity_1",
  ownerKey: "org_1:user_1",
};

describe("RECORDS consecutive local edits during sync", () => {
  let db: StatefulSqliteHarness;

  beforeEach(() => {
    __resetLocalDatabaseForTests();
    db = new StatefulSqliteHarness();
    sqliteMock.openDatabaseAsync.mockReset();
    sqliteMock.deleteDatabaseAsync.mockReset();
    sqliteMock.openDatabaseAsync.mockResolvedValue(db);
    sqliteMock.deleteDatabaseAsync.mockResolvedValue(undefined);
  });

  it("keeps B locally visible and durable when A is confirmed after B was saved", async () => {
    const store = getLocalDatabase();

    await store.upsertRemoteRecords({
      ...scope,
      cachedAt: "2026-09-26T10:00:00.000Z",
      records: [record("record_1", "Original", "2026-09-26T10:00:00.000Z")],
    });

    await store.updateLocalRecord({
      ...scope,
      recordId: "record_1",
      values: { ubicacion: "Taller" },
    });

    const aStarted = deferred<{ record: EntityRecord }>();
    let remoteRecord = record("record_1", "Original", "2026-09-26T10:00:00.000Z");
    const api = {
      createEntityRecord: vi.fn(),
      getEntityRecord: vi.fn(async () => ({ record: remoteRecord })),
      updateEntityRecord: vi.fn(async (_token: string, _contractId: string, _entityTypeId: string, _recordId: string, input: { values: Record<string, unknown> }) => {
        remoteRecord = record("record_1", String(input.values.ubicacion), "2026-09-26T10:02:00.000Z");
        return { record: remoteRecord };
      }).mockImplementationOnce(() => aStarted.promise),
    };

    const syncA = syncPendingRecordsOnce({
      api,
      ownerKey: scope.ownerKey,
      store,
      token: "token_1",
    });
    await vi.waitFor(() => expect(api.updateEntityRecord).toHaveBeenCalledOnce());

    await store.updateLocalRecord({
      ...scope,
      recordId: "record_1",
      values: { ubicacion: "Bodega" },
    });

    const beforeConfirm = await snapshot(store);

    expect(beforeConfirm.record).toMatchObject({
      syncStatus: "pending_update",
      values: { ubicacion: "Bodega" },
    });
    expect(beforeConfirm.operations).toMatchObject([
      {
        operation: "UPDATE",
        payload: { values: { ubicacion: "Bodega" } },
      },
    ]);

    remoteRecord = record("record_1", "Taller", "2026-09-26T10:01:00.000Z");
    aStarted.resolve({ record: remoteRecord });
    await syncA;

    const afterConfirm = await snapshot(store);

    expect(afterConfirm).toMatchObject({
      operations: [
        {
          operation: "UPDATE",
          payload: { values: { ubicacion: "Bodega" } },
        },
      ],
      record: {
        syncStatus: "pending_update",
        values: { ubicacion: "Bodega" },
      },
    });

    await syncPendingRecordsOnce({ api, ownerKey: scope.ownerKey, store, token: "token_1" });

    expect(api.updateEntityRecord).toHaveBeenCalledTimes(2);
    await expect(snapshot(store)).resolves.toMatchObject({
      operations: [],
      record: { syncStatus: "synced", values: { ubicacion: "Bodega" } },
    });
  });

  it("clears a transient persisted A conflict when A completion leaves B pending", async () => {
    const store = getLocalDatabase();
    await seedSyncedRecord(store);
    await store.updateLocalRecord({ ...scope, recordId: "record_1", values: { ubicacion: "Taller" } });
    const aStarted = deferred<{ record: EntityRecord }>();
    const api = updateApi(record("record_1", "Original", "2026-09-26T10:00:00.000Z"));
    api.updateEntityRecord.mockImplementationOnce(() => aStarted.promise);
    const syncA = syncPendingRecordsOnce({ api, ownerKey: scope.ownerKey, store, token: "token_1" });
    await vi.waitFor(() => expect(api.updateEntityRecord).toHaveBeenCalledOnce());

    await store.updateLocalRecord({ ...scope, recordId: "record_1", values: { ubicacion: "Bodega" } });
    const remoteA = record("record_1", "Taller", "2026-09-26T10:01:00.000Z");
    await store.upsertRemoteRecords({ ...scope, records: [remoteA] });

    await expect(snapshot(store)).resolves.toMatchObject({
      record: {
        conflictRemoteValues: { ubicacion: "Taller" },
        syncStatus: "conflict",
        values: { ubicacion: "Bodega" },
      },
    });

    aStarted.resolve({ record: remoteA });
    await syncA;

    await expect(snapshot(store)).resolves.toMatchObject({
      operations: [{ operation: "UPDATE", payload: { values: { ubicacion: "Bodega" } } }],
      record: {
        conflictRemoteValues: null,
        syncErrorCode: null,
        syncStatus: "pending_update",
        values: { ubicacion: "Bodega" },
      },
    });
  });

  it("refreshes a mounted detail after a direct RECORDS sync completes", () => {
    const detailSource = require("fs").readFileSync("src/renderers/records/RecordDetailScreen.tsx", "utf8");
    const lifecycleSource = require("fs").readFileSync("src/state/use-pending-work-lifecycle.ts", "utf8");

    expect(detailSource).toMatch(/recordId, recordsReconnectRefreshKey, retryCount/);
    expect(lifecycleSource).toContain(`syncResult === "completed"`);
    expect(lifecycleSource).toContain(`setRecordsReconnectRefreshKeyRef.current((key) => key + 1)`);
  });

  it("distinguishes a later B from a legacy A without intentId", async () => {
    const store = getLocalDatabase();
    await seedSyncedRecord(store);
    await store.updateLocalRecord({ ...scope, recordId: "record_1", values: { ubicacion: "Taller" } });

    const legacyRow = [...db.pendingOperations.values()][0];
    const legacyPayload = JSON.parse(legacyRow.payload_json) as Record<string, unknown>;
    delete legacyPayload.intentId;
    legacyRow.payload_json = JSON.stringify(legacyPayload);

    const aStarted = deferred<{ record: EntityRecord }>();
    const api = updateApi(record("record_1", "Original", "2026-09-26T10:00:00.000Z"));
    api.updateEntityRecord.mockImplementationOnce(() => aStarted.promise);
    const syncA = syncPendingRecordsOnce({ api, ownerKey: scope.ownerKey, store, token: "token_1" });
    await vi.waitFor(() => expect(api.updateEntityRecord).toHaveBeenCalledOnce());

    expect(api.updateEntityRecord.mock.calls[0][4]).toEqual({ values: { ubicacion: "Taller" } });
    await store.updateLocalRecord({ ...scope, recordId: "record_1", values: { ubicacion: "Bodega" } });
    aStarted.resolve({ record: record("record_1", "Taller", "2026-09-26T10:01:00.000Z") });
    await syncA;

    await expect(snapshot(store)).resolves.toMatchObject({
      operations: [{ payload: { values: { ubicacion: "Bodega" } } }],
      record: { syncStatus: "pending_update", values: { ubicacion: "Bodega" } },
    });
  });

  it("keeps B durable across a module restart before its send", async () => {
    const store = getLocalDatabase();
    await leaveBPendingAfterConfirmingA(store);

    __resetLocalDatabaseForTests();
    vi.resetModules();
    sqliteMock.openDatabaseAsync.mockResolvedValue(db);
    const { getLocalDatabase: getRestartedLocalDatabase } = await import("../lib/local-db");
    const { syncPendingRecordsOnce: syncRestartedRecordsOnce } = await import("./records-sync");
    const restartedStore = getRestartedLocalDatabase();

    await expect(snapshot(restartedStore)).resolves.toMatchObject({
      operations: [{ operation: "UPDATE", payload: { values: { ubicacion: "Bodega" } } }],
      record: { syncStatus: "pending_update", values: { ubicacion: "Bodega" } },
    });

    const api = updateApi(record("record_1", "Taller", "2026-09-26T10:01:00.000Z"));
    await syncRestartedRecordsOnce({ api, ownerKey: scope.ownerKey, store: restartedStore, token: "token_1" });

    expect(api.updateEntityRecord).toHaveBeenCalledOnce();
    await expect(snapshot(restartedStore)).resolves.toMatchObject({
      operations: [],
      record: { syncStatus: "synced", values: { ubicacion: "Bodega" } },
    });
  });

  it("keeps B and reports conflict when the remote version changes before B", async () => {
    const store = getLocalDatabase();
    await leaveBPendingAfterConfirmingA(store);
    const api = updateApi(record("record_1", "Patio", "2026-09-26T10:02:00.000Z"));

    const result = await syncPendingRecordsOnce({ api, ownerKey: scope.ownerKey, store, token: "token_1" });

    expect(result.conflicts).toBe(1);
    expect(api.updateEntityRecord).not.toHaveBeenCalled();
    await expect(snapshot(store)).resolves.toMatchObject({
      operations: [],
      record: {
        conflictRemoteValues: { ubicacion: "Patio" },
        syncStatus: "conflict",
        values: { ubicacion: "Bodega" },
      },
    });
    expect([...db.pendingOperations.values()].map((operation) => JSON.parse(operation.payload_json))).toMatchObject([
      { values: { ubicacion: "Bodega" } },
    ]);
  });

  it("keeps B pending when B gets a network failure", async () => {
    const store = getLocalDatabase();
    await leaveBPendingAfterConfirmingA(store);
    const api = {
      ...updateApi(record("record_1", "Taller", "2026-09-26T10:01:00.000Z")),
      updateEntityRecord: vi.fn(async () => { throw new OpcoNetworkError(); }),
    };

    const result = await syncPendingRecordsOnce({ api, ownerKey: scope.ownerKey, store, token: "token_1" });

    expect(result.retriable).toBe(1);
    await expect(snapshot(store)).resolves.toMatchObject({
      operations: [{ lastErrorCode: "NETWORK", payload: { values: { ubicacion: "Bodega" } } }],
      record: { syncStatus: "pending_update", values: { ubicacion: "Bodega" } },
    });
  });

  it("does not apply A network failure to a later B intent", async () => {
    const store = getLocalDatabase();
    await seedSyncedRecord(store);
    await store.updateLocalRecord({ ...scope, recordId: "record_1", values: { ubicacion: "Taller" } });
    const aStarted = deferred<{ record: EntityRecord }>();
    const api = updateApi(record("record_1", "Original", "2026-09-26T10:00:00.000Z"));
    api.updateEntityRecord.mockImplementationOnce(() => aStarted.promise);
    const syncA = syncPendingRecordsOnce({ api, ownerKey: scope.ownerKey, store, token: "token_1" });
    await vi.waitFor(() => expect(api.updateEntityRecord).toHaveBeenCalledOnce());

    await store.updateLocalRecord({ ...scope, recordId: "record_1", values: { ubicacion: "Bodega" } });
    aStarted.reject(new OpcoNetworkError());
    await syncA;

    await expect(snapshot(store)).resolves.toMatchObject({
      operations: [{ lastErrorCode: null, payload: { values: { ubicacion: "Bodega" } } }],
      record: { syncStatus: "pending_update", values: { ubicacion: "Bodega" } },
    });
  });

  it("does not apply A preflight conflict to a later B intent", async () => {
    const store = getLocalDatabase();
    await seedSyncedRecord(store);
    await store.updateLocalRecord({ ...scope, recordId: "record_1", values: { ubicacion: "Taller" } });
    const preflight = deferred<{ record: EntityRecord }>();
    const api = {
      createEntityRecord: vi.fn(),
      getEntityRecord: vi.fn(() => preflight.promise),
      updateEntityRecord: vi.fn(),
    };
    const syncA = syncPendingRecordsOnce({ api, ownerKey: scope.ownerKey, store, token: "token_1" });
    await vi.waitFor(() => expect(api.getEntityRecord).toHaveBeenCalledOnce());

    await store.updateLocalRecord({ ...scope, recordId: "record_1", values: { ubicacion: "Bodega" } });
    preflight.resolve({ record: record("record_1", "Patio", "2026-09-26T10:02:00.000Z") });
    await syncA;

    await expect(snapshot(store)).resolves.toMatchObject({
      operations: [{ lastErrorCode: null, payload: { values: { ubicacion: "Bodega" } } }],
      record: { syncStatus: "pending_update", values: { ubicacion: "Bodega" } },
    });
  });

  it("turns CREATE followed by an in-flight edit into one CREATE and one UPDATE", async () => {
    const store = getLocalDatabase();
    await store.createLocalRecord({ ...scope, localId: "local_1", values: { ubicacion: "Taller" } });
    const createStarted = deferred<{ record: EntityRecord }>();
    let remoteRecord = record("record_1", "Taller", "2026-09-26T10:01:00.000Z");
    const api = {
      createEntityRecord: vi.fn(() => createStarted.promise),
      getEntityRecord: vi.fn(async () => ({ record: remoteRecord })),
      updateEntityRecord: vi.fn(async (_token: string, _contractId: string, _entityTypeId: string, _recordId: string, input: { values: Record<string, unknown> }) => {
        remoteRecord = record("record_1", String(input.values.ubicacion), "2026-09-26T10:02:00.000Z");
        return { record: remoteRecord };
      }),
    };
    const syncCreate = syncPendingRecordsOnce({ api, ownerKey: scope.ownerKey, store, token: "token_1" });
    await vi.waitFor(() => expect(api.createEntityRecord).toHaveBeenCalledOnce());

    await store.updateLocalRecord({ ...scope, recordId: "local_1", values: { ubicacion: "Bodega" } });
    createStarted.resolve({ record: remoteRecord });
    await syncCreate;

    await expect(snapshotRecord(store, "local_1")).resolves.toMatchObject({
      operations: [{ id: "update_local_1", operation: "UPDATE", serverRecordId: "record_1", payload: { values: { ubicacion: "Bodega" } } }],
      record: { serverId: "record_1", syncStatus: "pending_update", values: { ubicacion: "Bodega" } },
    });

    await syncPendingRecordsOnce({ api, ownerKey: scope.ownerKey, store, token: "token_1" });

    expect(api.createEntityRecord).toHaveBeenCalledOnce();
    expect(api.updateEntityRecord).toHaveBeenCalledOnce();
    await expect(snapshotRecord(store, "local_1")).resolves.toMatchObject({
      operations: [],
      record: { syncStatus: "synced", values: { ubicacion: "Bodega" } },
    });
  });
});

async function snapshot(store: ReturnType<typeof getLocalDatabase>) {
  return snapshotRecord(store, "record_1");
}

async function snapshotRecord(store: ReturnType<typeof getLocalDatabase>, recordId: string) {
  return {
    operations: await store.listPendingOperations(scope.ownerKey),
    record: await store.getCachedRecord({ ...scope, recordId }),
  };
}

async function seedSyncedRecord(store: ReturnType<typeof getLocalDatabase>) {
  await store.upsertRemoteRecords({
    ...scope,
    cachedAt: "2026-09-26T10:00:00.000Z",
    records: [record("record_1", "Original", "2026-09-26T10:00:00.000Z")],
  });
}

async function leaveBPendingAfterConfirmingA(store: ReturnType<typeof getLocalDatabase>) {
  await seedSyncedRecord(store);
  await store.updateLocalRecord({ ...scope, recordId: "record_1", values: { ubicacion: "Taller" } });
  const aStarted = deferred<{ record: EntityRecord }>();
  const api = updateApi(record("record_1", "Original", "2026-09-26T10:00:00.000Z"));
  api.updateEntityRecord.mockImplementationOnce(() => aStarted.promise);
  const syncA = syncPendingRecordsOnce({ api, ownerKey: scope.ownerKey, store, token: "token_1" });
  await vi.waitFor(() => expect(api.updateEntityRecord).toHaveBeenCalledOnce());
  await store.updateLocalRecord({ ...scope, recordId: "record_1", values: { ubicacion: "Bodega" } });
  aStarted.resolve({ record: record("record_1", "Taller", "2026-09-26T10:01:00.000Z") });
  await syncA;
}

function updateApi(remoteRecord: EntityRecord) {
  return {
    createEntityRecord: vi.fn(),
    getEntityRecord: vi.fn(async () => ({ record: remoteRecord })),
    updateEntityRecord: vi.fn(async (_token: string, _contractId: string, _entityTypeId: string, _recordId: string, input: { values: Record<string, unknown> }) => ({
      record: record("record_1", String(input.values.ubicacion), "2026-09-26T10:03:00.000Z"),
    })),
  };
}

function record(id: string, ubicacion: string, updatedAt: string): EntityRecord {
  return {
    displayName: ubicacion,
    id,
    updatedAt,
    values: { ubicacion },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

type EntityRecordRow = {
  cached_at: string;
  conflict_remote_display_name: string | null;
  conflict_remote_updated_at: string | null;
  conflict_remote_values_json: string | null;
  contract_id: string;
  display_name: string;
  entity_type_id: string;
  local_id: string;
  owner_key: string;
  remote_updated_at: string | null;
  server_id: string | null;
  sync_error_code: string | null;
  sync_error_message: string | null;
  sync_status: "synced" | "pending_create" | "pending_update" | "syncing" | "failed" | "conflict";
  values_json: string;
};

type PendingOperationRow = {
  attempts: number;
  client_request_id: string;
  contract_id: string;
  created_at: string;
  entity_type_id: string;
  id: string;
  last_error_code: string | null;
  last_error_message: string | null;
  local_record_id: string;
  operation: "CREATE" | "UPDATE" | "STATE_UPDATE";
  owner_key: string;
  payload_json: string;
  server_record_id: string | null;
  updated_at: string;
};

type SyncTelemetryRow = {
  contract_id: string;
  entity_type_id: string;
  last_full_refresh_completed_at: string | null;
  last_push_completed_at: string | null;
  last_reconcile_completed_at: string | null;
  last_successful_sync_at: string | null;
  last_sync_attempt_at: string | null;
  last_sync_error_at: string | null;
  last_sync_error_code: string | null;
  last_sync_error_phase: string | null;
  owner_key: string;
  sync_phase: string;
  updated_at: string;
};

class StatefulSqliteHarness {
  entityRecords = new Map<string, EntityRecordRow>();
  pendingOperations = new Map<string, PendingOperationRow>();
  syncTelemetry = new Map<string, SyncTelemetryRow>();

  async closeAsync() {
    return undefined;
  }

  async execAsync() {
    return undefined;
  }

  async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
    if (sql.includes("PRAGMA table_info(entity_records)")) {
      return [
        "local_id",
        "server_id",
        "owner_key",
        "contract_id",
        "entity_type_id",
        "display_name",
        "values_json",
        "remote_updated_at",
        "cached_at",
        "sync_status",
        "sync_error_code",
        "sync_error_message",
        "conflict_remote_values_json",
        "conflict_remote_display_name",
        "conflict_remote_updated_at",
      ].map((name) => ({ name })) as T[];
    }

    if (sql.includes("PRAGMA table_info(app_view_definitions)")) {
      return [{ name: "owner_key" }] as T[];
    }

    if (sql.includes("PRAGMA table_info(sync_telemetry)")) {
      return [{ name: "entity_type_id" }] as T[];
    }

    if (sql.includes("FROM pending_operations") && sql.includes("INNER JOIN entity_records")) {
      const [ownerKey] = params;
      return [...this.pendingOperations.values()]
        .filter((operation) => operation.owner_key === ownerKey)
        .filter((operation) => operation.operation === "CREATE" || operation.operation === "UPDATE")
        .filter((operation) => {
          const local = this.entityRecords.get(operation.local_record_id);
          return local?.sync_status === "pending_create" || local?.sync_status === "pending_update";
        })
        .sort((left, right) =>
          left.local_record_id.localeCompare(right.local_record_id) ||
          operationOrder(left.operation) - operationOrder(right.operation) ||
          left.created_at.localeCompare(right.created_at),
        ) as T[];
    }

    return [] as T[];
  }

  async getFirstAsync<T>(sql: string, ...params: unknown[]): Promise<T | null> {
    if (sql.includes("FROM entity_records") && sql.includes("server_id = ?") && !sql.includes("local_id = ? OR server_id = ?")) {
      const [ownerKey, contractId, entityTypeId, serverId] = params;
      return (this.findRecord({ ownerKey, contractId, entityTypeId, serverId }) ?? null) as T | null;
    }

    if (sql.includes("FROM entity_records") && sql.includes("(local_id = ? OR server_id = ?)")) {
      const [ownerKey, contractId, entityTypeId, localId, serverId] = params;
      return (this.findRecord({ ownerKey, contractId, entityTypeId, localId, serverId }) ?? null) as T | null;
    }

    if (sql.includes("FROM pending_operations") && sql.includes("operation = 'CREATE'")) {
      const [ownerKey, localRecordId] = params;
      return ([...this.pendingOperations.values()].find((operation) =>
        operation.owner_key === ownerKey &&
        operation.local_record_id === localRecordId &&
        operation.operation === "CREATE",
      ) ?? null) as T | null;
    }

    if (sql.includes("FROM pending_operations") && sql.includes("WHERE id = ?")) {
      const [operationId] = params;
      return (this.pendingOperations.get(String(operationId)) ?? null) as T | null;
    }

    if (sql.includes("COUNT(*) AS total FROM pending_operations WHERE local_record_id = ?")) {
      const [localRecordId] = params;
      return {
        total: [...this.pendingOperations.values()].filter((operation) => operation.local_record_id === localRecordId).length,
      } as T;
    }

    if (sql.includes("SELECT remote_updated_at") && sql.includes("FROM entity_records")) {
      const [localRecordId] = params;
      return { remote_updated_at: this.entityRecords.get(String(localRecordId))?.remote_updated_at ?? null } as T;
    }

    return null;
  }

  async runAsync(sql: string, ...params: unknown[]) {
    if (sql.includes("INSERT OR REPLACE INTO app_metadata")) {
      return undefined;
    }

    if (sql.includes("INSERT OR IGNORE INTO sync_telemetry")) {
      const [ownerKey, contractId, entityTypeId, syncPhase, lastSyncAttemptAt, lastPushCompletedAt, lastFullRefreshCompletedAt, lastReconcileCompletedAt, lastSuccessfulSyncAt, lastSyncErrorAt, lastSyncErrorCode, lastSyncErrorPhase, updatedAt] = params;
      const key = telemetryKey(ownerKey, contractId, entityTypeId);
      if (!this.syncTelemetry.has(key)) {
        this.syncTelemetry.set(key, {
          contract_id: String(contractId),
          entity_type_id: String(entityTypeId),
          last_full_refresh_completed_at: nullableString(lastFullRefreshCompletedAt),
          last_push_completed_at: nullableString(lastPushCompletedAt),
          last_reconcile_completed_at: nullableString(lastReconcileCompletedAt),
          last_successful_sync_at: nullableString(lastSuccessfulSyncAt),
          last_sync_attempt_at: nullableString(lastSyncAttemptAt),
          last_sync_error_at: nullableString(lastSyncErrorAt),
          last_sync_error_code: nullableString(lastSyncErrorCode),
          last_sync_error_phase: nullableString(lastSyncErrorPhase),
          owner_key: String(ownerKey),
          sync_phase: String(syncPhase),
          updated_at: String(updatedAt),
        });
      }
      return undefined;
    }

    if (sql.includes("UPDATE sync_telemetry")) {
      this.updateSyncTelemetry(sql, params);
      return undefined;
    }

    if (sql.includes("INSERT INTO entity_records") && sql.includes("ON CONFLICT(local_id)")) {
      const [localId, serverId, ownerKey, contractId, entityTypeId, displayName, valuesJson, remoteUpdatedAt, cachedAt] = params;
      const row = this.entityRecords.get(String(localId));
      this.entityRecords.set(String(localId), {
        cached_at: String(cachedAt),
        conflict_remote_display_name: row?.sync_status === "synced" ? null : row?.conflict_remote_display_name ?? null,
        conflict_remote_updated_at: row?.sync_status === "synced" ? null : row?.conflict_remote_updated_at ?? null,
        conflict_remote_values_json: row?.sync_status === "synced" ? null : row?.conflict_remote_values_json ?? null,
        contract_id: String(contractId),
        display_name: String(displayName),
        entity_type_id: String(entityTypeId),
        local_id: String(localId),
        owner_key: String(ownerKey),
        remote_updated_at: nullableString(remoteUpdatedAt),
        server_id: nullableString(serverId),
        sync_error_code: row?.sync_status === "synced" ? null : row?.sync_error_code ?? null,
        sync_error_message: row?.sync_status === "synced" ? null : row?.sync_error_message ?? null,
        sync_status: row?.sync_status === "synced" || !row ? "synced" : row.sync_status,
        values_json: String(valuesJson),
      });
      return undefined;
    }

    if (sql.includes("INSERT INTO entity_records")) {
      const [localId, ownerKey, contractId, entityTypeId, displayName, valuesJson, cachedAt] = params;
      this.entityRecords.set(String(localId), {
        cached_at: String(cachedAt),
        conflict_remote_display_name: null,
        conflict_remote_updated_at: null,
        conflict_remote_values_json: null,
        contract_id: String(contractId),
        display_name: String(displayName),
        entity_type_id: String(entityTypeId),
        local_id: String(localId),
        owner_key: String(ownerKey),
        remote_updated_at: null,
        server_id: null,
        sync_error_code: null,
        sync_error_message: null,
        sync_status: "pending_create",
        values_json: String(valuesJson),
      });
      return undefined;
    }

    if (sql.includes("INSERT INTO pending_operations")) {
      const [id, clientRequestId, operation, ownerKey, contractId, entityTypeId, localRecordId, serverRecordId, payloadJson, createdAt, updatedAt] = params;
      const existing = this.pendingOperations.get(String(id));
      this.pendingOperations.set(String(id), {
        attempts: existing?.attempts ?? 0,
        client_request_id: existing?.client_request_id ?? String(clientRequestId),
        contract_id: String(contractId),
        created_at: existing?.created_at ?? String(createdAt),
        entity_type_id: String(entityTypeId),
        id: String(id),
        last_error_code: null,
        last_error_message: null,
        local_record_id: String(localRecordId),
        operation: operation as PendingOperationRow["operation"],
        owner_key: String(ownerKey),
        payload_json: String(payloadJson),
        server_record_id: nullableString(serverRecordId),
        updated_at: String(updatedAt),
      });
      return undefined;
    }

    if (sql.includes("UPDATE pending_operations") && sql.includes("SET payload_json = ?")) {
      const [payloadJson, updatedAt, operationId] = params;
      const operation = this.pendingOperations.get(String(operationId));
      if (operation) {
        operation.payload_json = String(payloadJson);
        operation.updated_at = String(updatedAt);
        operation.last_error_code = null;
        operation.last_error_message = null;
      }
      return undefined;
    }

    if (sql.includes("UPDATE pending_operations") && sql.includes("payload_json = COALESCE")) {
      const [updatedAt, code, message, payloadJson, operationId] = params;
      const operation = this.pendingOperations.get(String(operationId));
      if (operation) {
        operation.updated_at = String(updatedAt);
        operation.last_error_code = String(code);
        operation.last_error_message = String(message);
        if (payloadJson !== null) operation.payload_json = String(payloadJson);
      }
      return undefined;
    }

    if (sql.includes("UPDATE pending_operations") && sql.includes("last_error_code = ?")) {
      const [updatedAt, code, message, operationId] = params;
      const operation = this.pendingOperations.get(String(operationId));
      if (operation) {
        operation.updated_at = String(updatedAt);
        operation.last_error_code = String(code);
        operation.last_error_message = String(message);
      }
      return undefined;
    }

    if (sql.includes("UPDATE pending_operations") && sql.includes("attempts = attempts + 1")) {
      const [updatedAt, operationId] = params;
      const operation = this.pendingOperations.get(String(operationId));
      if (operation) {
        operation.attempts += 1;
        operation.updated_at = String(updatedAt);
        operation.last_error_code = null;
        operation.last_error_message = null;
      }
      return undefined;
    }

    if (sql.includes("UPDATE entity_records") && sql.includes("conflict_remote_values_json = ?")) {
      const [code, message, remoteValuesJson, remoteDisplayName, remoteUpdatedAt, localId] = params;
      const recordRow = this.entityRecords.get(String(localId));
      if (recordRow) {
        recordRow.sync_status = "conflict";
        recordRow.sync_error_code = String(code);
        recordRow.sync_error_message = String(message);
        recordRow.conflict_remote_values_json = String(remoteValuesJson);
        recordRow.conflict_remote_display_name = String(remoteDisplayName);
        recordRow.conflict_remote_updated_at = String(remoteUpdatedAt);
      }
      return undefined;
    }

    if (sql.includes("UPDATE entity_records") && sql.includes("SET sync_status = ?")) {
      const [syncStatus, code, message, localId] = params;
      const recordRow = this.entityRecords.get(String(localId));
      if (recordRow) {
        recordRow.sync_status = syncStatus as EntityRecordRow["sync_status"];
        recordRow.sync_error_code = String(code);
        recordRow.sync_error_message = String(message);
      }
      return undefined;
    }

    if (sql.includes("UPDATE entity_records") && sql.includes("sync_status = 'syncing'")) {
      const [operationId] = params;
      const operation = this.pendingOperations.get(String(operationId));
      const recordRow = operation ? this.entityRecords.get(operation.local_record_id) : null;
      if (recordRow) {
        recordRow.sync_status = "syncing";
        recordRow.sync_error_code = null;
        recordRow.sync_error_message = null;
      }
      return undefined;
    }

    if (sql.includes("UPDATE pending_operations") && sql.includes("operation = 'UPDATE'")) {
      const [nextId, serverRecordId, operationId] = params;
      const operation = this.pendingOperations.get(String(operationId));
      if (operation) {
        this.pendingOperations.delete(String(operationId));
        operation.id = String(nextId);
        operation.operation = "UPDATE";
        operation.server_record_id = String(serverRecordId);
        operation.last_error_code = null;
        operation.last_error_message = null;
        this.pendingOperations.set(operation.id, operation);
      }
      return undefined;
    }

    if (sql.includes("UPDATE entity_records") && sql.includes("sync_status = 'pending_update'")) {
      const [serverId, remoteUpdatedAt, localId] = params;
      const recordRow = this.entityRecords.get(String(localId));
      if (recordRow) {
        recordRow.server_id = String(serverId);
        recordRow.remote_updated_at = String(remoteUpdatedAt);
        recordRow.sync_status = "pending_update";
        recordRow.sync_error_code = null;
        recordRow.sync_error_message = null;
        recordRow.conflict_remote_values_json = null;
        recordRow.conflict_remote_display_name = null;
        recordRow.conflict_remote_updated_at = null;
      }
      return undefined;
    }

    if (sql.includes("UPDATE entity_records") && sql.includes("server_id = ?")) {
      const [serverId, displayName, valuesJson, remoteUpdatedAt, cachedAt, syncStatus, localId] = params;
      const recordRow = this.entityRecords.get(String(localId));
      if (recordRow) {
        recordRow.server_id = nullableString(serverId);
        recordRow.display_name = String(displayName);
        recordRow.values_json = String(valuesJson);
        recordRow.remote_updated_at = nullableString(remoteUpdatedAt);
        recordRow.cached_at = String(cachedAt);
        recordRow.sync_status = syncStatus as EntityRecordRow["sync_status"];
        recordRow.sync_error_code = null;
        recordRow.sync_error_message = null;
        recordRow.conflict_remote_values_json = null;
        recordRow.conflict_remote_display_name = null;
        recordRow.conflict_remote_updated_at = null;
      }
      return undefined;
    }

    if (sql.includes("UPDATE entity_records") && sql.includes("SET display_name = ?")) {
      const [displayName, valuesJson, cachedAt, syncStatus, localId] = params;
      const recordRow = this.entityRecords.get(String(localId));
      if (recordRow) {
        recordRow.display_name = String(displayName);
        recordRow.values_json = String(valuesJson);
        recordRow.cached_at = String(cachedAt);
        recordRow.sync_status = syncStatus as EntityRecordRow["sync_status"];
        recordRow.sync_error_code = null;
        recordRow.sync_error_message = null;
        recordRow.conflict_remote_values_json = null;
        recordRow.conflict_remote_display_name = null;
        recordRow.conflict_remote_updated_at = null;
      }
      return undefined;
    }

    if (sql === "DELETE FROM pending_operations WHERE id = ?") {
      const [operationId] = params;
      this.pendingOperations.delete(String(operationId));
      return undefined;
    }

    if (sql.includes("DELETE FROM entity_records") && sql.includes("server_id = ?")) {
      const [ownerKey, contractId, entityTypeId, serverId, exceptLocalId] = params;
      for (const row of [...this.entityRecords.values()]) {
        if (
          row.owner_key === ownerKey &&
          row.contract_id === contractId &&
          row.entity_type_id === entityTypeId &&
          row.server_id === serverId &&
          row.local_id !== exceptLocalId
        ) {
          this.entityRecords.delete(row.local_id);
        }
      }
    }

    return undefined;
  }

  async withTransactionAsync(task: (transaction: StatefulSqliteHarness) => Promise<void>) {
    const entityRecords = cloneMap(this.entityRecords);
    const pendingOperations = cloneMap(this.pendingOperations);
    const syncTelemetry = cloneMap(this.syncTelemetry);

    try {
      await task(this);
    } catch (error) {
      this.entityRecords = entityRecords;
      this.pendingOperations = pendingOperations;
      this.syncTelemetry = syncTelemetry;
      throw error;
    }
  }

  private findRecord({
    contractId,
    entityTypeId,
    localId,
    ownerKey,
    serverId,
  }: {
    contractId: unknown;
    entityTypeId: unknown;
    localId?: unknown;
    ownerKey: unknown;
    serverId?: unknown;
  }) {
    return [...this.entityRecords.values()].find((recordRow) =>
      recordRow.owner_key === ownerKey &&
      recordRow.contract_id === contractId &&
      recordRow.entity_type_id === entityTypeId &&
      (recordRow.local_id === localId || recordRow.server_id === serverId),
    );
  }

  private updateSyncTelemetry(sql: string, params: unknown[]) {
    const ownerKey = String(params.at(-3));
    const contractId = String(params.at(-2));
    const entityTypeId = String(params.at(-1));
    const row = this.syncTelemetry.get(telemetryKey(ownerKey, contractId, entityTypeId));
    if (!row) return;

    if (sql.includes("last_sync_attempt_at")) {
      const [phase, attemptedAt, updatedAt] = params;
      row.sync_phase = String(phase);
      row.last_sync_attempt_at = nullableString(attemptedAt) ?? row.last_sync_attempt_at;
      row.last_sync_error_at = null;
      row.last_sync_error_code = null;
      row.last_sync_error_phase = null;
      row.updated_at = String(updatedAt);
      return;
    }

    if (sql.includes("last_successful_sync_at")) {
      const [completedAt, lastSuccessfulSyncAt, updatedAt] = params;
      if (sql.includes("last_push_completed_at")) row.last_push_completed_at = String(completedAt);
      if (sql.includes("last_full_refresh_completed_at")) row.last_full_refresh_completed_at = String(completedAt);
      if (sql.includes("last_reconcile_completed_at")) row.last_reconcile_completed_at = String(completedAt);
      row.last_successful_sync_at = nullableString(lastSuccessfulSyncAt) ?? row.last_successful_sync_at;
      row.sync_phase = "idle";
      row.last_sync_error_at = null;
      row.last_sync_error_code = null;
      row.last_sync_error_phase = null;
      row.updated_at = String(updatedAt);
      return;
    }

    const [errorAt, code, phase, updatedAt] = params;
    row.sync_phase = "error";
    row.last_sync_error_at = String(errorAt);
    row.last_sync_error_code = nullableString(code);
    row.last_sync_error_phase = nullableString(phase);
    row.updated_at = String(updatedAt);
  }
}

function cloneMap<T>(map: Map<string, T>) {
  return new Map([...map.entries()].map(([key, value]) => [key, structuredClone(value)]));
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

function operationOrder(operation: PendingOperationRow["operation"]) {
  return operation === "CREATE" ? 0 : 1;
}

function telemetryKey(ownerKey: unknown, contractId: unknown, entityTypeId: unknown) {
  return `${ownerKey}:${contractId}:${entityTypeId}`;
}
