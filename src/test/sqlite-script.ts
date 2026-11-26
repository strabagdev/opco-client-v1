// Python's executescript commits a pending transaction before running the script.
// Expo execAsync does not. Let SQLite identify complete statements (including
// quoted semicolons and trigger bodies), then execute them without an extra COMMIT.
export const PYTHON_SQLITE_SCRIPT_EXECUTOR = `
def exec_sqlite_script(sql):
 pending=''
 for char in sql:
  pending+=char
  if char==';' and sqlite3.complete_statement(pending):
   c.execute(pending)
   pending=''
 if pending.strip(): c.execute(pending)
`;
