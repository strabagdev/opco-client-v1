// Real process termination + SQLite; the HTTP server below models Core's idempotency contract.
// @ts-expect-error Node types are intentionally absent from Expo's application tsconfig.
import { fork } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from Expo's application tsconfig.
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
// @ts-expect-error Node types are intentionally absent from Expo's application tsconfig.
import { createServer } from "node:http";
// @ts-expect-error Node types are intentionally absent from Expo's application tsconfig.
import process from "node:process";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PendingOperation, RecordUpdateCommand } from "../lib/offline-records";

type Snapshot = {
  count: number;
  selected: PendingOperation[];
  stateSelected: PendingOperation[];
  operations: { id: string; client_request_id: string; payload_json: string; local_record_id: string; attempts: number }[];
  records: { local_id: string; server_id: string | null; sync_status: string; values_json: string; remote_updated_at: string | null }[];
};
type Command = { clientRequestId: string; expectedUpdatedAt?: string; values: Record<string, unknown> };
type RemoteRecord = { id: string; displayName: string; updatedAt: string; values: Record<string, unknown> };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

let directory: string;
let caseDirectory: string;
let cache: string;
let server: ReturnType<typeof createServer>;
let apiUrl: string;
let hold: "before-commit" | "after-commit" | null;
let held: { response: { end(value: string): void }; body: string }[];
let arrived: ReturnType<typeof deferred<Command>>;
let remote: RemoteRecord | null;
let writes: number;
let requests: Command[];
let ledger: Map<string, { command: string; response: RemoteRecord }>;
const runtimes = new Set<Runtime>();

class Runtime {
  private sequence = 0;
  private tasks = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private child: ReturnType<typeof fork>;
  private stderr = "";
  readonly ready: Promise<void>;
  readonly exited: Promise<unknown>;

  constructor() {
    const ready = deferred<void>();
    this.ready = ready.promise;
    this.child = fork("src/test/records-sync-recovery-process.cjs", [caseDirectory + "/local.sqlite", apiUrl, cache], { execArgv: [], silent: true, detached: true });
    this.exited = new Promise(resolve => this.child.once("exit", (code: number | null, signal: string | null) => {
      ready.resolve();
      for (const task of this.tasks.values()) task.reject(new Error("Isolated runtime stopped: " + signal + " " + this.stderr));
      this.tasks.clear();
      resolve({ code, signal });
    }));
    this.child.stderr.on("data", (chunk: string) => { this.stderr += chunk; });
    this.child.on("message", (message: { ready?: boolean; id: number; value: unknown; error?: string }) => {
      if (message.ready) { ready.resolve(); return; }
      const task = this.tasks.get(message.id);
      this.tasks.delete(message.id);
      if (message.error) task?.reject(new Error(message.error));
      else task?.resolve(message.value);
    });
    runtimes.add(this);
  }

  async call<T = Snapshot>(method: string, input?: unknown): Promise<T> {
    await this.ready;
    return new Promise<T>((resolve, reject) => {
      const id = ++this.sequence;
      this.tasks.set(id, { resolve: value => resolve(value as T), reject });
      this.child.send({ id, method, input });
    });
  }

  async crash() {
    if (this.child.exitCode === null && this.child.signalCode === null) process.kill(-this.child.pid, "SIGKILL");
    await this.exited;
    runtimes.delete(this);
  }
}

function listenFixtureServer(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      server.removeListener("error", onError);
      server.removeListener("listening", onListening);
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onListening = () => { cleanup(); resolve(); };
    server.once("error", onError);
    try { server.listen(0, "127.0.0.1", onListening); }
    catch (error) { cleanup(); reject(error); }
  });
}

beforeAll(async () => {
  directory = mkdtempSync("/tmp/opco-c01-tests-");
  cache = directory + "/compiled";
  mkdirSync(cache);
  server = createServer(async (req: { method: string; on(event: string, callback: (value?: string) => void): void }, res: { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }) => {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: { record: remote } }));
      return;
    }
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      const command = JSON.parse(body) as Command;
      requests.push(command);
      const replay = ledger.get(command.clientRequestId);
      if (replay && replay.command !== body) throw new Error("Idempotency key changed content");
      if (!replay && hold !== "before-commit") {
        remote = { id: "c01_server", displayName: "Destino", updatedAt: "2026-11-22T02:00:00.000Z", values: command.values };
        writes++;
        ledger.set(command.clientRequestId, { command: body, response: remote });
      }
      const responseBody = JSON.stringify({ ok: true, data: { record: replay?.response ?? remote } });
      res.writeHead(200, { "Content-Type": "application/json" });
      if (hold) held.push({ response: res, body: responseBody });
      else res.end(responseBody);
      arrived.resolve(command);
    });
  });
  await listenFixtureServer(server);
  apiUrl = "http://127.0.0.1:" + server.address().port + "/api/v1";
});

beforeEach(() => {
  caseDirectory = mkdtempSync(directory + "/case-");
  remote = null;
  writes = 0;
  requests = [];
  ledger = new Map();
  hold = null;
  held = [];
  arrived = deferred<Command>();
});

afterEach(async () => {
  for (const runtime of [...runtimes]) await runtime.crash();
  server.closeAllConnections();
});
afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(resolve));
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe("C-01 RECORDS durable syncing recovery", () => {
  it.each(["CREATE", "UPDATE"] as const)("recovers %s after SIGKILL before the remote commit", async operation => {
    await crashAndResume(operation, "before-commit");
  });

  it.each(["CREATE", "UPDATE"] as const)("replays %s after the remote commit and lost response without a second write", async operation => {
    await crashAndResume(operation, "after-commit");
  });

  it.each(["CREATE", "UPDATE"] as const)("keeps an active %s single-flight; selection does not reset or resend it", async operation => {
    const runtime = new Runtime();
    await seed(runtime, operation);
    hold = "after-commit";
    const sending = runtime.call("sync");
    void sending.catch(() => undefined);
    await arrived.promise;
    const active = await runtime.call("read");
    expect(active.count).toBe(1);
    expect(active.selected).toHaveLength(1);
    expect(active.records[0].sync_status).toBe("syncing");
    const second = runtime.call("sync");
    const third = runtime.call("sync");
    void second.catch(() => undefined);
    void third.catch(() => undefined);
    // IPC read is processed after the extra sync triggers, without a timing sleep.
    const stillActive = await runtime.call("read");
    expect(stillActive.records[0].sync_status).toBe("syncing");
    expect(stillActive.operations[0].attempts).toBe(1);
    expect(requests).toHaveLength(1);
    hold = null;
    for (const response of held) response.response.end(response.body);
    await Promise.all([sending, second, third]);
    expect(requests).toHaveLength(1);
    expect(writes).toBe(1);
    expect((await runtime.call("read")).operations).toHaveLength(0);
  });

  it("isolates owners and preserves STATE_UPDATE selection/count behavior and failed/conflict exclusion", async () => {
    const runtime = new Runtime();
    const first = await runtime.call("matrix");
    expect(first.selected.map(operation => operation.id).sort()).toEqual(["create_a", "update_a"]);
    expect(first.count).toBe(2);
    const other = await runtime.call("read", "c01:owner_b");
    expect(other.selected.map(operation => operation.id)).toEqual(["create_b"]);
    expect(other.count).toBe(1);
    const state = await runtime.call("read", "c01:state_owner");
    expect(state.selected).toHaveLength(0);
    expect(state.stateSelected.map(operation => operation.id).sort()).toEqual(["state_pending", "state_sync"]);
    expect(state.count).toBe(1); // Preserve legacy STATE_UPDATE counting: pending yes, syncing no.
    expect(requests).toHaveLength(0);
  });

  it("recovers the window between mark-syncing and PATCH preparation without inventing a command", async () => {
    let runtime = new Runtime();
    await seed(runtime, "UPDATE");
    const marked = await runtime.call("markOnly");
    expect(JSON.parse(marked.operations[0].payload_json).sentCommand).toBeUndefined();
    await runtime.crash();
    runtime = new Runtime();
    const reopened = await runtime.call("read");
    expect(reopened.count).toBe(1);
    expect(reopened.operations[0].payload_json).toBe(marked.operations[0].payload_json);
    await runtime.call("sync");
    expect(writes).toBe(1);
    expect((await runtime.call("read")).records[0].sync_status).toBe("synced");
  });
});

async function seed(runtime: Runtime, operation: "CREATE" | "UPDATE") {
  if (operation === "UPDATE") remote = { id: "c01_server", displayName: "Origen", updatedAt: "2026-11-22T01:00:00.000Z", values: { ubicacion: "Origen" } };
  return runtime.call("seed", operation);
}

async function crashAndResume(operation: "CREATE" | "UPDATE", phase: "before-commit" | "after-commit") {
  let runtime = new Runtime();
  const initial = await seed(runtime, operation);
  hold = phase;
  const interrupted = runtime.call("sync");
  void interrupted.catch(() => undefined); // Expected: the actual process is killed, no retry handler runs.
  const sent = await arrived.promise;
  const duringSend = await runtime.call("read");
  expect(duringSend.records[0].sync_status).toBe("syncing");
  expect(duringSend.operations[0].id).toBe(initial.operations[0].id);
  const command = JSON.parse(duringSend.operations[0].payload_json).sentCommand as RecordUpdateCommand | undefined;
  if (operation === "UPDATE") {
    expect(command).toMatchObject(sent);
    expect(command?.intentId).toBe(command?.clientRequestId);
  }
  await runtime.crash();
  expect(await runtime.exited).toEqual({ code: null, signal: "SIGKILL" });
  hold = null;
  runtime = new Runtime();
  const reopened = await runtime.call("read");
  expect(reopened.operations).toEqual(duringSend.operations);
  expect(reopened.records).toEqual(duringSend.records);
  expect(reopened.count).toBe(1);
  expect(reopened.selected).toHaveLength(1);
  await runtime.call("sync");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(sent);
  expect(writes).toBe(1);
  expect(ledger.size).toBe(1);
  const completed = await runtime.call("read");
  expect(completed.operations).toHaveLength(0);
  expect(completed.records).toHaveLength(1);
  expect(completed.records[0]).toMatchObject({ local_id: initial.records[0].local_id, server_id: "c01_server", sync_status: "synced" });
  expect(completed.count).toBe(0);
}
