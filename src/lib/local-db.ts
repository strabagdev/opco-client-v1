import * as SQLite from "expo-sqlite";

import { CachedEntityDefinition, EntityDefinitionCache } from "./definition-cache";
import {
  buildLocalDisplayName,
  CachedEntityRecord,
  createLocalRecordId,
  OfflineRecordStore,
  PendingOperation,
  RecordSyncStatus,
} from "./offline-records";
import { EntityDefinition, EntityRecord, EntityRecordValue } from "./opco-api";
import { RecordsSyncStore } from "../sync/records-sync";

const DATABASE_NAME = "opco-client.db";
const SCHEMA_VERSION = "2";
const SELECTED_CONTRACT_ID_KEY = "selected_contract_id";
const SCHEMA_VERSION_KEY = "schema_version";

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export type LocalDatabase = EntityDefinitionCache &
  OfflineRecordStore &
  RecordsSyncStore & {
  getSelectedContractId(): Promise<string | null>;
  setSelectedContractId(contractId: string | null): Promise<void>;
};

export function getLocalDatabase(): LocalDatabase {
  return {
    completePendingOperation,
    countPendingOperations,
    createLocalRecord,
    failPendingOperation,
    getCachedRecord,
    getEntityDefinition,
    getSelectedContractId,
    listCachedRecords,
    listPendingOperations,
    markPendingOperationSyncing,
    retryPendingOperation,
    setSelectedContractId,
    updateLocalRecord,
    upsertRemoteRecords,
    upsertEntityDefinition,
  };
}

async function getDatabase() {
  if (!databasePromise) {
    databasePromise = openAndMigrate();
  }

  return databasePromise;
}

async function openAndMigrate() {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);

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
    CREATE TABLE IF NOT EXISTS entity_records (
      local_id TEXT PRIMARY KEY NOT NULL,
      server_id TEXT,
      owner_key TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      entity_type_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      values_json TEXT NOT NULL,
      updated_at_remote TEXT,
      cached_at TEXT NOT NULL,
      sync_status TEXT NOT NULL,
      sync_error_code TEXT,
      sync_error_message TEXT
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

  await db.runAsync(
    `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)`,
    SCHEMA_VERSION_KEY,
    SCHEMA_VERSION,
  );

  return db;
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
          updated_at_remote,
          cached_at,
          sync_status,
          sync_error_code,
          sync_error_message
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', NULL, NULL)
        ON CONFLICT(local_id)
        DO UPDATE SET
          server_id = excluded.server_id,
          display_name = excluded.display_name,
          values_json = excluded.values_json,
          updated_at_remote = excluded.updated_at_remote,
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
          END
      `,
      existing?.local_id ?? record.id,
      record.id,
      ownerKey,
      contractId,
      entityTypeId,
      record.displayName,
      JSON.stringify(record.values),
      readRemoteUpdatedAt(record),
      cachedAt,
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
          sync_error_message = NULL
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
        AND entity_records.sync_status <> 'failed'
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
    `SELECT COUNT(*) AS total FROM pending_operations WHERE owner_key = ?`,
    ownerKey,
  );

  return row?.total ?? 0;
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
          updated_at_remote = ?,
          cached_at = ?,
          sync_status = ?,
          sync_error_code = NULL,
          sync_error_message = NULL
      WHERE local_id = ?
    `,
    record.id,
    record.displayName,
    JSON.stringify(record.values),
    readRemoteUpdatedAt(record),
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
  contract_id: string;
  display_name: string;
  entity_type_id: string;
  local_id: string;
  owner_key: string;
  server_id: string | null;
  sync_error_code: string | null;
  sync_error_message: string | null;
  sync_status: RecordSyncStatus;
  updated_at_remote: string | null;
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
    displayName: row.display_name,
    id: row.server_id ?? row.local_id,
    localId: row.local_id,
    serverId: row.server_id,
    syncErrorCode: row.sync_error_code,
    syncErrorMessage: row.sync_error_message,
    syncStatus: row.sync_status,
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

function readRemoteUpdatedAt(record: EntityRecord) {
  const value = (record as EntityRecord & { updatedAt?: unknown }).updatedAt;

  return typeof value === "string" ? value : null;
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
