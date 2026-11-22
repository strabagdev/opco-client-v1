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
    expect(f.raw.withTransactionAsync.mock.contexts[0]).toBe(f.raw);
    expect(f.raw.execAsync).not.toHaveBeenCalled();
    expect(f.raw.closeAsync).not.toHaveBeenCalled();
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
