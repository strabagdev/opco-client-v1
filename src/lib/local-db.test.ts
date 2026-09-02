import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __getLocalDatabaseDebugStateForTests,
  __resetLocalDatabaseForTests,
  getLocalDatabaseRecoverySummary,
  getLocalDatabaseStorageState,
  getLocalDatabase,
  resetLocalDatabaseAfterConfirmation,
  retryLocalDatabaseInitialization,
  subscribeLocalDatabaseCacheChanges,
} from "./local-db";
import { PendingOperation } from "./offline-records";
import { EntityField } from "./opco-api";
import { STATE_UPDATE_REQUEST_HISTORY_LIMIT, StateUpdateRequestHistoryEvent } from "./state-update-offline";

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
      lastStateUpdateActivity: null,
      lastStateUpdateSync: {
        completedAt: "2026-08-27T10:00:02.000Z",
        lastRequestDiagnostics: {
          abortControllerTriggered: true,
          fetchResolvedAt: null,
          httpStatus: null,
          pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update",
          requestCompletedAt: "2026-08-27T10:00:12.000Z",
          requestDurationMs: 12000,
          requestStartedAt: "2026-08-27T10:00:00.000Z",
          responseBodyStartedAt: null,
          responseParsedAt: null,
          responseStarted: false,
          timeoutMs: 12000,
        },
        operationsAttempted: 1,
        operationsCompleted: 1,
        operationsFailed: 0,
        operationsSelected: 1,
        reconciledAfterTimeout: true,
        result: "reconciled_success",
        startedAt: "2026-08-27T10:00:00.000Z",
        syncRunId: "sync_reconnect_1",
        timeoutOccurred: true,
        trigger: "reconnect",
      },
      lastVisibleErrorEvent: null,
    });

    expect(db.runAsync).toHaveBeenCalledWith(
      `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)`,
      expect.stringMatching(/^state_update_sync_diagnostics:fp_[a-f0-9]{8}$/),
      expect.stringContaining('"result":"reconciled_success"'),
    );
    expect(db.runAsync.mock.calls.some((call) => call[1] === "state_update_sync_diagnostics:org_1:user_1")).toBe(false);
  });

  it("persists offline preparation diagnostics without raw owner ids in the metadata key", async () => {
    const store = getLocalDatabase();

    await store.setOfflinePreparationDiagnostics("org_1:user_1", {
      appViews: {
        completed: 1,
        failed: 0,
        running: 0,
        total: 1,
      },
      lastAppView: null,
      prewarmCompletedAt: "2026-08-30T10:00:02.000Z",
      prewarmDurationMs: 2000,
      prewarmStartedAt: "2026-08-30T10:00:00.000Z",
      slow: false,
      slowestStages: [],
      status: "completed",
    });

    expect(db.runAsync).toHaveBeenCalledWith(
      `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)`,
      expect.stringMatching(/^offline_preparation_diagnostics:fp_[a-f0-9]{8}$/),
      expect.stringContaining('"status":"completed"'),
    );
    expect(db.runAsync.mock.calls.some((call) => call[1] === "offline_preparation_diagnostics:org_1:user_1")).toBe(false);
  });

  it("persists Attendance day snapshot hydration by scoped metadata", async () => {
    const store = getLocalDatabase();

    await store.markAttendanceDaySnapshotHydrated({
      appViewId: "view_attendance",
      contractId: "contract_1",
      date: "2026-08-31",
      ownerKey: "org_1:user_1",
      refreshedAt: "2026-08-31T12:00:00.000Z",
      targetEntityTypeId: "entity_attendance",
    });

    const metadataCall = db.runAsync.mock.calls.find(
      (call) => call[0] === `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)` &&
        typeof call[1] === "string" &&
        call[1].startsWith("attendance_day_snapshot_hydration:"),
    );

    expect(metadataCall?.[1]).toContain("contract_1:view_attendance:entity_attendance:2026-08-31");
    expect(metadataCall?.[1]).not.toContain("org_1:user_1");
    expect(JSON.parse(String(metadataCall?.[2]))).toEqual({
      lastSuccessfulRefreshAt: "2026-08-31T12:00:00.000Z",
    });
  });

  it("hydrates Attendance day snapshot metadata from app_metadata", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM app_metadata")) {
        return {
          value: JSON.stringify({
            lastSuccessfulRefreshAt: "2026-08-31T12:00:00.000Z",
          }),
        };
      }

      return null;
    });

    await expect(getLocalDatabase().getAttendanceDaySnapshotHydration({
      appViewId: "view_attendance",
      contractId: "contract_1",
      date: "2026-08-31",
      ownerKey: "org_1:user_1",
      targetEntityTypeId: "entity_attendance",
    })).resolves.toEqual({
      lastSuccessfulRefreshAt: "2026-08-31T12:00:00.000Z",
    });
  });

  it("hydrates offline preparation diagnostics from app_metadata", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM app_metadata")) {
        return {
          value: JSON.stringify({
            appViews: {
              completed: 1,
              failed: 0,
              running: 0,
              total: 1,
            },
            lastAppView: {
              appViewCompletedAt: "2026-08-30T10:00:02.000Z",
              appViewStartedAt: "2026-08-30T10:00:00.000Z",
              appViewType: "RECORDS",
              durationMs: 2000,
              errorCode: null,
              fingerprint: "fp_12345678",
              result: "success",
              slow: false,
              stage: "sqlite_write",
              workflowKey: null,
            },
            prewarmCompletedAt: "2026-08-30T10:00:02.000Z",
            prewarmDurationMs: 2000,
            prewarmStartedAt: "2026-08-30T10:00:00.000Z",
            slow: false,
            slowestStages: [{
              completedAt: "2026-08-30T10:00:01.000Z",
              durationMs: 1000,
              result: "success",
              stage: "definition_load",
              startedAt: "2026-08-30T10:00:00.000Z",
            }],
            status: "completed",
          }),
        };
      }

      return null;
    });
    const store = getLocalDatabase();

    await expect(store.getOfflinePreparationDiagnostics("org_1:user_1")).resolves.toMatchObject({
      appViews: {
        completed: 1,
        failed: 0,
        running: 0,
        total: 1,
      },
      lastAppView: {
        fingerprint: "fp_12345678",
      },
      slowestStages: [{
        stage: "definition_load",
      }],
      status: "completed",
    });
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
            lastReconnectPreflight: {
              authDecision: "token_valid",
              authRefreshCompletedAt: null,
              authRefreshStartedAt: null,
              completedAt: "2026-08-27T10:00:02.500Z",
              countPendingOperationsCount: 0,
              countPendingOperationsDurationMs: 12,
              debounceCompletedAt: "2026-08-27T10:00:00.300Z",
              debounceDurationMs: 300,
              debounceStartedAt: "2026-08-27T10:00:00.000Z",
              listPendingStateUpdateOperationsCount: 1,
              listPendingStateUpdateOperationsDurationMs: 18,
              readinessAttempts: 2,
              readinessCompletedAt: "2026-08-27T10:00:02.500Z",
              readinessConfirmedAt: "2026-08-27T10:00:02.500Z",
              readinessDurationMs: 2200,
              readinessStartedAt: "2026-08-27T10:00:00.300Z",
              reconnectDetectedAt: "2026-08-27T10:00:00.000Z",
              runSyncStartedAt: "2026-08-27T10:00:00.300Z",
              scopeCheckAfterReadiness: "current",
              shouldSyncCompletedAt: "2026-08-27T10:00:00.320Z",
              shouldSyncDurationMs: 20,
              shouldSyncResult: true,
              shouldSyncStartedAt: "2026-08-27T10:00:00.300Z",
              syncPendingWorkCompletedAt: "2026-08-27T10:00:02.900Z",
              syncPendingWorkStartedAt: "2026-08-27T10:00:02.600Z",
              syncRunId: "sync_unknown_1",
              trigger: "unknown-to-online",
            },
            lastStateUpdateSync: {
              completedAt: "2026-08-27T10:00:02.000Z",
              lastRequestDiagnostics: {
                abortControllerTriggered: false,
                attemptNumber: 2,
                fetchResolvedAt: "2026-08-27T10:00:01.000Z",
                httpStatus: 200,
                pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update",
                requestCompletedAt: "2026-08-27T10:00:02.000Z",
                requestDurationMs: 2000,
                requestStartedAt: "2026-08-27T10:00:00.000Z",
                responseBodyStartedAt: "2026-08-27T10:00:01.000Z",
                responseParsedAt: "2026-08-27T10:00:02.000Z",
                responseStarted: true,
                timeoutMs: 12000,
              },
              operationsAttempted: 1,
              operationsCompleted: 1,
              operationsFailed: 0,
              operationsSelected: 1,
              reconciledAfterTimeout: false,
              result: "success",
              startedAt: "2026-08-27T10:00:00.000Z",
              syncRunId: "sync_unknown_1",
              timeoutOccurred: false,
              trigger: "unknown-to-online",
            },
            reconnectRunHistory: [
              {
                authDecision: "token_valid",
                authRefreshCompletedAt: null,
                authRefreshStartedAt: null,
                completedAt: "2026-08-27T10:00:02.500Z",
                countPendingOperationsCount: 0,
                countPendingOperationsDurationMs: 12,
                debounceCompletedAt: "2026-08-27T10:00:00.300Z",
                debounceDurationMs: 300,
                debounceStartedAt: "2026-08-27T10:00:00.000Z",
                listPendingStateUpdateOperationsCount: 1,
                listPendingStateUpdateOperationsDurationMs: 18,
                readinessAttempts: 2,
                readinessCompletedAt: "2026-08-27T10:00:02.500Z",
                readinessConfirmedAt: "2026-08-27T10:00:02.500Z",
                readinessDurationMs: 2200,
                readinessStartedAt: "2026-08-27T10:00:00.300Z",
                reconnectDetectedAt: "2026-08-27T10:00:00.000Z",
                runSyncStartedAt: "2026-08-27T10:00:00.300Z",
                scopeCheckAfterReadiness: "current",
                shouldSyncCompletedAt: "2026-08-27T10:00:00.320Z",
                shouldSyncDurationMs: 20,
                shouldSyncResult: true,
                shouldSyncStartedAt: "2026-08-27T10:00:00.300Z",
                syncPendingWorkCompletedAt: "2026-08-27T10:00:02.900Z",
                syncPendingWorkStartedAt: "2026-08-27T10:00:02.600Z",
                syncRunId: "sync_unknown_1",
                trigger: "unknown-to-online",
              },
            ],
          }),
        };
      }

      return null;
    });
    const store = getLocalDatabase();

    await expect(store.getStateUpdateSyncDiagnosticsTelemetry("org_1:user_1")).resolves.toMatchObject({
      currentConnectivity: { status: "online" },
      lastReconnect: { detected: true, previousConnectivityStatus: "unknown", resultingConnectivityStatus: "online" },
      lastReconnectPreflight: {
        authDecision: "token_valid",
        countPendingOperationsCount: 0,
        debounceDurationMs: 300,
        listPendingStateUpdateOperationsCount: 1,
        readinessAttempts: 2,
        readinessConfirmedAt: "2026-08-27T10:00:02.500Z",
        scopeCheckAfterReadiness: "current",
        shouldSyncDurationMs: 20,
        syncPendingWorkCompletedAt: "2026-08-27T10:00:02.900Z",
        syncPendingWorkStartedAt: "2026-08-27T10:00:02.600Z",
        syncRunId: "sync_unknown_1",
      },
      lastStateUpdateActivity: null,
      lastStateUpdateSync: {
        lastRequestDiagnostics: { attemptNumber: 2, httpStatus: 200, requestDurationMs: 2000 },
        operationsCompleted: 1,
        result: "success",
        syncRunId: "sync_unknown_1",
        timeoutOccurred: false,
        trigger: "unknown-to-online",
      },
      lastVisibleErrorEvent: null,
      reconnectRunHistory: [
        expect.objectContaining({
          readinessConfirmedAt: "2026-08-27T10:00:02.500Z",
          syncPendingWorkStartedAt: "2026-08-27T10:00:02.600Z",
          syncRunId: "sync_unknown_1",
        }),
      ],
    });
  });

  it("hydrates terminal readiness activity results from app_metadata", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM app_metadata")) {
        return {
          value: JSON.stringify({
            currentConnectivity: { status: "online", updatedAt: "2026-08-29T10:00:03.000Z" },
            lastReconnect: {
              detected: true,
              detectedAt: "2026-08-29T10:00:00.000Z",
              previousConnectivityStatus: "unknown",
              resultingConnectivityStatus: "online",
            },
            lastStateUpdateActivity: {
              completedAt: "2026-08-29T10:00:01.000Z",
              lastRequestDiagnostics: null,
              operationsCompleted: 0,
              operationsFailed: 0,
              result: "interrupted",
              startedAt: "2026-08-29T10:00:00.000Z",
              syncRunId: "sync_interrupted_ready",
              timeoutOccurred: false,
              trigger: "ready_check",
              type: "ready_check",
            },
          }),
        };
      }

      return null;
    });

    await expect(getLocalDatabase().getStateUpdateSyncDiagnosticsTelemetry("org_1:user_1")).resolves.toMatchObject({
      lastStateUpdateActivity: {
        result: "interrupted",
        syncRunId: "sync_interrupted_ready",
        type: "ready_check",
      },
    });
  });

  it("hydrates bounded STATE_UPDATE request history without raw owner ids", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM app_metadata")) {
        return {
          value: JSON.stringify({
            currentConnectivity: { status: "online", updatedAt: "2026-08-29T10:00:03.000Z" },
            lastReconnect: {
              detectedAt: "2026-08-29T10:00:00.000Z",
              previousConnectivityStatus: "offline",
              resultingConnectivityStatus: "online",
            },
            lastStateUpdateActivity: null,
            lastStateUpdateSync: null,
            lastVisibleErrorEvent: null,
            requestHistory: [{
              abortControllerTriggered: false,
              diagnosticOperation: "SAVE",
              diagnosticRequestId: "opco_diag_123",
              fetchResolvedAt: "2026-08-29T10:00:01.000Z",
              httpStatus: 200,
              interpretation: "success",
              method: "POST",
              pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update",
              requestCompletedAt: "2026-08-29T10:00:02.000Z",
              requestDurationMs: 2000,
              requestStartedAt: "2026-08-29T10:00:00.000Z",
              responseBodyStartedAt: "2026-08-29T10:00:01.000Z",
              responseParsedAt: "2026-08-29T10:00:02.000Z",
              responseRequestId: "opco_diag_123",
              responseStarted: true,
              serverTiming: [{ durationMs: 1500, name: "total" }],
              timeoutMs: 12000,
            }],
          }),
        };
      }

      return null;
    });
    const store = getLocalDatabase();

    const telemetry = await store.getStateUpdateSyncDiagnosticsTelemetry("org_1:user_1");

    expect(telemetry?.requestHistory).toEqual([
      expect.objectContaining({
        diagnosticOperation: "SAVE",
        diagnosticRequestId: "opco_diag_123",
        interpretation: "success",
        serverTiming: [expect.objectContaining({ durationMs: 1500, name: "total" })],
      }),
    ]);
    expect(db.getFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("FROM app_metadata"),
      expect.stringMatching(/^state_update_sync_diagnostics:fp_[a-f0-9]{8}$/),
    );
  });

  it("hydrates the same 50 most recent STATE_UPDATE request history events persisted by writes", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM app_metadata")) {
        return {
          value: JSON.stringify({
            currentConnectivity: { status: "online", updatedAt: "2026-08-29T10:00:03.000Z" },
            lastReconnect: {
              detectedAt: "2026-08-29T10:00:00.000Z",
              previousConnectivityStatus: "offline",
              resultingConnectivityStatus: "online",
            },
            lastStateUpdateActivity: null,
            lastStateUpdateSync: null,
            lastVisibleErrorEvent: null,
            requestHistory: Array.from({ length: STATE_UPDATE_REQUEST_HISTORY_LIMIT + 1 }, (_, index) => stateUpdateRequestHistoryEvent({
              diagnosticRequestId: `opco_diag_${index + 1}`,
              requestCompletedAt: `2026-08-29T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
              requestStartedAt: `2026-08-29T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
            })),
          }),
        };
      }

      return null;
    });

    const telemetry = await getLocalDatabase().getStateUpdateSyncDiagnosticsTelemetry("org_1:user_1");

    expect(telemetry?.requestHistory).toHaveLength(STATE_UPDATE_REQUEST_HISTORY_LIMIT);
    expect(telemetry?.requestHistory?.[0]?.diagnosticRequestId).toBe("opco_diag_2");
    expect(telemetry?.requestHistory?.at(-1)?.diagnosticRequestId).toBe("opco_diag_51");
  });

  it("persists the last visible STATE_UPDATE UI error with the same sanitized owner scope", async () => {
    db.getFirstAsync.mockResolvedValueOnce(null);
    const store = getLocalDatabase();

    await store.recordStateUpdateVisibleErrorEvent("org_1:user_1", {
      clearedAt: null,
      durationMs: 12000,
      errorCode: "OpcoNetworkError",
      httpStatus: null,
      method: "GET",
      occurredAt: "2026-08-28T11:00:00.000Z",
      operation: "refresh",
      pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/attendance",
      resolution: "unresolved",
      syncRunId: "sync_reconnect_1",
      timeoutOccurred: true,
    });

    const write = db.runAsync.mock.calls.find((call) =>
      call[0] === `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)` &&
      String(call[1]).startsWith("state_update_sync_diagnostics:"),
    );

    expect(write?.[1]).toEqual(expect.stringMatching(/^state_update_sync_diagnostics:fp_[a-f0-9]{8}$/));
    expect(write?.[1]).not.toBe("state_update_sync_diagnostics:org_1:user_1");
    expect(write?.[2]).toEqual(expect.stringContaining('"lastVisibleErrorEvent"'));
    expect(write?.[2]).toEqual(expect.stringContaining('"operation":"refresh"'));
    expect(write?.[2]).not.toEqual(expect.stringContaining("org_1:user_1"));
  });

  it("persists the last session termination diagnostics without raw owner ids", async () => {
    db.getFirstAsync.mockResolvedValueOnce(null);
    const store = getLocalDatabase();

    await store.recordStateUpdateSessionTermination("org_1:user_1", {
      errorCode: "REFRESH_TOKEN_EXPIRED",
      reason: "refresh_invalid",
      requestId: "opco_diag_refresh",
      source: "AUTH_REFRESH",
      timestamp: "2026-08-29T10:00:00.000Z",
    });

    const write = db.runAsync.mock.calls.find((call) =>
      call[0] === `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)` &&
      String(call[1]).startsWith("state_update_sync_diagnostics:"),
    );

    expect(write?.[1]).toEqual(expect.stringMatching(/^state_update_sync_diagnostics:fp_[a-f0-9]{8}$/));
    expect(write?.[2]).toEqual(expect.stringContaining('"lastSessionTermination"'));
    expect(write?.[2]).toEqual(expect.stringContaining('"source":"AUTH_REFRESH"'));
    expect(write?.[2]).toEqual(expect.stringContaining('"errorCode":"REFRESH_TOKEN_EXPIRED"'));
    expect(write?.[2]).not.toEqual(expect.stringContaining("org_1:user_1"));
  });

  it("persists attendance context selections by owner, contract, app view, and field id", async () => {
    const store = getLocalDatabase();

    await store.setAttendanceContextSelection("org_1:user_1", "contract_1", "view_attendance", "shift_field", "shift_day");

    const write = db.runAsync.mock.calls.find((call) =>
      call[0] === `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)` &&
      String(call[1]).startsWith("attendance_context_selection:"),
    );

    expect(write?.[1]).toEqual(expect.stringMatching(/^attendance_context_selection:fp_[a-f0-9]{8}:contract_1:view_attendance:shift_field$/));
    expect(write?.[1]).not.toContain("org_1:user_1");
    expect(write?.[2]).toBe("shift_day");

    db.getFirstAsync.mockResolvedValueOnce({ value: "shift_day" });
    await expect(store.getAttendanceContextSelection("org_1:user_1", "contract_1", "view_attendance", "shift_field"))
      .resolves.toBe("shift_day");

    await store.setAttendanceContextSelection("org_1:user_1", "contract_1", "view_attendance", "shift_field", null);
    expect(db.runAsync).toHaveBeenCalledWith(
      `DELETE FROM app_metadata WHERE key = ?`,
      expect.stringMatching(/^attendance_context_selection:fp_[a-f0-9]{8}:contract_1:view_attendance:shift_field$/),
    );
  });

  it("resolves the last visible STATE_UPDATE UI error without deleting the historical event", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM app_metadata")) {
        return {
          value: JSON.stringify({
            currentConnectivity: { status: "online", updatedAt: "2026-08-28T11:00:00.000Z" },
            lastReconnect: {
              detected: true,
              detectedAt: "2026-08-28T11:00:00.000Z",
              previousConnectivityStatus: "offline",
              resultingConnectivityStatus: "online",
            },
            lastStateUpdateActivity: null,
            lastStateUpdateSync: null,
            lastVisibleErrorEvent: {
              clearedAt: null,
              durationMs: 12000,
              errorCode: "OpcoNetworkError",
              httpStatus: null,
              method: "GET",
              occurredAt: "2026-08-28T11:00:01.000Z",
              operation: "refresh",
              pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/attendance",
              resolution: "unresolved",
              syncRunId: "sync_reconnect_1",
              timeoutOccurred: true,
            },
          }),
        };
      }

      return null;
    });
    const store = getLocalDatabase();

    await store.resolveStateUpdateVisibleErrorEvent("org_1:user_1", "cleared_after_success");

    const diagnosticsWrites = db.runAsync.mock.calls.filter((call) =>
      call[0] === `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)` &&
      String(call[1]).startsWith("state_update_sync_diagnostics:"),
    );
    const telemetry = JSON.parse(String(diagnosticsWrites[diagnosticsWrites.length - 1]?.[2]));

    expect(telemetry.lastVisibleErrorEvent).toMatchObject({
      operation: "refresh",
      resolution: "cleared_after_success",
      timeoutOccurred: true,
    });
    expect(telemetry.lastVisibleErrorEvent.clearedAt).toEqual(expect.any(String));
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

  it("lists durable failed RECORDS operations for global diagnostics", async () => {
    db.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM pending_operations") && sql.includes("entity_records.sync_status = 'failed'")) {
        return [
          {
            attempts: 2,
            entity_type_id: "entity_people_abcdef",
            last_error_code: "VALIDATION_ERROR",
            last_error_message: "Nombre requerido.",
            local_record_id: "local_record_123456",
            operation: "UPDATE",
            record_sync_error_code: "VALIDATION_ERROR",
            record_sync_error_message: "Nombre requerido.",
            record_sync_status: "failed",
            server_record_id: "server_record_654321",
            updated_at: "2026-09-02T12:00:00.000Z",
          },
        ];
      }

      return [];
    });
    const store = getLocalDatabase();

    const operations = await store.listFailedRecordOperations({
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
    });

    expect(operations).toEqual([
      {
        entityTypeId: "entity_people_abcdef",
        lastErrorCode: "VALIDATION_ERROR",
        lastErrorMessage: "Nombre requerido.",
        localRecordId: "local_record_123456",
        operation: "UPDATE",
        retryCount: 2,
        serverRecordId: "server_record_654321",
        syncErrorCode: "VALIDATION_ERROR",
        syncErrorMessage: "Nombre requerido.",
        syncStatus: "failed",
        updatedAt: "2026-09-02T12:00:00.000Z",
      },
    ]);
    expect(db.getAllAsync).toHaveBeenCalledWith(expect.stringContaining("pending_operations.operation IN ('CREATE', 'UPDATE')"), "org_1:user_1", "contract_1", 5);
  });

  it("notifies Home availability listeners when RECORDS full refresh telemetry becomes ready", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLocalDatabaseCacheChanges(listener);
    const store = getLocalDatabase();

    await store.markSyncPhaseCompleted({
      contractId: "contract_1",
      entityTypeId: "entity_1",
      ownerKey: "org_1:user_1",
      phase: "reconciling",
    });

    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
  });

  it("notifies Home availability listeners when Attendance moves from none to partial or complete", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLocalDatabaseCacheChanges(listener);
    const store = getLocalDatabase();

    await store.markAttendanceDaySnapshotHydrated({
      appViewId: "attendance_view_1",
      contractId: "contract_1",
      date: "2026-08-26",
      ownerKey: "org_1:user_1",
      targetEntityTypeId: "attendance",
    });

    await store.markAttendanceDaySnapshotHydrated({
      appViewId: "attendance_view_1",
      contractId: "contract_1",
      date: "2026-08-27",
      ownerKey: "org_1:user_1",
      targetEntityTypeId: "attendance",
    });

    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("stops notifying Home availability listeners after unsubscribe", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLocalDatabaseCacheChanges(listener);
    const store = getLocalDatabase();

    unsubscribe();
    await store.markAttendanceDaySnapshotHydrated({
      appViewId: "attendance_view_1",
      contractId: "contract_1",
      date: "2026-08-26",
      ownerKey: "org_1:user_1",
      targetEntityTypeId: "attendance",
    });

    expect(listener).not.toHaveBeenCalled();
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
              lastErrorDetails: {
                entityTypeId: "attendance_entity",
                fields: [{
                  expectedType: "FIELD_OPTION_VALUE",
                  expectedValues: ["turno_a"],
                  fieldId: "shift_field",
                  fieldLabel: "Turno",
                  fieldType: "SELECT",
                  rejectedValue: "shift_option_id",
                  source: "extra",
                }],
              },
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
      lastErrorDetails: {
        entityTypeId: "attendance_entity",
        fields: [expect.objectContaining({
          expectedValues: ["turno_a"],
          fieldId: "shift_field",
          rejectedValue: "shift_option_id",
        })],
      },
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
    expect(db.runAsync.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("json_remove(payload_json, '$.lastErrorDetails')"))).toBe(true);
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

  it("removes stale synced STATE_UPDATE cache rows only after a complete remote snapshot", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM entity_records") || sql.includes("FROM pending_operations")) {
        return null;
      }

      return null;
    });
    db.runAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("DELETE FROM entity_records")) {
        return { changes: 6 };
      }

      return undefined;
    });
    const store = getLocalDatabase();

    const result = await store.upsertStateUpdateSnapshot({
      appViewId: "attendance_view_real_1",
      complete: true,
      contractId: "contract_real_1",
      date: "2026-08-27",
      items: [{
        current: {
          recordId: "attendance_remote_keep",
          stateValues: [{ fieldId: "status_field", label: "Presente", optionId: "present_option" }],
          updatedAt: "2026-08-27T11:00:00.000Z",
        },
        subject: { displayName: "Persona segura", id: "person_keep" },
      }],
      ownerKey: "org_1:user_1",
      targetEntityTypeId: "attendance",
    });

    const deleteCall = db.runAsync.mock.calls.find(([sql]) =>
      typeof sql === "string" && sql.includes("DELETE FROM entity_records"),
    );

    expect(result.staleSyncedRemoved).toBe(6);
    expect(deleteCall?.[0]).toContain("sync_status = 'synced'");
    expect(deleteCall?.[0]).toContain("json_extract(values_json, '$.appViewId') = ?");
    expect(deleteCall?.[0]).toContain("json_extract(values_json, '$.date') = ?");
    expect(deleteCall?.[0]).toContain("local_id NOT IN (?)");
    expect(deleteCall?.[0]).toContain("server_id NOT IN (?)");
    expect(deleteCall).toEqual([
      expect.any(String),
      "org_1:user_1",
      "contract_real_1",
      "attendance",
      "attendance_view_real_1",
      "2026-08-27",
      "2026-08-27",
      "state_update_attendance_view_real_1_2026-08-27_person_keep",
      "attendance_remote_keep",
    ]);
  });

  it("does not remove stale STATE_UPDATE cache rows when the remote snapshot is partial", async () => {
    db.getFirstAsync.mockResolvedValue(null);
    const store = getLocalDatabase();

    const result = await store.upsertStateUpdateSnapshot({
      appViewId: "attendance_view_real_1",
      complete: false,
      contractId: "contract_real_1",
      date: "2026-08-27",
      items: [{
        current: {
          recordId: "attendance_remote_1",
          stateValues: [{ fieldId: "status_field", label: "Presente", optionId: "present_option" }],
          updatedAt: "2026-08-27T11:00:00.000Z",
        },
        subject: { displayName: "Persona 1", id: "person_1" },
      }],
      ownerKey: "org_1:user_1",
      targetEntityTypeId: "attendance",
    });

    expect(result.staleSyncedRemoved).toBe(0);
    expect(db.runAsync.mock.calls.some(([sql]) =>
      typeof sql === "string" && sql.includes("DELETE FROM entity_records"),
    )).toBe(false);
  });

  it("can clear synced STATE_UPDATE cache for an empty complete day while preserving unresolved statuses", async () => {
    db.runAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("DELETE FROM entity_records")) {
        return { changes: 7 };
      }

      return undefined;
    });
    const store = getLocalDatabase();

    const result = await store.upsertStateUpdateSnapshot({
      appViewId: "attendance_view_real_1",
      complete: true,
      contractId: "contract_real_1",
      date: "2026-08-27",
      items: [],
      ownerKey: "org_1:user_1",
      targetEntityTypeId: "attendance",
    });

    const deleteCall = db.runAsync.mock.calls.find(([sql]) =>
      typeof sql === "string" && sql.includes("DELETE FROM entity_records"),
    );

    expect(result.staleSyncedRemoved).toBe(7);
    expect(deleteCall?.[0]).toContain("sync_status = 'synced'");
    expect(deleteCall?.[0]).not.toContain("NOT IN");
    expect(deleteCall).toEqual([
      expect.any(String),
      "org_1:user_1",
      "contract_real_1",
      "attendance",
      "attendance_view_real_1",
      "2026-08-27",
      "2026-08-27",
    ]);
  });

  it("does not overwrite a local STATE_UPDATE record when a pending operation does not match the remote snapshot", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM entity_records")) {
        return stateUpdateEntityRecordRow({
          local_id: "state_update_attendance_2026_08_26_person_real_1",
          sync_status: "pending_update",
        });
      }

      if (sql.includes("FROM pending_operations")) {
        return stateUpdatePendingOperationRow({
          payload_json: JSON.stringify({
            appViewId: "attendance_view_real_1",
            clientRequestId: "client_request_timeout_1",
            date: "2026-08-26",
            historyMode: "update-current",
            stateValues: [{ fieldId: "status_field", label: "Ausente", optionId: "absent_option" }],
            subjectDisplayName: "Persona segura",
            subjectRecordId: "person_real_1",
            uniqueness: "subject-date",
          }),
        });
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
    expect(db.runAsync.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("DELETE FROM pending_operations"))).toBe(false);
  });

  it("completes a pending STATE_UPDATE and marks telemetry reconciled when a later remote snapshot confirms the write", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM entity_records")) {
        return stateUpdateEntityRecordRow({
          local_id: "state_update_attendance_2026_08_26_person_real_1",
          sync_error_code: "OpcoNetworkError",
          sync_error_message: "La solicitud a Opco agoto el tiempo de espera.",
          sync_status: "pending_update",
        });
      }

      if (sql.includes("FROM pending_operations")) {
        return stateUpdatePendingOperationRow({
          payload_json: JSON.stringify({
            appViewId: "attendance_view_real_1",
            clientRequestId: "client_request_timeout_1",
            date: "2026-08-26",
            historyMode: "update-current",
            stateValues: [{ fieldId: "status_field", label: "Presente", optionId: "present_option" }],
            subjectDisplayName: "Persona segura",
            subjectRecordId: "person_real_1",
            uniqueness: "subject-date",
          }),
        });
      }

      if (sql.includes("FROM app_metadata")) {
        return {
          value: JSON.stringify({
            currentConnectivity: { status: "online", updatedAt: "2026-08-27T10:00:00.000Z" },
            lastReconnect: {
              detected: true,
              detectedAt: "2026-08-27T10:00:00.000Z",
              previousConnectivityStatus: "offline",
              resultingConnectivityStatus: "online",
            },
            lastStateUpdateSync: {
              completedAt: "2026-08-27T10:00:12.000Z",
              operationsAttempted: 1,
              operationsCompleted: 0,
              operationsFailed: 1,
              operationsSelected: 1,
              reconciledAfterTimeout: false,
              result: "failed",
              startedAt: "2026-08-27T10:00:00.000Z",
              trigger: "reconnect",
            },
          }),
        };
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
      `DELETE FROM pending_operations WHERE id = ? AND operation = ?`,
      "state_update_local_1",
      "STATE_UPDATE",
    );
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("sync_status = 'synced'"),
      "attendance_remote_1",
      "Persona segura",
      expect.any(String),
      expect.any(String),
      expect.any(String),
      "state_update_attendance_2026_08_26_person_real_1",
    );
    expect(db.runAsync).toHaveBeenCalledWith(
      `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)`,
      expect.stringMatching(/^state_update_sync_diagnostics:fp_[a-f0-9]{8}$/),
      expect.stringContaining('"result":"reconciled_success"'),
    );
    const diagnosticsWrites = db.runAsync.mock.calls.filter((call) =>
      call[0] === `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)` &&
      String(call[1]).startsWith("state_update_sync_diagnostics:"),
    );
    const diagnosticsWrite = diagnosticsWrites[diagnosticsWrites.length - 1];
    const telemetry = JSON.parse(String(diagnosticsWrite?.[2]));

    expect(telemetry.lastStateUpdateActivity).toMatchObject({
      result: "reconciled_success",
      trigger: "snapshot_reconciliation",
      type: "snapshot_reconciliation",
    });
    expect(telemetry.lastStateUpdateSync).toMatchObject({
      result: "failed",
      trigger: "reconnect",
    });
    expect(db.runAsync.mock.calls.some((call) => String(call[2]).includes("La solicitud a Opco"))).toBe(false);
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
      updatedAt: "2026-08-26T11:30:00.000Z",
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
      "2026-08-26T11:30:00.000Z",
      expect.any(String),
      "state_update_local_record_1",
    );
  });

  it("commits STATE_UPDATE conflict metadata and local record status as one transaction", async () => {
    const store = getLocalDatabase();

    await store.markStateUpdateOperationConflict(
      stateUpdatePendingOperation(),
      stateUpdateConflictResult(),
    );

    expect(db.withTransactionAsync).toHaveBeenCalledOnce();
    const transactionTask = db.withTransactionAsync.mock.calls[0][0] as () => Promise<void>;

    db.runAsync.mockClear();
    await transactionTask();

    expect(db.runAsync.mock.calls[0][0]).toContain("UPDATE pending_operations");
    expect(db.runAsync.mock.calls[1][0]).toContain("sync_status = 'conflict'");
    expect(db.runAsync.mock.calls[1]).toEqual([
      expect.stringContaining("UPDATE entity_records"),
      "CONFLICT",
      "Opco tiene un estado distinto para este registro.",
      expect.stringContaining("\"extraValues\":{\"shift_field\":\"turno_b\"}"),
      "Persona segura",
      "2026-08-26T12:00:00.000Z",
      "state_update_local_record_1",
    ]);
  });

  it("does not leave STATE_UPDATE conflict half-applied when the local record conflict write fails inside the transaction", async () => {
    db.withTransactionAsync.mockImplementationOnce(async (task: () => Promise<void>) => {
      await expect(task()).rejects.toThrow("state update conflict record failed");
      throw new Error("state update conflict record failed");
    });
    db.runAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("sync_status = 'conflict'")) {
        throw new Error("state update conflict record failed");
      }
      return undefined;
    });
    const store = getLocalDatabase();

    await expect(store.markStateUpdateOperationConflict(
      stateUpdatePendingOperation(),
      stateUpdateConflictResult(),
    )).rejects.toThrow("state update conflict record failed");

    expect(db.withTransactionAsync).toHaveBeenCalledOnce();
    const conflictCalls = db.runAsync.mock.calls.filter(([sql]) =>
      String(sql).includes("UPDATE pending_operations") || String(sql).includes("sync_status = 'conflict'"),
    );
    expect(conflictCalls[0][0]).toContain("UPDATE pending_operations");
    expect(conflictCalls[1][0]).toContain("sync_status = 'conflict'");
  });

  it("does not apply STATE_UPDATE conflict record changes when the pending operation write fails first", async () => {
    db.withTransactionAsync.mockImplementationOnce(async (task: () => Promise<void>) => {
      await expect(task()).rejects.toThrow("state update conflict pending failed");
      throw new Error("state update conflict pending failed");
    });
    db.runAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE pending_operations")) {
        throw new Error("state update conflict pending failed");
      }
      return undefined;
    });
    const store = getLocalDatabase();

    await expect(store.markStateUpdateOperationConflict(
      stateUpdatePendingOperation(),
      stateUpdateConflictResult(),
    )).rejects.toThrow("state update conflict pending failed");

    expect(db.withTransactionAsync).toHaveBeenCalledOnce();
    const conflictCalls = db.runAsync.mock.calls.filter(([sql]) =>
      String(sql).includes("UPDATE pending_operations") || String(sql).includes("sync_status = 'conflict'"),
    );
    expect(conflictCalls).toHaveLength(1);
    expect(conflictCalls[0][0]).toContain("UPDATE pending_operations");
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

  it("persists the local RECORDS create snapshot and outbox operation in one SQLite transaction", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string, ...params: unknown[]) => {
      if (sql.includes("FROM entity_records")) {
        return recordsEntityRecordRow({
          local_id: String(params.at(-1)),
          sync_status: "pending_create",
        });
      }

      return null;
    });
    const store = getLocalDatabase();

    await store.createLocalRecord({
      clientRequestId: "request_1",
      contractId: "contract_1",
      entityTypeId: "entity_1",
      localId: "local_1",
      ownerKey: "org_1:user_1",
      values: { name: "Local" },
    });

    expect(db.withTransactionAsync).toHaveBeenCalledOnce();
    const transactionTask = db.withTransactionAsync.mock.calls[0][0] as () => Promise<void>;

    db.runAsync.mockClear();
    await transactionTask();

    expect(db.runAsync.mock.calls[0][0]).toContain("INSERT INTO entity_records");
    expect(db.runAsync.mock.calls[1][0]).toContain("INSERT INTO pending_operations");
  });

  it("keeps normalized relation strings when persisting RECORDS CREATE outbox payloads", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string, ...params: unknown[]) => {
      if (sql.includes("FROM entity_records")) {
        return recordsEntityRecordRow({
          local_id: String(params.at(-1)),
          sync_status: "pending_create",
        });
      }

      return null;
    });
    const store = getLocalDatabase();

    await store.createLocalRecord({
      clientRequestId: "request_1",
      contractId: "contract_1",
      entityTypeId: "entity_1",
      fields: [
        localDbField("relation_one", "RELATION", "ONE"),
        localDbField("relation_many", "RELATION", "MANY", true),
        localDbField("nombre", "TEXT"),
      ],
      localId: "local_1",
      ownerKey: "org_1:user_1",
      values: {
        nombre: "Local",
        relation_many: ["a", "b"],
        relation_one: "cargo_1",
      },
    });

    const outboxWrite = db.runAsync.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO pending_operations"));
    const payload = JSON.parse(String(outboxWrite?.[9]));

    expect(payload.values).toEqual({
      nombre: "Local",
      relation_many: ["a", "b"],
      relation_one: "cargo_1",
    });
  });

  it("does not report RECORDS create success when the outbox insert fails inside the transaction", async () => {
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

    await expect(store.createLocalRecord({
      clientRequestId: "request_1",
      contractId: "contract_1",
      entityTypeId: "entity_1",
      localId: "local_1",
      ownerKey: "org_1:user_1",
      values: { name: "Local" },
    })).rejects.toThrow("pending insert failed");

    const saveCalls = db.runAsync.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO entity_records") || String(sql).includes("INSERT INTO pending_operations"),
    );

    expect(saveCalls[0][0]).toContain("INSERT INTO entity_records");
    expect(saveCalls[1][0]).toContain("INSERT INTO pending_operations");
  });

  it("persists the local RECORDS update snapshot and outbox operation in one SQLite transaction", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM entity_records")) {
        return recordsEntityRecordRow({
          local_id: "local_1",
          remote_updated_at: "2026-08-24T10:00:00.000Z",
          server_id: "record_1",
          sync_status: "synced",
        });
      }

      return null;
    });
    const store = getLocalDatabase();

    await store.updateLocalRecord({
      contractId: "contract_1",
      entityTypeId: "entity_1",
      ownerKey: "org_1:user_1",
      recordId: "record_1",
      values: { status: "local" },
    });

    expect(db.withTransactionAsync).toHaveBeenCalledOnce();
    const transactionTask = db.withTransactionAsync.mock.calls[0][0] as () => Promise<void>;

    db.runAsync.mockClear();
    await transactionTask();

    expect(db.runAsync.mock.calls[0][0]).toContain("UPDATE entity_records");
    expect(db.runAsync.mock.calls[1][0]).toContain("INSERT INTO pending_operations");
  });

  it("normalizes relation objects before persisting RECORDS UPDATE outbox payloads", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM entity_records")) {
        return recordsEntityRecordRow({
          local_id: "local_1",
          remote_updated_at: "2026-08-24T10:00:00.000Z",
          server_id: "record_1",
          sync_status: "synced",
          values_json: JSON.stringify({
            cargo: {
              displayName: "Maestro Primera",
              entityTypeId: "cargos",
              id: "cargo_1",
            },
            nombre: "Juan",
            responsables: [
              { displayName: "A", entityTypeId: "personas", id: "a" },
              { displayName: "B", entityTypeId: "personas", id: "b" },
            ],
          }),
        });
      }

      return null;
    });
    const store = getLocalDatabase();

    await store.updateLocalRecord({
      contractId: "contract_1",
      entityTypeId: "entity_1",
      fields: [
        localDbField("cargo", "RELATION", "ONE"),
        localDbField("nombre", "TEXT"),
        localDbField("responsables", "RELATION", "MANY", true),
      ],
      ownerKey: "org_1:user_1",
      recordId: "record_1",
      values: { nombre: "Pedro" },
    });

    const outboxWrite = db.runAsync.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO pending_operations"));
    const payload = JSON.parse(String(outboxWrite?.[9]));

    expect(payload.values).toEqual({
      cargo: "cargo_1",
      nombre: "Pedro",
      responsables: ["a", "b"],
    });
  });

  it("does not report RECORDS update success when the outbox write fails inside the transaction", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM entity_records")) {
        return recordsEntityRecordRow({
          local_id: "local_1",
          server_id: "record_1",
          sync_status: "synced",
        });
      }

      return null;
    });
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

    await expect(store.updateLocalRecord({
      contractId: "contract_1",
      entityTypeId: "entity_1",
      ownerKey: "org_1:user_1",
      recordId: "record_1",
      values: { status: "local" },
    })).rejects.toThrow("pending insert failed");
  });

  it("commits RECORDS remote completion as one transaction", async () => {
    db.getFirstAsync.mockResolvedValue({ total: 0 });
    const store = getLocalDatabase();

    await store.completePendingOperation(recordsPendingOperation(), remoteRecord("record_1"));

    expect(db.withTransactionAsync).toHaveBeenCalledOnce();
    const transactionTask = db.withTransactionAsync.mock.calls[0][0] as () => Promise<void>;

    db.runAsync.mockClear();
    await transactionTask();

    expect(db.runAsync.mock.calls[0][0]).toContain("DELETE FROM entity_records");
    expect(db.runAsync.mock.calls[1][0]).toContain("DELETE FROM pending_operations");
    expect(db.runAsync.mock.calls[2][0]).toContain("UPDATE entity_records");
    expect(db.runAsync.mock.calls[2][0]).toContain("sync_status = ?");
  });

  it("does not leave RECORDS completion half-applied when the outbox delete fails inside the transaction", async () => {
    db.withTransactionAsync.mockImplementationOnce(async (task: () => Promise<void>) => {
      await expect(task()).rejects.toThrow("delete failed");
      throw new Error("delete failed");
    });
    db.runAsync.mockImplementation(async (sql: string) => {
      if (sql === "DELETE FROM pending_operations WHERE id = ?") {
        throw new Error("delete failed");
      }
      return undefined;
    });
    const store = getLocalDatabase();

    await expect(store.completePendingOperation(recordsPendingOperation(), remoteRecord("record_1"))).rejects.toThrow("delete failed");
  });

  it("commits RECORDS conflict metadata and outbox error as one transaction", async () => {
    const store = getLocalDatabase();

    await store.markPendingOperationConflict(
      recordsPendingOperation(),
      remoteRecord("record_1"),
      "REMOTE_VERSION_CHANGED",
      "changed",
    );

    expect(db.withTransactionAsync).toHaveBeenCalledOnce();
    const transactionTask = db.withTransactionAsync.mock.calls[0][0] as () => Promise<void>;

    db.runAsync.mockClear();
    await transactionTask();

    expect(db.runAsync.mock.calls[0][0]).toContain("UPDATE pending_operations");
    expect(db.runAsync.mock.calls[1][0]).toContain("sync_status = 'conflict'");
  });

  it("does not leave RECORDS conflict half-applied when the record conflict write fails inside the transaction", async () => {
    db.withTransactionAsync.mockImplementationOnce(async (task: () => Promise<void>) => {
      await expect(task()).rejects.toThrow("conflict failed");
      throw new Error("conflict failed");
    });
    db.runAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("sync_status = 'conflict'")) {
        throw new Error("conflict failed");
      }
      return undefined;
    });
    const store = getLocalDatabase();

    await expect(store.markPendingOperationConflict(
      recordsPendingOperation(),
      remoteRecord("record_1"),
      "REMOTE_VERSION_CHANGED",
      "changed",
    )).rejects.toThrow("conflict failed");
  });

  it("commits RECORDS definitive failure as one transaction", async () => {
    const store = getLocalDatabase();

    await store.failPendingOperation(recordsPendingOperation(), "VALIDATION", "invalid");

    expect(db.withTransactionAsync).toHaveBeenCalledOnce();
    const transactionTask = db.withTransactionAsync.mock.calls[0][0] as () => Promise<void>;

    db.runAsync.mockClear();
    await transactionTask();

    expect(db.runAsync.mock.calls[0][0]).toContain("UPDATE pending_operations");
    expect(db.runAsync.mock.calls[1][0]).toContain("UPDATE entity_records");
  });

  it("does not leave RECORDS failure half-applied when the record status write fails inside the transaction", async () => {
    db.withTransactionAsync.mockImplementationOnce(async (task: () => Promise<void>) => {
      await expect(task()).rejects.toThrow("failure write failed");
      throw new Error("failure write failed");
    });
    db.runAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE entity_records")) {
        throw new Error("failure write failed");
      }
      return undefined;
    });
    const store = getLocalDatabase();

    await expect(store.failPendingOperation(recordsPendingOperation(), "VALIDATION", "invalid")).rejects.toThrow("failure write failed");
  });

  it("detects RECORDS outbox consistency issues without exposing raw identifiers", async () => {
    db.getAllAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("ORPHANED_LOCAL_INTENT")) {
        return [
          {
            code: "ORPHANED_LOCAL_INTENT",
            local_record_id: "local_secret_1",
            operation: null,
            operation_id: null,
            sync_status: "pending_update",
          },
          {
            code: "ORPHANED_OUTBOX",
            local_record_id: "local_secret_2",
            operation: "CREATE",
            operation_id: "create_local_secret_2",
            sync_status: null,
          },
          {
            code: "INCONSISTENT_COMPLETION",
            local_record_id: "local_secret_3",
            operation: "UPDATE",
            operation_id: "update_local_secret_3",
            sync_status: "synced",
          },
        ];
      }

      return [];
    });
    const store = getLocalDatabase();

    const consistency = await store.getRecordOutboxConsistency({
      contractId: "contract_sensitive",
      entityTypeId: "entity_sensitive",
      ownerKey: "org_sensitive:user_sensitive",
    });

    expect(consistency.ok).toBe(false);
    expect(consistency.issueCounts).toEqual({
      INCONSISTENT_COMPLETION: 1,
      ORPHANED_LOCAL_INTENT: 1,
      ORPHANED_OUTBOX: 1,
    });
    expect(JSON.stringify(consistency)).not.toContain("secret");
    expect(consistency.issues.map((issue) => issue.code)).toEqual([
      "ORPHANED_LOCAL_INTENT",
      "ORPHANED_OUTBOX",
      "INCONSISTENT_COMPLETION",
    ]);
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

  it("keeps the clientRequestId when repeated Attendance update-current save has the same intention", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM pending_operations")) {
        return stateUpdateDiagnosticsRow({
          client_request_id: "stable-client-request",
          local_record_id: "state_update_view_attendance_2026_08_26_person_a",
          payload_json: JSON.stringify({
            appViewId: "view_attendance",
            clientRequestId: "stable-client-request",
            date: "2026-08-26",
            expectedUpdatedAt: null,
            historyMode: "update-current",
            stateValues: [{ fieldId: "status_field", label: "Presente", optionId: "present_option" }],
            subjectDisplayName: "Persona person_a",
            subjectRecordId: "person_a",
            uniqueness: "subject-date",
          }),
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
    await store.saveStateUpdateLocally(stateUpdateSaveInput("person_a", "present_option"));

    const operationInserts = db.runAsync.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO pending_operations"));

    expect(operationInserts).toHaveLength(2);
    expect(new Set(operationInserts.map((call) => call[1])).size).toBe(1);
    expect(operationInserts[0][2]).toBe("stable-client-request");
    expect(operationInserts[1][2]).toBe("stable-client-request");
    expect(String(operationInserts[1][9])).toContain("present_option");
  });

  it("rotates the clientRequestId when consolidated Attendance update-current payload changes", async () => {
    db.getFirstAsync.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM pending_operations")) {
        return stateUpdateDiagnosticsRow({
          client_request_id: "stable-client-request",
          local_record_id: "state_update_view_attendance_2026_08_26_person_a",
          payload_json: JSON.stringify({
            appViewId: "view_attendance",
            clientRequestId: "stable-client-request",
            date: "2026-08-26",
            historyMode: "update-current",
            stateValues: [{ fieldId: "status_field", label: "Presente", optionId: "present_option" }],
            subjectDisplayName: "Persona person_a",
            subjectRecordId: "person_a",
            uniqueness: "subject-date",
          }),
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

    await store.saveStateUpdateLocally(stateUpdateSaveInput("person_a", "absent_option"));

    const operationInserts = db.runAsync.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO pending_operations"));

    expect(operationInserts).toHaveLength(1);
    expect(operationInserts[0][2]).not.toBe("stable-client-request");
    expect(String(operationInserts[0][9])).toContain("absent_option");
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

  it("keeps the same server_id isolated across owner, contract, and entity scopes", async () => {
    const store = getLocalDatabase();

    await store.upsertRemoteRecords({
      contractId: "contract_1",
      entityTypeId: "personas",
      ownerKey: "org_1:user_1",
      records: [remoteRecord("shared_server_record")],
    });
    await store.upsertRemoteRecords({
      contractId: "contract_1",
      entityTypeId: "personas",
      ownerKey: "org_1:user_2",
      records: [remoteRecord("shared_server_record")],
    });
    await store.upsertRemoteRecords({
      contractId: "contract_2",
      entityTypeId: "personas",
      ownerKey: "org_1:user_1",
      records: [remoteRecord("shared_server_record")],
    });
    await store.upsertRemoteRecords({
      contractId: "contract_1",
      entityTypeId: "equipos",
      ownerKey: "org_1:user_1",
      records: [remoteRecord("shared_server_record")],
    });

    const recordInserts = db.runAsync.mock.calls.filter(([sql]) =>
      typeof sql === "string" && sql.includes("INSERT INTO entity_records"),
    );
    const localIds = recordInserts.map(([, localId]) => String(localId));

    expect(recordInserts).toHaveLength(4);
    expect(new Set(localIds).size).toBe(4);
    expect(recordInserts.map((call) => call.slice(1, 6))).toEqual([
      [expect.stringMatching(/^remote_/), "shared_server_record", "org_1:user_1", "contract_1", "personas"],
      [expect.stringMatching(/^remote_/), "shared_server_record", "org_1:user_2", "contract_1", "personas"],
      [expect.stringMatching(/^remote_/), "shared_server_record", "org_1:user_1", "contract_2", "personas"],
      [expect.stringMatching(/^remote_/), "shared_server_record", "org_1:user_1", "contract_1", "equipos"],
    ]);
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

function recordsEntityRecordRow(overrides: Record<string, unknown> = {}) {
  return {
    cached_at: "2026-08-24T10:00:00.000Z",
    conflict_remote_display_name: null,
    conflict_remote_updated_at: null,
    conflict_remote_values_json: null,
    contract_id: "contract_1",
    display_name: "Local",
    entity_type_id: "entity_1",
    local_id: "local_1",
    owner_key: "org_1:user_1",
    remote_updated_at: null,
    server_id: null,
    sync_error_code: null,
    sync_error_message: null,
    sync_status: "pending_create",
    values_json: JSON.stringify({ name: "Local" }),
    ...overrides,
  };
}

function localDbField(
  key: string,
  type: EntityField["type"],
  relationKind?: "ONE" | "MANY",
  multiple = false,
): EntityField {
  return {
    active: true,
    config: relationKind ? { relation: { relationKind } } : {},
    id: `field_${key}`,
    key,
    multiple,
    name: key,
    order: 1,
    required: false,
    type,
  };
}

function recordsPendingOperation(overrides: Partial<PendingOperation> = {}): PendingOperation {
  return {
    attempts: 1,
    clientRequestId: "request_1",
    contractId: "contract_1",
    createdAt: "2026-08-24T10:00:00.000Z",
    entityTypeId: "entity_1",
    id: "create_local_1",
    lastErrorCode: null,
    lastErrorMessage: null,
    localRecordId: "local_1",
    operation: "CREATE",
    ownerKey: "org_1:user_1",
    payload: { clientRequestId: "request_1", values: { name: "Local" } },
    serverRecordId: null,
    updatedAt: "2026-08-24T10:00:00.000Z",
    ...overrides,
  };
}

function stateUpdatePendingOperation(overrides: Partial<PendingOperation> = {}): PendingOperation {
  return {
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
      extraValues: { shift_field: "turno_a" },
      historyMode: "update-current",
      stateValues: [{ fieldId: "status_field", label: "Presente", optionId: "present_option" }],
      subjectDisplayName: "Persona segura",
      subjectRecordId: "person_real_1",
      uniqueness: "subject-date",
    },
    serverRecordId: null,
    updatedAt: "2026-08-26T10:01:00.000Z",
    ...overrides,
  };
}

function stateUpdateConflictResult() {
  return {
    existing: {
      extraValues: { shift_field: "turno_b" },
      recordId: "attendance_remote_1",
      stateValues: [{ fieldId: "status_field", label: "Ausente", optionId: "absent_option" }],
      updatedAt: "2026-08-26T12:00:00.000Z",
    },
    extraValues: [{
      fieldId: "shift_field",
      fieldLabel: "Turno",
      fieldType: "SELECT",
      localValue: "turno_a",
      remoteValue: "turno_b",
    }],
    requested: {
      extraValues: { shift_field: "turno_a" },
      stateValues: [{ fieldId: "status_field", label: "Presente", optionId: "present_option" }],
    },
    result: "CONFLICT" as const,
    subjectRecordId: "person_real_1",
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

function stateUpdatePendingOperationRow(overrides: Record<string, unknown>) {
  return {
    attempts: 1,
    client_request_id: "client_request_timeout_1",
    contract_id: "contract_real_1",
    created_at: "2026-08-27T10:00:00.000Z",
    entity_type_id: "attendance",
    id: "state_update_local_1",
    last_error_code: "OpcoNetworkError",
    last_error_message: "La solicitud a Opco agoto el tiempo de espera.",
    local_record_id: "state_update_attendance_2026_08_26_person_real_1",
    operation: "STATE_UPDATE",
    owner_key: "org_1:user_1",
    payload_json: JSON.stringify({
      appViewId: "attendance_view_real_1",
      clientRequestId: "client_request_timeout_1",
      date: "2026-08-26",
      historyMode: "update-current",
      stateValues: [{ fieldId: "status_field", label: "Presente", optionId: "present_option" }],
      subjectDisplayName: "Persona segura",
      subjectRecordId: "person_real_1",
      uniqueness: "subject-date",
    }),
    server_record_id: null,
    updated_at: "2026-08-27T10:00:12.000Z",
    ...overrides,
  };
}

function stateUpdateRequestHistoryEvent(
  overrides: Partial<StateUpdateRequestHistoryEvent> = {},
): StateUpdateRequestHistoryEvent {
  return {
    abortControllerTriggered: false,
    diagnosticOperation: "SAVE",
    diagnosticRequestId: "opco_diag_1",
    diagnosticSyncRunId: "sync_1",
    errorCode: null,
    fetchResolvedAt: "2026-08-29T10:00:00.100Z",
    httpStatus: 200,
    interpretation: "success",
    method: "POST",
    pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update",
    requestCompletedAt: "2026-08-29T10:00:00.300Z",
    requestDurationMs: 300,
    requestStartedAt: "2026-08-29T10:00:00.000Z",
    responseBodyStartedAt: "2026-08-29T10:00:00.200Z",
    responseParsedAt: "2026-08-29T10:00:00.300Z",
    responseRequestId: "opco_diag_1",
    responseStarted: true,
    serverTiming: [],
    timeoutMs: 12000,
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
