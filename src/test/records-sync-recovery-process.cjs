// Isolated test process: real production store/engine, real SQLite, synthetic HTTP API.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { spawn } = require('node:child_process');
const ts = require('typescript');

const [databasePath, apiUrl, cachePath] = process.argv.slice(2);
let database;
function sqliteFile() {
  const worker = spawn('python3', ['-u', '-c', [
    'import sqlite3,json,sys',
    'c=sqlite3.connect(sys.argv[1], isolation_level=None)',
    'c.row_factory=sqlite3.Row',
    'for line in sys.stdin:',
    ' try:',
    '  q=json.loads(line); sql=q["sql"]; args=q.get("args",[])',
    '  if q["kind"]=="exec":',
    '   if sql.strip() in ("BEGIN","COMMIT","ROLLBACK"): c.execute(sql)',
    '   else: c.executescript(sql)',
    '   result=None',
    '  else:',
    '   cur=c.execute(sql,args)',
    '   result=[dict(r) for r in cur.fetchall()] if q["kind"]=="read" else {"changes":cur.rowcount}',
    '  print(json.dumps({"result":result}))',
    ' except Exception as e: print(json.dumps({"error":str(e)}))',
    'c.close()',
  ].join('\n'), databasePath]);
  let buffer = '';
  const queue = [];
  worker.stdout.on('data', chunk => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const end = buffer.indexOf('\n');
      const reply = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const task = queue.shift();
      if (reply.error) task.reject(new Error(reply.error));
      else task.resolve(reply.result);
    }
  });
  worker.stderr.pipe(process.stderr);
  const query = (kind, sql, args = []) => new Promise((resolve, reject) => {
    queue.push({ resolve, reject });
    worker.stdin.write(JSON.stringify({ kind, sql, args }) + '\n');
  });
  return {
    execAsync: sql => query('exec', sql),
    getAllAsync: (sql, ...args) => query('read', sql, args),
    getFirstAsync: async (sql, ...args) => (await query('read', sql, args))[0] ?? null,
    runAsync: (sql, ...args) => query('write', sql, args),
    withTransactionAsync: async task => {
      await query('exec', 'BEGIN');
      try { await task(); await query('exec', 'COMMIT'); }
      catch (error) { await query('exec', 'ROLLBACK'); throw error; }
    },
    closeAsync: () => new Promise(resolve => { worker.once('exit', resolve); worker.stdin.end(); }),
  };
}

// Only the platform binding is adapted; SQL, migrations, commands and sync are unchanged.
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'expo-sqlite') return { openDatabaseAsync: async () => (database ??= sqliteFile()) };
  return originalLoad.call(this, request, parent, isMain);
};
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const hash = crypto.createHash('sha256').update(source).digest('hex');
  const cached = path.join(cachePath, hash + '.cjs');
  let output;
  if (fs.existsSync(cached)) output = fs.readFileSync(cached, 'utf8');
  else {
    output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    fs.writeFileSync(cached, output);
  }
  module._compile(output, filename);
};

const { getLocalDatabase } = require('../lib/local-db.ts');
const { createOpcoApi } = require('../lib/opco-api.ts');
const { syncPendingRecordsOnce } = require('../sync/records-sync.ts');
const store = getLocalDatabase();
const scope = { ownerKey: 'c01:owner_a', contractId: 'c01_contract', entityTypeId: 'c01_entity' };
const api = createOpcoApi({ apiUrl, platformOS: 'web' });

async function snapshot(ownerKey = scope.ownerKey) {
  await store.getSelectedContractId();
  return {
    count: await store.countPendingOperations(ownerKey),
    selected: await store.listPendingOperations(ownerKey),
    stateSelected: await store.listPendingStateUpdateOperations(ownerKey),
    operations: await database.getAllAsync('SELECT * FROM pending_operations WHERE owner_key = ? ORDER BY id', ownerKey),
    records: await database.getAllAsync('SELECT * FROM entity_records WHERE owner_key = ? ORDER BY local_id', ownerKey),
  };
}
async function seedMatrix() {
  await store.getSelectedContractId();
  for (const [id, owner, contract, operation, status] of [
    ['create_a', scope.ownerKey, scope.contractId, 'CREATE', 'syncing'],
    ['update_a', scope.ownerKey, 'c01_contract_2', 'UPDATE', 'syncing'],
    ['create_b', 'c01:owner_b', scope.contractId, 'CREATE', 'syncing'],
    ['failed', scope.ownerKey, scope.contractId, 'CREATE', 'failed'],
    ['conflict', scope.ownerKey, scope.contractId, 'UPDATE', 'conflict'],
    ['state_sync', 'c01:state_owner', scope.contractId, 'STATE_UPDATE', 'syncing'],
    ['state_pending', 'c01:state_owner', scope.contractId, 'STATE_UPDATE', 'pending_update'],
  ]) {
    await database.runAsync('INSERT INTO entity_records (local_id,owner_key,contract_id,entity_type_id,display_name,values_json,cached_at,sync_status) VALUES (?,?,?,?,?,?,?,?)', id, owner, contract, scope.entityTypeId, id, '{}', '2026-11-22T00:00:00.000Z', status);
    await database.runAsync('INSERT INTO pending_operations (id,owner_key,contract_id,entity_type_id,local_record_id,operation,payload_json,client_request_id,created_at,updated_at,attempts) VALUES (?,?,?,?,?,?,?,?,?,?,0)', id, owner, contract, scope.entityTypeId, id, operation, '{"values":{}}', id, '2026-11-22T00:00:00.000Z', '2026-11-22T00:00:00.000Z');
  }
  return snapshot();
}
process.on('message', async ({ id, method, input }) => {
  try {
    let value;
    if (method === 'seed') {
      if (input === 'CREATE') await store.createLocalRecord({ ...scope, localId: 'c01_local', clientRequestId: 'c01_create_request', values: { codigo: 'C01-SYNTHETIC', ubicacion: 'Destino' } });
      else {
        await store.upsertRemoteRecords({ ...scope, cachedAt: '2026-11-22T01:00:00.000Z', records: [{ id: 'c01_server', displayName: 'Origen', updatedAt: '2026-11-22T01:00:00.000Z', values: { ubicacion: 'Origen' } }] });
        await store.updateLocalRecord({ ...scope, recordId: 'c01_server', values: { ubicacion: 'Destino' } });
      }
      value = await snapshot();
    } else if (method === 'read') value = await snapshot(input);
    else if (method === 'matrix') value = await seedMatrix();
    else if (method === 'markOnly') {
      const [operation] = await store.listPendingOperations(scope.ownerKey);
      await store.markPendingOperationSyncing(operation.id);
      value = await snapshot();
    } else if (method === 'sync') value = await syncPendingRecordsOnce({ api, ownerKey: scope.ownerKey, store, token: 'isolated-c01-token' });
    else throw new Error('Unknown isolated fixture command');
    process.send({ id, value });
  } catch (error) { process.send({ id, error: error.stack ?? String(error) }); }
});
process.send({ ready: true });
