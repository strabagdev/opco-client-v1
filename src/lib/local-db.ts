import * as SQLite from "expo-sqlite";

import { AppNavigationCache, CachedAppViewsSnapshot, CachedContextSnapshot } from "./app-navigation-cache";
import {
  buildOfflineStateValues,
  createStateUpdateLocalRecordId,
  isStateUpdateCompatibleWorkflow,
  StateUpdateLocalRecordDiagnostics,
  normalizeStateUpdateRecord,
  OfflineStateUpdatePayload,
  OfflineStateUpdateValues,
  resolveStateUpdateClientRequestId,
  SaveStateUpdateLocallyInput,
  SearchStateUpdateSubjectsInput,
  STATE_UPDATE_OPERATION,
  StateUpdateSyncDiagnosticsTelemetry,
  StateUpdateOutboxDiagnostics,
  StateUpdateOfflineStore,
  StateUpdateRequestDiagnostics,
  StateUpdateRequestHistoryEvent,
  STATE_UPDATE_RECONNECT_RUN_HISTORY_LIMIT,
  STATE_UPDATE_REQUEST_HISTORY_LIMIT,
  StateUpdateScope,
  StateUpdateSessionTerminationTelemetry,
  StateUpdateSnapshotReconcileResult,
  StateUpdateVisibleErrorResolution,
  StateUpdateVisibleErrorTelemetry,
  stateUpdateRemoteItemMatchesPayload,
  stateUpdateRecordToItem,
  UpsertStateUpdateSnapshotInput,
} from "./state-update-offline";
import {
  AppViewDefinitionCache,
  AppViewDefinitionStatus,
  CachedAppViewDefinition,
  PreparedAppViewDefinition,
  UpsertAppViewDefinitionInput,
} from "./app-view-definitions-cache";
import {
  OfflinePreparationDiagnostics,
  parseOfflinePreparationDiagnostics,
} from "./app-view-prewarm";
import { CachedEntityDefinition, EntityDefinitionCache } from "./definition-cache";
import {
  LocalDatabaseRecoverySummary,
  LocalDatabaseStorageState,
  LocalDatabaseUnavailableCause,
  LocalDatabaseUnavailableError,
  isAccessHandleBusyError,
  sanitizeLocalDatabaseErrorMessage,
} from "./local-db-recovery";
import {
  buildLocalDisplayName,
  CachedEntityRecord,
  createLocalRecordId,
  OfflineRecordStore,
  PendingOperation,
  RecordsReconcileDiagnostics,
  RecordSyncStatus,
  RecordsSyncSummary,
  RecordOutboxConsistency,
  RecordOutboxConsistencyIssueCode,
  fingerprintRecordsScope,
} from "./offline-records";
import { AppView, ContextResponse, EntityDefinition, EntityRecord, EntityRecordValue, MeResponse, OpcoApi, StateUpdateBatchResult, StateUpdateItem } from "./opco-api";
import {
  emptySyncTelemetry,
  SyncErrorCode,
  SyncErrorPhase,
  SyncPhase,
  SyncTelemetry,
  SyncTelemetryStore,
} from "./sync-telemetry";
import { RecordsSyncStore } from "../sync/records-sync";
import { StateUpdateSyncStore } from "../sync/state-update-sync";

const DATABASE_NAME = "opco-client.db";
const SCHEMA_VERSION = "8";
const SELECTED_CONTRACT_ID_KEY = "selected_contract_id";
const OFFLINE_PREPARATION_DIAGNOSTICS_KEY = "offline_preparation_diagnostics";
const ATTENDANCE_CONTEXT_SELECTION_KEY = "attendance_context_selection";
const STATE_UPDATE_SYNC_DIAGNOSTICS_KEY = "state_update_sync_diagnostics";
const SCHEMA_VERSION_KEY = "schema_version";
const GLOBAL_DATABASE_STATE_KEY = "__opcoClientLocalDatabaseState";

type LocalDatabaseGlobalState = {
  database: SQLite.SQLiteDatabase | null;
  databasePromise: Promise<SQLite.SQLiteDatabase> | null;
  lifecycleCloseRegistered: boolean;
  lastUnavailableError: LocalDatabaseUnavailableError | null;
  listeners: Set<() => void>;
  migrationPromise: Promise<void> | null;
  migratedSchemaVersion: string | null;
  storageState: LocalDatabaseStorageState;
};

type LocalDatabaseGlobal = typeof globalThis & {
  [GLOBAL_DATABASE_STATE_KEY]?: LocalDatabaseGlobalState;
};

export type LocalDatabase = AppNavigationCache &
  AppViewDefinitionCache &
  EntityDefinitionCache &
  OfflineRecordStore &
  StateUpdateOfflineStore &
  SyncTelemetryStore &
  RecordsSyncStore &
  StateUpdateSyncStore & {
  getOfflinePreparationDiagnostics(ownerKey: string): Promise<OfflinePreparationDiagnostics | null>;
  getAttendanceContextSelection(ownerKey: string, contractId: string, appViewId: string, fieldId: string): Promise<string | null>;
  getSelectedContractId(ownerKey?: string | null): Promise<string | null>;
  setAttendanceContextSelection(ownerKey: string, contractId: string, appViewId: string, fieldId: string, optionId: string | null): Promise<void>;
  setOfflinePreparationDiagnostics(ownerKey: string, diagnostics: OfflinePreparationDiagnostics): Promise<void>;
  setSelectedContractId(contractId: string | null, ownerKey?: string | null): Promise<void>;
};

export function getLocalDatabase(): LocalDatabase {
  return {
    clearNavigationCache,
    completePendingOperation,
    completeStateUpdateOperation,
    countPendingOperations,
    createLocalRecord,
    failPendingOperation,
    failStateUpdateOperation,
    getAppViews,
    getAppViewDefinition,
    getContextSnapshot,
    getCachedRecord,
    getRecordsSyncSummary,
    getRecordCacheStatusCounts,
    getRecordOutboxConsistency,
    getStateUpdateSummary,
    getStateUpdateOutboxDiagnostics,
    getStateUpdateSyncDiagnosticsTelemetry,
    getSyncTelemetry,
    getEntityDefinition,
    getOfflinePreparationDiagnostics,
    getAttendanceContextSelection,
    listStateUpdateConflicts,
    listAppViewDefinitions,
    getSelectedContractId,
    listCachedRecords,
    listProblemRecords,
    listPendingOperations,
    listPendingStateUpdateOperations,
    listStateUpdateLatest,
    markPendingOperationSyncing,
    markStateUpdateOperationSyncing,
    recordStateUpdateSessionTermination,
    recordStateUpdateVisibleErrorEvent,
    markPendingOperationConflict,
    markStateUpdateOperationConflict,
    readRecordRemoteUpdatedAt,
    markSyncError,
    markSyncPhase,
    markSyncPhaseCompleted,
    reconcileAppViewDefinitions,
    reconcileRemoteRecordsSnapshot,
    resolveRecordConflictWithLocal,
    resolveRecordConflictWithRemote,
    retryFailedRecord,
    retryFailedStateUpdateOperations,
    retryPendingOperation,
    retryStateUpdateOperation,
    resolveStateUpdateVisibleErrorEvent,
    discardStateUpdateLocalChange,
    saveStateUpdateLocally,
    searchStateUpdateSubjects,
    setSelectedContractId,
    setAttendanceContextSelection,
    setOfflinePreparationDiagnostics,
    setStateUpdateSyncDiagnosticsTelemetry,
    updateLocalRecord,
    upsertAppViews,
    upsertAppViewDefinition,
    upsertContextSnapshot,
    upsertStateUpdateSnapshot,
    upsertRemoteRecords,
    upsertEntityDefinition,
  };
}

async function getDatabase() {
  const state = getLocalDatabaseGlobalState();

  if (state.storageState.status === "unavailable" && !state.databasePromise) {
    throw state.lastUnavailableError ?? new LocalDatabaseUnavailableError("UNKNOWN");
  }

  if (!state.databasePromise) {
    setLocalDatabaseStorageState(state, {
      destructiveRecoveryAvailable: false,
      errorCode: null,
      retryable: false,
      status: "initializing",
    });
    const nextDatabasePromise = openAndMigrate().catch((error) => {
      if (state.databasePromise === nextDatabasePromise) {
        state.database = null;
        state.databasePromise = null;
        state.migratedSchemaVersion = null;
        state.migrationPromise = null;
      }

      const unavailableError = toLocalDatabaseUnavailableError(error, "UNKNOWN");

      markLocalDatabaseUnavailable(state, unavailableError);
      throw unavailableError;
    });

    state.databasePromise = nextDatabasePromise;
  }

  return state.databasePromise;
}

async function openAndMigrate() {
  const state = getLocalDatabaseGlobalState();
  let db: SQLite.SQLiteDatabase;

  try {
    db = state.database ?? await SQLite.openDatabaseAsync(DATABASE_NAME);
    registerWebDatabaseLifecycleClose(state);
  } catch (error) {
    throw toLocalDatabaseUnavailableError(error, "OPEN_FAILED");
  }

  state.database = db;
  try {
    await migrateDatabaseOnce(db, state);
  } catch (error) {
    await closeDatabaseQuietly(db);
    state.database = null;
    state.migrationPromise = null;
    state.migratedSchemaVersion = null;
    throw toLocalDatabaseUnavailableError(error, "MIGRATION_FAILED");
  }

  state.lastUnavailableError = null;
  setLocalDatabaseStorageState(state, {
    destructiveRecoveryAvailable: false,
    errorCode: null,
    retryable: false,
    status: "ready",
  });

  return db;
}

async function migrateDatabaseOnce(db: SQLite.SQLiteDatabase, state = getLocalDatabaseGlobalState()) {
  if (state.migratedSchemaVersion === SCHEMA_VERSION) {
    return;
  }

  if (!state.migrationPromise) {
    state.migrationPromise = runMigrations(db)
      .then(() => {
        state.migratedSchemaVersion = SCHEMA_VERSION;
      })
      .finally(() => {
        state.migrationPromise = null;
      });
  }

  await state.migrationPromise;
}

async function runMigrations(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entity_definitions (
      entity_type_id TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      definition_json TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY (entity_type_id, contract_id)
    );
    CREATE TABLE IF NOT EXISTS context_snapshot (
      id TEXT PRIMARY KEY NOT NULL,
      owner_key TEXT,
      me_json TEXT NOT NULL,
      context_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_views (
      owner_key TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      views_json TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY (owner_key, contract_id)
    );
    CREATE TABLE IF NOT EXISTS app_view_definitions (
      owner_key TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      app_view_id TEXT NOT NULL,
      app_view_type TEXT NOT NULL,
      workflow_key TEXT,
      definition_json TEXT NOT NULL,
      last_prepared_at TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (owner_key, contract_id, app_view_id)
    );
    CREATE TABLE IF NOT EXISTS entity_records (
      local_id TEXT PRIMARY KEY NOT NULL,
      server_id TEXT,
      owner_key TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      entity_type_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      values_json TEXT NOT NULL,
      remote_updated_at TEXT,
      cached_at TEXT NOT NULL,
      sync_status TEXT NOT NULL,
      sync_error_code TEXT,
      sync_error_message TEXT,
      conflict_remote_values_json TEXT,
      conflict_remote_display_name TEXT,
      conflict_remote_updated_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS entity_records_server_identity
      ON entity_records(owner_key, contract_id, entity_type_id, server_id)
      WHERE server_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS entity_records_scope
      ON entity_records(owner_key, contract_id, entity_type_id, cached_at);
    CREATE TABLE IF NOT EXISTS pending_operations (
      id TEXT PRIMARY KEY NOT NULL,
      client_request_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      entity_type_id TEXT NOT NULL,
      local_record_id TEXT NOT NULL,
      server_record_id TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error_code TEXT,
      last_error_message TEXT,
      FOREIGN KEY(local_record_id) REFERENCES entity_records(local_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS pending_operations_create_once
      ON pending_operations(owner_key, local_record_id, operation)
      WHERE operation = 'CREATE';
    CREATE UNIQUE INDEX IF NOT EXISTS pending_operations_update_once
      ON pending_operations(owner_key, local_record_id, operation)
      WHERE operation = 'UPDATE';
    CREATE INDEX IF NOT EXISTS pending_operations_queue
      ON pending_operations(owner_key, created_at);
    CREATE TABLE IF NOT EXISTS sync_telemetry (
      owner_key TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      entity_type_id TEXT NOT NULL,
      sync_phase TEXT NOT NULL,
      last_sync_attempt_at TEXT,
      last_push_completed_at TEXT,
      last_full_refresh_completed_at TEXT,
      last_reconcile_completed_at TEXT,
      last_successful_sync_at TEXT,
      last_sync_error_at TEXT,
      last_sync_error_code TEXT,
      last_sync_error_phase TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (owner_key, contract_id, entity_type_id)
    );
  `);

  await migrateEntityRecordsTable(db);
  await migrateNavigationCacheTables(db);
  await migrateAppViewDefinitionsTable(db);
  await migrateSyncTelemetryTable(db);

  await db.runAsync(
    `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)`,
    SCHEMA_VERSION_KEY,
    SCHEMA_VERSION,
  );
}

function getLocalDatabaseGlobalState() {
  const globalState = globalThis as LocalDatabaseGlobal;

  if (!globalState[GLOBAL_DATABASE_STATE_KEY]) {
    globalState[GLOBAL_DATABASE_STATE_KEY] = {
      database: null,
      databasePromise: null,
      lifecycleCloseRegistered: false,
      lastUnavailableError: null,
      listeners: new Set(),
      migratedSchemaVersion: null,
      migrationPromise: null,
      storageState: {
        destructiveRecoveryAvailable: false,
        errorCode: null,
        retryable: false,
        status: "initializing",
      },
    };
  }

  return globalState[GLOBAL_DATABASE_STATE_KEY];
}

function setLocalDatabaseStorageState(state: LocalDatabaseGlobalState, storageState: LocalDatabaseStorageState) {
  if (isSameLocalDatabaseStorageState(state.storageState, storageState)) {
    return;
  }

  state.storageState = storageState;
  notifyLocalDatabaseStorageListeners(state);
}

function isSameLocalDatabaseStorageState(current: LocalDatabaseStorageState, next: LocalDatabaseStorageState) {
  return current.status === next.status && current.errorCode === next.errorCode && current.retryable === next.retryable &&
    current.destructiveRecoveryAvailable === next.destructiveRecoveryAvailable &&
    ("cause" in current ? current.cause : null) === ("cause" in next ? next.cause : null) &&
    ("technicalMessage" in current ? current.technicalMessage : null) === ("technicalMessage" in next ? next.technicalMessage : null);
}

function notifyLocalDatabaseStorageListeners(state = getLocalDatabaseGlobalState()) {
  for (const listener of state.listeners) {
    listener();
  }
}

function markLocalDatabaseUnavailable(state: LocalDatabaseGlobalState, error: LocalDatabaseUnavailableError) {
  state.lastUnavailableError = error;
  setLocalDatabaseStorageState(state, {
    cause: error.causeCode,
    destructiveRecoveryAvailable: error.causeCode !== "ACCESS_HANDLE_BUSY",
    errorCode: "SQLITE_UNAVAILABLE",
    technicalMessage: sanitizeLocalDatabaseErrorMessage(error.originalError),
    retryable: true,
    status: "unavailable",
  });
}

async function closeDatabaseQuietly(db: SQLite.SQLiteDatabase) {
  try {
    await db.closeAsync();
  } catch {
    // Recovery must keep moving even when the underlying handle is already gone.
  }
}

function toLocalDatabaseUnavailableError(
  error: unknown,
  fallbackCause: LocalDatabaseUnavailableCause,
): LocalDatabaseUnavailableError {
  if (error instanceof LocalDatabaseUnavailableError) {
    return error;
  }

  return new LocalDatabaseUnavailableError(classifyLocalDatabaseFailureCause(error, fallbackCause), error);
}

function classifyLocalDatabaseFailureCause(
  error: unknown,
  fallbackCause: LocalDatabaseUnavailableCause,
): LocalDatabaseUnavailableCause {
  if (isAccessHandleBusyError(error)) {
    return "ACCESS_HANDLE_BUSY";
  }

  const message = error instanceof Error ? error.message.toLocaleLowerCase("en-US") : "";

  if (message.includes("corrupt") || message.includes("malformed") || message.includes("not a database")) {
    return "CORRUPTION_SUSPECTED";
  }

  if (
    message.includes("opfs") ||
    message.includes("access handle") ||
    message.includes("quota") ||
    message.includes("storage") ||
    message.includes("sharedarraybuffer") ||
    message.includes("cross-origin")
  ) {
    return "STORAGE_UNAVAILABLE";
  }

  return fallbackCause;
}

function registerWebDatabaseLifecycleClose(state: LocalDatabaseGlobalState) {
  if (state.lifecycleCloseRegistered || typeof window === "undefined") {
    return;
  }

  const closeCurrentDatabase = () => {
    const currentDatabase = state.database;

    if (!currentDatabase) {
      return;
    }

    state.database = null;
    state.databasePromise = null;
    state.migrationPromise = null;
    state.migratedSchemaVersion = null;
    void closeDatabaseQuietly(currentDatabase);
  };

  window.addEventListener("pagehide", closeCurrentDatabase);
  window.addEventListener("beforeunload", closeCurrentDatabase);
  state.lifecycleCloseRegistered = true;
}

export function __resetLocalDatabaseForTests() {
  const globalState = globalThis as LocalDatabaseGlobal;

  delete globalState[GLOBAL_DATABASE_STATE_KEY];
}

export function __getLocalDatabaseDebugStateForTests() {
  const state = getLocalDatabaseGlobalState();

  return {
    hasDatabase: Boolean(state.database),
    hasDatabasePromise: Boolean(state.databasePromise),
    hasMigrationPromise: Boolean(state.migrationPromise),
    lastUnavailableCause: state.lastUnavailableError?.causeCode ?? null,
    migratedSchemaVersion: state.migratedSchemaVersion,
    storageState: state.storageState,
  };
}

export function getLocalDatabaseStorageState() {
  return getLocalDatabaseGlobalState().storageState;
}

export function subscribeLocalDatabaseStorageState(listener: () => void) {
  const state = getLocalDatabaseGlobalState();

  state.listeners.add(listener);

  return () => {
    state.listeners.delete(listener);
  };
}

export async function retryLocalDatabaseInitialization() {
  const state = getLocalDatabaseGlobalState();

  state.databasePromise = null;
  state.migrationPromise = null;
  state.migratedSchemaVersion = null;
  state.lastUnavailableError = null;
  setLocalDatabaseStorageState(state, {
    destructiveRecoveryAvailable: false,
    errorCode: null,
    retryable: false,
    status: "initializing",
  });

  return getDatabase();
}

export async function getLocalDatabaseRecoverySummary(): Promise<LocalDatabaseRecoverySummary> {
  let db: SQLite.SQLiteDatabase | null = null;
  let shouldClose = false;

  try {
    const state = getLocalDatabaseGlobalState();

    db = state.database;
    if (!db) {
      db = await SQLite.openDatabaseAsync(DATABASE_NAME);
      shouldClose = true;
    }

    const rows = await db.getAllAsync<{ sync_status: RecordSyncStatus; total: number }>(
      `
        SELECT sync_status, COUNT(*) AS total
        FROM entity_records
        WHERE sync_status IN ('pending_create', 'pending_update', 'failed', 'conflict')
        GROUP BY sync_status
      `,
    );
    const count = (status: RecordSyncStatus) =>
      rows.filter((row) => row.sync_status === status).reduce((total, row) => total + row.total, 0);
    const summary = {
      canCount: true,
      conflictCount: count("conflict"),
      failedCount: count("failed"),
      pendingCreateCount: count("pending_create"),
      pendingUpdateCount: count("pending_update"),
      totalAtRiskCount: 0,
    };

    return {
      ...summary,
      totalAtRiskCount: summary.pendingCreateCount + summary.pendingUpdateCount + summary.failedCount + summary.conflictCount,
    };
  } catch {
    return emptyLocalDatabaseRecoverySummary(false);
  } finally {
    if (shouldClose && db) {
      await closeDatabaseQuietly(db);
    }
  }
}

export async function resetLocalDatabaseAfterConfirmation({ confirmed }: { confirmed: boolean }) {
  if (!confirmed) {
    throw new Error("Local database reset requires explicit confirmation.");
  }

  const state = getLocalDatabaseGlobalState();

  if (state.database) {
    await closeDatabaseQuietly(state.database);
  }

  state.database = null;
  state.databasePromise = null;
  state.migrationPromise = null;
  state.migratedSchemaVersion = null;
  state.lastUnavailableError = null;
  setLocalDatabaseStorageState(state, {
    destructiveRecoveryAvailable: false,
    errorCode: null,
    retryable: false,
    status: "initializing",
  });

  try {
    await SQLite.deleteDatabaseAsync(DATABASE_NAME);

    return await getDatabase();
  } catch (error) {
    const unavailableError = toLocalDatabaseUnavailableError(error, "STORAGE_UNAVAILABLE");

    markLocalDatabaseUnavailable(state, unavailableError);
    throw unavailableError;
  }
}

function emptyLocalDatabaseRecoverySummary(canCount: boolean): LocalDatabaseRecoverySummary {
  return {
    canCount,
    conflictCount: 0,
    failedCount: 0,
    pendingCreateCount: 0,
    pendingUpdateCount: 0,
    totalAtRiskCount: 0,
  };
}

async function migrateEntityRecordsTable(db: SQLite.SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(entity_records)`);
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("remote_updated_at")) {
    await db.execAsync(`ALTER TABLE entity_records ADD COLUMN remote_updated_at TEXT`);
  }

  if (!columnNames.has("conflict_remote_values_json")) {
    await db.execAsync(`ALTER TABLE entity_records ADD COLUMN conflict_remote_values_json TEXT`);
  }

  if (!columnNames.has("conflict_remote_display_name")) {
    await db.execAsync(`ALTER TABLE entity_records ADD COLUMN conflict_remote_display_name TEXT`);
  }

  if (!columnNames.has("conflict_remote_updated_at")) {
    await db.execAsync(`ALTER TABLE entity_records ADD COLUMN conflict_remote_updated_at TEXT`);
  }

  if (columnNames.has("updated_at_remote")) {
    await db.execAsync(`
      UPDATE entity_records
      SET remote_updated_at = COALESCE(remote_updated_at, updated_at_remote)
      WHERE remote_updated_at IS NULL
    `);
  }
}

async function migrateNavigationCacheTables(db: SQLite.SQLiteDatabase) {
  const contextColumns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(context_snapshot)`);
  const contextColumnNames = new Set(contextColumns.map((column) => column.name));

  if (!contextColumnNames.has("owner_key")) {
    await db.execAsync(`ALTER TABLE context_snapshot ADD COLUMN owner_key TEXT`);
  }

  const appViewColumns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(app_views)`);
  const appViewColumnNames = new Set(appViewColumns.map((column) => column.name));

  if (!appViewColumnNames.has("owner_key")) {
    await db.execAsync(`
      ALTER TABLE app_views RENAME TO app_views_legacy;
      CREATE TABLE app_views (
        owner_key TEXT NOT NULL,
        contract_id TEXT NOT NULL,
        views_json TEXT NOT NULL,
        synced_at TEXT NOT NULL,
        PRIMARY KEY (owner_key, contract_id)
      );
      INSERT INTO app_views (owner_key, contract_id, views_json, synced_at)
      SELECT 'legacy', contract_id, views_json, synced_at
      FROM app_views_legacy;
      DROP TABLE app_views_legacy;
    `);
  }
}

async function migrateAppViewDefinitionsTable(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS app_view_definitions (
      owner_key TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      app_view_id TEXT NOT NULL,
      app_view_type TEXT NOT NULL,
      workflow_key TEXT,
      definition_json TEXT NOT NULL,
      last_prepared_at TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (owner_key, contract_id, app_view_id)
    );
  `);
}

async function migrateSyncTelemetryTable(db: SQLite.SQLiteDatabase) {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(sync_telemetry)`);
  const columnNames = new Set(columns.map((column) => column.name));

  if (columns.length > 0 && !columnNames.has("entity_type_id")) {
    await db.execAsync(`
      ALTER TABLE sync_telemetry RENAME TO sync_telemetry_legacy;
      CREATE TABLE sync_telemetry (
        owner_key TEXT NOT NULL,
        contract_id TEXT NOT NULL,
        entity_type_id TEXT NOT NULL,
        sync_phase TEXT NOT NULL,
        last_sync_attempt_at TEXT,
        last_push_completed_at TEXT,
        last_full_refresh_completed_at TEXT,
        last_reconcile_completed_at TEXT,
        last_successful_sync_at TEXT,
        last_sync_error_at TEXT,
        last_sync_error_code TEXT,
        last_sync_error_phase TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (owner_key, contract_id, entity_type_id)
      );
      INSERT INTO sync_telemetry (
        owner_key,
        contract_id,
        entity_type_id,
        sync_phase,
        last_sync_attempt_at,
        last_push_completed_at,
        last_full_refresh_completed_at,
        last_reconcile_completed_at,
        last_successful_sync_at,
        last_sync_error_at,
        last_sync_error_code,
        last_sync_error_phase,
        updated_at
      )
      SELECT
        owner_key,
        contract_id,
        '__contract_legacy__',
        sync_phase,
        last_sync_attempt_at,
        last_push_completed_at,
        last_full_refresh_completed_at,
        last_reconcile_completed_at,
        last_successful_sync_at,
        last_sync_error_at,
        last_sync_error_code,
        last_sync_error_phase,
        updated_at
      FROM sync_telemetry_legacy;
      DROP TABLE sync_telemetry_legacy;
    `);
  }
}

async function upsertContextSnapshot(
  ownerKey: string,
  me: MeResponse,
  context: ContextResponse,
  syncedAt: string,
) {
  const db = await getDatabase();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO context_snapshot (id, owner_key, me_json, context_json, synced_at)
      VALUES (?, ?, ?, ?, ?)
    `,
    ownerKey,
    ownerKey,
    JSON.stringify(me),
    JSON.stringify(context),
    syncedAt,
  );
}

async function getContextSnapshot(ownerKey: string): Promise<CachedContextSnapshot | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    context_json: string;
    me_json: string;
    owner_key: string | null;
    synced_at: string;
  }>(
    `
      SELECT owner_key, me_json, context_json, synced_at
      FROM context_snapshot
      WHERE id = ?
      LIMIT 1
    `,
    ownerKey,
  );

  if (!row) {
    return null;
  }

  return {
    context: JSON.parse(row.context_json) as ContextResponse,
    me: JSON.parse(row.me_json) as MeResponse,
    ownerKey: row.owner_key ?? ownerKey,
    syncedAt: row.synced_at,
  };
}

async function upsertAppViews(ownerKey: string, contractId: string, views: AppView[], syncedAt: string) {
  const db = await getDatabase();

  await db.runAsync(
    `
      INSERT INTO app_views (owner_key, contract_id, views_json, synced_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(owner_key, contract_id)
      DO UPDATE SET views_json = excluded.views_json, synced_at = excluded.synced_at
    `,
    ownerKey,
    contractId,
    JSON.stringify(views),
    syncedAt,
  );
}

async function getAppViews(ownerKey: string, contractId: string): Promise<CachedAppViewsSnapshot | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ synced_at: string; views_json: string }>(
    `
      SELECT views_json, synced_at
      FROM app_views
      WHERE owner_key = ? AND contract_id = ?
      LIMIT 1
    `,
    ownerKey,
    contractId,
  );

  if (!row) {
    return null;
  }

  return {
    syncedAt: row.synced_at,
    views: JSON.parse(row.views_json) as AppView[],
  };
}

async function clearNavigationCache() {
  const db = await getDatabase();

  await db.runAsync(`DELETE FROM context_snapshot`);
  await db.runAsync(`DELETE FROM app_views`);
  await db.runAsync(`DELETE FROM app_view_definitions`);
}

async function upsertAppViewDefinition({
  appViewId,
  appViewType,
  contractId,
  definition,
  lastPreparedAt,
  ownerKey,
  status,
  workflowKey = null,
}: UpsertAppViewDefinitionInput) {
  const db = await getDatabase();

  await db.runAsync(
    `
      INSERT INTO app_view_definitions (
        owner_key,
        contract_id,
        app_view_id,
        app_view_type,
        workflow_key,
        definition_json,
        last_prepared_at,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_key, contract_id, app_view_id)
      DO UPDATE SET
        app_view_type = excluded.app_view_type,
        workflow_key = excluded.workflow_key,
        definition_json = excluded.definition_json,
        last_prepared_at = excluded.last_prepared_at,
        status = excluded.status
    `,
    ownerKey,
    contractId,
    appViewId,
    appViewType,
    workflowKey,
    JSON.stringify(definition),
    lastPreparedAt,
    status,
  );
}

async function getAppViewDefinition(
  ownerKey: string,
  contractId: string,
  appViewId: string,
): Promise<CachedAppViewDefinition | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<AppViewDefinitionRow>(
    `
      SELECT *
      FROM app_view_definitions
      WHERE owner_key = ? AND contract_id = ? AND app_view_id = ?
      LIMIT 1
    `,
    ownerKey,
    contractId,
    appViewId,
  );

  return row ? mapAppViewDefinitionRow(row) : null;
}

async function listAppViewDefinitions(ownerKey: string, contractId: string): Promise<CachedAppViewDefinition[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<AppViewDefinitionRow>(
    `
      SELECT *
      FROM app_view_definitions
      WHERE owner_key = ? AND contract_id = ?
      ORDER BY last_prepared_at DESC
    `,
    ownerKey,
    contractId,
  );

  return rows.map(mapAppViewDefinitionRow);
}

async function reconcileAppViewDefinitions(ownerKey: string, contractId: string, assignedAppViewIds: string[]) {
  const db = await getDatabase();

  if (assignedAppViewIds.length === 0) {
    await db.runAsync(
      `DELETE FROM app_view_definitions WHERE owner_key = ? AND contract_id = ?`,
      ownerKey,
      contractId,
    );
    return;
  }

  const placeholders = assignedAppViewIds.map(() => "?").join(", ");

  await db.runAsync(
    `
      DELETE FROM app_view_definitions
      WHERE owner_key = ?
        AND contract_id = ?
        AND app_view_id NOT IN (${placeholders})
    `,
    ownerKey,
    contractId,
    ...assignedAppViewIds,
  );
}

async function upsertRemoteRecords({
  cachedAt = new Date().toISOString(),
  contractId,
  entityTypeId,
  ownerKey,
  records,
}: {
  cachedAt?: string;
  contractId: string;
  entityTypeId: string;
  ownerKey: string;
  records: EntityRecord[];
}) {
  const db = await getDatabase();

  for (const record of records) {
    const existing = await db.getFirstAsync<EntityRecordRow>(
      `
        SELECT *
        FROM entity_records
        WHERE owner_key = ? AND contract_id = ? AND entity_type_id = ? AND server_id = ?
        LIMIT 1
      `,
      ownerKey,
      contractId,
      entityTypeId,
      record.id,
    );

    if (existing?.sync_status === "pending_update" && hasRemoteVersionChanged(existing.remote_updated_at, record.updatedAt)) {
      await markRecordConflict(db, {
        localRecordId: existing.local_id,
        remoteRecord: record,
        syncErrorCode: "REMOTE_VERSION_CHANGED",
        syncErrorMessage: "Este registro cambio en Opco mientras tenias modificaciones locales pendientes.",
      });
      continue;
    }

    if (existing && existing.sync_status !== "synced") {
      continue;
    }

    await db.runAsync(
      `
        INSERT INTO entity_records (
          local_id,
          server_id,
          owner_key,
          contract_id,
          entity_type_id,
          display_name,
          values_json,
          remote_updated_at,
          cached_at,
          sync_status,
          sync_error_code,
          sync_error_message,
          conflict_remote_values_json,
          conflict_remote_display_name,
          conflict_remote_updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', NULL, NULL, NULL, NULL, NULL)
        ON CONFLICT(local_id)
        DO UPDATE SET
          server_id = excluded.server_id,
          display_name = excluded.display_name,
          values_json = excluded.values_json,
          remote_updated_at = excluded.remote_updated_at,
          cached_at = excluded.cached_at,
          sync_status = CASE
            WHEN entity_records.sync_status = 'synced' THEN 'synced'
            ELSE entity_records.sync_status
          END,
          sync_error_code = CASE
            WHEN entity_records.sync_status = 'synced' THEN NULL
            ELSE entity_records.sync_error_code
          END,
          sync_error_message = CASE
            WHEN entity_records.sync_status = 'synced' THEN NULL
            ELSE entity_records.sync_error_message
          END,
          conflict_remote_values_json = CASE
            WHEN entity_records.sync_status = 'synced' THEN NULL
            ELSE entity_records.conflict_remote_values_json
          END,
          conflict_remote_display_name = CASE
            WHEN entity_records.sync_status = 'synced' THEN NULL
            ELSE entity_records.conflict_remote_display_name
          END,
          conflict_remote_updated_at = CASE
            WHEN entity_records.sync_status = 'synced' THEN NULL
            ELSE entity_records.conflict_remote_updated_at
      END
      `,
      existing?.local_id ?? createRemoteRecordLocalId({ contractId, entityTypeId, ownerKey, serverId: record.id }),
      record.id,
      ownerKey,
      contractId,
      entityTypeId,
      record.displayName,
      JSON.stringify(record.values),
      record.updatedAt,
      cachedAt,
    );
  }
}

function createRemoteRecordLocalId({
  contractId,
  entityTypeId,
  ownerKey,
  serverId,
}: {
  contractId: string;
  entityTypeId: string;
  ownerKey: string;
  serverId: string;
}) {
  return `remote_${fingerprintLocalIdPart(ownerKey)}_${fingerprintLocalIdPart(contractId)}_${fingerprintLocalIdPart(entityTypeId)}_${serverId}`;
}

function fingerprintLocalIdPart(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function reconcileRemoteRecordsSnapshot({
  cachedAt = new Date().toISOString(),
  contractId,
  entityTypeId,
  ownerKey,
  records,
}: {
  cachedAt?: string;
  contractId: string;
  entityTypeId: string;
  ownerKey: string;
  records: EntityRecord[];
}) {
  const db = await getDatabase();
  const seenServerIds = new Set(records.map((record) => record.id));

  await upsertRemoteRecords({
    cachedAt,
    contractId,
    entityTypeId,
    ownerKey,
    records,
  });
  const afterUpsert = await getRecordCacheStatusCounts({ contractId, entityTypeId, ownerKey });

  const syncedRows = await db.getAllAsync<{ local_id: string; server_id: string | null }>(
    `
      SELECT local_id, server_id
      FROM entity_records
      WHERE owner_key = ?
        AND contract_id = ?
        AND entity_type_id = ?
        AND sync_status = 'synced'
    `,
    ownerKey,
    contractId,
    entityTypeId,
  );

  for (const row of syncedRows) {
    if (row.server_id && seenServerIds.has(row.server_id)) {
      continue;
    }

    await db.runAsync(
      `
        DELETE FROM entity_records
        WHERE local_id = ? AND sync_status = 'synced'
      `,
      row.local_id,
    );
  }

  const afterReconcile = await getRecordCacheStatusCounts({ contractId, entityTypeId, ownerKey });
  const scope = fingerprintRecordsScope({ contractId, entityTypeId, ownerKey });

  return {
    afterReconcile,
    afterUpsert,
    reconcileScope: scope,
    writeScope: scope,
  } satisfies RecordsReconcileDiagnostics;
}

async function listCachedRecords({
  contractId,
  entityTypeId,
  ownerKey,
  page = 1,
  pageSize = 25,
  search,
}: {
  contractId: string;
  entityTypeId: string;
  ownerKey: string;
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<EntityRecordRow>(
    `
      SELECT *
      FROM entity_records
      WHERE owner_key = ? AND contract_id = ? AND entity_type_id = ?
      ORDER BY cached_at DESC, display_name ASC
    `,
    ownerKey,
    contractId,
    entityTypeId,
  );
  const normalizedSearch = search?.trim().toLocaleLowerCase("es-CL") ?? "";
  const filtered = rows.map(mapRecordRow).filter((record) => {
    if (!normalizedSearch) {
      return true;
    }

    return (
      record.displayName.toLocaleLowerCase("es-CL").includes(normalizedSearch) ||
      JSON.stringify(record.values).toLocaleLowerCase("es-CL").includes(normalizedSearch)
    );
  });
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;

  return {
    fromCache: true,
    offline: false,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
    records: filtered.slice(offset, offset + pageSize),
  };
}

async function getCachedRecord({
  contractId,
  entityTypeId,
  ownerKey,
  recordId,
}: {
  contractId: string;
  entityTypeId: string;
  ownerKey: string;
  recordId: string;
}) {
  const db = await getDatabase();
  const row = await db.getFirstAsync<EntityRecordRow>(
    `
      SELECT *
      FROM entity_records
      WHERE owner_key = ?
        AND contract_id = ?
        AND entity_type_id = ?
        AND (local_id = ? OR server_id = ?)
      LIMIT 1
    `,
    ownerKey,
    contractId,
    entityTypeId,
    recordId,
    recordId,
  );

  return row ? mapRecordRow(row) : null;
}

async function createLocalRecord({
  clientRequestId = createLocalRecordId(),
  contractId,
  entityTypeId,
  localId = createLocalRecordId(),
  ownerKey,
  values,
}: {
  clientRequestId?: string;
  contractId: string;
  entityTypeId: string;
  localId?: string;
  ownerKey: string;
  values: Record<string, EntityRecordValue>;
}) {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const displayName = buildLocalDisplayName(values);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `
        INSERT INTO entity_records (
          local_id,
          server_id,
          owner_key,
          contract_id,
          entity_type_id,
          display_name,
          values_json,
          cached_at,
          sync_status
        )
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'pending_create')
      `,
      localId,
      ownerKey,
      contractId,
      entityTypeId,
      displayName,
      JSON.stringify(values),
      now,
    );

    await upsertPendingOperationInTransaction(db, {
      clientRequestId,
      contractId,
      entityTypeId,
      localRecordId: localId,
      operation: "CREATE",
      ownerKey,
      payload: {
        clientRequestId,
        values,
      },
      serverRecordId: null,
      timestamp: now,
    });
  });

  const record = await getCachedRecord({ contractId, entityTypeId, ownerKey, recordId: localId });

  if (!record) {
    throw new Error("No fue posible leer el registro local creado.");
  }

  return record;
}

async function updateLocalRecord({
  contractId,
  entityTypeId,
  ownerKey,
  recordId,
  values,
}: {
  contractId: string;
  entityTypeId: string;
  ownerKey: string;
  recordId: string;
  values: Record<string, EntityRecordValue>;
}) {
  const db = await getDatabase();
  const existing = await getCachedRecord({ contractId, entityTypeId, ownerKey, recordId });

  if (!existing) {
    throw new Error("No se encontro el registro local para editar.");
  }

  const now = new Date().toISOString();
  const nextValues = {
    ...existing.values,
    ...values,
  };
  const createOperation = await db.getFirstAsync<PendingOperationRow>(
    `
      SELECT *
      FROM pending_operations
      WHERE owner_key = ? AND local_record_id = ? AND operation = 'CREATE'
      LIMIT 1
    `,
    ownerKey,
    existing.localId,
  );
  const nextStatus: RecordSyncStatus = createOperation ? "pending_create" : "pending_update";

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `
        UPDATE entity_records
        SET display_name = ?,
            values_json = ?,
            cached_at = ?,
            sync_status = ?,
            sync_error_code = NULL,
            sync_error_message = NULL,
            conflict_remote_values_json = NULL,
            conflict_remote_display_name = NULL,
            conflict_remote_updated_at = NULL
        WHERE local_id = ?
      `,
      buildLocalDisplayName(nextValues),
      JSON.stringify(nextValues),
      now,
      nextStatus,
      existing.localId,
    );

    if (createOperation) {
      await db.runAsync(
        `
          UPDATE pending_operations
          SET payload_json = ?,
              updated_at = ?,
              last_error_code = NULL,
              last_error_message = NULL
          WHERE id = ?
        `,
        JSON.stringify({
          clientRequestId: createOperation.client_request_id,
          values: nextValues,
        }),
        now,
        createOperation.id,
      );
      return;
    }

    if (!existing.serverId) {
      throw new Error("No se puede sincronizar UPDATE sin server_id.");
    }

    await upsertPendingOperationInTransaction(db, {
      clientRequestId: createLocalRecordId(),
      contractId,
      entityTypeId,
      localRecordId: existing.localId,
      operation: "UPDATE",
      ownerKey,
      payload: {
        values: nextValues,
      },
      serverRecordId: existing.serverId,
      timestamp: now,
    });
  });

  const record = await getCachedRecord({ contractId, entityTypeId, ownerKey, recordId: existing.localId });

  if (!record) {
    throw new Error("No fue posible leer el registro local actualizado.");
  }

  return record;
}

async function listPendingOperations(ownerKey: string) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<PendingOperationRow>(
    `
      SELECT pending_operations.*
      FROM pending_operations
      INNER JOIN entity_records ON entity_records.local_id = pending_operations.local_record_id
      WHERE pending_operations.owner_key = ?
        AND entity_records.sync_status IN ('pending_create', 'pending_update')
        AND pending_operations.operation IN ('CREATE', 'UPDATE')
      ORDER BY
        pending_operations.local_record_id ASC,
        CASE pending_operations.operation WHEN 'CREATE' THEN 0 ELSE 1 END ASC,
        pending_operations.created_at ASC
    `,
    ownerKey,
  );

  return rows.map(mapPendingOperationRow);
}

async function countPendingOperations(ownerKey: string) {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ total: number }>(
    `
      SELECT COUNT(*) AS total
      FROM pending_operations
      INNER JOIN entity_records ON entity_records.local_id = pending_operations.local_record_id
      WHERE pending_operations.owner_key = ?
        AND entity_records.sync_status IN ('pending_create', 'pending_update')
    `,
    ownerKey,
  );

  return row?.total ?? 0;
}

async function getRecordsSyncSummary({
  contractId,
  ownerKey,
}: {
  contractId: string;
  ownerKey: string;
}): Promise<RecordsSyncSummary> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ sync_status: RecordSyncStatus; total: number }>(
    `
      SELECT sync_status, COUNT(*) AS total
      FROM entity_records
      WHERE owner_key = ?
        AND contract_id = ?
        AND sync_status IN ('pending_create', 'pending_update', 'syncing', 'failed', 'conflict')
      GROUP BY sync_status
    `,
    ownerKey,
    contractId,
  );
  const count = (statuses: RecordSyncStatus[]) =>
    rows
      .filter((row) => statuses.includes(row.sync_status))
      .reduce((total, row) => total + row.total, 0);

  return {
    conflictCount: count(["conflict"]),
    failedCount: count(["failed"]),
    pendingCount: count(["pending_create", "pending_update"]),
    syncingCount: count(["syncing"]),
  };
}

async function getRecordOutboxConsistency({
  contractId,
  entityTypeId,
  ownerKey,
}: {
  contractId: string;
  entityTypeId: string;
  ownerKey: string;
}): Promise<RecordOutboxConsistency> {
  const db = await getDatabase();
  const scope = fingerprintRecordsScope({ contractId, entityTypeId, ownerKey });
  const rows = await db.getAllAsync<{
    code: RecordOutboxConsistencyIssueCode;
    local_record_id: string | null;
    operation: "CREATE" | "UPDATE" | null;
    operation_id: string | null;
    sync_status: RecordSyncStatus | null;
  }>(
    `
      SELECT
        'ORPHANED_LOCAL_INTENT' AS code,
        entity_records.local_id AS local_record_id,
        NULL AS operation,
        NULL AS operation_id,
        entity_records.sync_status AS sync_status
      FROM entity_records
      LEFT JOIN pending_operations ON pending_operations.owner_key = entity_records.owner_key
        AND pending_operations.contract_id = entity_records.contract_id
        AND pending_operations.entity_type_id = entity_records.entity_type_id
        AND pending_operations.local_record_id = entity_records.local_id
        AND pending_operations.operation IN ('CREATE', 'UPDATE')
      WHERE entity_records.owner_key = ?
        AND entity_records.contract_id = ?
        AND entity_records.entity_type_id = ?
        AND entity_records.sync_status IN ('pending_create', 'pending_update', 'syncing')
        AND pending_operations.id IS NULL
      UNION ALL
      SELECT
        'ORPHANED_OUTBOX' AS code,
        pending_operations.local_record_id AS local_record_id,
        pending_operations.operation AS operation,
        pending_operations.id AS operation_id,
        NULL AS sync_status
      FROM pending_operations
      LEFT JOIN entity_records ON entity_records.owner_key = pending_operations.owner_key
        AND entity_records.contract_id = pending_operations.contract_id
        AND entity_records.entity_type_id = pending_operations.entity_type_id
        AND entity_records.local_id = pending_operations.local_record_id
      WHERE pending_operations.owner_key = ?
        AND pending_operations.contract_id = ?
        AND pending_operations.entity_type_id = ?
        AND pending_operations.operation IN ('CREATE', 'UPDATE')
        AND entity_records.local_id IS NULL
      UNION ALL
      SELECT
        'INCONSISTENT_COMPLETION' AS code,
        entity_records.local_id AS local_record_id,
        pending_operations.operation AS operation,
        pending_operations.id AS operation_id,
        entity_records.sync_status AS sync_status
      FROM entity_records
      INNER JOIN pending_operations ON pending_operations.owner_key = entity_records.owner_key
        AND pending_operations.contract_id = entity_records.contract_id
        AND pending_operations.entity_type_id = entity_records.entity_type_id
        AND pending_operations.local_record_id = entity_records.local_id
        AND pending_operations.operation IN ('CREATE', 'UPDATE')
      WHERE entity_records.owner_key = ?
        AND entity_records.contract_id = ?
        AND entity_records.entity_type_id = ?
        AND entity_records.sync_status = 'synced'
    `,
    ownerKey,
    contractId,
    entityTypeId,
    ownerKey,
    contractId,
    entityTypeId,
    ownerKey,
    contractId,
    entityTypeId,
  );
  const issueCounts: Record<RecordOutboxConsistencyIssueCode, number> = {
    INCONSISTENT_COMPLETION: 0,
    ORPHANED_LOCAL_INTENT: 0,
    ORPHANED_OUTBOX: 0,
  };
  const issues: RecordOutboxConsistency["issues"] = rows.map((row) => {
    issueCounts[row.code] += 1;

    return {
      code: row.code,
      contract: scope.contract,
      entity: scope.entity,
      localRecord: fingerprintDiagnosticValue(row.local_record_id ?? "missing"),
      operation: row.operation ?? "none",
      operationId: row.operation_id ? fingerprintDiagnosticValue(row.operation_id) : null,
      owner: scope.owner,
      syncStatus: row.sync_status ?? "missing-record",
    };
  });

  return {
    issueCounts,
    issues,
    ok: issues.length === 0,
    scope,
  };
}

async function getRecordCacheStatusCounts({
  contractId,
  entityTypeId,
  ownerKey,
}: {
  contractId: string;
  entityTypeId: string;
  ownerKey: string;
}) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ sync_status: RecordSyncStatus; total: number }>(
    `
      SELECT sync_status, COUNT(*) AS total
      FROM entity_records
      WHERE owner_key = ?
        AND contract_id = ?
        AND entity_type_id = ?
      GROUP BY sync_status
    `,
    ownerKey,
    contractId,
    entityTypeId,
  );
  const count = (status: RecordSyncStatus) =>
    rows.filter((row) => row.sync_status === status).reduce((total, row) => total + row.total, 0);

  return {
    conflict: count("conflict"),
    failed: count("failed"),
    pendingCreate: count("pending_create"),
    pendingUpdate: count("pending_update"),
    synced: count("synced"),
    total: rows.reduce((total, row) => total + row.total, 0),
  };
}

async function getSyncTelemetry({
  contractId,
  entityTypeId,
  ownerKey,
}: {
  contractId: string;
  entityTypeId: string;
  ownerKey: string;
}): Promise<SyncTelemetry | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<SyncTelemetryRow>(
    `
      SELECT *
      FROM sync_telemetry
      WHERE owner_key = ? AND contract_id = ? AND entity_type_id = ?
      LIMIT 1
    `,
    ownerKey,
    contractId,
    entityTypeId,
  );

  return row ? mapSyncTelemetryRow(row) : null;
}

async function markSyncPhase({
  attemptedAt,
  contractId,
  entityTypeId,
  ownerKey,
  phase,
}: {
  attemptedAt?: string;
  contractId: string;
  entityTypeId: string;
  ownerKey: string;
  phase: SyncPhase;
}) {
  const db = await getDatabase();
  const now = attemptedAt ?? new Date().toISOString();

  await ensureSyncTelemetryRow(db, ownerKey, contractId, entityTypeId, now);
  await db.runAsync(
    `
      UPDATE sync_telemetry
      SET sync_phase = ?,
          last_sync_attempt_at = COALESCE(?, last_sync_attempt_at),
          last_sync_error_at = NULL,
          last_sync_error_code = NULL,
          last_sync_error_phase = NULL,
          updated_at = ?
      WHERE owner_key = ? AND contract_id = ? AND entity_type_id = ?
    `,
    phase,
    attemptedAt ?? null,
    now,
    ownerKey,
    contractId,
    entityTypeId,
  );
}

async function markSyncPhaseCompleted({
  completedAt,
  contractId,
  entityTypeId,
  ownerKey,
  phase,
}: {
  completedAt?: string;
  contractId: string;
  entityTypeId: string;
  ownerKey: string;
  phase: SyncErrorPhase;
}) {
  const db = await getDatabase();
  const now = completedAt ?? new Date().toISOString();
  const completedColumn = getSyncCompletedColumn(phase);
  const lastSuccessfulSyncAt = phase === "reconciling" ? now : null;

  await ensureSyncTelemetryRow(db, ownerKey, contractId, entityTypeId, now);
  await db.runAsync(
    `
      UPDATE sync_telemetry
      SET ${completedColumn} = ?,
          last_successful_sync_at = COALESCE(?, last_successful_sync_at),
          sync_phase = 'idle',
          last_sync_error_at = NULL,
          last_sync_error_code = NULL,
          last_sync_error_phase = NULL,
          updated_at = ?
      WHERE owner_key = ? AND contract_id = ? AND entity_type_id = ?
    `,
    now,
    lastSuccessfulSyncAt,
    now,
    ownerKey,
    contractId,
    entityTypeId,
  );
}

async function markSyncError({
  code,
  contractId,
  entityTypeId,
  occurredAt,
  ownerKey,
  phase,
}: {
  code: SyncErrorCode;
  contractId: string;
  entityTypeId: string;
  occurredAt?: string;
  ownerKey: string;
  phase: SyncErrorPhase;
}) {
  const db = await getDatabase();
  const now = occurredAt ?? new Date().toISOString();

  await ensureSyncTelemetryRow(db, ownerKey, contractId, entityTypeId, now);
  await db.runAsync(
    `
      UPDATE sync_telemetry
      SET sync_phase = 'error',
          last_sync_error_at = ?,
          last_sync_error_code = ?,
          last_sync_error_phase = ?,
          updated_at = ?
      WHERE owner_key = ? AND contract_id = ? AND entity_type_id = ?
    `,
    now,
    code,
    phase,
    now,
    ownerKey,
    contractId,
    entityTypeId,
  );
}

async function listProblemRecords({
  contractId,
  entityTypeId,
  ownerKey,
}: {
  contractId: string;
  entityTypeId: string;
  ownerKey: string;
}) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<EntityRecordRow>(
    `
      SELECT *
      FROM entity_records
      WHERE owner_key = ?
        AND contract_id = ?
        AND entity_type_id = ?
        AND sync_status IN ('failed', 'conflict')
      ORDER BY sync_status ASC, cached_at DESC, display_name ASC
    `,
    ownerKey,
    contractId,
    entityTypeId,
  );

  return rows.map(mapRecordRow);
}

async function saveStateUpdateLocally(input: SaveStateUpdateLocallyInput) {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const localRecordId = createStateUpdateLocalRecordId(input);
  const existingRecord = await getCachedRecord({
    contractId: input.contractId,
    entityTypeId: input.targetEntityTypeId,
    ownerKey: input.ownerKey,
    recordId: localRecordId,
  });
  const existingOperation = input.historyMode === "update-current"
    ? await db.getFirstAsync<PendingOperationRow>(
        `
          SELECT *
          FROM pending_operations
          WHERE owner_key = ?
            AND contract_id = ?
            AND entity_type_id = ?
            AND local_record_id = ?
            AND operation = ?
          LIMIT 1
        `,
        input.ownerKey,
        input.contractId,
        input.targetEntityTypeId,
        localRecordId,
        STATE_UPDATE_OPERATION,
      )
    : null;
  const expectedUpdatedAt = input.expectedUpdatedAt ?? existingRecord?.remoteUpdatedAt ?? null;
  const stateValues = buildOfflineStateValues(input.stateFields, input.stateValues);
  const values: OfflineStateUpdateValues = {
    appViewId: input.appViewId,
    date: input.date,
    expectedUpdatedAt,
    extraValues: input.extraValues,
    stateValues,
    subjectDisplayName: input.subjectDisplayName,
    subjectRecordId: input.subjectRecordId,
  };
  const nextPayload: OfflineStateUpdatePayload = {
    appViewId: input.appViewId,
    clientRequestId: existingOperation?.client_request_id ?? "",
    date: input.date,
    expectedUpdatedAt,
    extraValues: input.extraValues,
    historyMode: input.historyMode,
    overwrite: input.overwrite,
    stateValues,
    subjectDisplayName: input.subjectDisplayName,
    subjectRecordId: input.subjectRecordId,
    uniqueness: input.uniqueness,
  };
  const existingPayload = existingOperation
    ? parsePendingStateUpdatePayload(existingOperation.payload_json)
    : null;
  const clientRequestId = resolveStateUpdateClientRequestId({
    existingClientRequestId: existingOperation?.client_request_id,
    existingPayload,
    nextPayload,
  });
  const payload: OfflineStateUpdatePayload = {
    ...nextPayload,
    clientRequestId,
  };
  const syncStatus: RecordSyncStatus = existingRecord?.serverId || expectedUpdatedAt ? "pending_update" : "pending_create";

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `
        INSERT INTO entity_records (
          local_id,
          server_id,
          owner_key,
          contract_id,
          entity_type_id,
          display_name,
          values_json,
          remote_updated_at,
          cached_at,
          sync_status,
          sync_error_code,
          sync_error_message,
          conflict_remote_values_json,
          conflict_remote_display_name,
          conflict_remote_updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)
        ON CONFLICT(local_id)
        DO UPDATE SET
          display_name = excluded.display_name,
          values_json = excluded.values_json,
          remote_updated_at = COALESCE(entity_records.remote_updated_at, excluded.remote_updated_at),
          cached_at = excluded.cached_at,
          sync_status = excluded.sync_status,
          sync_error_code = NULL,
          sync_error_message = NULL,
          conflict_remote_values_json = NULL,
          conflict_remote_display_name = NULL,
          conflict_remote_updated_at = NULL
      `,
      localRecordId,
      existingRecord?.serverId ?? null,
      input.ownerKey,
      input.contractId,
      input.targetEntityTypeId,
      input.subjectDisplayName,
      JSON.stringify(values),
      expectedUpdatedAt,
      now,
      syncStatus,
    );

    await upsertStateUpdatePendingOperation({
      clientRequestId,
      input,
      localRecordId,
      payload,
      serverRecordId: existingRecord?.serverId ?? null,
      timestamp: now,
    });
  });

  const saved = await getCachedRecord({
    contractId: input.contractId,
    entityTypeId: input.targetEntityTypeId,
    ownerKey: input.ownerKey,
    recordId: localRecordId,
  });

  if (!saved) {
    throw new Error("No fue posible leer el cambio de estado local guardado.");
  }

  return normalizeStateUpdateRecord(saved);
}

async function searchStateUpdateSubjects({
  appViewId,
  contractId,
  date,
  ownerKey,
  search,
  sourceEntityTypeId,
  targetEntityTypeId,
}: SearchStateUpdateSubjectsInput) {
  const subjects = await listCachedRecords({
    contractId,
    entityTypeId: sourceEntityTypeId,
    ownerKey,
    page: 1,
    pageSize: 25,
    search,
  });
  const results = await Promise.all(
    subjects.records.map(async (record) => {
      const localState = await findStateUpdateRecordForSubject({
        appViewId,
        contractId,
        date,
        ownerKey,
        subjectRecordId: record.serverId ?? record.id,
        targetEntityTypeId,
      });

      return localState
        ? stateUpdateRecordToItem(normalizeStateUpdateRecord(localState))
        : {
            current: null,
            subject: {
              displayName: record.displayName,
              id: record.serverId ?? record.id,
            },
          };
    }),
  );

  return results;
}

async function upsertStateUpdateSnapshot({ appViewId, complete = false, contractId, date, items, ownerKey, targetEntityTypeId }: UpsertStateUpdateSnapshotInput): Promise<StateUpdateSnapshotReconcileResult> {
  const db = await getDatabase();
  const cachedAt = new Date().toISOString();
  let staleSyncedRemoved = 0;

  await db.withTransactionAsync(async () => {
    const currentItems = items.filter((item) => item.current);

    for (const item of currentItems) {
      if (!item.current) {
        continue;
      }

      const localRecordId = createStateUpdateLocalRecordId({
        appViewId,
        date,
        historyMode: "update-current",
        subjectRecordId: item.subject.id,
        uniqueness: date ? "subject-date" : "subject",
      });
      const existing = await getCachedRecord({
        contractId,
        entityTypeId: targetEntityTypeId,
        ownerKey,
        recordId: localRecordId,
      });

      if (existing && existing.syncStatus !== "synced") {
        const pendingOperation = await getStateUpdatePendingOperation(db, ownerKey, existing.localId);

        if (pendingOperation) {
          const payload = pendingOperation.payload as OfflineStateUpdatePayload;

          if (!stateUpdateRemoteItemMatchesPayload(item, payload)) {
            continue;
          }

          await completeStateUpdateOperationInTransaction(db, pendingOperation, {
            recordId: item.current.recordId,
            result: "UNCHANGED",
            subjectRecordId: payload.subjectRecordId,
            updatedAt: item.current.updatedAt,
          });
          await markStateUpdateSyncDiagnosticsReconciledFromSnapshot({
            completedAt: cachedAt,
            ownerKey,
          });
          continue;
        }
      }

      const values: OfflineStateUpdateValues = {
        appViewId,
        date,
        expectedUpdatedAt: item.current.updatedAt,
        extraValues: item.current.extraValues,
        stateValues: item.current.stateValues,
        subjectDisplayName: item.subject.displayName,
        subjectRecordId: item.subject.id,
      };

      await db.runAsync(
        `
          INSERT INTO entity_records (
            local_id,
            server_id,
            owner_key,
            contract_id,
            entity_type_id,
            display_name,
            values_json,
            remote_updated_at,
            cached_at,
            sync_status,
            sync_error_code,
            sync_error_message,
            conflict_remote_values_json,
            conflict_remote_display_name,
            conflict_remote_updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', NULL, NULL, NULL, NULL, NULL)
          ON CONFLICT(local_id)
          DO UPDATE SET
            server_id = excluded.server_id,
            display_name = excluded.display_name,
            values_json = excluded.values_json,
            remote_updated_at = excluded.remote_updated_at,
            cached_at = excluded.cached_at,
            sync_status = 'synced',
            sync_error_code = NULL,
            sync_error_message = NULL,
            conflict_remote_values_json = NULL,
            conflict_remote_display_name = NULL,
            conflict_remote_updated_at = NULL
        `,
        localRecordId,
        item.current.recordId,
        ownerKey,
        contractId,
        targetEntityTypeId,
        item.subject.displayName,
        JSON.stringify(values),
        item.current.updatedAt,
        cachedAt,
      );
    }

    if (complete) {
      staleSyncedRemoved = await deleteStaleSyncedStateUpdateRecords({
        appViewId,
        contractId,
        date,
        db,
        items: currentItems,
        ownerKey,
        targetEntityTypeId,
      });
    }
  });

  return { staleSyncedRemoved };
}

async function deleteStaleSyncedStateUpdateRecords({
  appViewId,
  contractId,
  date,
  db,
  items,
  ownerKey,
  targetEntityTypeId,
}: StateUpdateScope & { db: SQLite.SQLiteDatabase; items: StateUpdateItem[] }) {
  const currentItems = items.filter((item) => item.current);
  const remoteRecordIds = currentItems.map((item) => item.current?.recordId).filter((recordId): recordId is string => Boolean(recordId));
  const localRecordIds = currentItems.map((item) => createStateUpdateLocalRecordId({
    appViewId,
    date,
    historyMode: "update-current",
    subjectRecordId: item.subject.id,
    uniqueness: date ? "subject-date" : "subject",
  }));
  const keepLocalPlaceholders = localRecordIds.map(() => "?").join(", ");
  const keepRemotePlaceholders = remoteRecordIds.map(() => "?").join(", ");
  const keepLocalClause = localRecordIds.length > 0 ? `AND local_id NOT IN (${keepLocalPlaceholders})` : "";
  const keepRemoteClause = remoteRecordIds.length > 0 ? `AND (server_id IS NULL OR server_id NOT IN (${keepRemotePlaceholders}))` : "";
  const result = await db.runAsync(
    `
      DELETE FROM entity_records
      WHERE owner_key = ?
        AND contract_id = ?
        AND entity_type_id = ?
        AND sync_status = 'synced'
        AND json_extract(values_json, '$.appViewId') = ?
        AND (? IS NULL OR json_extract(values_json, '$.date') = ?)
        ${keepLocalClause}
        ${keepRemoteClause}
    `,
    ownerKey,
    contractId,
    targetEntityTypeId,
    appViewId,
    date ?? null,
    date ?? null,
    ...localRecordIds,
    ...remoteRecordIds,
  );

  return result && typeof result === "object" && "changes" in result && typeof result.changes === "number" ? result.changes : 0;
}

async function getStateUpdateSummary(input: StateUpdateScope): Promise<import("./state-update-offline").StateUpdateSummary> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ sync_status: RecordSyncStatus; total: number }>(
    `
      SELECT sync_status, COUNT(*) AS total
      FROM entity_records
      WHERE owner_key = ?
        AND contract_id = ?
        AND entity_type_id = ?
        AND json_extract(values_json, '$.appViewId') = ?
        AND (? IS NULL OR json_extract(values_json, '$.date') = ?)
      GROUP BY sync_status
    `,
    input.ownerKey,
    input.contractId,
    input.targetEntityTypeId,
    input.appViewId,
    input.date ?? null,
    input.date ?? null,
  );
  const count = (statuses: RecordSyncStatus[]) =>
    rows
      .filter((row) => statuses.includes(row.sync_status))
      .reduce((total, row) => total + row.total, 0);

  return {
    conflictCount: count(["conflict"]),
    failedCount: count(["failed"]),
    pendingCount: count(["pending_create", "pending_update"]),
    syncingCount: count(["syncing"]),
    totalRegistered: rows.reduce((total, row) => total + row.total, 0),
  };
}

async function listStateUpdateLatest(input: StateUpdateScope & { limit?: number }) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<EntityRecordRow>(
    `
      SELECT *
      FROM entity_records
      WHERE owner_key = ?
        AND contract_id = ?
        AND entity_type_id = ?
        AND json_extract(values_json, '$.appViewId') = ?
        AND (? IS NULL OR json_extract(values_json, '$.date') = ?)
      ORDER BY cached_at DESC
      LIMIT ?
    `,
    input.ownerKey,
    input.contractId,
    input.targetEntityTypeId,
    input.appViewId,
    input.date ?? null,
    input.date ?? null,
    input.limit ?? 10,
  );

  return rows.map((row) => {
    const record = normalizeStateUpdateRecord(mapRecordRow(row));

    return {
      recordId: record.localRecordId,
      stateValues: record.stateValues.map((value) => ({
        ...value,
        label: record.syncStatus === "pending" && value.label ? `${value.label} (por sincronizar)` : value.label,
      })),
      subject: record.subject,
      updatedAt: record.updatedAt ?? row.cached_at,
    };
  });
}

async function listStateUpdateConflicts(input: StateUpdateScope) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<EntityRecordRow>(
    `
      SELECT *
      FROM entity_records
      WHERE owner_key = ?
        AND contract_id = ?
        AND entity_type_id = ?
        AND sync_status = 'conflict'
        AND json_extract(values_json, '$.appViewId') = ?
        AND (? IS NULL OR json_extract(values_json, '$.date') = ?)
      ORDER BY cached_at DESC, display_name ASC
    `,
    input.ownerKey,
    input.contractId,
    input.targetEntityTypeId,
    input.appViewId,
    input.date ?? null,
    input.date ?? null,
  );

  return rows.map((row) => normalizeStateUpdateRecord(mapRecordRow(row)));
}

async function markPendingOperationSyncing(operationId: string) {
  const db = await getDatabase();
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `
        UPDATE pending_operations
        SET attempts = attempts + 1,
            updated_at = ?,
            last_error_code = NULL,
            last_error_message = NULL
        WHERE id = ?
      `,
      now,
      operationId,
    );

    await db.runAsync(
      `
        UPDATE entity_records
        SET sync_status = 'syncing',
            sync_error_code = NULL,
            sync_error_message = NULL
        WHERE local_id = (
          SELECT local_record_id
          FROM pending_operations
          WHERE id = ?
        )
      `,
      operationId,
    );
  });
}

async function listPendingStateUpdateOperations(ownerKey: string) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<PendingOperationRow>(
    `
      SELECT pending_operations.*
      FROM pending_operations
      INNER JOIN entity_records ON entity_records.local_id = pending_operations.local_record_id
      WHERE pending_operations.owner_key = ?
        AND pending_operations.operation = ?
        AND entity_records.sync_status IN ('pending_create', 'pending_update', 'syncing')
      ORDER BY pending_operations.created_at ASC
    `,
    ownerKey,
    STATE_UPDATE_OPERATION,
  );

  return rows.map(mapPendingOperationRow);
}

async function getStateUpdateOutboxDiagnostics(ownerKey: string): Promise<StateUpdateOutboxDiagnostics> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<StateUpdateOutboxDiagnosticsRow>(
    `
      SELECT
        pending_operations.*,
        entity_records.sync_status AS record_sync_status,
        entity_records.sync_error_code AS record_sync_error_code,
        entity_records.sync_error_message AS record_sync_error_message,
        entity_records.cached_at AS record_cached_at,
        app_view_definitions.definition_json AS definition_json,
        app_view_definitions.status AS definition_status,
        app_view_definitions.workflow_key AS definition_workflow_key
      FROM pending_operations
      LEFT JOIN entity_records ON entity_records.local_id = pending_operations.local_record_id
      LEFT JOIN app_view_definitions ON app_view_definitions.owner_key = pending_operations.owner_key
        AND app_view_definitions.contract_id = pending_operations.contract_id
        AND app_view_definitions.app_view_id = json_extract(pending_operations.payload_json, '$.appViewId')
      WHERE pending_operations.owner_key = ?
        AND pending_operations.operation = ?
      ORDER BY pending_operations.created_at ASC
    `,
    ownerKey,
    STATE_UPDATE_OPERATION,
  );
  const operations = rows.map(mapStateUpdateOutboxDiagnosticsRow);
  const localRows = await db.getAllAsync<StateUpdateLocalRecordDiagnosticsRow>(
    `
      SELECT
        entity_records.*,
        pending_operations.id AS pending_operation_id,
        app_view_definitions.definition_json AS definition_json,
        app_view_definitions.status AS definition_status,
        app_view_definitions.workflow_key AS definition_workflow_key
      FROM entity_records
      LEFT JOIN pending_operations ON pending_operations.owner_key = entity_records.owner_key
        AND pending_operations.local_record_id = entity_records.local_id
        AND pending_operations.operation = ?
      LEFT JOIN app_view_definitions ON app_view_definitions.owner_key = entity_records.owner_key
        AND app_view_definitions.contract_id = entity_records.contract_id
        AND app_view_definitions.app_view_id = json_extract(entity_records.values_json, '$.appViewId')
      WHERE entity_records.owner_key = ?
        AND json_extract(entity_records.values_json, '$.appViewId') IS NOT NULL
        AND (
          app_view_definitions.definition_json IS NULL
          OR app_view_definitions.workflow_key IN ('attendance', 'state-update')
          OR json_extract(app_view_definitions.definition_json, '$.kind') = 'state-update'
        )
      ORDER BY entity_records.cached_at DESC
    `,
    STATE_UPDATE_OPERATION,
    ownerKey,
  );
  const localRecords = localRows.map(mapStateUpdateLocalRecordDiagnosticsRow);
  const localCount = (status: RecordSyncStatus) => localRecords.filter((record) => record.syncStatus === status).length;
  const attendanceDerivedPendingCount = localRecords.filter((record) =>
    isStateUpdateCompatibleWorkflow(record.workflowKey) &&
    (record.syncStatus === "pending_create" ||
      record.syncStatus === "pending_update" ||
      record.syncStatus === "syncing" ||
      record.syncStatus === "failed" ||
      record.syncStatus === "conflict")
  ).length;
  const orphanedLocalChange = localRecords.filter((record) => record.recoveryState === "ORPHANED_LOCAL_CHANGE").length;
  const remoteSnapshotRepairable = localRecords.filter((record) => record.recoveryState === "REMOTE_SNAPSHOT_REPAIRABLE").length;

  return {
    consistency: operations.length === 0 && attendanceDerivedPendingCount > 0 ? "MISMATCH" : "OK",
    localRecords,
    operations,
    summary: {
      attendanceDerivedPendingCount,
      conflict: operations.filter((operation) => operation.syncStatus === "conflict").length,
      eligibleForAutoSync: operations.filter((operation) => operation.retryable).length,
      failed: operations.filter((operation) => operation.syncStatus === "failed").length,
      localConflict: localCount("conflict"),
      localFailed: localCount("failed"),
      localPendingCreate: localCount("pending_create"),
      localPendingUpdate: localCount("pending_update"),
      localSynced: localCount("synced"),
      localSyncing: localCount("syncing"),
      localTotal: localRecords.length,
      orphanedLocalChange,
      remoteSnapshotRepairable,
      pendingCreate: operations.filter((operation) => operation.syncStatus === "pending_create").length,
      pendingUpdate: operations.filter((operation) => operation.syncStatus === "pending_update").length,
      stateUpdateTotalLocal: operations.length,
      syncing: operations.filter((operation) => operation.syncStatus === "syncing").length,
    },
  };
}

async function getStateUpdatePendingOperation(db: SQLite.SQLiteDatabase, ownerKey: string, localRecordId: string) {
  const row = await db.getFirstAsync<PendingOperationRow>(
    `
      SELECT *
      FROM pending_operations
      WHERE owner_key = ? AND local_record_id = ? AND operation = ?
      LIMIT 1
    `,
    ownerKey,
    localRecordId,
    STATE_UPDATE_OPERATION,
  );

  return row?.id ? mapPendingOperationRow(row) : null;
}

async function markStateUpdateOperationSyncing(operationId: string) {
  const db = await getDatabase();

  await db.runAsync(
    `
      UPDATE pending_operations
      SET attempts = attempts + 1,
          updated_at = ?,
          last_error_code = NULL,
          last_error_message = NULL
      WHERE id = ? AND operation = ?
    `,
    new Date().toISOString(),
    operationId,
    STATE_UPDATE_OPERATION,
  );

  await db.runAsync(
    `
      UPDATE entity_records
      SET sync_status = 'syncing',
          sync_error_code = NULL,
          sync_error_message = NULL
      WHERE local_id = (
        SELECT local_record_id
        FROM pending_operations
        WHERE id = ?
      )
    `,
    operationId,
  );
}

async function completePendingOperation(operation: PendingOperation, record: EntityRecord) {
  const db = await getDatabase();
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `
        DELETE FROM entity_records
        WHERE owner_key = ?
          AND contract_id = ?
          AND entity_type_id = ?
          AND server_id = ?
          AND local_id <> ?
      `,
      operation.ownerKey,
      operation.contractId,
      operation.entityTypeId,
      record.id,
      operation.localRecordId,
    );

    await db.runAsync(`DELETE FROM pending_operations WHERE id = ?`, operation.id);

    const remaining = await db.getFirstAsync<{ total: number }>(
      `SELECT COUNT(*) AS total FROM pending_operations WHERE local_record_id = ?`,
      operation.localRecordId,
    );
    const nextStatus: RecordSyncStatus = remaining?.total ? "pending_update" : "synced";

    await db.runAsync(
      `
        UPDATE entity_records
        SET server_id = ?,
            display_name = ?,
            values_json = ?,
            remote_updated_at = ?,
            cached_at = ?,
            sync_status = ?,
            sync_error_code = NULL,
            sync_error_message = NULL,
            conflict_remote_values_json = NULL,
            conflict_remote_display_name = NULL,
            conflict_remote_updated_at = NULL
        WHERE local_id = ?
      `,
      record.id,
      record.displayName,
      JSON.stringify(record.values),
      record.updatedAt,
      now,
      nextStatus,
      operation.localRecordId,
    );
  });
}

async function completeStateUpdateOperation(
  operation: PendingOperation,
  result: Extract<StateUpdateBatchResult, { result: "CREATED" | "UNCHANGED" | "UPDATED" }>,
) {
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    await completeStateUpdateOperationInTransaction(db, operation, result);
  });
}

async function completeStateUpdateOperationInTransaction(
  db: SQLite.SQLiteDatabase,
  operation: PendingOperation,
  result: Extract<StateUpdateBatchResult, { result: "CREATED" | "UNCHANGED" | "UPDATED" }>,
) {
  const payload = operation.payload as OfflineStateUpdatePayload;
  const now = new Date().toISOString();
  const values: OfflineStateUpdateValues = {
    appViewId: payload.appViewId,
    date: payload.date,
    expectedUpdatedAt: null,
    extraValues: payload.extraValues,
    stateValues: payload.stateValues.map((value) => ({
      fieldId: value.fieldId,
      label: value.label ?? null,
      optionId: value.optionId,
    })),
    subjectDisplayName: payload.subjectDisplayName,
    subjectRecordId: payload.subjectRecordId,
  };

  await db.runAsync(`DELETE FROM pending_operations WHERE id = ? AND operation = ?`, operation.id, STATE_UPDATE_OPERATION);
  await db.runAsync(
    `
      UPDATE entity_records
      SET server_id = COALESCE(?, server_id),
          display_name = ?,
          values_json = ?,
          remote_updated_at = ?,
          cached_at = ?,
          sync_status = 'synced',
          sync_error_code = NULL,
          sync_error_message = NULL,
          conflict_remote_values_json = NULL,
          conflict_remote_display_name = NULL,
          conflict_remote_updated_at = NULL
      WHERE local_id = ?
    `,
    result.recordId,
    payload.subjectDisplayName,
    JSON.stringify(values),
    result.updatedAt,
    now,
    operation.localRecordId,
  );
}

async function retryPendingOperation(operation: PendingOperation, code: string, message: string) {
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    await setOperationError(db, operation, code, message, operation.operation === "CREATE" ? "pending_create" : "pending_update");
  });
}

async function retryStateUpdateOperation(operation: PendingOperation, code: string, message: string) {
  const db = await getDatabase();
  const payload = operation.payload as OfflineStateUpdatePayload;

  await setOperationError(
    db,
    operation,
    code,
    message,
    payload.expectedUpdatedAt || operation.serverRecordId ? "pending_update" : "pending_create",
  );
}

async function retryFailedStateUpdateOperations({
  manualRetryToken,
  ownerKey,
}: {
  manualRetryToken?: string | null;
  ownerKey: string;
}) {
  const db = await getDatabase();
  const rows = await db.getAllAsync<PendingOperationRow>(
    `
      SELECT pending_operations.*
      FROM pending_operations
      INNER JOIN entity_records ON entity_records.local_id = pending_operations.local_record_id
      WHERE pending_operations.owner_key = ?
        AND pending_operations.operation = ?
        AND entity_records.sync_status = 'failed'
      ORDER BY pending_operations.created_at ASC
    `,
    ownerKey,
    STATE_UPDATE_OPERATION,
  );
  const selectedRows = manualRetryToken
    ? rows.filter((row) => stateUpdateManualRetryToken(row.id) === manualRetryToken)
    : rows;
  const now = new Date().toISOString();

  for (const row of selectedRows) {
    await db.runAsync(
      `
        UPDATE pending_operations
        SET updated_at = ?,
            last_error_code = NULL,
            last_error_message = NULL
        WHERE id = ? AND owner_key = ? AND operation = ?
      `,
      now,
      row.id,
      ownerKey,
      STATE_UPDATE_OPERATION,
    );
    await db.runAsync(
      `
        UPDATE entity_records
        SET sync_status = 'pending_update',
            sync_error_code = NULL,
            sync_error_message = NULL
        WHERE local_id = ?
      `,
      row.local_record_id,
    );
  }

  return selectedRows.length;
}

async function failPendingOperation(operation: PendingOperation, code: string, message: string) {
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    await setOperationError(db, operation, code, message, "failed");
  });
}

async function failStateUpdateOperation(operation: PendingOperation, code: string, message: string) {
  const db = await getDatabase();

  await setOperationError(db, operation, code, message, "failed");
}

async function readRecordRemoteUpdatedAt(operation: PendingOperation) {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ remote_updated_at: string | null }>(
    `
      SELECT remote_updated_at
      FROM entity_records
      WHERE local_id = ?
      LIMIT 1
    `,
    operation.localRecordId,
  );

  return row?.remote_updated_at ?? null;
}

async function markPendingOperationConflict(operation: PendingOperation, remoteRecord: EntityRecord, code: string, message: string) {
  const db = await getDatabase();
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `
        UPDATE pending_operations
        SET updated_at = ?,
            last_error_code = ?,
            last_error_message = ?
        WHERE id = ?
      `,
      now,
      code,
      message,
      operation.id,
    );
    await markRecordConflict(db, {
      localRecordId: operation.localRecordId,
      remoteRecord,
      syncErrorCode: code,
      syncErrorMessage: message,
    });
  });
}

async function markStateUpdateOperationConflict(
  operation: PendingOperation,
  result: Extract<StateUpdateBatchResult, { result: "CONFLICT" }>,
) {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const payload = operation.payload as OfflineStateUpdatePayload;
  const remoteValues: OfflineStateUpdateValues = {
    appViewId: payload.appViewId,
    date: payload.date,
    expectedUpdatedAt: result.existing.updatedAt,
    extraValues: payload.extraValues,
    stateValues: result.existing.stateValues,
    subjectDisplayName: payload.subjectDisplayName,
    subjectRecordId: result.subjectRecordId,
  };

  await db.runAsync(
    `
      UPDATE pending_operations
      SET updated_at = ?,
          last_error_code = ?,
          last_error_message = ?
      WHERE id = ?
    `,
    now,
    "CONFLICT",
    "Opco tiene un estado distinto para este registro.",
    operation.id,
  );
  await db.runAsync(
    `
      UPDATE entity_records
      SET sync_status = 'conflict',
          sync_error_code = ?,
          sync_error_message = ?,
          conflict_remote_values_json = ?,
          conflict_remote_display_name = ?,
          conflict_remote_updated_at = ?
      WHERE local_id = ?
    `,
    "CONFLICT",
    "Opco tiene un estado distinto para este registro.",
    JSON.stringify(remoteValues),
    payload.subjectDisplayName,
    result.existing.updatedAt,
    operation.localRecordId,
  );
}

async function discardStateUpdateLocalChange(input: StateUpdateScope & { subjectRecordId: string }) {
  const db = await getDatabase();
  const existing = await findStateUpdateRecordForSubject(input);

  if (!existing) {
    return;
  }

  const conflictValues = existing.conflictRemoteValues as Record<string, EntityRecordValue> | null;

  await db.runAsync(
    `
      DELETE FROM pending_operations
      WHERE owner_key = ? AND local_record_id = ? AND operation = ?
    `,
    input.ownerKey,
    existing.localId,
    STATE_UPDATE_OPERATION,
  );

  if (!conflictValues) {
    await db.runAsync(`DELETE FROM entity_records WHERE local_id = ?`, existing.localId);
    return;
  }

  await db.runAsync(
    `
      UPDATE entity_records
      SET values_json = ?,
          remote_updated_at = ?,
          cached_at = ?,
          sync_status = 'synced',
          sync_error_code = NULL,
          sync_error_message = NULL,
          conflict_remote_values_json = NULL,
          conflict_remote_display_name = NULL,
          conflict_remote_updated_at = NULL
      WHERE local_id = ?
    `,
    JSON.stringify(conflictValues),
    existing.conflictRemoteUpdatedAt ?? null,
    new Date().toISOString(),
    existing.localId,
  );
}

async function retryFailedRecord({
  contractId,
  entityTypeId,
  ownerKey,
  recordId,
}: {
  contractId: string;
  entityTypeId: string;
  ownerKey: string;
  recordId: string;
}) {
  const db = await getDatabase();
  const existing = await getCachedRecord({ contractId, entityTypeId, ownerKey, recordId });

  if (!existing || existing.syncStatus !== "failed") {
    throw new Error("No se encontro un registro fallido para reintentar.");
  }

  const operation = await db.getFirstAsync<PendingOperationRow>(
    `
      SELECT *
      FROM pending_operations
      WHERE owner_key = ? AND local_record_id = ?
      LIMIT 1
    `,
    ownerKey,
    existing.localId,
  );

  if (!operation) {
    throw new Error("No se encontro una operacion pendiente para reintentar.");
  }

  const now = new Date().toISOString();
  const nextStatus: RecordSyncStatus = operation.operation === "CREATE" ? "pending_create" : "pending_update";
  const nextPayload = operation.operation === "CREATE"
    ? { clientRequestId: operation.client_request_id, values: existing.values }
    : { values: existing.values };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `
        UPDATE pending_operations
        SET payload_json = ?,
            updated_at = ?,
            last_error_code = NULL,
            last_error_message = NULL
        WHERE id = ?
      `,
      JSON.stringify(nextPayload),
      now,
      operation.id,
    );
    await db.runAsync(
      `
        UPDATE entity_records
        SET sync_status = ?,
            sync_error_code = NULL,
            sync_error_message = NULL
        WHERE local_id = ?
      `,
      nextStatus,
      existing.localId,
    );
  });

  const record = await getCachedRecord({ contractId, entityTypeId, ownerKey, recordId: existing.localId });

  if (!record) {
    throw new Error("No fue posible leer el registro reintentado.");
  }

  return record;
}

async function resolveRecordConflictWithLocal({
  api,
  contractId,
  entityTypeId,
  ownerKey,
  recordId,
  token,
}: {
  api: Pick<OpcoApi, "getEntityRecord">;
  contractId: string;
  entityTypeId: string;
  ownerKey: string;
  recordId: string;
  token: string;
}) {
  const db = await getDatabase();
  const existing = await getCachedRecord({ contractId, entityTypeId, ownerKey, recordId });

  if (!existing || existing.syncStatus !== "conflict") {
    throw new Error("No se encontro un conflicto para resolver.");
  }

  if (!existing.serverId) {
    throw new Error("No se puede resolver con version local sin server_id.");
  }

  const remote = await api.getEntityRecord(token, contractId, entityTypeId, existing.serverId);
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `
        UPDATE entity_records
        SET remote_updated_at = ?,
            sync_status = 'pending_update',
            sync_error_code = NULL,
            sync_error_message = NULL,
            conflict_remote_values_json = NULL,
            conflict_remote_display_name = NULL,
            conflict_remote_updated_at = NULL
        WHERE local_id = ?
      `,
      remote.record.updatedAt,
      existing.localId,
    );
    await db.runAsync(
      `
        UPDATE pending_operations
        SET payload_json = ?,
            updated_at = ?,
            last_error_code = NULL,
            last_error_message = NULL
        WHERE owner_key = ? AND local_record_id = ? AND operation = 'UPDATE'
      `,
      JSON.stringify({ values: existing.values }),
      now,
      ownerKey,
      existing.localId,
    );
  });

  const record = await getCachedRecord({ contractId, entityTypeId, ownerKey, recordId: existing.localId });

  if (!record) {
    throw new Error("No fue posible leer el registro resuelto.");
  }

  return record;
}

async function resolveRecordConflictWithRemote({
  api,
  contractId,
  entityTypeId,
  ownerKey,
  recordId,
  token,
}: {
  api: Pick<OpcoApi, "getEntityRecord">;
  contractId: string;
  entityTypeId: string;
  ownerKey: string;
  recordId: string;
  token: string;
}) {
  const db = await getDatabase();
  const existing = await getCachedRecord({ contractId, entityTypeId, ownerKey, recordId });

  if (!existing || existing.syncStatus !== "conflict") {
    throw new Error("No se encontro un conflicto para resolver.");
  }

  if (!existing.serverId) {
    throw new Error("No se puede resolver con Opco sin server_id.");
  }

  const remote = await api.getEntityRecord(token, contractId, entityTypeId, existing.serverId);
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `
        DELETE FROM pending_operations
        WHERE owner_key = ? AND local_record_id = ? AND operation = 'UPDATE'
      `,
      ownerKey,
      existing.localId,
    );
    await db.runAsync(
      `
        UPDATE entity_records
        SET display_name = ?,
            values_json = ?,
            remote_updated_at = ?,
            cached_at = ?,
            sync_status = 'synced',
            sync_error_code = NULL,
            sync_error_message = NULL,
            conflict_remote_values_json = NULL,
            conflict_remote_display_name = NULL,
            conflict_remote_updated_at = NULL
        WHERE local_id = ?
      `,
      remote.record.displayName,
      JSON.stringify(remote.record.values),
      remote.record.updatedAt,
      now,
      existing.localId,
    );
  });

  const record = await getCachedRecord({ contractId, entityTypeId, ownerKey, recordId: existing.localId });

  if (!record) {
    throw new Error("No fue posible leer el registro resuelto.");
  }

  return record;
}

async function upsertPendingOperationInTransaction(
  db: SQLite.SQLiteDatabase,
  {
    clientRequestId,
    contractId,
    entityTypeId,
    localRecordId,
    operation,
    ownerKey,
    payload,
    serverRecordId,
    timestamp,
  }: {
    clientRequestId: string;
    contractId: string;
    entityTypeId: string;
    localRecordId: string;
    operation: PendingOperation["operation"];
    ownerKey: string;
    payload: { clientRequestId?: string; values: Record<string, EntityRecordValue> };
    serverRecordId: string | null;
    timestamp: string;
  },
) {
  const id = `${operation.toLocaleLowerCase("en-US")}_${localRecordId}`;

  await db.runAsync(
    `
      INSERT INTO pending_operations (
        id,
        client_request_id,
        operation,
        owner_key,
        contract_id,
        entity_type_id,
        local_record_id,
        server_record_id,
        payload_json,
        created_at,
        updated_at,
        attempts
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(id)
      DO UPDATE SET
        client_request_id = pending_operations.client_request_id,
        server_record_id = excluded.server_record_id,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at,
        last_error_code = NULL,
        last_error_message = NULL
    `,
    id,
    clientRequestId,
    operation,
    ownerKey,
    contractId,
    entityTypeId,
    localRecordId,
    serverRecordId,
    JSON.stringify(payload),
    timestamp,
    timestamp,
  );
}

async function upsertStateUpdatePendingOperation({
  clientRequestId,
  input,
  localRecordId,
  payload,
  serverRecordId,
  timestamp,
}: {
  clientRequestId: string;
  input: SaveStateUpdateLocallyInput;
  localRecordId: string;
  payload: OfflineStateUpdatePayload;
  serverRecordId: string | null;
  timestamp: string;
}) {
  const db = await getDatabase();
  const id = `state_update_${localRecordId}`;

  await db.runAsync(
    `
      INSERT INTO pending_operations (
        id,
        client_request_id,
        operation,
        owner_key,
        contract_id,
        entity_type_id,
        local_record_id,
        server_record_id,
        payload_json,
        created_at,
        updated_at,
        attempts
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(id)
      DO UPDATE SET
        client_request_id = excluded.client_request_id,
        server_record_id = COALESCE(excluded.server_record_id, pending_operations.server_record_id),
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at,
        last_error_code = NULL,
        last_error_message = NULL
    `,
    id,
    clientRequestId,
    STATE_UPDATE_OPERATION,
    input.ownerKey,
    input.contractId,
    input.targetEntityTypeId,
    localRecordId,
    serverRecordId,
    JSON.stringify(payload),
    timestamp,
    timestamp,
  );
}

async function findStateUpdateRecordForSubject(input: StateUpdateScope & { subjectRecordId: string }) {
  const db = await getDatabase();
  const row = await db.getFirstAsync<EntityRecordRow>(
    `
      SELECT *
      FROM entity_records
      WHERE owner_key = ?
        AND contract_id = ?
        AND entity_type_id = ?
        AND json_extract(values_json, '$.appViewId') = ?
        AND json_extract(values_json, '$.subjectRecordId') = ?
        AND (? IS NULL OR json_extract(values_json, '$.date') = ?)
      ORDER BY cached_at DESC
      LIMIT 1
    `,
    input.ownerKey,
    input.contractId,
    input.targetEntityTypeId,
    input.appViewId,
    input.subjectRecordId,
    input.date ?? null,
    input.date ?? null,
  );

  return row ? mapRecordRow(row) : null;
}

async function setOperationError(
  db: SQLite.SQLiteDatabase,
  operation: PendingOperation,
  code: string,
  message: string,
  syncStatus: RecordSyncStatus,
) {
  const now = new Date().toISOString();

  await db.runAsync(
    `
      UPDATE pending_operations
      SET updated_at = ?,
          last_error_code = ?,
          last_error_message = ?
      WHERE id = ?
    `,
    now,
    code,
    message,
    operation.id,
  );

  await db.runAsync(
    `
      UPDATE entity_records
      SET sync_status = ?,
          sync_error_code = ?,
          sync_error_message = ?
      WHERE local_id = ?
    `,
    syncStatus,
    code,
    message,
    operation.localRecordId,
  );
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
  sync_status: RecordSyncStatus;
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
  operation: PendingOperation["operation"];
  owner_key: string;
  payload_json: string;
  server_record_id: string | null;
  updated_at: string;
};

type StateUpdateOutboxDiagnosticsRow = PendingOperationRow & {
  definition_json: string | null;
  definition_status: AppViewDefinitionStatus | null;
  definition_workflow_key: string | null;
  record_cached_at: string | null;
  record_sync_error_code: string | null;
  record_sync_error_message: string | null;
  record_sync_status: RecordSyncStatus | null;
};

type StateUpdateLocalRecordDiagnosticsRow = EntityRecordRow & {
  definition_json: string | null;
  definition_status: AppViewDefinitionStatus | null;
  definition_workflow_key: string | null;
  pending_operation_id: string | null;
};

type AppViewDefinitionRow = {
  app_view_id: string;
  app_view_type: AppView["type"];
  contract_id: string;
  definition_json: string;
  last_prepared_at: string;
  owner_key: string;
  status: AppViewDefinitionStatus;
  workflow_key: string | null;
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
  last_sync_error_code: SyncErrorCode | null;
  last_sync_error_phase: SyncErrorPhase | null;
  owner_key: string;
  sync_phase: SyncPhase;
};

function mapAppViewDefinitionRow(row: AppViewDefinitionRow): CachedAppViewDefinition {
  return {
    appViewId: row.app_view_id,
    appViewType: row.app_view_type,
    contractId: row.contract_id,
    definition: JSON.parse(row.definition_json) as PreparedAppViewDefinition,
    lastPreparedAt: row.last_prepared_at,
    ownerKey: row.owner_key,
    status: row.status,
    workflowKey: row.workflow_key,
  };
}

function mapRecordRow(row: EntityRecordRow): CachedEntityRecord {
  return {
    conflictRemoteDisplayName: row.conflict_remote_display_name,
    conflictRemoteUpdatedAt: row.conflict_remote_updated_at,
    conflictRemoteValues: row.conflict_remote_values_json
      ? JSON.parse(row.conflict_remote_values_json) as Record<string, EntityRecordValue>
      : null,
    displayName: row.display_name,
    id: row.server_id ?? row.local_id,
    localId: row.local_id,
    remoteUpdatedAt: row.remote_updated_at,
    serverId: row.server_id,
    syncErrorCode: row.sync_error_code,
    syncErrorMessage: row.sync_error_message,
    syncStatus: row.sync_status,
    updatedAt: row.remote_updated_at ?? row.cached_at,
    values: JSON.parse(row.values_json) as Record<string, EntityRecordValue>,
  };
}

function mapSyncTelemetryRow(row: SyncTelemetryRow): SyncTelemetry {
  return {
    contractId: row.contract_id,
    entityTypeId: row.entity_type_id,
    lastFullRefreshCompletedAt: row.last_full_refresh_completed_at,
    lastPushCompletedAt: row.last_push_completed_at,
    lastReconcileCompletedAt: row.last_reconcile_completed_at,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    lastSyncAttemptAt: row.last_sync_attempt_at,
    lastSyncErrorAt: row.last_sync_error_at,
    lastSyncErrorCode: row.last_sync_error_code,
    lastSyncErrorPhase: row.last_sync_error_phase,
    ownerKey: row.owner_key,
    syncPhase: row.sync_phase,
  };
}

function mapPendingOperationRow(row: PendingOperationRow): PendingOperation {
  return {
    attempts: row.attempts,
    clientRequestId: row.client_request_id,
    contractId: row.contract_id,
    createdAt: row.created_at,
    entityTypeId: row.entity_type_id,
    id: row.id,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    localRecordId: row.local_record_id,
    operation: row.operation,
    ownerKey: row.owner_key,
    payload: JSON.parse(row.payload_json) as PendingOperation["payload"],
    serverRecordId: row.server_record_id,
    updatedAt: row.updated_at,
  };
}

function parsePendingStateUpdatePayload(value: string): OfflineStateUpdatePayload | null {
  try {
    return JSON.parse(value) as OfflineStateUpdatePayload;
  } catch {
    return null;
  }
}

function mapStateUpdateOutboxDiagnosticsRow(row: StateUpdateOutboxDiagnosticsRow): StateUpdateOutboxDiagnostics["operations"][number] {
  const payload = parseJsonObject(row.payload_json);
  const definition = row.definition_json ? parseJsonObject(row.definition_json) as PreparedAppViewDefinition | null : null;
  const payloadStateValues = getDiagnosticStateValues(payload);
  const definitionStateFields = getDiagnosticStateFields(definition);
  const selectedStateValues = payloadStateValues.filter((value) => typeof value.fieldId === "string");
  const matchingStateValues = selectedStateValues.filter((value) => {
    const field = definitionStateFields.find((item) => item.fieldId === value.fieldId);

    return field?.options.some((option) => option.optionId === value.optionId) ?? false;
  });
  const statusOptionResolved = selectedStateValues.length === 0
    ? "no-state-values"
    : matchingStateValues.length === selectedStateValues.length;
  const syncStatus = row.record_sync_status ?? "missing-record";

  return {
    appViewFingerprint: fingerprintDiagnosticValue(getDiagnosticAppViewId(payload)),
    appViewResolved: Boolean(definition),
    clientRequestId: abbreviateDiagnosticValue(row.client_request_id),
    config: {
      definitionKind: getDiagnosticDefinitionKind(definition),
      extraFieldsCount: getDiagnosticExtraFieldsCount(definition),
      matchingStateValuesCount: matchingStateValues.length,
      missingStateValuesCount: Math.max(0, selectedStateValues.length - matchingStateValues.length),
      sourceTargetConfigured: hasDiagnosticSourceTargetConfig(definition),
      stateFieldsCount: definitionStateFields.length,
      statusOptionResolved,
      workflowKey: row.definition_workflow_key ?? getDiagnosticWorkflowKey(definition),
    },
    contractFingerprint: fingerprintDiagnosticValue(row.contract_id),
    date: getDiagnosticDate(payload),
    extraValuesCount: countObjectKeys(getDiagnosticExtraValues(payload)),
    lastBackendErrorCode: getDiagnosticBackendErrorCode(row.last_error_code),
    lastErrorCode: row.last_error_code ?? row.record_sync_error_code,
    lastErrorPhase: row.last_error_code || row.record_sync_error_code ? "pushing" : null,
    lastHttpStatus: null,
    operationType: row.operation,
    payloadSchema: getDiagnosticPayloadSchema(payload),
    manualRetryToken: syncStatus === "failed" && row.operation === STATE_UPDATE_OPERATION ? stateUpdateManualRetryToken(row.id) : null,
    manualRetryable: syncStatus === "failed" && row.operation === STATE_UPDATE_OPERATION,
    retryable: row.operation === STATE_UPDATE_OPERATION && isStateUpdateAutoSyncStatus(syncStatus),
    retryCount: row.attempts,
    stateValuesCount: selectedStateValues.length,
    subjectFingerprint: fingerprintDiagnosticValue(getDiagnosticSubjectRecordId(payload)),
    syncStatus,
    updatedAt: row.updated_at ?? row.record_cached_at ?? "unknown",
  };
}

function mapStateUpdateLocalRecordDiagnosticsRow(row: StateUpdateLocalRecordDiagnosticsRow): StateUpdateLocalRecordDiagnostics {
  const values = parseJsonObject(row.values_json);
  const definition = row.definition_json ? parseJsonObject(row.definition_json) as PreparedAppViewDefinition | null : null;
  const stateValues = getDiagnosticStateValues(values);
  const remoteRecordExists = Boolean(row.server_id || row.remote_updated_at);

  return {
    appViewFingerprint: fingerprintDiagnosticValue(getDiagnosticAppViewId(values)),
    appViewResolved: Boolean(definition),
    contractFingerprint: fingerprintDiagnosticValue(row.contract_id),
    date: getDiagnosticDate(values),
    hasPendingOperation: Boolean(row.pending_operation_id),
    lastErrorCode: row.sync_error_code,
    localRecordFingerprint: fingerprintDiagnosticValue(row.local_id),
    remoteRecordExists,
    recoveryState: getStateUpdateLocalRecordRecoveryState({
      hasPendingOperation: Boolean(row.pending_operation_id),
      remoteRecordExists,
      syncStatus: row.sync_status,
    }),
    stateValuesCount: stateValues.length,
    subjectFingerprint: fingerprintDiagnosticValue(getDiagnosticSubjectRecordId(values)),
    syncStatus: row.sync_status,
    updatedAt: row.cached_at,
    workflowKey: row.definition_workflow_key ?? getDiagnosticWorkflowKey(definition),
  };
}

function getStateUpdateLocalRecordRecoveryState({
  hasPendingOperation,
  remoteRecordExists,
  syncStatus,
}: {
  hasPendingOperation: boolean;
  remoteRecordExists: boolean;
  syncStatus: string;
}): StateUpdateLocalRecordDiagnostics["recoveryState"] {
  if (syncStatus !== "pending_create" && syncStatus !== "pending_update" && syncStatus !== "syncing") {
    return "OK";
  }

  if (hasPendingOperation) {
    return "PENDING_WITH_OUTBOX";
  }

  return remoteRecordExists ? "REMOTE_SNAPSHOT_REPAIRABLE" : "ORPHANED_LOCAL_CHANGE";
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function getDiagnosticPayloadSchema(payload: Record<string, unknown> | null): StateUpdateOutboxDiagnostics["operations"][number]["payloadSchema"] {
  if (!payload) {
    return "unknown";
  }

  if (typeof payload.appViewId === "string" && typeof payload.subjectRecordId === "string" && Array.isArray(payload.stateValues)) {
    return "current";
  }

  if (Array.isArray(payload.entries)) {
    return "legacy-batch";
  }

  if (typeof payload.subjectRecordId === "string" && payload.states && typeof payload.states === "object" && !Array.isArray(payload.states)) {
    return "legacy-wire-states";
  }

  return "unknown";
}

function getDiagnosticAppViewId(payload: Record<string, unknown> | null) {
  return typeof payload?.appViewId === "string" ? payload.appViewId : null;
}

function getDiagnosticSubjectRecordId(payload: Record<string, unknown> | null) {
  if (typeof payload?.subjectRecordId === "string") {
    return payload.subjectRecordId;
  }

  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  const firstEntry = entries[0];

  if (firstEntry && typeof firstEntry === "object" && "subjectRecordId" in firstEntry && typeof firstEntry.subjectRecordId === "string") {
    return firstEntry.subjectRecordId;
  }

  if (firstEntry && typeof firstEntry === "object" && "personRecordId" in firstEntry && typeof firstEntry.personRecordId === "string") {
    return firstEntry.personRecordId;
  }

  return null;
}

function getDiagnosticDate(payload: Record<string, unknown> | null) {
  return typeof payload?.date === "string" ? payload.date : null;
}

function getDiagnosticExtraValues(payload: Record<string, unknown> | null) {
  if (payload?.extraValues && typeof payload.extraValues === "object" && !Array.isArray(payload.extraValues)) {
    return payload.extraValues as Record<string, unknown>;
  }

  return null;
}

function getDiagnosticStateValues(payload: Record<string, unknown> | null): { fieldId: string | null; optionId: string | null }[] {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload.stateValues)) {
    return payload.stateValues
      .filter((value) => value && typeof value === "object")
      .map((value) => {
        const record = value as Record<string, unknown>;

        return {
          fieldId: typeof record.fieldId === "string" ? record.fieldId : null,
          optionId: typeof record.optionId === "string" ? record.optionId : null,
        };
      });
  }

  if (payload.states && typeof payload.states === "object" && !Array.isArray(payload.states)) {
    return Object.entries(payload.states).map(([fieldId, optionId]) => ({
      fieldId,
      optionId: typeof optionId === "string" ? optionId : null,
    }));
  }

  return [];
}

function getDiagnosticStateFields(definition: PreparedAppViewDefinition | null) {
  if (definition?.kind !== "state-update") {
    return [];
  }

  return definition.stateFields;
}

function getDiagnosticDefinitionKind(definition: PreparedAppViewDefinition | null) {
  return definition?.kind ?? "missing";
}

function getDiagnosticWorkflowKey(definition: PreparedAppViewDefinition | null) {
  if (!definition || definition.appView.type !== "WORKFLOW") {
    return null;
  }

  return String(definition.appView.config.workflowKey ?? "") || null;
}

function getDiagnosticExtraFieldsCount(definition: PreparedAppViewDefinition | null) {
  return definition?.kind === "state-update" ? definition.extraFields.length : 0;
}

function hasDiagnosticSourceTargetConfig(definition: PreparedAppViewDefinition | null) {
  if (definition?.kind !== "state-update") {
    return false;
  }

  return Boolean(definition.sourceEntityTypeId && definition.targetEntityTypeId);
}

function countObjectKeys(value: Record<string, unknown> | null) {
  return value ? Object.keys(value).length : 0;
}

function getDiagnosticBackendErrorCode(code: string | null) {
  if (!code || code === "OpcoNetworkError" || code === "NETWORK") {
    return null;
  }

  return code;
}

function isStateUpdateAutoSyncStatus(syncStatus: string) {
  return syncStatus === "pending_create" || syncStatus === "pending_update" || syncStatus === "syncing";
}

function stateUpdateManualRetryToken(value: string) {
  return fingerprintDiagnosticValue(`retry:${value}`);
}

function abbreviateDiagnosticValue(value: string | null) {
  if (!value) {
    return "missing";
  }

  if (value.length <= 12) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function fingerprintDiagnosticValue(value: string | null) {
  if (!value) {
    return "missing";
  }

  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fp_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function ensureSyncTelemetryRow(
  db: SQLite.SQLiteDatabase,
  ownerKey: string,
  contractId: string,
  entityTypeId: string,
  timestamp: string,
) {
  const empty = emptySyncTelemetry({ contractId, entityTypeId, ownerKey });

  await db.runAsync(
    `
      INSERT OR IGNORE INTO sync_telemetry (
        owner_key,
        contract_id,
        entity_type_id,
        sync_phase,
        last_sync_attempt_at,
        last_push_completed_at,
        last_full_refresh_completed_at,
        last_reconcile_completed_at,
        last_successful_sync_at,
        last_sync_error_at,
        last_sync_error_code,
        last_sync_error_phase,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    empty.ownerKey,
    empty.contractId,
    empty.entityTypeId,
    empty.syncPhase,
    empty.lastSyncAttemptAt,
    empty.lastPushCompletedAt,
    empty.lastFullRefreshCompletedAt,
    empty.lastReconcileCompletedAt,
    empty.lastSuccessfulSyncAt,
    empty.lastSyncErrorAt,
    empty.lastSyncErrorCode,
    empty.lastSyncErrorPhase,
    timestamp,
  );
}

function getSyncCompletedColumn(phase: SyncErrorPhase) {
  switch (phase) {
    case "pushing":
      return "last_push_completed_at";
    case "refreshing":
      return "last_full_refresh_completed_at";
    case "reconciling":
      return "last_reconcile_completed_at";
  }
}

async function markRecordConflict(
  db: SQLite.SQLiteDatabase,
  {
    localRecordId,
    remoteRecord,
    syncErrorCode,
    syncErrorMessage,
  }: {
    localRecordId: string;
    remoteRecord: EntityRecord;
    syncErrorCode: string;
    syncErrorMessage: string;
  },
) {
  await db.runAsync(
    `
      UPDATE entity_records
      SET sync_status = 'conflict',
          sync_error_code = ?,
          sync_error_message = ?,
          conflict_remote_values_json = ?,
          conflict_remote_display_name = ?,
          conflict_remote_updated_at = ?
      WHERE local_id = ?
    `,
    syncErrorCode,
    syncErrorMessage,
    JSON.stringify(remoteRecord.values),
    remoteRecord.displayName,
    remoteRecord.updatedAt,
    localRecordId,
  );
}

function hasRemoteVersionChanged(localRemoteUpdatedAt: string | null, nextRemoteUpdatedAt: string) {
  return !localRemoteUpdatedAt || localRemoteUpdatedAt !== nextRemoteUpdatedAt;
}

async function upsertEntityDefinition(
  contractId: string,
  entityTypeId: string,
  definition: EntityDefinition,
  syncedAt: string,
) {
  const db = await getDatabase();

  await db.runAsync(
    `
      INSERT INTO entity_definitions (entity_type_id, contract_id, definition_json, synced_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(entity_type_id, contract_id)
      DO UPDATE SET definition_json = excluded.definition_json, synced_at = excluded.synced_at
    `,
    entityTypeId,
    contractId,
    JSON.stringify(definition),
    syncedAt,
  );
}

async function getEntityDefinition(
  contractId: string,
  entityTypeId: string,
): Promise<CachedEntityDefinition | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ definition_json: string; synced_at: string }>(
    `
      SELECT definition_json, synced_at
      FROM entity_definitions
      WHERE entity_type_id = ? AND contract_id = ?
      LIMIT 1
    `,
    entityTypeId,
    contractId,
  );

  if (!row) {
    return null;
  }

  return {
    definition: JSON.parse(row.definition_json) as EntityDefinition,
    syncedAt: row.synced_at,
  };
}

async function getSelectedContractId(ownerKey?: string | null) {
  const db = await getDatabase();
  const keys = ownerKey
    ? [`${SELECTED_CONTRACT_ID_KEY}:${ownerKey}`]
    : [SELECTED_CONTRACT_ID_KEY];

  for (const key of keys) {
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_metadata WHERE key = ? LIMIT 1`,
      key,
    );

    if (row?.value) {
      return row.value;
    }
  }

  return null;
}

async function getStateUpdateSyncDiagnosticsTelemetry(ownerKey: string): Promise<StateUpdateSyncDiagnosticsTelemetry | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_metadata WHERE key = ? LIMIT 1`,
    stateUpdateSyncDiagnosticsKey(ownerKey),
  );

  if (!row?.value) {
    return null;
  }

  return parseStateUpdateSyncDiagnosticsTelemetry(row.value);
}

async function getOfflinePreparationDiagnostics(ownerKey: string): Promise<OfflinePreparationDiagnostics | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_metadata WHERE key = ? LIMIT 1`,
    offlinePreparationDiagnosticsKey(ownerKey),
  );

  if (!row?.value) {
    return null;
  }

  return parseOfflinePreparationDiagnostics(row.value);
}

async function setOfflinePreparationDiagnostics(ownerKey: string, diagnostics: OfflinePreparationDiagnostics) {
  const db = await getDatabase();

  await db.runAsync(
    `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)`,
    offlinePreparationDiagnosticsKey(ownerKey),
    JSON.stringify(diagnostics),
  );
}

async function setStateUpdateSyncDiagnosticsTelemetry(ownerKey: string, telemetry: StateUpdateSyncDiagnosticsTelemetry) {
  const db = await getDatabase();

  await db.runAsync(
    `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)`,
    stateUpdateSyncDiagnosticsKey(ownerKey),
    JSON.stringify(telemetry),
  );
}

async function recordStateUpdateVisibleErrorEvent(ownerKey: string, event: StateUpdateVisibleErrorTelemetry) {
  const current = await getStateUpdateSyncDiagnosticsTelemetry(ownerKey);

  await setStateUpdateSyncDiagnosticsTelemetry(ownerKey, {
    currentConnectivity: current?.currentConnectivity ?? {
      status: "unknown",
      updatedAt: event.occurredAt,
    },
    lastReconnect: current?.lastReconnect ?? {
      detected: false,
      detectedAt: null,
      previousConnectivityStatus: null,
      resultingConnectivityStatus: null,
    },
    lastReconnectPreflight: current?.lastReconnectPreflight ?? null,
    lastStateUpdateActivity: current?.lastStateUpdateActivity ?? null,
    lastStateUpdateSync: current?.lastStateUpdateSync ?? null,
    lastSessionTermination: current?.lastSessionTermination ?? null,
    lastVisibleErrorEvent: event,
    reconnectRunHistory: current?.reconnectRunHistory ?? [],
    requestHistory: current?.requestHistory ?? [],
  });
}

async function recordStateUpdateSessionTermination(ownerKey: string, event: StateUpdateSessionTerminationTelemetry) {
  const current = await getStateUpdateSyncDiagnosticsTelemetry(ownerKey);

  await setStateUpdateSyncDiagnosticsTelemetry(ownerKey, {
    currentConnectivity: current?.currentConnectivity ?? {
      status: "unknown",
      updatedAt: event.timestamp,
    },
    lastReconnect: current?.lastReconnect ?? {
      detected: false,
      detectedAt: null,
      previousConnectivityStatus: null,
      resultingConnectivityStatus: null,
    },
    lastReconnectPreflight: current?.lastReconnectPreflight ?? null,
    lastStateUpdateActivity: current?.lastStateUpdateActivity ?? null,
    lastStateUpdateSync: current?.lastStateUpdateSync ?? null,
    lastSessionTermination: event,
    lastVisibleErrorEvent: current?.lastVisibleErrorEvent ?? null,
    reconnectRunHistory: current?.reconnectRunHistory ?? [],
    requestHistory: current?.requestHistory ?? [],
  });
}

async function resolveStateUpdateVisibleErrorEvent(ownerKey: string, resolution: StateUpdateVisibleErrorResolution) {
  const current = await getStateUpdateSyncDiagnosticsTelemetry(ownerKey);
  const lastVisibleErrorEvent = current?.lastVisibleErrorEvent;

  if (!current || !lastVisibleErrorEvent || lastVisibleErrorEvent.clearedAt) {
    return;
  }

  await setStateUpdateSyncDiagnosticsTelemetry(ownerKey, {
    ...current,
    lastVisibleErrorEvent: {
      ...lastVisibleErrorEvent,
      clearedAt: new Date().toISOString(),
      resolution,
    },
    requestHistory: current.requestHistory ?? [],
  });
}

async function setSelectedContractId(contractId: string | null, ownerKey?: string | null) {
  const db = await getDatabase();
  const key = ownerKey ? `${SELECTED_CONTRACT_ID_KEY}:${ownerKey}` : SELECTED_CONTRACT_ID_KEY;

  if (!contractId) {
    await db.runAsync(`DELETE FROM app_metadata WHERE key = ?`, key);

    if (!ownerKey) {
      await db.runAsync(`DELETE FROM app_metadata WHERE key LIKE ?`, `${SELECTED_CONTRACT_ID_KEY}:%`);
    }

    return;
  }

  await db.runAsync(
    `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)`,
    key,
    contractId,
  );
}

async function getAttendanceContextSelection(
  ownerKey: string,
  contractId: string,
  appViewId: string,
  fieldId: string,
) {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_metadata WHERE key = ? LIMIT 1`,
    attendanceContextSelectionKey(ownerKey, contractId, appViewId, fieldId),
  );

  return row?.value ?? null;
}

async function setAttendanceContextSelection(
  ownerKey: string,
  contractId: string,
  appViewId: string,
  fieldId: string,
  optionId: string | null,
) {
  const db = await getDatabase();
  const key = attendanceContextSelectionKey(ownerKey, contractId, appViewId, fieldId);

  if (!optionId) {
    await db.runAsync(`DELETE FROM app_metadata WHERE key = ?`, key);
    return;
  }

  await db.runAsync(
    `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)`,
    key,
    optionId,
  );
}

function stateUpdateSyncDiagnosticsKey(ownerKey: string) {
  return `${STATE_UPDATE_SYNC_DIAGNOSTICS_KEY}:${fingerprintDiagnosticValue(ownerKey)}`;
}

function attendanceContextSelectionKey(ownerKey: string, contractId: string, appViewId: string, fieldId: string) {
  return [
    ATTENDANCE_CONTEXT_SELECTION_KEY,
    fingerprintDiagnosticValue(ownerKey),
    contractId,
    appViewId,
    fieldId,
  ].join(":");
}

function offlinePreparationDiagnosticsKey(ownerKey: string) {
  return `${OFFLINE_PREPARATION_DIAGNOSTICS_KEY}:${fingerprintDiagnosticValue(ownerKey)}`;
}

function parseStateUpdateSyncDiagnosticsTelemetry(value: string): StateUpdateSyncDiagnosticsTelemetry | null {
  try {
    const parsed = JSON.parse(value) as Partial<StateUpdateSyncDiagnosticsTelemetry>;

    if (!parsed.currentConnectivity || !parsed.lastReconnect) {
      return null;
    }

    const detectedAt = typeof parsed.lastReconnect.detectedAt === "string" ? parsed.lastReconnect.detectedAt : null;
    const previousConnectivityStatus = normalizeNullableConnectivityStatus(parsed.lastReconnect.previousConnectivityStatus);
    const resultingConnectivityStatus = normalizeNullableConnectivityStatus(parsed.lastReconnect.resultingConnectivityStatus);

    return {
      currentConnectivity: {
        status: normalizeConnectivityStatus(parsed.currentConnectivity.status),
        updatedAt: typeof parsed.currentConnectivity.updatedAt === "string" ? parsed.currentConnectivity.updatedAt : null,
      },
      lastReconnect: {
        detected: Boolean(detectedAt && previousConnectivityStatus && resultingConnectivityStatus),
        detectedAt,
        previousConnectivityStatus,
        resultingConnectivityStatus,
      },
      lastReconnectPreflight: normalizeStateUpdateReconnectPreflightTelemetry(parsed.lastReconnectPreflight),
      lastStateUpdateActivity: normalizeLastStateUpdateActivityTelemetry(parsed.lastStateUpdateActivity),
      lastStateUpdateSync: normalizeLastStateUpdateSyncTelemetry(parsed.lastStateUpdateSync),
      lastSessionTermination: normalizeStateUpdateSessionTerminationTelemetry(parsed.lastSessionTermination),
      lastVisibleErrorEvent: normalizeLastVisibleErrorEventTelemetry(parsed.lastVisibleErrorEvent),
      reconnectRunHistory: normalizeStateUpdateReconnectRunHistory(parsed.reconnectRunHistory),
      requestHistory: normalizeStateUpdateRequestHistory(parsed.requestHistory),
    };
  } catch {
    return null;
  }
}

async function markStateUpdateSyncDiagnosticsReconciledFromSnapshot({
  completedAt,
  ownerKey,
}: {
  completedAt: string;
  ownerKey: string;
}) {
  const current = await getStateUpdateSyncDiagnosticsTelemetry(ownerKey);
  const previousRun = current?.lastStateUpdateSync;

  await setStateUpdateSyncDiagnosticsTelemetry(ownerKey, {
    currentConnectivity: current?.currentConnectivity ?? {
      status: "unknown",
      updatedAt: completedAt,
    },
    lastReconnect: current?.lastReconnect ?? {
      detected: false,
      detectedAt: null,
      previousConnectivityStatus: null,
      resultingConnectivityStatus: null,
    },
    lastReconnectPreflight: current?.lastReconnectPreflight ?? null,
    lastStateUpdateActivity: {
      completedAt,
      lastRequestDiagnostics: previousRun?.lastRequestDiagnostics ?? null,
      operationsCompleted: Math.max(previousRun?.operationsCompleted ?? 0, 1),
      operationsFailed: 0,
      result: "reconciled_success",
      startedAt: previousRun?.startedAt ?? completedAt,
      syncRunId: previousRun?.syncRunId ?? null,
      timeoutOccurred: previousRun?.timeoutOccurred ?? (previousRun?.reconciledAfterTimeout === true),
      trigger: "snapshot_reconciliation",
      type: "snapshot_reconciliation",
    },
    lastStateUpdateSync: previousRun ?? null,
    lastSessionTermination: current?.lastSessionTermination ?? null,
    lastVisibleErrorEvent: current?.lastVisibleErrorEvent ?? null,
    reconnectRunHistory: current?.reconnectRunHistory ?? [],
    requestHistory: current?.requestHistory ?? [],
  });
}

function normalizeLastStateUpdateSyncTelemetry(
  telemetry: Partial<StateUpdateSyncDiagnosticsTelemetry["lastStateUpdateSync"]> | null | undefined,
): StateUpdateSyncDiagnosticsTelemetry["lastStateUpdateSync"] {
  if (!telemetry || typeof telemetry.startedAt !== "string") {
    return null;
  }

  return {
    completedAt: typeof telemetry.completedAt === "string" ? telemetry.completedAt : null,
    lastRequestDiagnostics: normalizeStateUpdateRequestDiagnostics(telemetry.lastRequestDiagnostics),
    operationsAttempted: normalizeDiagnosticCount(telemetry.operationsAttempted),
    operationsCompleted: normalizeDiagnosticCount(telemetry.operationsCompleted),
    operationsFailed: normalizeDiagnosticCount(telemetry.operationsFailed),
    operationsSelected: normalizeDiagnosticCount(telemetry.operationsSelected),
    reconciledAfterTimeout: telemetry.reconciledAfterTimeout === true,
    result: normalizeStateUpdateSyncTelemetryResult(telemetry.result),
    startedAt: telemetry.startedAt,
    syncRunId: typeof telemetry.syncRunId === "string" ? telemetry.syncRunId : null,
    timeoutOccurred: telemetry.timeoutOccurred === true || telemetry.reconciledAfterTimeout === true,
    trigger: normalizeStateUpdateSyncTrigger(telemetry.trigger),
  };
}

function normalizeLastStateUpdateActivityTelemetry(
  telemetry: Partial<StateUpdateSyncDiagnosticsTelemetry["lastStateUpdateActivity"]> | null | undefined,
): StateUpdateSyncDiagnosticsTelemetry["lastStateUpdateActivity"] {
  if (!telemetry || typeof telemetry.startedAt !== "string") {
    return null;
  }

  const type = telemetry.type === "auth_refresh" ||
    telemetry.type === "ready_check" ||
    telemetry.type === "reconnect" ||
    telemetry.type === "snapshot_reconciliation" ||
    telemetry.type === "sync"
    ? telemetry.type
    : null;

  if (!type) {
    return null;
  }

  return {
    completedAt: typeof telemetry.completedAt === "string" ? telemetry.completedAt : null,
    lastRequestDiagnostics: normalizeStateUpdateRequestDiagnostics(telemetry.lastRequestDiagnostics),
    operationsCompleted: normalizeDiagnosticCount(telemetry.operationsCompleted),
    operationsFailed: normalizeDiagnosticCount(telemetry.operationsFailed),
    result: normalizeStateUpdateSyncTelemetryResult(telemetry.result),
    startedAt: telemetry.startedAt,
    syncRunId: typeof telemetry.syncRunId === "string" ? telemetry.syncRunId : null,
    timeoutOccurred: telemetry.timeoutOccurred === true,
    trigger: telemetry.trigger === "auth_refresh" ||
      telemetry.trigger === "snapshot_reconciliation" ||
      telemetry.trigger === "ready_check" ||
      telemetry.trigger === "reconnect"
      ? telemetry.trigger
      : normalizeStateUpdateSyncTrigger(telemetry.trigger),
    type,
  };
}

function normalizeStateUpdateReconnectPreflightTelemetry(
  telemetry: Partial<StateUpdateSyncDiagnosticsTelemetry["lastReconnectPreflight"]> | null | undefined,
): StateUpdateSyncDiagnosticsTelemetry["lastReconnectPreflight"] {
  if (!telemetry || typeof telemetry !== "object") {
    return null;
  }

  const trigger = normalizeStateUpdateSyncTrigger(telemetry.trigger);

  return {
    authDecision: telemetry.authDecision === "refresh_required" || telemetry.authDecision === "token_valid" ? telemetry.authDecision : null,
    authRefreshCompletedAt: normalizeDiagnosticTimestamp(telemetry.authRefreshCompletedAt),
    authRefreshStartedAt: normalizeDiagnosticTimestamp(telemetry.authRefreshStartedAt),
    completedAt: normalizeDiagnosticTimestamp(telemetry.completedAt),
    countPendingOperationsCount: normalizeNullableDiagnosticCount(telemetry.countPendingOperationsCount),
    countPendingOperationsDurationMs: normalizeNullableDiagnosticDuration(telemetry.countPendingOperationsDurationMs),
    debounceCompletedAt: normalizeDiagnosticTimestamp(telemetry.debounceCompletedAt),
    debounceDurationMs: normalizeNullableDiagnosticDuration(telemetry.debounceDurationMs),
    debounceStartedAt: normalizeDiagnosticTimestamp(telemetry.debounceStartedAt),
    listPendingStateUpdateOperationsCount: normalizeNullableDiagnosticCount(telemetry.listPendingStateUpdateOperationsCount),
    listPendingStateUpdateOperationsDurationMs: normalizeNullableDiagnosticDuration(telemetry.listPendingStateUpdateOperationsDurationMs),
    readinessAttempts: normalizeNullableDiagnosticCount(telemetry.readinessAttempts),
    readinessCompletedAt: normalizeDiagnosticTimestamp(telemetry.readinessCompletedAt),
    readinessConfirmedAt: normalizeDiagnosticTimestamp(telemetry.readinessConfirmedAt),
    readinessDurationMs: normalizeNullableDiagnosticDuration(telemetry.readinessDurationMs),
    readinessStartedAt: normalizeDiagnosticTimestamp(telemetry.readinessStartedAt),
    reconnectDetectedAt: normalizeDiagnosticTimestamp(telemetry.reconnectDetectedAt),
    runSyncStartedAt: normalizeDiagnosticTimestamp(telemetry.runSyncStartedAt),
    scopeCheckAfterReadiness: telemetry.scopeCheckAfterReadiness === "contract_changed" ||
      telemetry.scopeCheckAfterReadiness === "current" ||
      telemetry.scopeCheckAfterReadiness === "owner_changed" ||
      telemetry.scopeCheckAfterReadiness === "token_changed"
      ? telemetry.scopeCheckAfterReadiness
      : null,
    recordsOperationsCompleted: normalizeNullableDiagnosticCount(telemetry.recordsOperationsCompleted),
    recordsOperationsFailed: normalizeNullableDiagnosticCount(telemetry.recordsOperationsFailed),
    recordsPhaseCompletedAt: normalizeDiagnosticTimestamp(telemetry.recordsPhaseCompletedAt),
    recordsPhaseFailedAt: normalizeDiagnosticTimestamp(telemetry.recordsPhaseFailedAt),
    recordsPhaseResult: telemetry.recordsPhaseResult === "completed" || telemetry.recordsPhaseResult === "failed"
      ? telemetry.recordsPhaseResult
      : null,
    recordsPhaseStartedAt: normalizeDiagnosticTimestamp(telemetry.recordsPhaseStartedAt),
    stateUpdateOperationsSelected: normalizeNullableDiagnosticCount(telemetry.stateUpdateOperationsSelected),
    stateUpdatePhaseCompletedAt: normalizeDiagnosticTimestamp(telemetry.stateUpdatePhaseCompletedAt),
    stateUpdatePhaseFailedAt: normalizeDiagnosticTimestamp(telemetry.stateUpdatePhaseFailedAt),
    stateUpdatePhaseResult: telemetry.stateUpdatePhaseResult === "completed" || telemetry.stateUpdatePhaseResult === "failed"
      ? telemetry.stateUpdatePhaseResult
      : null,
    stateUpdatePhaseStartedAt: normalizeDiagnosticTimestamp(telemetry.stateUpdatePhaseStartedAt),
    shouldSyncCompletedAt: normalizeDiagnosticTimestamp(telemetry.shouldSyncCompletedAt),
    shouldSyncDurationMs: normalizeNullableDiagnosticDuration(telemetry.shouldSyncDurationMs),
    shouldSyncResult: typeof telemetry.shouldSyncResult === "boolean" ? telemetry.shouldSyncResult : null,
    shouldSyncStartedAt: normalizeDiagnosticTimestamp(telemetry.shouldSyncStartedAt),
    syncPendingWorkCompletedAt: normalizeDiagnosticTimestamp(telemetry.syncPendingWorkCompletedAt),
    syncPendingWorkStartedAt: normalizeDiagnosticTimestamp(telemetry.syncPendingWorkStartedAt),
    syncRunId: normalizeDiagnosticToken(telemetry.syncRunId),
    trigger,
  };
}

function normalizeStateUpdateReconnectRunHistory(
  telemetry: Partial<StateUpdateSyncDiagnosticsTelemetry>["reconnectRunHistory"],
): StateUpdateSyncDiagnosticsTelemetry["reconnectRunHistory"] {
  if (!Array.isArray(telemetry)) {
    return [];
  }

  return telemetry
    .map((entry) => normalizeStateUpdateReconnectPreflightTelemetry(entry))
    .filter((entry): entry is NonNullable<StateUpdateSyncDiagnosticsTelemetry["lastReconnectPreflight"]> => Boolean(entry?.syncRunId))
    .slice(-STATE_UPDATE_RECONNECT_RUN_HISTORY_LIMIT);
}

function normalizeLastVisibleErrorEventTelemetry(
  telemetry: Partial<StateUpdateSyncDiagnosticsTelemetry["lastVisibleErrorEvent"]> | null | undefined,
): StateUpdateSyncDiagnosticsTelemetry["lastVisibleErrorEvent"] {
  if (!telemetry || typeof telemetry.occurredAt !== "string" || typeof telemetry.operation !== "string") {
    return null;
  }

  return {
    clearedAt: typeof telemetry.clearedAt === "string" ? telemetry.clearedAt : null,
    durationMs: typeof telemetry.durationMs === "number" ? telemetry.durationMs : null,
    errorCode: typeof telemetry.errorCode === "string" ? telemetry.errorCode : "UNKNOWN_ERROR",
    httpStatus: typeof telemetry.httpStatus === "number" ? telemetry.httpStatus : null,
    method: typeof telemetry.method === "string" ? telemetry.method : null,
    occurredAt: telemetry.occurredAt,
    operation: telemetry.operation,
    pathTemplate: typeof telemetry.pathTemplate === "string" ? telemetry.pathTemplate : null,
    resolution: normalizeStateUpdateVisibleErrorResolution(telemetry.resolution),
    syncRunId: typeof telemetry.syncRunId === "string" ? telemetry.syncRunId : null,
    timeoutOccurred: telemetry.timeoutOccurred === true,
  };
}

function normalizeStateUpdateSessionTerminationTelemetry(
  telemetry: Partial<StateUpdateSyncDiagnosticsTelemetry["lastSessionTermination"]> | null | undefined,
): StateUpdateSyncDiagnosticsTelemetry["lastSessionTermination"] {
  if (!telemetry || typeof telemetry.timestamp !== "string" || typeof telemetry.errorCode !== "string") {
    return null;
  }

  const reason = telemetry.reason === "refresh_invalid" ||
    telemetry.reason === "token_invalid" ||
    telemetry.reason === "user_sign_out"
    ? telemetry.reason
    : null;
  const source = telemetry.source === "AUTH_REFRESH" ||
    telemetry.source === "AUTHENTICATED_REQUEST" ||
    telemetry.source === "USER"
    ? telemetry.source
    : null;

  if (!reason || !source) {
    return null;
  }

  return {
    errorCode: telemetry.errorCode,
    reason,
    requestId: normalizeDiagnosticToken(telemetry.requestId),
    source,
    timestamp: telemetry.timestamp,
  };
}

function normalizeStateUpdateRequestDiagnostics(value: unknown): StateUpdateRequestDiagnostics | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const diagnostics = value as Record<string, unknown>;
  const requestStartedAt = diagnostics.requestStartedAt;
  const requestCompletedAt = diagnostics.requestCompletedAt;
  const requestDurationMs = diagnostics.requestDurationMs;
  const timeoutMs = diagnostics.timeoutMs;
  const pathTemplate = diagnostics.pathTemplate;

  if (
    typeof requestStartedAt !== "string" ||
    typeof requestCompletedAt !== "string" ||
    typeof requestDurationMs !== "number" ||
    typeof timeoutMs !== "number" ||
    typeof pathTemplate !== "string"
  ) {
    return null;
  }

  return {
    abortControllerTriggered: diagnostics.abortControllerTriggered === true,
    attemptNumber: normalizeDiagnosticAttemptNumber(diagnostics.attemptNumber),
    diagnosticOperation: normalizeDiagnosticOperation(diagnostics.diagnosticOperation),
    diagnosticRequestId: normalizeDiagnosticToken(diagnostics.diagnosticRequestId) ?? "unknown",
    diagnosticSyncRunId: normalizeDiagnosticToken(diagnostics.diagnosticSyncRunId),
    errorCode: normalizeDiagnosticToken(diagnostics.errorCode),
    fetchResolvedAt: typeof diagnostics.fetchResolvedAt === "string" ? diagnostics.fetchResolvedAt : null,
    httpStatus: typeof diagnostics.httpStatus === "number" ? diagnostics.httpStatus : null,
    method: typeof diagnostics.method === "string" ? diagnostics.method : "UNKNOWN",
    operationResult: normalizeDiagnosticOperationResult(diagnostics.operationResult),
    pathTemplate,
    requestCompletedAt,
    requestDurationMs,
    requestStartedAt,
    responseBodyStartedAt: typeof diagnostics.responseBodyStartedAt === "string" ? diagnostics.responseBodyStartedAt : null,
    responseParsedAt: typeof diagnostics.responseParsedAt === "string" ? diagnostics.responseParsedAt : null,
    responseRequestId: normalizeDiagnosticToken(diagnostics.responseRequestId),
    responseStarted: diagnostics.responseStarted === true,
    serverTiming: normalizeServerTiming(diagnostics.serverTiming),
    timeoutMs,
  };
}

function normalizeStateUpdateRequestHistory(value: unknown): StateUpdateRequestHistoryEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((item) => {
      const diagnostics = normalizeStateUpdateRequestDiagnostics(item);

      if (!diagnostics || !item || typeof item !== "object") {
        return [];
      }

      const interpretation = (item as Record<string, unknown>).interpretation;

      return [{
        ...diagnostics,
        interpretation: normalizeRequestInterpretation(interpretation),
      }];
    })
    .slice(-STATE_UPDATE_REQUEST_HISTORY_LIMIT);
}

function normalizeDiagnosticOperationResult(value: unknown) {
  return value === "diagnostics_error" ||
    value === "http_error" ||
    value === "network_error" ||
    value === "response_parse_error" ||
    value === "response_validation_error" ||
    value === "success" ||
    value === "transport_timeout" ||
    value === "unknown"
    ? value
    : undefined;
}

function normalizeServerTiming(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const metric = item as Record<string, unknown>;
      const name = typeof metric.name === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(metric.name)
        ? metric.name
        : null;

      if (!name) {
        return null;
      }

      return {
        description: typeof metric.description === "string" ? metric.description : null,
        durationMs: typeof metric.durationMs === "number" && Number.isFinite(metric.durationMs) && metric.durationMs >= 0
          ? metric.durationMs
          : null,
        name,
      };
    })
    .filter((item): item is NonNullable<StateUpdateRequestHistoryEvent["serverTiming"]>[number] => Boolean(item));
}

function normalizeDiagnosticOperation(value: unknown): NonNullable<StateUpdateRequestDiagnostics["diagnosticOperation"]> {
  return value === "SAVE" ||
    value === "DAY_LOAD" ||
    value === "REFRESH_AFTER_SYNC" ||
    value === "SEARCH" ||
    value === "PERSON_LOAD" ||
    value === "RECONCILE" ||
    value === "READY_CHECK" ||
    value === "AUTH_REFRESH" ||
    value === "HEALTH" ||
    value === "OTHER"
    ? value
    : "OTHER";
}

function normalizeDiagnosticToken(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,96}$/.test(value) ? value : null;
}

function normalizeRequestInterpretation(value: unknown): StateUpdateRequestHistoryEvent["interpretation"] {
  return value === "client_timeout_before_response" ||
    value === "http_error" ||
    value === "network_failure" ||
    value === "server_slow" ||
    value === "success" ||
    value === "unknown"
    ? value
    : "unknown";
}

function normalizeDiagnosticCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function normalizeDiagnosticAttemptNumber(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 99 ? value : null;
}

function normalizeNullableDiagnosticCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeNullableDiagnosticDuration(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function normalizeDiagnosticTimestamp(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  return Number.isFinite(Date.parse(value)) ? value : null;
}

function normalizeConnectivityStatus(value: unknown): StateUpdateSyncDiagnosticsTelemetry["currentConnectivity"]["status"] {
  return value === "online" || value === "offline" || value === "unknown" ? value : "unknown";
}

function normalizeNullableConnectivityStatus(value: unknown) {
  return value === "online" || value === "offline" || value === "unknown" ? value : null;
}

function normalizeStateUpdateSyncTelemetryResult(value: unknown) {
  return value === "auth_pending" ||
    value === "auth_timeout" ||
    value === "cancelled_scope_changed" ||
    value === "failed" ||
    value === "interrupted" ||
    value === "noop" ||
    value === "partial_failure" ||
    value === "ready_confirmed" ||
    value === "ready_failed" ||
    value === "reconnecting" ||
    value === "records_failed_before_state_update" ||
    value === "reconciled_success" ||
    value === "sync_started" ||
    value === "success"
    ? value
    : "failed";
}

function normalizeStateUpdateSyncTrigger(value: unknown) {
  return value === "reconnect" ||
    value === "unknown-to-online" ||
    value === "manual-retry" ||
    value === "startup-with-pending" ||
    value === "foreground/resume" ||
    value === "other"
    ? value
    : "other";
}

function normalizeStateUpdateVisibleErrorResolution(value: unknown): StateUpdateVisibleErrorResolution {
  return value === "cleared_after_success" ||
    value === "cleared_by_user" ||
    value === "refresh_failed" ||
    value === "unresolved"
    ? value
    : "unresolved";
}
