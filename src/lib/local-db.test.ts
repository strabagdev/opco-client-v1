import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __getLocalDatabaseDebugStateForTests,
  __resetLocalDatabaseForTests,
  getLocalDatabaseRecoverySummary,
  getLocalDatabaseStorageState,
  getLocalDatabase,
  resetLocalDatabaseAfterConfirmation,
  retryLocalDatabaseInitialization,
} from "./local-db";

const sqliteMock = vi.hoisted(() => ({
  deleteDatabaseAsync: vi.fn(),
  openDatabaseAsync: vi.fn(),
}));

vi.mock("expo-sqlite", () => ({
  deleteDatabaseAsync: sqliteMock.deleteDatabaseAsync,
  openDatabaseAsync: sqliteMock.openDatabaseAsync,
}));

type MockDatabase = {
  execAsync: ReturnType<typeof vi.fn>;
  closeAsync: ReturnType<typeof vi.fn>;
  getAllAsync: ReturnType<typeof vi.fn>;
  getFirstAsync: ReturnType<typeof vi.fn>;
  runAsync: ReturnType<typeof vi.fn>;
};

let db: MockDatabase;

beforeEach(() => {
  __resetLocalDatabaseForTests();
  db = createMockDatabase();
  sqliteMock.openDatabaseAsync.mockReset();
  sqliteMock.deleteDatabaseAsync.mockReset();
  sqliteMock.deleteDatabaseAsync.mockResolvedValue(undefined);
  sqliteMock.openDatabaseAsync.mockResolvedValue(db);
});

describe("local database singleton", () => {
  it("shares one SQLite open promise across concurrent operations", async () => {
    let resolveOpen: (database: MockDatabase) => void = () => undefined;
    const opening = new Promise<MockDatabase>((resolve) => {
      resolveOpen = resolve;
    });

    sqliteMock.openDatabaseAsync.mockReturnValue(opening);

    const store = getLocalDatabase();
    const firstRead = store.getSelectedContractId();
    const secondRead = store.getSelectedContractId();

    expect(sqliteMock.openDatabaseAsync).toHaveBeenCalledOnce();
    expect(__getLocalDatabaseDebugStateForTests().hasDatabasePromise).toBe(true);

    resolveOpen(db);

    await Promise.all([firstRead, secondRead]);

    expect(sqliteMock.openDatabaseAsync).toHaveBeenCalledOnce();
  });

  it("runs migrations once for repeated local database access", async () => {
    const store = getLocalDatabase();

    await store.getSelectedContractId();
    await store.getSelectedContractId();

    expect(sqliteMock.openDatabaseAsync).toHaveBeenCalledOnce();
    expect(db.runAsync).toHaveBeenCalledWith(
        `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)`,
      "schema_version",
      "8",
    );
    expect(db.runAsync.mock.calls.filter((call) => call[1] === "schema_version")).toHaveLength(1);
    expect(__getLocalDatabaseDebugStateForTests()).toMatchObject({
      hasDatabase: true,
      hasDatabasePromise: true,
      hasMigrationPromise: false,
      migratedSchemaVersion: "8",
    });
  });

  it("restores sync telemetry by owner and contract", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM sync_telemetry")) {
        return {
          contract_id: "contract_1",
          entity_type_id: "entity_1",
          last_full_refresh_completed_at: "2026-08-24T10:03:00.000Z",
          last_push_completed_at: "2026-08-24T10:02:00.000Z",
          last_reconcile_completed_at: "2026-08-24T10:04:00.000Z",
          last_successful_sync_at: "2026-08-24T10:04:00.000Z",
          last_sync_attempt_at: "2026-08-24T10:01:00.000Z",
          last_sync_error_at: null,
          last_sync_error_code: null,
          last_sync_error_phase: null,
          owner_key: "org_1:user_1",
          sync_phase: "idle",
        };
      }

      return null;
    });
    const store = getLocalDatabase();

    await expect(store.getSyncTelemetry({ contractId: "contract_1", entityTypeId: "entity_1", ownerKey: "org_1:user_1" })).resolves.toMatchObject({
      entityTypeId: "entity_1",
      lastSuccessfulSyncAt: "2026-08-24T10:04:00.000Z",
      ownerKey: "org_1:user_1",
      syncPhase: "idle",
    });
  });

  it("shares the same SQLite singleton when UI reads and reconnect sync reads run together", async () => {
    const store = getLocalDatabase();

    await Promise.all([
      store.listCachedRecords({
        contractId: "contract_1",
        entityTypeId: "entity_1",
        ownerKey: "org_1:user_1",
      }),
      store.listPendingOperations("org_1:user_1"),
    ]);

    expect(sqliteMock.openDatabaseAsync).toHaveBeenCalledOnce();
  });

  it("marks storage unavailable when SQLite open fails", async () => {
    sqliteMock.openDatabaseAsync.mockRejectedValueOnce(new Error("OPFS access handle unavailable"));
    const store = getLocalDatabase();

    await expect(store.getSelectedContractId()).rejects.toMatchObject({ code: "SQLITE_UNAVAILABLE" });
    expect(getLocalDatabaseStorageState()).toMatchObject({
      cause: "STORAGE_UNAVAILABLE",
      destructiveRecoveryAvailable: true,
      errorCode: "SQLITE_UNAVAILABLE",
      retryable: true,
      status: "unavailable",
    });
  });

  it("recovers the singleton after a failed open promise when retry succeeds", async () => {
    sqliteMock.openDatabaseAsync
      .mockRejectedValueOnce(new Error("open failed"))
      .mockResolvedValueOnce(db);
    const store = getLocalDatabase();

    await expect(store.getSelectedContractId()).rejects.toMatchObject({ code: "SQLITE_UNAVAILABLE" });
    await expect(retryLocalDatabaseInitialization()).resolves.toBe(db);

    expect(getLocalDatabaseStorageState()).toMatchObject({ status: "ready" });
    expect(sqliteMock.deleteDatabaseAsync).not.toHaveBeenCalled();
    expect(sqliteMock.openDatabaseAsync).toHaveBeenCalledTimes(2);
  });

  it("keeps storage unavailable when retry fails again", async () => {
    sqliteMock.openDatabaseAsync.mockRejectedValue(new Error("open failed"));
    const store = getLocalDatabase();

    await expect(store.getSelectedContractId()).rejects.toMatchObject({ code: "SQLITE_UNAVAILABLE" });
    await expect(retryLocalDatabaseInitialization()).rejects.toMatchObject({ code: "SQLITE_UNAVAILABLE" });

    expect(getLocalDatabaseStorageState()).toMatchObject({
      errorCode: "SQLITE_UNAVAILABLE",
      status: "unavailable",
    });
    expect(sqliteMock.openDatabaseAsync).toHaveBeenCalledTimes(2);
  });

  it("does not advance schema version when migrations fail", async () => {
    db.execAsync.mockRejectedValueOnce(new Error("migration failed"));
    const store = getLocalDatabase();

    await expect(store.getSelectedContractId()).rejects.toMatchObject({ code: "SQLITE_UNAVAILABLE" });

    expect(db.runAsync.mock.calls.filter((call) => call[1] === "schema_version")).toHaveLength(0);
    expect(__getLocalDatabaseDebugStateForTests()).toMatchObject({
      hasDatabase: false,
      migratedSchemaVersion: null,
      storageState: {
        cause: "MIGRATION_FAILED",
        status: "unavailable",
      },
    });
  });

  it("does not reset the database without explicit confirmation", async () => {
    await expect(resetLocalDatabaseAfterConfirmation({ confirmed: false })).rejects.toThrow(/confirmation/i);

    expect(sqliteMock.deleteDatabaseAsync).not.toHaveBeenCalled();
  });

  it("counts local changes at risk before destructive recovery", async () => {
    db.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM entity_records")) {
        return [
          { sync_status: "pending_create", total: 2 },
          { sync_status: "pending_update", total: 3 },
          { sync_status: "failed", total: 1 },
          { sync_status: "conflict", total: 4 },
        ];
      }

      return [];
    });

    await expect(getLocalDatabaseRecoverySummary()).resolves.toEqual({
      canCount: true,
      conflictCount: 4,
      failedCount: 1,
      pendingCreateCount: 2,
      pendingUpdateCount: 3,
      totalAtRiskCount: 10,
    });
  });

  it("deletes local SQLite only after confirmation and recreates schema", async () => {
    await resetLocalDatabaseAfterConfirmation({ confirmed: true });

    expect(sqliteMock.deleteDatabaseAsync).toHaveBeenCalledWith("opco-client.db");
    expect(sqliteMock.openDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(getLocalDatabaseStorageState()).toMatchObject({ status: "ready" });
  });
});

function createMockDatabase(): MockDatabase {
  return {
    closeAsync: vi.fn(async () => undefined),
    execAsync: vi.fn(async () => undefined),
    getAllAsync: vi.fn(async (sql: string) => {
      if (sql.includes("PRAGMA table_info(entity_records)")) {
        return [
          { name: "remote_updated_at" },
          { name: "conflict_remote_values_json" },
          { name: "conflict_remote_display_name" },
          { name: "conflict_remote_updated_at" },
        ];
      }

      if (sql.includes("PRAGMA table_info(context_snapshot)")) {
        return [{ name: "owner_key" }];
      }

      if (sql.includes("PRAGMA table_info(app_views)")) {
        return [{ name: "owner_key" }];
      }

      if (sql.includes("PRAGMA table_info(app_view_definitions)")) {
        return [{ name: "owner_key" }];
      }

      if (sql.includes("PRAGMA table_info(sync_telemetry)")) {
        return [{ name: "entity_type_id" }];
      }

      return [];
    }),
    getFirstAsync: vi.fn(async () => null),
    runAsync: vi.fn(async () => undefined),
  };
}
