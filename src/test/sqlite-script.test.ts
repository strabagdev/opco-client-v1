// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";
import { PYTHON_SQLITE_SCRIPT_EXECUTOR } from "./sqlite-script";

it("executes compound SQL without committing its caller's transaction, including trigger bodies", () => {
  const result = execFileSync("python3", ["-c", `
import sqlite3,json
c=sqlite3.connect(':memory:',isolation_level=None)
${PYTHON_SQLITE_SCRIPT_EXECUTOR}
exec_sqlite_script('CREATE TABLE source(id INTEGER); CREATE TABLE witness(value TEXT);')
c.execute('BEGIN')
exec_sqlite_script("CREATE TRIGGER inserted AFTER INSERT ON source BEGIN INSERT INTO witness VALUES ('a;b'); INSERT INTO witness VALUES ('two'); END; INSERT INTO source VALUES (1);")
inside=c.execute('SELECT value FROM witness ORDER BY rowid').fetchall()
active=c.in_transaction
c.execute('ROLLBACK')
print(json.dumps({'inside':inside,'transactionStillActive':active,'rows':c.execute('SELECT count(*) FROM source').fetchone()[0],'trigger':c.execute(\"SELECT count(*) FROM sqlite_master WHERE type='trigger'\").fetchone()[0]}))
`], { encoding: "utf8" });
  expect(JSON.parse(result)).toEqual({ inside: [["a;b"], ["two"]], transactionStillActive: true, rows: 0, trigger: 0 });
});
