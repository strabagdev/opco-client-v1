import type { SQLiteDatabase, SQLiteExecuteAsyncResult } from "expo-sqlite";

type StatementMethod = "runAsync" | "getFirstAsync" | "getAllAsync";
type FailurePhase = "prepare" | "execute" | "read" | "finalize" | "begin" | "commit" | "transaction";
type SecondaryPhase = "finalize" | "rollback";
type ErrorCode = "SQLITE_CONSTRAINT_UNIQUE" | "SQLITE_CONSTRAINT" | "SQLITE_BUSY" |
  "SQLITE_LOCKED" | "SQLITE_IOERR" | "SQLITE_CORRUPT" | "SQLITE_FULL" |
  "SQLITE_ERROR" | "STORAGE_QUOTA_EXCEEDED" | "STATEMENT_FINALIZATION_FAILED" | "UNKNOWN";

export type SQLiteStatementErrorDiagnostic = {
  primary: { phase: FailurePhase; code: ErrorCode; sqliteCode: number | null };
  secondary: { phase: SecondaryPhase; code: ErrorCode; sqliteCode: number | null }[];
};

// Keep the original exceptions transient and outside serializable diagnostics. Never store SQL,
// parameters, error messages or stacks in the coordinator, telemetry, console or local storage.
const failures = new WeakMap<object, { phase: FailurePhase; secondary: { phase: SecondaryPhase; error: unknown }[] }>();
const isObject = (value: unknown): value is object => value !== null && typeof value === "object";

function remember(error: unknown, phase: FailurePhase) {
  if (isObject(error)) failures.set(error, { phase, secondary: [] });
}

function safeError(error: unknown): { code: ErrorCode; sqliteCode: number | null } {
  const message = error instanceof Error ? error.message : "";
  const reported = isObject(error) && "sqliteCode" in error ? error.sqliteCode : null;
  const parsed = /\bError code\s*:?\s*(\d+)\b/i.exec(message);
  const numeric = typeof reported === "number" ? reported : parsed ? Number(parsed[1]) : null;
  const sqliteCode = numeric !== null && Number.isInteger(numeric) && numeric >= 0 && numeric <= 65535
    ? numeric : null;
  let code: ErrorCode = "UNKNOWN";
  if (error instanceof Error && (error.name === "QuotaExceededError" || message.startsWith("QuotaExceededError:"))) code = "STORAGE_QUOTA_EXCEEDED";
  else if (message.includes("UNIQUE constraint failed")) code = "SQLITE_CONSTRAINT_UNIQUE";
  else if (message.includes("Error finalizing statement")) code = "STATEMENT_FINALIZATION_FAILED";
  else {
    const base = sqliteCode === null ? null : sqliteCode & 255;
    if (base === 19) code = "SQLITE_CONSTRAINT";
    else if (base === 5) code = "SQLITE_BUSY";
    else if (base === 6) code = "SQLITE_LOCKED";
    else if (base === 10) code = "SQLITE_IOERR";
    else if (base === 11) code = "SQLITE_CORRUPT";
    else if (base === 13) code = "SQLITE_FULL";
    else if (base === 1) code = "SQLITE_ERROR";
  }
  return { code, sqliteCode };
}

export function getSQLiteStatementErrorDiagnostic(error: unknown): SQLiteStatementErrorDiagnostic | null {
  const failure = isObject(error) ? failures.get(error) : undefined;
  return failure ? {
    primary: { phase: failure.phase, ...safeError(error) },
    secondary: failure.secondary.map(({ phase, error }) => ({ phase, ...safeError(error) })),
  } : null;
}

async function executeStatement(
  database: SQLiteDatabase, method: StatementMethod, source: string, params: unknown[],
) {
  let statement;
  try {
    statement = await database.prepareAsync(source);
  } catch (error) {
    remember(error, "prepare");
    throw error;
  }
  let failed = false;
  let primary: unknown;
  let phase: FailurePhase = "execute";
  try {
    // Preserve Expo's array/object/variadic bindings and return objects without normalization.
    const result: SQLiteExecuteAsyncResult<unknown> = await Reflect.apply(statement.executeAsync, statement, params);
    if (method === "runAsync") return result;
    phase = "read";
    return await result[method]();
  } catch (error) {
    failed = true;
    primary = error;
    remember(error, phase);
    throw error;
  } finally {
    try {
      await statement.finalizeAsync();
    } catch (secondary) {
      if (!failed) {
        remember(secondary, "finalize");
        throw secondary;
      }
      // Even a thrown null/undefined remains the primary failure. Finalize still runs once.
      if (isObject(primary)) failures.get(primary)?.secondary.push({ phase: "finalize", error: secondary });
    }
  }
}

async function executeTransaction(database: SQLiteDatabase, task: () => Promise<void>) {
  let failed = false;
  let primary: unknown;
  function capture(error: unknown, phase: FailurePhase) {
    if (failed) return;
    failed = true;
    primary = error;
    // A statement may already carry its execution/read/finalize details.
    if (!isObject(error) || !failures.has(error)) remember(error, phase);
  }
  const receiver = new Proxy(database, {
    get(target, property) {
      if (property === "execAsync") return async (source: string) => {
        try {
          return await target.execAsync(source);
        } catch (error) {
          if (source === "ROLLBACK" && failed) {
            if (isObject(primary)) failures.get(primary)?.secondary.push({ phase: "rollback", error });
          } else {
            capture(error, source === "BEGIN" ? "begin" : source === "COMMIT" ? "commit" : "execute");
          }
          throw error;
        }
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    // SDK 57 still owns BEGIN/task/COMMIT/ROLLBACK. Only observe its dispatch;
    // physical methods retain their original receiver and are never replaced.
    return await Reflect.apply(database.withTransactionAsync, receiver, [async () => {
      try { await task(); } catch (error) { capture(error, "transaction"); throw error; }
    }]);
  } catch (error) {
    if (failed) throw primary; // Preserve even null/undefined; never replay a write.
    remember(error, "transaction");
    throw error;
  }
}

/** Same physical connection and SDK 57 transactions; no queue or atomic-boundary changes. */
export function preserveSQLiteStatementErrors(database: SQLiteDatabase): SQLiteDatabase {
  // Injected SQLite-compatible test stores may only implement the convenience methods.
  // They keep their own behavior; an error they already discarded cannot be reconstructed.
  if (typeof database.prepareAsync !== "function") return database;
  return new Proxy(database, {
    get(target, property) {
      if (property === "withTransactionAsync") {
        return (task: () => Promise<void>) => executeTransaction(target, task);
      }
      if (property === "runAsync" || property === "getFirstAsync" || property === "getAllAsync") {
        return (source: string, ...params: unknown[]) => executeStatement(target, property, source, params);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
