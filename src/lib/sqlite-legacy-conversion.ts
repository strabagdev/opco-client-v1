import type { SQLiteDatabase } from "expo-sqlite";
import { LOCAL_MIGRATION_AMBIGUOUS_CODE, LocalDatabaseUnavailableError } from "./local-db-recovery";

type Column = { name: string; required: boolean; pk?: number };
type Conversion = {
  table: "app_views" | "sync_telemetry";
  discriminator: string;
  columns: Column[];
  addedValue: string;
  create: string;
};
const text = (name: string, required = false, pk?: number): Column => ({ name, required, pk });
const views: Conversion = {
  table: "app_views", discriminator: "owner_key", addedValue: "'legacy'",
  columns: [text("owner_key", true, 1), text("contract_id", true, 2), text("views_json", true), text("synced_at", true)],
  create: `CREATE TABLE app_views (
    owner_key TEXT NOT NULL, contract_id TEXT NOT NULL, views_json TEXT NOT NULL, synced_at TEXT NOT NULL,
    PRIMARY KEY (owner_key, contract_id)
  )`,
};
const telemetry: Conversion = {
  table: "sync_telemetry", discriminator: "entity_type_id", addedValue: "'__contract_legacy__'",
  columns: [text("owner_key", true, 1), text("contract_id", true, 2), text("entity_type_id", true, 3),
    text("sync_phase", true), text("last_sync_attempt_at"), text("last_push_completed_at"),
    text("last_full_refresh_completed_at"), text("last_reconcile_completed_at"), text("last_successful_sync_at"),
    text("last_sync_error_at"), text("last_sync_error_code"), text("last_sync_error_phase"), text("updated_at", true)],
  create: `CREATE TABLE sync_telemetry (
    owner_key TEXT NOT NULL, contract_id TEXT NOT NULL, entity_type_id TEXT NOT NULL, sync_phase TEXT NOT NULL,
    last_sync_attempt_at TEXT, last_push_completed_at TEXT, last_full_refresh_completed_at TEXT,
    last_reconcile_completed_at TEXT, last_successful_sync_at TEXT, last_sync_error_at TEXT,
    last_sync_error_code TEXT, last_sync_error_phase TEXT, updated_at TEXT NOT NULL,
    PRIMARY KEY (owner_key, contract_id, entity_type_id)
  )`,
};
const quote = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;
function ambiguous(spec: Conversion, reason: string): never {
  const error = new LocalDatabaseUnavailableError("MIGRATION_FAILED",
    new Error(`${LOCAL_MIGRATION_AMBIGUOUS_CODE}:${spec.table}:${reason}`));
  error.destructiveRecoveryAvailable = false;
  throw error;
}

async function assertShape(db: SQLiteDatabase, spec: Conversion, table: string, expected: Column[]) {
  const columns = await db.getAllAsync<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number; hidden: number }>(`PRAGMA table_xinfo(${quote(table)})`);
  if (columns.length !== expected.length || expected.some(c => !columns.some(v => v.name === c.name &&
    v.type.toUpperCase() === "TEXT" && v.notnull === Number(c.required) && v.dflt_value === null &&
    v.pk === (c.pk ?? 0) && v.hidden === 0))) ambiguous(spec, "schema");
  const indexes = await db.getAllAsync<{ name: string; origin: string; unique: number; partial: number }>(`PRAGMA index_list(${quote(table)})`);
  if (indexes.length !== 1 || indexes[0].origin !== "pk" || indexes[0].unique !== 1 || indexes[0].partial !== 0) ambiguous(spec, "indexes");
  const keys = (await db.getAllAsync<{ name: string; coll: string; desc: number; key: number }>(`PRAGMA index_xinfo(${quote(indexes[0].name)})`)).filter(c => c.key === 1);
  const expectedKeys = expected.filter(c => c.pk).sort((a, b) => a.pk! - b.pk!);
  if (keys.length !== expectedKeys.length || keys.some((c, i) => c.name !== expectedKeys[i].name || c.coll !== "BINARY" || c.desc !== 0)) ambiguous(spec, "identity");
  const invalid = expected.map(c => `${c.required ? `${quote(c.name)} IS NULL OR ` : ""}(${quote(c.name)} IS NOT NULL AND typeof(${quote(c.name)}) <> 'text')`).join(" OR ");
  if (await db.getFirstAsync(`SELECT 1 FROM ${quote(table)} WHERE ${invalid} LIMIT 1`)) ambiguous(spec, "values");
}

async function assertDependencies(db: SQLiteDatabase, spec: Conversion) {
  // These two published cache shapes have no triggers, views or foreign keys. Do not
  // guess how a custom schema would react to copying or dropping a table.
  if (await db.getFirstAsync("SELECT 1 FROM sqlite_master WHERE type IN ('trigger', 'view') LIMIT 1")) ambiguous(spec, "dependencies");
  const tables = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  const affected = [spec.table, `${spec.table}_legacy`];
  for (const { name } of tables) {
    const foreignKeys = await db.getAllAsync<{ table: string }>(`PRAGMA foreign_key_list(${quote(name)})`);
    if (foreignKeys.some(f => affected.includes(f.table)) || (affected.includes(name) && foreignKeys.length)) ambiguous(spec, "dependencies");
  }
}

/** Only the two existing conversions, inside the opener's existing transaction. No new migration engine. */
async function completeLegacyConversion(db: SQLiteDatabase, spec: Conversion) {
  const old = `${spec.table}_legacy`;
  const currentColumns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${spec.table})`);
  const legacyColumns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${old})`);
  const isOld = currentColumns.length > 0 && !currentColumns.some(c => c.name === spec.discriminator);
  if (!isOld && legacyColumns.length === 0) return;
  if (isOld && legacyColumns.length > 0) ambiguous(spec, "two_sources");
  const legacySpec = spec.columns.filter(c => c.name !== spec.discriminator).map(c => ({
    ...c, pk: c.pk && spec.discriminator === "owner_key" ? c.pk - 1 : c.pk,
  }));
  if (isOld) {
    await assertShape(db, spec, spec.table, legacySpec);
    await assertDependencies(db, spec);
    await db.execAsync(`ALTER TABLE ${quote(spec.table)} RENAME TO ${quote(old)}`);
  }
  if (isOld || currentColumns.length === 0) await db.execAsync(spec.create);
  await assertShape(db, spec, old, legacySpec);
  await assertShape(db, spec, spec.table, spec.columns);
  await assertDependencies(db, spec);

  const expression = (c: Column) => c.name === spec.discriminator ? spec.addedValue : `s.${quote(c.name)}`;
  const equal = (c: Column) => `d.${quote(c.name)} COLLATE BINARY IS ${expression(c)} COLLATE BINARY`;
  const identity = spec.columns.filter(c => c.pk).map(equal).join(" AND ");
  const identical = spec.columns.map(equal).join(" AND ");
  if (await db.getFirstAsync(`SELECT 1 FROM ${quote(old)} s JOIN ${quote(spec.table)} d ON ${identity} WHERE NOT (${identical}) LIMIT 1`)) ambiguous(spec, "conflicting_copy");
  await db.execAsync(`INSERT INTO ${quote(spec.table)} (${spec.columns.map(c => quote(c.name)).join(", ")})
    SELECT ${spec.columns.map(expression).join(", ")} FROM ${quote(old)} s
    WHERE NOT EXISTS (SELECT 1 FROM ${quote(spec.table)} d WHERE ${identity})`);
  if (await db.getFirstAsync(`SELECT 1 FROM ${quote(old)} s WHERE NOT EXISTS (SELECT 1 FROM ${quote(spec.table)} d WHERE ${identical}) LIMIT 1`)) ambiguous(spec, "unverified_copy");
  // Every source row now exists byte-for-byte at its mapped identity. Other owners
  // and entity scopes were never replaced. Dropping is covered by the same transaction.
  await db.execAsync(`DROP TABLE ${quote(old)}`);
}

export const migrateLegacyAppViewsTable = (db: SQLiteDatabase) => completeLegacyConversion(db, views);
export const migrateLegacySyncTelemetryTable = (db: SQLiteDatabase) => completeLegacyConversion(db, telemetry);
