import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __getLocalDatabaseDebugStateForTests,
  __resetLocalDatabaseForTests,
  getLocalDatabase,
} from "./local-db";

const sqliteMock = vi.hoisted(() => ({
  openDatabaseAsync: vi.fn(),
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: sqliteMock.openDatabaseAsync,
}));

type MockDatabase = {
  execAsync: ReturnType<typeof vi.fn>;
  getAllAsync: ReturnType<typeof vi.fn>;
  getFirstAsync: ReturnType<typeof vi.fn>;
  runAsync: ReturnType<typeof vi.fn>;
};

let db: MockDatabase;

beforeEach(() => {
  __resetLocalDatabaseForTests();
  db = createMockDatabase();
  sqliteMock.openDatabaseAsync.mockReset();
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
      "7",
    );
    expect(db.runAsync.mock.calls.filter((call) => call[1] === "schema_version")).toHaveLength(1);
    expect(__getLocalDatabaseDebugStateForTests()).toMatchObject({
      hasDatabase: true,
      hasDatabasePromise: true,
      hasMigrationPromise: false,
      migratedSchemaVersion: "7",
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
});

function createMockDatabase(): MockDatabase {
  return {
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

      if (sql.includes("PRAGMA table_info(sync_telemetry)")) {
        return [{ name: "entity_type_id" }];
      }

      return [];
    }),
    getFirstAsync: vi.fn(async () => null),
    runAsync: vi.fn(async () => undefined),
  };
}
