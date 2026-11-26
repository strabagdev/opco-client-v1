// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
import type { SQLiteDatabase } from "expo-sqlite";
import { afterEach, expect, it } from "vitest";
import { PYTHON_SQLITE_SCRIPT_EXECUTOR } from "../test/sqlite-script";
import { migrateLegacyAppViewsTable, migrateLegacySyncTelemetryTable } from "./sqlite-legacy-conversion";

function fixture() {
  const worker = spawn("python3", ["-u", "-c", `
import sqlite3,json,sys
c=sqlite3.connect(':memory:',isolation_level=None)
c.row_factory=sqlite3.Row
${PYTHON_SQLITE_SCRIPT_EXECUTOR}
for line in sys.stdin:
 try:
  q=json.loads(line)
  if q['kind']=='exec': exec_sqlite_script(q['sql']); result=None
  else:
   cur=c.execute(q['sql'],q.get('args',[]))
   result=[dict(r) for r in cur.fetchall()] if q['kind']=='read' else {'changes':cur.rowcount}
  print(json.dumps({'result':result},default=lambda value:{'blobHex':value.hex()} if isinstance(value,bytes) else str(value)))
 except Exception as e: print(json.dumps({'error':str(e)}))
`]);
  const closed = new Promise<void>(resolve => worker.once("close", () => resolve()));
  const queue: { resolve: (value: any) => void; reject: (error: Error) => void }[] = [];
  let buffer = "";
  worker.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n"), reply = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      const next = queue.shift()!; if (reply.error) next.reject(new Error(reply.error)); else next.resolve(reply.result);
    }
  });
  const query = (kind: string, sql: string, args: unknown[] = []) => new Promise<any>((resolve, reject) => {
    queue.push({ resolve, reject }); worker.stdin.write(JSON.stringify({ kind, sql, args }) + "\n");
  });
  const db = {
    execAsync: (sql: string) => query("exec", sql),
    getAllAsync: (sql: string, ...args: unknown[]) => query("read", sql, args),
    getFirstAsync: async (sql: string, ...args: unknown[]) => (await query("read", sql, args))[0] ?? null,
    runAsync: (sql: string, ...args: unknown[]) => query("write", sql, args),
    withTransactionAsync: async (task: () => Promise<void>) => {
      await query("exec", "BEGIN");
      try { await task(); await query("exec", "COMMIT"); }
      catch (error) { await query("exec", "ROLLBACK"); throw error; }
    },
  } as unknown as SQLiteDatabase;
  return { db, async stop() { worker.stdin.end(); await closed; expect(queue).toHaveLength(0); } };
}
let current: ReturnType<typeof fixture> | undefined;
afterEach(async () => { await current?.stop(); current = undefined; });

const families = ["app_views", "sync_telemetry"] as const;
type Family = typeof families[number];
const oldSQL = (name: string, family: Family) => family === "app_views"
  ? `CREATE TABLE ${name}(contract_id TEXT PRIMARY KEY NOT NULL,views_json TEXT NOT NULL,synced_at TEXT NOT NULL)`
  : `CREATE TABLE ${name}(owner_key TEXT NOT NULL,contract_id TEXT NOT NULL,sync_phase TEXT NOT NULL,
    last_sync_attempt_at TEXT,last_push_completed_at TEXT,last_full_refresh_completed_at TEXT,last_reconcile_completed_at TEXT,
    last_successful_sync_at TEXT,last_sync_error_at TEXT,last_sync_error_code TEXT,last_sync_error_phase TEXT,updated_at TEXT NOT NULL,
    PRIMARY KEY(owner_key,contract_id))`;
const newSQL = (family: Family) => family === "app_views"
  ? "CREATE TABLE app_views(owner_key TEXT NOT NULL,contract_id TEXT NOT NULL,views_json TEXT NOT NULL,synced_at TEXT NOT NULL,PRIMARY KEY(owner_key,contract_id))"
  : "CREATE TABLE sync_telemetry(owner_key TEXT NOT NULL,contract_id TEXT NOT NULL,entity_type_id TEXT NOT NULL,sync_phase TEXT NOT NULL,last_sync_attempt_at TEXT,last_push_completed_at TEXT,last_full_refresh_completed_at TEXT,last_reconcile_completed_at TEXT,last_successful_sync_at TEXT,last_sync_error_at TEXT,last_sync_error_code TEXT,last_sync_error_phase TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(owner_key,contract_id,entity_type_id))";
const sourceColumns = (family: Family) => family === "app_views" ? ["contract_id", "views_json", "synced_at"] : ["owner_key", "contract_id", "sync_phase", "updated_at"];
const payloadColumn = (family: Family) => family === "app_views" ? "views_json" : "sync_phase";
async function put(db: SQLiteDatabase, table: string, family: Family, key: string, mapped: boolean, value = "original") {
  const columns = sourceColumns(family), values: string[] = family === "app_views" ? [key, value, "2026-11-25T12:00:00Z"] : ["org:A", key, value, "2026-11-25T12:00:00Z"];
  if (mapped) { columns.push(family === "app_views" ? "owner_key" : "entity_type_id"); values.push(family === "app_views" ? "legacy" : "__contract_legacy__"); }
  await db.runAsync(`INSERT INTO ${table}(${columns.join(",")}) VALUES (${values.map(() => "?").join(",")})`, ...values);
}
const migrate = (db: SQLiteDatabase, family: Family) => family === "app_views" ? migrateLegacyAppViewsTable(db) : migrateLegacySyncTelemetryTable(db);
async function snapshot(db: SQLiteDatabase) {
  const schema = await db.getAllAsync<{ name: string; sql: string }>("SELECT name,sql FROM sqlite_master WHERE type IN ('table','trigger','index') ORDER BY name");
  const data: Record<string, unknown> = {};
  for (const table of schema.filter(t => t.sql?.startsWith("CREATE TABLE"))) data[table.name] = await db.getAllAsync(`SELECT * FROM ${table.name} ORDER BY rowid`);
  return { schema, data };
}

for (const family of families) {
  it.each(["old-only", "renamed-only", "empty-target", "partial-identical", "complete-identical", "other-identity", "empty-source"])(`C12 safely completes ${family} from %s exactly once`, async mode => {
    current = fixture(); const { db } = current, old = family + "_legacy";
    await db.execAsync(oldSQL(mode === "old-only" ? family : old, family));
    if (mode !== "empty-source") for (const key of ["one", "two"]) await put(db, mode === "old-only" ? family : old, family, key, false);
    if (!["old-only", "renamed-only"].includes(mode)) await db.execAsync(newSQL(family));
    if (["partial-identical", "complete-identical"].includes(mode)) await put(db, family, family, "one", true);
    if (mode === "complete-identical") await put(db, family, family, "two", true);
    if (["other-identity", "empty-source"].includes(mode)) await put(db, family, family, "other", true, "unrelated");
    await db.withTransactionAsync(() => migrate(db, family));
    expect(await db.getFirstAsync("SELECT name FROM sqlite_master WHERE name=?", old)).toBeNull();
    expect(await db.getAllAsync(`SELECT * FROM ${family}`)).toHaveLength(mode === "empty-source" ? 1 : mode === "other-identity" ? 3 : 2);
    const before = await snapshot(db), changes = await db.getFirstAsync("SELECT total_changes() AS n");
    await db.withTransactionAsync(() => migrate(db, family));
    expect(await snapshot(db)).toEqual(before); expect(await db.getFirstAsync("SELECT total_changes() AS n")).toEqual(changes);
  });

  it.each(["conflict", "unknown-source", "unknown-target", "two-sources", "collation", "value-collation", "trigger", "foreign-key", "extra-index", "blob-value"])(`C12 preserves ambiguous ${family} %s without copying or dropping`, async mode => {
    current = fixture(); const { db } = current, old = family + "_legacy";
    let source = oldSQL(old, family), target = newSQL(family);
    if (mode === "collation") source = source.replace(family === "app_views" ? "contract_id TEXT" : "owner_key TEXT", family === "app_views" ? "contract_id TEXT COLLATE NOCASE" : "owner_key TEXT COLLATE NOCASE");
    if (mode === "value-collation") target = target.replace(payloadColumn(family) + " TEXT", payloadColumn(family) + " TEXT COLLATE NOCASE");
    await db.execAsync(source); await put(db, old, family, "one", false);
    await db.execAsync(mode === "two-sources" ? oldSQL(family, family) : target);
    if (mode === "two-sources") await put(db, family, family, "one", false);
    if (["conflict", "value-collation"].includes(mode)) await put(db, family, family, "one", true, "ORIGINAL");
    if (mode === "unknown-source") await db.execAsync(`ALTER TABLE ${old} ADD COLUMN extra TEXT`);
    if (mode === "unknown-target") await db.execAsync(`ALTER TABLE ${family} ADD COLUMN extra TEXT`);
    if (mode === "trigger") await db.execAsync(`CREATE TRIGGER custom AFTER INSERT ON ${family} BEGIN SELECT 1; END;`);
    if (mode === "foreign-key") {
      const keys = family === "app_views" ? ["owner_key", "contract_id"] : ["owner_key", "contract_id", "entity_type_id"];
      await db.execAsync(`CREATE TABLE dependent(${keys.map(k => k + " TEXT").join(",")}, FOREIGN KEY(${keys.join(",")}) REFERENCES ${family}(${keys.join(",")}))`);
    }
    if (mode === "extra-index") await db.execAsync(`CREATE INDEX extra ON ${old}(${payloadColumn(family)})`);
    if (mode === "blob-value") await db.execAsync(`UPDATE ${old} SET ${payloadColumn(family)}=X'0102'`);
    const before = await snapshot(db);
    await expect(db.withTransactionAsync(() => migrate(db, family))).rejects.toMatchObject({ causeCode: "MIGRATION_FAILED", retryable: true, destructiveRecoveryAvailable: false, originalError: expect.objectContaining({ message: expect.stringMatching(/^SQLITE_MIGRATION_AMBIGUOUS:/) }) });
    expect(await snapshot(db)).toEqual(before);
  });
}

it("rolls back an earlier safe conversion if the next conversion is ambiguous", async () => {
  current = fixture(); const { db } = current;
  await db.execAsync(oldSQL("app_views", "app_views") + ";" + oldSQL("sync_telemetry_legacy", "sync_telemetry") + ";" + newSQL("sync_telemetry"));
  await put(db, "app_views", "app_views", "one", false);
  await put(db, "sync_telemetry_legacy", "sync_telemetry", "one", false);
  await put(db, "sync_telemetry", "sync_telemetry", "one", true, "different");
  const before = await snapshot(db);
  await expect(db.withTransactionAsync(async () => { await migrateLegacyAppViewsTable(db); await migrateLegacySyncTelemetryTable(db); })).rejects.toMatchObject({ causeCode: "MIGRATION_FAILED" });
  expect(await snapshot(db)).toEqual(before);
});
