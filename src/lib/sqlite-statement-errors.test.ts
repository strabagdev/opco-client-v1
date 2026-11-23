import type { SQLiteDatabase } from "expo-sqlite";
import { describe, expect, it, vi } from "vitest";
import { getSQLiteStatementErrorDiagnostic, preserveSQLiteStatementErrors } from "./sqlite-statement-errors";

function fixture() {
  const result = Object.freeze({
    changes: 1, lastInsertRowId: 4,
    getFirstAsync: vi.fn().mockResolvedValue({ value: 1 }),
    getAllAsync: vi.fn().mockResolvedValue([{ value: 1 }, { value: 2 }]),
  });
  const statement = {
    executeAsync: vi.fn().mockResolvedValue(result),
    finalizeAsync: vi.fn().mockResolvedValue(undefined),
  };
  const raw = {
    prepareAsync: vi.fn().mockResolvedValue(statement),
    execAsync: vi.fn(), closeAsync: vi.fn(),
    withTransactionAsync: vi.fn(async (task: () => Promise<void>) => task()),
  };
  const db = preserveSQLiteStatementErrors(raw as unknown as SQLiteDatabase);
  return { db, raw, statement, result };
}

describe("SQLite primary error preservation", () => {
  it.each(["runAsync", "getFirstAsync", "getAllAsync"] as const)("keeps execute error and finalize error for %s", async (method) => {
    const f = fixture();
    const primary = new Error("Error code 19: UNIQUE constraint failed: secret_table.secret_column token=PRIVATE");
    const secondary = new Error("Error finalizing statement: PRIVATE_SECONDARY");
    f.statement.executeAsync.mockRejectedValue(primary);
    f.statement.finalizeAsync.mockRejectedValue(secondary);
    await expect(Reflect.apply(f.db[method], f.db, ["SQL_PRIVATE", "VALUE_PRIVATE"])).rejects.toBe(primary);
    expect(f.statement.finalizeAsync).toHaveBeenCalledTimes(1);
    const diagnostic = getSQLiteStatementErrorDiagnostic(primary);
    expect(diagnostic).toEqual({
      primary: { phase: "execute", code: "SQLITE_CONSTRAINT_UNIQUE", sqliteCode: 19 },
      secondary: [{ phase: "finalize", code: "STATEMENT_FINALIZATION_FAILED", sqliteCode: null }],
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(/PRIVATE|secret_|token|SQL_PRIVATE|VALUE_PRIVATE/);
    expect(getSQLiteStatementErrorDiagnostic(secondary)).toBeNull();
  });

  it.each(["getFirstAsync", "getAllAsync"] as const)("keeps a cursor read error before finalize for %s", async (method) => {
    const f = fixture(), primary = new Error("Error code: 1: malformed JSON PRIVATE");
    f.result[method].mockRejectedValue(primary);
    f.statement.finalizeAsync.mockRejectedValue(new Error("Error finalizing statement"));
    await expect(Reflect.apply(f.db[method], f.db, ["query"])).rejects.toBe(primary);
    expect(getSQLiteStatementErrorDiagnostic(primary)).toEqual({
      primary: { phase: "read", code: "SQLITE_ERROR", sqliteCode: 1 },
      secondary: [{ phase: "finalize", code: "STATEMENT_FINALIZATION_FAILED", sqliteCode: null }],
    });
  });

  it("does not hide a finalize failure after a successful execute", async () => {
    const f = fixture(), error = new Error("Error finalizing statement");
    f.statement.finalizeAsync.mockRejectedValue(error);
    await expect(f.db.runAsync("query")).rejects.toBe(error);
    expect(getSQLiteStatementErrorDiagnostic(error)).toEqual({
      primary: { phase: "finalize", code: "STATEMENT_FINALIZATION_FAILED", sqliteCode: null }, secondary: [],
    });
  });

  it("keeps a prepare failure and does not finalize a statement that was not prepared", async () => {
    const f = fixture(), error = new Error("Error code 1: no such table: PRIVATE");
    f.raw.prepareAsync.mockRejectedValue(error);
    await expect(f.db.getAllAsync("query")).rejects.toBe(error);
    expect(f.statement.finalizeAsync).not.toHaveBeenCalled();
    expect(getSQLiteStatementErrorDiagnostic(error)?.primary).toEqual({ phase: "prepare", code: "SQLITE_ERROR", sqliteCode: 1 });
  });

  it.each([undefined, null, "private primitive"])("does not replace a non-object rejection (%s)", async (error) => {
    const f = fixture();
    f.statement.executeAsync.mockRejectedValue(error);
    f.statement.finalizeAsync.mockRejectedValue(new Error("Error finalizing statement"));
    await expect(f.db.runAsync("query")).rejects.toBe(error);
    expect(f.statement.finalizeAsync).toHaveBeenCalledTimes(1);
  });

  it("preserves bind formats and the original SDK result without mutating it", async () => {
    const f = fixture(), array = ["text", 2], named = { $value: 3 };
    expect(await f.db.runAsync("array query", array)).toBe(f.result);
    expect(f.statement.executeAsync).toHaveBeenLastCalledWith(array);
    await f.db.runAsync("named query", named);
    expect(f.statement.executeAsync).toHaveBeenLastCalledWith(named);
    await f.db.runAsync("variadic query", "text", 2, null);
    expect(f.statement.executeAsync).toHaveBeenLastCalledWith("text", 2, null);
    expect(f.statement.finalizeAsync).toHaveBeenCalledTimes(3);
    expect(await f.db.getFirstAsync("read")).toEqual({ value: 1 });
    expect(await f.db.getAllAsync("read")).toEqual([{ value: 1 }, { value: 2 }]);
  });

  it("does not add a transaction, connection or queue and keeps the receiver of other methods", async () => {
    const f = fixture();
    await f.db.withTransactionAsync(async () => { await f.db.runAsync("write"); });
    expect(f.raw.withTransactionAsync).toHaveBeenCalledTimes(1);
    expect(f.raw.execAsync).not.toHaveBeenCalled();
    expect(f.raw.closeAsync).not.toHaveBeenCalled();
    await f.db.closeAsync();
    expect(f.raw.closeAsync.mock.contexts[0]).toBe(f.raw);
  });

  it("returns independent safe summaries, preserving extended codes only when actually reported", async () => {
    const f = fixture(), error = Object.assign(new Error("UNIQUE constraint failed: private"), { sqliteCode: 2067 });
    f.statement.executeAsync.mockRejectedValue(error);
    await expect(f.db.runAsync("query")).rejects.toBe(error);
    const first = getSQLiteStatementErrorDiagnostic(error)!;
    first.primary.sqliteCode = 0;
    expect(getSQLiteStatementErrorDiagnostic(error)?.primary.sqliteCode).toBe(2067);
  });

  it("keeps an injected store without a prepared-statement API unchanged", () => {
    const raw = { runAsync: vi.fn() } as unknown as SQLiteDatabase;
    expect(preserveSQLiteStatementErrors(raw)).toBe(raw);
  });
});

function transactionFixture() {
  const f = fixture();
  f.raw.execAsync.mockResolvedValue(undefined);
  // Exact async transaction sequence of installed expo-sqlite 57.0.1.
  f.raw.withTransactionAsync.mockImplementation(async function (this: SQLiteDatabase, task: () => Promise<void>) {
    try {
      await this.execAsync("BEGIN");
      await task();
      await this.execAsync("COMMIT");
    } catch (error) {
      await this.execAsync("ROLLBACK");
      throw error;
    }
  });
  return f;
}

describe("SQLite transaction primary error preservation", () => {
  it("keeps execution, finalize and rollback failures in order without exposing their contents", async () => {
    const f = transactionFixture(), primary = new Error("Error code 13: PRIVATE_SQL PRIVATE_BIND PRIVATE_TOKEN");
    f.statement.executeAsync.mockRejectedValue(primary);
    f.statement.finalizeAsync.mockRejectedValue(new Error("Error finalizing statement PRIVATE_FINALIZE"));
    f.raw.execAsync.mockImplementation(async source => { if (source === "ROLLBACK") throw new Error("Error code 1: PRIVATE_ROLLBACK"); });
    await expect(f.db.withTransactionAsync(async () => { await f.db.runAsync("PRIVATE_SQL", "PRIVATE_BIND"); })).rejects.toBe(primary);
    expect(f.raw.execAsync.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "ROLLBACK"]);
    expect(f.statement.finalizeAsync).toHaveBeenCalledTimes(1);
    expect(getSQLiteStatementErrorDiagnostic(primary)).toEqual({
      primary: { phase: "execute", code: "SQLITE_FULL", sqliteCode: 13 },
      secondary: [{ phase: "finalize", code: "STATEMENT_FINALIZATION_FAILED", sqliteCode: null }, { phase: "rollback", code: "SQLITE_ERROR", sqliteCode: 1 }],
    });
    expect(JSON.stringify(getSQLiteStatementErrorDiagnostic(primary))).not.toMatch(/PRIVATE|SQL_PRIVATE|BIND|TOKEN/);
    expect(f.raw.execAsync.mock.contexts.every(receiver => receiver === f.raw)).toBe(true);
  });

  it.each(["BEGIN", "COMMIT"])("retains a %s failure when rollback also rejects", async boundary => {
    const f = transactionFixture(), primary = new Error("Error code 13: database or disk is full");
    const task = vi.fn().mockResolvedValue(undefined);
    f.raw.execAsync.mockImplementation(async source => {
      if (source === boundary) throw primary;
      if (source === "ROLLBACK") throw new Error("Error code 1: cannot rollback - no transaction is active");
    });
    await expect(f.db.withTransactionAsync(task)).rejects.toBe(primary);
    expect(task).toHaveBeenCalledTimes(boundary === "BEGIN" ? 0 : 1);
    expect(getSQLiteStatementErrorDiagnostic(primary)).toEqual({
      primary: { phase: boundary.toLowerCase(), code: "SQLITE_FULL", sqliteCode: 13 },
      secondary: [{ phase: "rollback", code: "SQLITE_ERROR", sqliteCode: 1 }],
    });
    expect(f.raw.execAsync.mock.calls.map(([sql]) => sql)).toEqual(boundary === "BEGIN" ? ["BEGIN", "ROLLBACK"] : ["BEGIN", "COMMIT", "ROLLBACK"]);
  });

  it("keeps a body error when rollback succeeds, and never retries the task", async () => {
    const f = transactionFixture(), primary = new DOMException("PRIVATE_QUOTA", "QuotaExceededError");
    const task = vi.fn(async () => { throw primary; });
    await expect(f.db.withTransactionAsync(task)).rejects.toBe(primary);
    expect(task).toHaveBeenCalledTimes(1);
    expect(getSQLiteStatementErrorDiagnostic(primary)).toEqual({ primary: { phase: "transaction", code: "STORAGE_QUOTA_EXCEEDED", sqliteCode: null }, secondary: [] });
    expect(f.raw.execAsync.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "ROLLBACK"]);
  });

  it("keeps a finalize-only failure as primary if rollback rejects", async () => {
    const f = transactionFixture(), primary = new Error("Error finalizing statement PRIVATE");
    f.statement.finalizeAsync.mockRejectedValue(primary);
    f.raw.execAsync.mockImplementation(async source => { if (source === "ROLLBACK") throw new Error("Error code 1: private"); });
    await expect(f.db.withTransactionAsync(async () => { await f.db.runAsync("write"); })).rejects.toBe(primary);
    expect(getSQLiteStatementErrorDiagnostic(primary)).toMatchObject({ primary: { phase: "finalize" }, secondary: [{ phase: "rollback" }] });
  });

  it.each([null, undefined, "private primitive"])("preserves a non-object transaction rejection: %s", async primary => {
    const f = transactionFixture();
    f.raw.execAsync.mockImplementation(async source => { if (source === "ROLLBACK") throw new Error("secondary"); });
    await expect(f.db.withTransactionAsync(async () => { throw primary; })).rejects.toBe(primary);
    expect(getSQLiteStatementErrorDiagnostic(primary)).toBeNull();
  });

  it("leaves SDK methods unchanged and permits the next transaction after a failure", async () => {
    const f = transactionFixture(), primary = new Error("Error code 13: disk full");
    const originalExec = f.raw.execAsync, originalTransaction = f.raw.withTransactionAsync;
    await expect(f.db.withTransactionAsync(async () => { throw primary; })).rejects.toBe(primary);
    await f.db.withTransactionAsync(async () => { await f.db.runAsync("write"); });
    expect(f.raw.execAsync).toBe(originalExec);
    expect(f.raw.withTransactionAsync).toBe(originalTransaction);
    expect(f.raw.execAsync.mock.calls.map(([sql]) => sql)).toEqual(["BEGIN", "ROLLBACK", "BEGIN", "COMMIT"]);
    expect(f.raw.execAsync.mock.contexts.every(receiver => receiver === f.raw)).toBe(true);
    expect(f.raw.withTransactionAsync).toHaveBeenCalledTimes(2);
    expect(f.raw.closeAsync).not.toHaveBeenCalled();
  });

  it("does not hide an SDK rejection outside the observed callback or boundaries", async () => {
    const f = transactionFixture(), primary = new Error("SDK failure PRIVATE");
    f.raw.withTransactionAsync.mockRejectedValueOnce(primary);
    await expect(f.db.withTransactionAsync(async () => undefined)).rejects.toBe(primary);
    expect(getSQLiteStatementErrorDiagnostic(primary)).toEqual({ primary: { phase: "transaction", code: "UNKNOWN", sqliteCode: null }, secondary: [] });
  });
});
