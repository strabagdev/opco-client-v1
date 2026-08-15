import * as SQLite from "expo-sqlite";

import { CachedEntityDefinition, EntityDefinitionCache } from "./definition-cache";
import { EntityDefinition } from "./opco-api";

const DATABASE_NAME = "opco-client.db";
const SCHEMA_VERSION = "1";
const SELECTED_CONTRACT_ID_KEY = "selected_contract_id";
const SCHEMA_VERSION_KEY = "schema_version";

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

export type LocalDatabase = EntityDefinitionCache & {
  getSelectedContractId(): Promise<string | null>;
  setSelectedContractId(contractId: string | null): Promise<void>;
};

export function getLocalDatabase(): LocalDatabase {
  return {
    getEntityDefinition,
    getSelectedContractId,
    setSelectedContractId,
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
  `);

  await db.runAsync(
    `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)`,
    SCHEMA_VERSION_KEY,
    SCHEMA_VERSION,
  );

  return db;
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
