import * as SQLite from "expo-sqlite";

import { AppNavigationCache, CachedAppViewsSnapshot, CachedContextSnapshot } from "./app-navigation-cache";
import { CachedEntityDefinition, EntityDefinitionCache } from "./definition-cache";
import {
  buildLocalDisplayName,
  CachedEntityRecord,
  createLocalRecordId,
  OfflineRecordStore,
  PendingOperation,
  RecordSyncStatus,
  RecordsSyncSummary,
} from "./offline-records";
import { AppView, ContextResponse, EntityDefinition, EntityRecord, EntityRecordValue, MeResponse, OpcoApi } from "./opco-api";
import { RecordsSyncStore } from "../sync/records-sync";

const DATABASE_NAME = "opco-client.db";
const SCHEMA_VERSION = "4";
const SELECTED_CONTRACT_ID_KEY = "selected_contract_id";
const SCHEMA_VERSION_KEY = "schema_version";
const GLOBAL_DATABASE_STATE_KEY = "__opcoClientLocalDatabaseState";

type LocalDatabaseGlobalState = {
  database: SQLite.SQLiteDatabase | null;
  databasePromise: Promise<SQLite.SQLiteDatabase> | null;
  migrationPromise: Promise<void> | null;
  migratedSchemaVersion: string | null;
};

type LocalDatabaseGlobal = typeof globalThis & {
  [GLOBAL_DATABASE_STATE_KEY]?: LocalDatabaseGlobalState;
};

export type LocalDatabase = AppNavigationCache &
  EntityDefinitionCache &
  OfflineRecordStore &
  RecordsSyncStore & {
  getSelectedContractId(): Promise<string | null>;
  setSelectedContractId(contractId: string | null): Promise<void>;
};

export function getLocalDatabase(): LocalDatabase {
  return {
    clearNavigationCache,
    completePendingOperation,
    countPendingOperations,
    createLocalRecord,
    failPendingOperation,
    getAppViews,
    getContextSnapshot,
    getCachedRecord,
    getRecordsSyncSummary,
    getEntityDefinition,
    getSelectedContractId,
    listCachedRecords,
    listProblemRecords,
    listPendingOperations,
    markPendingOperationSyncing,
    markPendingOperationConflict,
    readRecordRemoteUpdatedAt,
    reconcileRemoteRecordsSnapshot,
    resolveRecordConflictWithLocal,
    resolveRecordConflictWithRemote,
    retryFailedRecord,
    retryPendingOperation,
    setSelectedContractId,
    updateLocalRecord,
    upsertAppViews,
    upsertContextSnapshot,
    upsertRemoteRecords,
    upsertEntityDefinition,
  };
}

async function getDatabase() {
  const state = getLocalDatabaseGlobalState();

  if (!state.databasePromise) {
    const nextDatabasePromise = openAndMigrate().catch((error) => {
      if (state.databasePromise === nextDatabasePromise) {
        state.database = null;
        state.databasePromise = null;
        state.migratedSchemaVersion = null;
        state.migrationPromise = null;
      }

      throw error;
    });

    state.databasePromise = nextDatabasePromise;
  }

  return state.databasePromise;
}

async function openAndMigrate() {
  const state = getLocalDatabaseGlobalState();
  const db = state.database ?? await SQLite.openDatabaseAsync(DATABASE_NAME);

  state.database = db;
  await migrateDatabaseOnce(db, state);

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
      me_json TEXT NOT NULL,
      context_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_views (
      contract_id TEXT PRIMARY KEY NOT NULL,
      views_json TEXT NOT NULL,
      synced_at TEXT NOT NULL
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
  `);

  await migrateEntityRecordsTable(db);

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
      migratedSchemaVersion: null,
      migrationPromise: null,
    };
  }

  return globalState[GLOBAL_DATABASE_STATE_KEY];
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
    migratedSchemaVersion: state.migratedSchemaVersion,
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

async function upsertContextSnapshot(
  me: MeResponse,
  context: ContextResponse,
  syncedAt: string,
) {
  const db = await getDatabase();

  await db.runAsync(
    `
      INSERT OR REPLACE INTO context_snapshot (id, me_json, context_json, synced_at)
      VALUES ('current', ?, ?, ?)
    `,
    JSON.stringify(me),
    JSON.stringify(context),
    syncedAt,
  );
}

async function getContextSnapshot(): Promise<CachedContextSnapshot | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    context_json: string;
    me_json: string;
    synced_at: string;
  }>(
    `
      SELECT me_json, context_json, synced_at
      FROM context_snapshot
      WHERE id = 'current'
      LIMIT 1
    `,
  );

  if (!row) {
    return null;
  }

  return {
    context: JSON.parse(row.context_json) as ContextResponse,
    me: JSON.parse(row.me_json) as MeResponse,
    syncedAt: row.synced_at,
  };
}

async function upsertAppViews(contractId: string, views: AppView[], syncedAt: string) {
  const db = await getDatabase();

  await db.runAsync(
    `
      INSERT INTO app_views (contract_id, views_json, synced_at)
      VALUES (?, ?, ?)
      ON CONFLICT(contract_id)
      DO UPDATE SET views_json = excluded.views_json, synced_at = excluded.synced_at
    `,
    contractId,
    JSON.stringify(views),
    syncedAt,
  );
}

async function getAppViews(contractId: string): Promise<CachedAppViewsSnapshot | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ synced_at: string; views_json: string }>(
    `
      SELECT views_json, synced_at
      FROM app_views
      WHERE contract_id = ?
      LIMIT 1
    `,
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
      existing?.local_id ?? record.id,
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

  await upsertPendingOperation({
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
  } else {
    if (!existing.serverId) {
      throw new Error("No se puede sincronizar UPDATE sin server_id.");
    }

    await upsertPendingOperation({
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
  }

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

async function markPendingOperationSyncing(operationId: string) {
  const db = await getDatabase();

  await db.runAsync(
    `
      UPDATE pending_operations
      SET attempts = attempts + 1,
          updated_at = ?,
          last_error_code = NULL,
          last_error_message = NULL
      WHERE id = ?
    `,
    new Date().toISOString(),
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
}

async function completePendingOperation(operation: PendingOperation, record: EntityRecord) {
  const db = await getDatabase();
  const now = new Date().toISOString();

  await db.runAsync(`DELETE FROM pending_operations WHERE id = ?`, operation.id);
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
}

async function retryPendingOperation(operation: PendingOperation, code: string, message: string) {
  const db = await getDatabase();

  await setOperationError(db, operation, code, message, operation.operation === "CREATE" ? "pending_create" : "pending_update");
}

async function failPendingOperation(operation: PendingOperation, code: string, message: string) {
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

  await db.runAsync(
    `
      UPDATE pending_operations
      SET updated_at = ?,
          last_error_code = ?,
          last_error_message = ?
      WHERE id = ?
    `,
    new Date().toISOString(),
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
    new Date().toISOString(),
    ownerKey,
    existing.localId,
  );

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
    new Date().toISOString(),
    existing.localId,
  );

  const record = await getCachedRecord({ contractId, entityTypeId, ownerKey, recordId: existing.localId });

  if (!record) {
    throw new Error("No fue posible leer el registro resuelto.");
  }

  return record;
}

async function upsertPendingOperation({
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
  operation: "CREATE" | "UPDATE";
  ownerKey: string;
  payload: { clientRequestId?: string; values: Record<string, EntityRecordValue> };
  serverRecordId: string | null;
  timestamp: string;
}) {
  const db = await getDatabase();
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
  operation: "CREATE" | "UPDATE";
  owner_key: string;
  payload_json: string;
  server_record_id: string | null;
  updated_at: string;
};

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

async function getSelectedContractId() {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_metadata WHERE key = ? LIMIT 1`,
    SELECTED_CONTRACT_ID_KEY,
  );

  return row?.value ?? null;
}

async function setSelectedContractId(contractId: string | null) {
  const db = await getDatabase();

  if (!contractId) {
    await db.runAsync(`DELETE FROM app_metadata WHERE key = ?`, SELECTED_CONTRACT_ID_KEY);
    return;
  }

  await db.runAsync(
    `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)`,
    SELECTED_CONTRACT_ID_KEY,
    contractId,
  );
}
