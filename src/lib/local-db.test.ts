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
  withTransactionAsync: ReturnType<typeof vi.fn>;
};

let db: MockDatabase;

beforeEach(() => {
  __resetLocalDatabaseForTests();
  vi.unstubAllGlobals();
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

  it("closes the web SQLite handle on pagehide so a later runtime can reopen it", async () => {
    const listeners = new Map<string, () => void>();

    vi.stubGlobal("window", {
      addEventListener: vi.fn((eventName: string, listener: () => void) => {
        listeners.set(eventName, listener);
      }),
    });
    const store = getLocalDatabase();

    await store.getSelectedContractId();
    listeners.get("pagehide")?.();

    expect(db.closeAsync).toHaveBeenCalledOnce();
    expect(__getLocalDatabaseDebugStateForTests()).toMatchObject({
      hasDatabase: false,
      hasDatabasePromise: false,
      migratedSchemaVersion: null,
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

  it("persists the last STATE_UPDATE diagnostics telemetry without raw owner ids in the metadata key", async () => {
    const store = getLocalDatabase();

    await store.setStateUpdateSyncDiagnosticsTelemetry("org_1:user_1", {
      currentConnectivity: {
        status: "online",
        updatedAt: "2026-08-27T10:00:00.000Z",
      },
      lastReconnect: {
        detected: true,
        detectedAt: "2026-08-27T10:00:00.000Z",
        previousConnectivityStatus: "offline",
        resultingConnectivityStatus: "online",
      },
      lastStateUpdateSync: {
        completedAt: "2026-08-27T10:00:02.000Z",
        operationsAttempted: 1,
        operationsCompleted: 1,
        operationsFailed: 0,
        operationsSelected: 1,
        reconciledAfterTimeout: true,
        result: "reconciled_success",
        startedAt: "2026-08-27T10:00:00.000Z",
        trigger: "reconnect",
      },
    });

    expect(db.runAsync).toHaveBeenCalledWith(
      `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)`,
      expect.stringMatching(/^state_update_sync_diagnostics:fp_[a-f0-9]{8}$/),
      expect.stringContaining('"result":"reconciled_success"'),
    );
    expect(db.runAsync.mock.calls.some((call) => call[1] === "state_update_sync_diagnostics:org_1:user_1")).toBe(false);
  });

  it("hydrates persisted STATE_UPDATE diagnostics telemetry from app_metadata", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM app_metadata")) {
        return {
          value: JSON.stringify({
            currentConnectivity: { status: "online", updatedAt: "2026-08-27T10:00:03.000Z" },
            lastReconnect: {
              detected: false,
              detectedAt: "2026-08-27T10:00:00.000Z",
              previousConnectivityStatus: "unknown",
              resultingConnectivityStatus: "online",
            },
            lastStateUpdateSync: {
              completedAt: "2026-08-27T10:00:02.000Z",
              operationsAttempted: 1,
              operationsCompleted: 1,
              operationsFailed: 0,
              operationsSelected: 1,
              reconciledAfterTimeout: false,
              result: "success",
              startedAt: "2026-08-27T10:00:00.000Z",
              trigger: "unknown-to-online",
            },
          }),
        };
      }

      return null;
    });
    const store = getLocalDatabase();

    await expect(store.getStateUpdateSyncDiagnosticsTelemetry("org_1:user_1")).resolves.toMatchObject({
      currentConnectivity: { status: "online" },
      lastReconnect: { detected: false, previousConnectivityStatus: "unknown", resultingConnectivityStatus: "online" },
      lastStateUpdateSync: { operationsCompleted: 1, result: "success", trigger: "unknown-to-online" },
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

  it("returns interrupted syncing STATE_UPDATE operations for retry on reconnect", async () => {
    const store = getLocalDatabase();

    await store.listPendingStateUpdateOperations("org_1:user_1");

    expect(db.getAllAsync).toHaveBeenCalledWith(
      expect.stringContaining("entity_records.sync_status IN ('pending_create', 'pending_update', 'syncing')"),
      "org_1:user_1",
      "STATE_UPDATE",
    );
    expect(db.getAllAsync).not.toHaveBeenCalledWith(
      expect.stringContaining("entity_records.sync_status IN ('pending_create', 'pending_update', 'syncing', 'failed')"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("summarizes STATE_UPDATE outbox diagnostics without exposing raw ids or payloads", async () => {
    db.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM pending_operations") && sql.includes("app_view_definitions")) {
        return [
          stateUpdateDiagnosticsRow({
            client_request_id: "client-request-id-current-1",
            contract_id: "contract_real_1",
            payload_json: JSON.stringify({
              appViewId: "attendance_view_real_1",
              clientRequestId: "client-request-id-current-1",
              date: "2026-08-26",
              extraValues: { motivo: "safe-count-only" },
              stateValues: [{ fieldId: "status_field", optionId: "present_option" }],
              subjectRecordId: "person_real_1",
            }),
            record_sync_status: "syncing",
          }),
          stateUpdateDiagnosticsRow({
            client_request_id: "client-request-id-legacy-1",
            payload_json: JSON.stringify({
              appViewId: "attendance_view_real_1",
              date: "2026-08-26",
              entries: [{ personRecordId: "person_real_2", statusOptionId: "absent_option" }],
            }),
            record_sync_status: "failed",
          }),
        ];
      }

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
    });
    const store = getLocalDatabase();

    const diagnostics = await store.getStateUpdateOutboxDiagnostics("org_1:user_1");

    expect(diagnostics.summary).toMatchObject({
      eligibleForAutoSync: 1,
      failed: 1,
      stateUpdateTotalLocal: 2,
      syncing: 1,
    });
    expect(diagnostics.operations[0]).toMatchObject({
      appViewFingerprint: expect.stringMatching(/^fp_/),
      clientRequestId: "client...nt-1",
      config: {
        matchingStateValuesCount: 1,
        statusOptionResolved: true,
        workflowKey: "attendance",
      },
      contractFingerprint: expect.stringMatching(/^fp_/),
      extraValuesCount: 1,
      payloadSchema: "current",
      manualRetryable: false,
      retryable: true,
      stateValuesCount: 1,
      subjectFingerprint: expect.stringMatching(/^fp_/),
      syncStatus: "syncing",
    });
    expect(diagnostics.operations[1]).toMatchObject({
      manualRetryToken: expect.stringMatching(/^fp_/),
      manualRetryable: true,
      payloadSchema: "legacy-batch",
      retryable: false,
      syncStatus: "failed",
    });
    expect(JSON.stringify(diagnostics)).not.toContain("person_real_1");
    expect(JSON.stringify(diagnostics)).not.toContain("safe-count-only");
  });

  it("moves failed STATE_UPDATE operations back to pending_update only after explicit manual retry", async () => {
    db.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM pending_operations") && sql.includes("entity_records.sync_status = 'failed'")) {
        return [
          stateUpdateDiagnosticsRow({
            client_request_id: "client-request-id-current-1",
            id: "state_update_pending_1",
            local_record_id: "state_update_local_record_1",
            payload_json: JSON.stringify({
              appViewId: "attendance_view_real_1",
              clientRequestId: "client-request-id-current-1",
              date: "2026-08-26",
              extraValues: { motivo: "safe-count-only" },
              stateValues: [{ fieldId: "status_field", optionId: "present_option" }],
              subjectRecordId: "person_real_1",
            }),
            record_sync_status: "failed",
          }),
        ];
      }

      return [];
    });
    const store = getLocalDatabase();

    const retried = await store.retryFailedStateUpdateOperations({ ownerKey: "org_1:user_1" });

    expect(retried).toBe(1);
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE pending_operations"),
      expect.any(String),
      "state_update_pending_1",
      "org_1:user_1",
      "STATE_UPDATE",
    );
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("sync_status = 'pending_update'"),
      "state_update_local_record_1",
    );
    expect(db.runAsync.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("payload_json"))).toBe(false);
    expect(db.runAsync.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("client_request_id"))).toBe(false);
  });

  it("uses the sanitized diagnostics token to retry one failed STATE_UPDATE operation", async () => {
    db.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM pending_operations") && sql.includes("app_view_definitions")) {
        return [
          stateUpdateDiagnosticsRow({
            id: "state_update_pending_1",
            local_record_id: "state_update_local_record_1",
            record_sync_status: "failed",
          }),
          stateUpdateDiagnosticsRow({
            client_request_id: "client-request-id-current-2",
            id: "state_update_pending_2",
            local_record_id: "state_update_local_record_2",
            record_sync_status: "failed",
          }),
        ];
      }

      if (sql.includes("FROM pending_operations") && sql.includes("entity_records.sync_status = 'failed'")) {
        return [
          stateUpdateDiagnosticsRow({
            id: "state_update_pending_1",
            local_record_id: "state_update_local_record_1",
            record_sync_status: "failed",
          }),
          stateUpdateDiagnosticsRow({
            client_request_id: "client-request-id-current-2",
            id: "state_update_pending_2",
            local_record_id: "state_update_local_record_2",
            record_sync_status: "failed",
          }),
        ];
      }

      return [];
    });
    const store = getLocalDatabase();
    const diagnostics = await store.getStateUpdateOutboxDiagnostics("org_1:user_1");
    const manualRetryToken = diagnostics.operations[1].manualRetryToken;

    db.runAsync.mockClear();
    const retried = await store.retryFailedStateUpdateOperations({
      manualRetryToken,
      ownerKey: "org_1:user_1",
    });

    expect(retried).toBe(1);
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE pending_operations"),
      expect.any(String),
      "state_update_pending_2",
      "org_1:user_1",
      "STATE_UPDATE",
    );
    expect(db.runAsync.mock.calls.some((call) => call.includes("state_update_pending_1"))).toBe(false);
  });

  it("reports a mismatch when Attendance has local pending state records but the STATE_UPDATE outbox is empty", async () => {
    db.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM pending_operations") && sql.includes("app_view_definitions")) {
        return [];
      }

      if (sql.includes("FROM entity_records") && sql.includes("pending_operations.id AS pending_operation_id")) {
        return [
          stateUpdateLocalDiagnosticsRow({
            local_id: "state_update_local_record_1",
            pending_operation_id: null,
            remote_updated_at: "2026-08-26T11:00:00.000Z",
            server_id: "attendance_remote_1",
            sync_status: "pending_update",
          }),
          stateUpdateLocalDiagnosticsRow({
            local_id: "state_update_local_record_2",
            pending_operation_id: null,
            sync_status: "pending_create",
          }),
          stateUpdateLocalDiagnosticsRow({
            local_id: "state_update_local_record_3",
            pending_operation_id: null,
            sync_status: "synced",
          }),
        ];
      }

      return [];
    });
    const store = getLocalDatabase();

    const diagnostics = await store.getStateUpdateOutboxDiagnostics("org_1:user_1");

    expect(diagnostics.consistency).toBe("MISMATCH");
    expect(diagnostics.summary).toMatchObject({
      attendanceDerivedPendingCount: 2,
      localPendingCreate: 1,
      localPendingUpdate: 1,
      localSynced: 1,
      localTotal: 3,
      orphanedLocalChange: 1,
      remoteSnapshotRepairable: 1,
      stateUpdateTotalLocal: 0,
    });
    expect(diagnostics.localRecords[0]).toMatchObject({
      hasPendingOperation: false,
      recoveryState: "REMOTE_SNAPSHOT_REPAIRABLE",
      remoteRecordExists: true,
      syncStatus: "pending_update",
      workflowKey: "attendance",
    });
    expect(diagnostics.localRecords[1]).toMatchObject({
      hasPendingOperation: false,
      recoveryState: "ORPHANED_LOCAL_CHANGE",
      remoteRecordExists: false,
      syncStatus: "pending_create",
    });
    expect(JSON.stringify(diagnostics)).not.toContain("person_real_1");
  });

  it("repairs an orphaned local STATE_UPDATE record when the remote snapshot contains the completed state", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM entity_records")) {
        return stateUpdateEntityRecordRow({
          local_id: "state_update_attendance_2026_08_26_person_real_1",
          sync_status: "pending_update",
        });
      }

      if (sql.includes("FROM pending_operations")) {
        return { total: 0 };
      }

      return null;
    });
    const store = getLocalDatabase();

    await store.upsertStateUpdateSnapshot({
      appViewId: "attendance_view_real_1",
      contractId: "contract_real_1",
      date: "2026-08-26",
      items: [{
        current: {
          recordId: "attendance_remote_1",
          stateValues: [{ fieldId: "status_field", label: "Presente", optionId: "present_option" }],
          updatedAt: "2026-08-26T11:00:00.000Z",
        },
        subject: { displayName: "Persona segura", id: "person_real_1" },
      }],
      ownerKey: "org_1:user_1",
      targetEntityTypeId: "attendance",
    });

    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("sync_status = 'synced'"),
      expect.stringMatching(/^state_update_/),
      "attendance_remote_1",
      "org_1:user_1",
      "contract_real_1",
      "attendance",
      "Persona segura",
      expect.any(String),
      "2026-08-26T11:00:00.000Z",
      expect.any(String),
    );
  });

  it("does not overwrite a local STATE_UPDATE record that still has a pending operation", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM entity_records")) {
        return stateUpdateEntityRecordRow({
          local_id: "state_update_attendance_2026_08_26_person_real_1",
          sync_status: "pending_update",
        });
      }

      if (sql.includes("FROM pending_operations")) {
        return { total: 1 };
      }

      return null;
    });
    const store = getLocalDatabase();

    await store.upsertStateUpdateSnapshot({
      appViewId: "attendance_view_real_1",
      contractId: "contract_real_1",
      date: "2026-08-26",
      items: [{
        current: {
          recordId: "attendance_remote_1",
          stateValues: [{ fieldId: "status_field", label: "Presente", optionId: "present_option" }],
          updatedAt: "2026-08-26T11:00:00.000Z",
        },
        subject: { displayName: "Persona segura", id: "person_real_1" },
      }],
      ownerKey: "org_1:user_1",
      targetEntityTypeId: "attendance",
    });

    expect(db.runAsync.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO entity_records"))).toBe(false);
  });

  it("classifies a real local STATE_UPDATE pending row with outbox as protected instead of orphaned", async () => {
    db.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM pending_operations") && sql.includes("app_view_definitions")) {
        return [];
      }

      if (sql.includes("FROM entity_records") && sql.includes("pending_operations.id AS pending_operation_id")) {
        return [
          stateUpdateLocalDiagnosticsRow({
            local_id: "state_update_local_record_1",
            pending_operation_id: "state_update_pending_1",
            sync_status: "pending_update",
          }),
        ];
      }

      return [];
    });
    const store = getLocalDatabase();

    const diagnostics = await store.getStateUpdateOutboxDiagnostics("org_1:user_1");

    expect(diagnostics.localRecords[0]).toMatchObject({
      hasPendingOperation: true,
      recoveryState: "PENDING_WITH_OUTBOX",
      syncStatus: "pending_update",
    });
    expect(diagnostics.summary).toMatchObject({
      orphanedLocalChange: 0,
      remoteSnapshotRepairable: 0,
    });
  });

  it("marks the associated local STATE_UPDATE record as synced when a pending operation completes", async () => {
    db.getFirstAsync.mockResolvedValue({ total: 0 });
    const store = getLocalDatabase();

    await store.completeStateUpdateOperation({
      attempts: 1,
      clientRequestId: "client-request-id-current-1",
      contractId: "contract_real_1",
      createdAt: "2026-08-26T10:00:00.000Z",
      entityTypeId: "attendance",
      id: "state_update_pending_1",
      lastErrorCode: null,
      lastErrorMessage: null,
      localRecordId: "state_update_local_record_1",
      operation: "STATE_UPDATE",
      ownerKey: "org_1:user_1",
      payload: {
        appViewId: "attendance_view_real_1",
        clientRequestId: "client-request-id-current-1",
        date: "2026-08-26",
        historyMode: "update-current",
        stateValues: [{ fieldId: "status_field", label: "Presente", optionId: "present_option" }],
        subjectDisplayName: "Persona segura",
        subjectRecordId: "person_real_1",
        uniqueness: "subject-date",
      },
      serverRecordId: null,
      updatedAt: "2026-08-26T10:01:00.000Z",
    }, {
      recordId: "attendance_remote_1",
      result: "CREATED",
      subjectRecordId: "person_real_1",
    });

    expect(db.runAsync).toHaveBeenCalledWith(
      `DELETE FROM pending_operations WHERE id = ? AND operation = ?`,
      "state_update_pending_1",
      "STATE_UPDATE",
    );
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("sync_status = 'synced'"),
      "attendance_remote_1",
      "Persona segura",
      expect.any(String),
      expect.any(String),
      expect.any(String),
      "state_update_local_record_1",
    );
  });

  it("persists the local STATE_UPDATE record and outbox operation in one SQLite transaction", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM entity_records")) {
        return stateUpdateEntityRecordRow({
          local_id: "state_update_attendance_2026_08_26_person_a",
          sync_status: "pending_create",
        });
      }

      return null;
    });
    const store = getLocalDatabase();

    await store.saveStateUpdateLocally(stateUpdateSaveInput("person_a"));

    expect(db.withTransactionAsync).toHaveBeenCalledOnce();
    const transactionTask = db.withTransactionAsync.mock.calls[0][0] as () => Promise<void>;

    db.runAsync.mockClear();
    await transactionTask();

    expect(db.runAsync.mock.calls[0][0]).toContain("INSERT INTO entity_records");
    expect(db.runAsync.mock.calls[1][0]).toContain("INSERT INTO pending_operations");
  });

  it("does not report local save success when the STATE_UPDATE outbox insert fails inside the transaction", async () => {
    db.withTransactionAsync.mockImplementationOnce(async (task: () => Promise<void>) => {
      await expect(task()).rejects.toThrow("pending insert failed");
      throw new Error("pending insert failed");
    });
    db.runAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO pending_operations")) {
        throw new Error("pending insert failed");
      }
      return undefined;
    });
    const store = getLocalDatabase();

    await expect(store.saveStateUpdateLocally(stateUpdateSaveInput("person_a"))).rejects.toThrow("pending insert failed");

    const saveCalls = db.runAsync.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO entity_records") || String(sql).includes("INSERT INTO pending_operations"),
    );

    expect(saveCalls[0][0]).toContain("INSERT INTO entity_records");
    expect(saveCalls[1][0]).toContain("INSERT INTO pending_operations");
  });

  it("creates three persisted STATE_UPDATE intents for three different Attendance people", async () => {
    const savedRows = new Map<string, ReturnType<typeof stateUpdateEntityRecordRow>>();

    db.getFirstAsync.mockImplementation(async (sql: string, ...params: unknown[]) => {
      if (sql.includes("FROM entity_records")) {
        return savedRows.get(String(params.at(-1))) ?? null;
      }

      return null;
    });
    db.runAsync.mockImplementation(async (sql: string, ...params: unknown[]) => {
      if (sql.includes("INSERT INTO entity_records")) {
        const localId = String(params[0]);

        savedRows.set(localId, stateUpdateEntityRecordRow({
          display_name: String(params[5]),
          local_id: localId,
          sync_status: params[9],
          values_json: String(params[6]),
        }));
      }
      return undefined;
    });
    const store = getLocalDatabase();

    await store.saveStateUpdateLocally(stateUpdateSaveInput("person_a"));
    await store.saveStateUpdateLocally(stateUpdateSaveInput("person_b"));
    await store.saveStateUpdateLocally(stateUpdateSaveInput("person_c"));

    const recordInserts = db.runAsync.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO entity_records"));
    const operationInserts = db.runAsync.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO pending_operations"));

    expect(recordInserts).toHaveLength(3);
    expect(operationInserts).toHaveLength(3);
    expect(new Set(recordInserts.map((call) => call[0])).size).toBe(1);
    expect(new Set(recordInserts.map((call) => call[1])).size).toBe(3);
    expect(recordInserts.map((call) => call[1])).toEqual([
      expect.stringContaining("person_a"),
      expect.stringContaining("person_b"),
      expect.stringContaining("person_c"),
    ]);
  });

  it("consolidates repeated Attendance update-current saves for the same person and date", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM pending_operations")) {
        return stateUpdateDiagnosticsRow({
          client_request_id: "stable-client-request",
          local_record_id: "state_update_view_attendance_2026_08_26_person_a",
        });
      }

      if (sql.includes("FROM entity_records")) {
        return stateUpdateEntityRecordRow({
          local_id: "state_update_view_attendance_2026_08_26_person_a",
          sync_status: "pending_update",
        });
      }

      return null;
    });
    const store = getLocalDatabase();

    await store.saveStateUpdateLocally(stateUpdateSaveInput("person_a", "present_option"));
    await store.saveStateUpdateLocally(stateUpdateSaveInput("person_a", "absent_option"));

    const operationInserts = db.runAsync.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO pending_operations"));

    expect(operationInserts).toHaveLength(2);
    expect(new Set(operationInserts.map((call) => call[1])).size).toBe(1);
    expect(operationInserts[0][2]).toBe("stable-client-request");
    expect(operationInserts[1][2]).toBe("stable-client-request");
    expect(String(operationInserts[1][9])).toContain("absent_option");
  });

  it("uses scoped local ids for new remote records so legacy rows from another scope cannot steal the current scope", async () => {
    const store = getLocalDatabase();
    const records = Array.from({ length: 388 }, (_, index) => remoteRecord(`persona_${index + 1}`));

    await store.upsertRemoteRecords({
      contractId: "contract_1",
      entityTypeId: "personas",
      ownerKey: "org_1:user_brenda",
      records,
    });

    const recordInserts = db.runAsync.mock.calls.filter(([sql]) =>
      typeof sql === "string" && sql.includes("INSERT INTO entity_records"),
    );
    const localIds = recordInserts.map(([, localId]) => localId);

    expect(recordInserts).toHaveLength(388);
    expect(localIds).toHaveLength(new Set(localIds).size);
    expect(localIds[0]).toMatch(/^remote_/);
    expect(localIds).not.toContain("persona_1");
  });

  it("preserves an existing current-scope local id when refreshing a known remote record", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM entity_records")) {
        return {
          cached_at: "2026-08-24T10:00:00.000Z",
          conflict_remote_display_name: null,
          conflict_remote_updated_at: null,
          conflict_remote_values_json: null,
          contract_id: "contract_1",
          display_name: "Persona 1",
          entity_type_id: "personas",
          local_id: "legacy_current_local_id",
          owner_key: "org_1:user_brenda",
          remote_updated_at: "2026-08-24T10:00:00.000Z",
          server_id: "persona_1",
          sync_error_code: null,
          sync_error_message: null,
          sync_status: "synced",
          values_json: "{}",
        };
      }

      return null;
    });
    const store = getLocalDatabase();

    await store.upsertRemoteRecords({
      contractId: "contract_1",
      entityTypeId: "personas",
      ownerKey: "org_1:user_brenda",
      records: [remoteRecord("persona_1")],
    });

    const recordInsert = db.runAsync.mock.calls.find(([sql]) =>
      typeof sql === "string" && sql.includes("INSERT INTO entity_records"),
    );

    expect(recordInsert?.[1]).toBe("legacy_current_local_id");
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

  it("classifies OPFS Access Handle contention separately from unavailable storage", async () => {
    const accessHandleError = new Error(
      "Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.",
    );
    accessHandleError.name = "NoModificationAllowedError";
    sqliteMock.openDatabaseAsync.mockRejectedValueOnce(accessHandleError);
    const store = getLocalDatabase();

    await expect(store.getSelectedContractId()).rejects.toMatchObject({ code: "SQLITE_UNAVAILABLE" });
    expect(getLocalDatabaseStorageState()).toMatchObject({
      cause: "ACCESS_HANDLE_BUSY",
      destructiveRecoveryAvailable: false,
      errorCode: "SQLITE_UNAVAILABLE",
      retryable: true,
      status: "unavailable",
      technicalMessage: expect.stringContaining("createSyncAccessHandle"),
    });
  });

  it("retries after an OPFS Access Handle is released without deleting SQLite", async () => {
    const accessHandleError = new Error("createSyncAccessHandle failed because another open Access Handle exists");

    sqliteMock.openDatabaseAsync
      .mockRejectedValueOnce(accessHandleError)
      .mockResolvedValueOnce(db);
    const store = getLocalDatabase();

    await expect(store.getSelectedContractId()).rejects.toMatchObject({ code: "SQLITE_UNAVAILABLE" });
    await expect(retryLocalDatabaseInitialization()).resolves.toBe(db);

    expect(getLocalDatabaseStorageState()).toMatchObject({ status: "ready" });
    expect(sqliteMock.deleteDatabaseAsync).not.toHaveBeenCalled();
    expect(sqliteMock.openDatabaseAsync).toHaveBeenCalledTimes(2);
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
    withTransactionAsync: vi.fn(async (task: () => Promise<void>) => task()),
  };
}

function remoteRecord(id: string) {
  return {
    displayName: id,
    id,
    updatedAt: "2026-08-24T10:00:00.000Z",
    values: { nombre: id },
  };
}

function stateUpdateDiagnosticsRow(overrides: Record<string, unknown>) {
  return {
    attempts: 2,
    client_request_id: "client-request-id-current-1",
    contract_id: "contract_real_1",
    created_at: "2026-08-26T10:00:00.000Z",
    definition_json: JSON.stringify({
      appView: {
        config: { workflowKey: "attendance" },
        id: "attendance_view_real_1",
        icon: null,
        name: "Attendance",
        slug: "attendance",
        sortOrder: 1,
        type: "WORKFLOW",
      },
      dateFieldId: "date_field",
      extraFields: [{ id: "motivo" }],
      historyMode: "update-current",
      kind: "state-update",
      sourceEntityTypeId: "personas",
      stateFields: [
        {
          fieldId: "status_field",
          label: "Estado",
          options: [
            { label: "Presente", optionId: "present_option" },
            { label: "Ausente", optionId: "absent_option" },
          ],
          required: true,
        },
      ],
      subjectFieldId: "persona",
      targetEntityTypeId: "attendance",
      uniqueness: "subject-date",
    }),
    definition_status: "ready",
    definition_workflow_key: "attendance",
    entity_type_id: "attendance",
    id: "state_update_local_1",
    last_error_code: null,
    last_error_message: null,
    local_record_id: "state_update_local_record_1",
    operation: "STATE_UPDATE",
    owner_key: "org_real:user_real",
    payload_json: "{}",
    record_cached_at: "2026-08-26T10:01:00.000Z",
    record_sync_error_code: null,
    record_sync_error_message: null,
    record_sync_status: "syncing",
    server_record_id: null,
    updated_at: "2026-08-26T10:02:00.000Z",
    ...overrides,
  };
}

function stateUpdateLocalDiagnosticsRow(overrides: Record<string, unknown>) {
  return {
    cached_at: "2026-08-26T10:01:00.000Z",
    conflict_remote_display_name: null,
    conflict_remote_updated_at: null,
    conflict_remote_values_json: null,
    contract_id: "contract_real_1",
    definition_json: JSON.stringify({
      appView: {
        config: { workflowKey: "attendance" },
        id: "attendance_view_real_1",
        icon: null,
        name: "Attendance",
        slug: "attendance",
        sortOrder: 1,
        type: "WORKFLOW",
      },
      kind: "state-update",
    }),
    definition_status: "ready",
    definition_workflow_key: "attendance",
    display_name: "Persona segura",
    entity_type_id: "attendance",
    local_id: "state_update_local_record_1",
    owner_key: "org_real:user_real",
    pending_operation_id: null,
    remote_updated_at: null,
    server_id: null,
    sync_error_code: null,
    sync_error_message: null,
    sync_status: "pending_update",
    values_json: JSON.stringify({
      appViewId: "attendance_view_real_1",
      date: "2026-08-26",
      stateValues: [{ fieldId: "status_field", optionId: "present_option" }],
      subjectRecordId: "person_real_1",
    }),
    ...overrides,
  };
}

function stateUpdateEntityRecordRow(overrides: Record<string, unknown>) {
  return {
    cached_at: "2026-08-26T10:01:00.000Z",
    conflict_remote_display_name: null,
    conflict_remote_updated_at: null,
    conflict_remote_values_json: null,
    contract_id: "contract_real_1",
    display_name: "Persona segura",
    entity_type_id: "attendance",
    local_id: "state_update_attendance_2026_08_26_person_real_1",
    owner_key: "org_1:user_1",
    remote_updated_at: null,
    server_id: null,
    sync_error_code: null,
    sync_error_message: null,
    sync_status: "pending_update",
    values_json: JSON.stringify({
      appViewId: "attendance_view_real_1",
      date: "2026-08-26",
      stateValues: [{ fieldId: "status_field", optionId: "present_option" }],
      subjectDisplayName: "Persona segura",
      subjectRecordId: "person_real_1",
    }),
    ...overrides,
  };
}

function stateUpdateSaveInput(subjectRecordId: string, optionId = "present_option") {
  return {
    appViewId: "view_attendance",
    contractId: "contract_real_1",
    date: "2026-08-26",
    historyMode: "update-current" as const,
    ownerKey: "org_1:user_1",
    stateFields: [{
      fieldId: "status_field",
      label: "Estado",
      options: [
        { label: "Presente", optionId: "present_option" },
        { label: "Ausente", optionId: "absent_option" },
      ],
      required: true,
    }],
    stateValues: [{ fieldId: "status_field", optionId }],
    subjectDisplayName: `Persona ${subjectRecordId}`,
    subjectRecordId,
    targetEntityTypeId: "attendance",
    uniqueness: "subject-date" as const,
  };
}
