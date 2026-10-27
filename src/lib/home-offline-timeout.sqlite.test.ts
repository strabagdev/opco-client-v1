// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { spawn } from "node:child_process";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppViewsUnavailableError, loadAppViewsWithCache } from "./app-navigation-cache";
import { prewarmAssignedAppViewsOnce } from "./app-view-prewarm";
import { getHomeNavigationEvents, homeNavigationRows, recordHomeNavigationTransport } from "./home-navigation-diagnostics";
import { getHomeExperienceCards, getHomeExperienceSections } from "./home-experiences";
import { __resetLocalDatabaseForTests, getLocalDatabase, getLocalDatabaseStorageState } from "./local-db";
import { createOpcoApi, DEFAULT_REQUEST_TIMEOUT_MS, OpcoNetworkError, type AppView, type OpcoNetworkDiagnostics } from "./opco-api";
import { restoreSession } from "./session-logic";
import { isStateUpdateDiagnosticPath } from "./state-update-offline";

const sqlite = vi.hoisted(() => ({ openDatabaseAsync: vi.fn() }));
vi.mock("expo-sqlite", () => sqlite);

const ownerKey = "synthetic-organization:synthetic-user";
const contractId = "synthetic-contract";
const token = "synthetic-token";
const syncedAt = "2026-10-26T18:00:00.000Z";
const views: AppView[] = [{ id: "synthetic-view", name: "Experiencia sintética", slug: "synthetic-view", type: "PANEL", icon: null, sortOrder: 0, config: {} }];
const me = { app: { id: "synthetic-app", clientId: "synthetic-client", name: "Synthetic", slug: "synthetic" }, user: { id: "synthetic-user", email: "synthetic@example.invalid", name: null } };
const context = { organization: { id: "synthetic-organization", name: "Synthetic" }, contracts: [{ id: contractId, name: "Synthetic", role: "ADMIN" as const }] };

// Same Python sqlite3 bridge as existing SQLite integrations; SQL, migrations and
// navigation/cache functions are real. This does not execute Expo WASM or Safari.
function sqliteFile(path: string) {
  const worker = spawn("python3", ["-u", "-c", `
import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1], isolation_level=None)
c.row_factory=sqlite3.Row
for line in sys.stdin:
 try:
  q=json.loads(line); sql=q['sql']; args=q.get('args',[])
  if q['kind']=='exec':
   if sql.strip() in ('BEGIN','COMMIT','ROLLBACK'): c.execute(sql)
   else: c.executescript(sql)
   result=None
  else:
   cur=c.execute(sql,args)
   result=[dict(r) for r in cur.fetchall()] if q['kind']=='read' else {'changes':cur.rowcount}
  print(json.dumps({'result':result}))
 except Exception as e: print(json.dumps({'error':str(e)}))
c.close()
`, path]);
  const queue: { resolve(value: unknown): void; reject(error: Error): void }[] = [];
  let buffer = "";
  worker.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      const reply = JSON.parse(buffer.slice(0, end)) as { result: unknown; error?: string };
      buffer = buffer.slice(end + 1);
      const task = queue.shift()!;
      if (reply.error) task.reject(new Error(reply.error));
      else task.resolve(reply.result);
    }
  });
  const exit = new Promise<void>((resolve, reject) => {
    worker.on("exit", (code: number) => code === 0 ? resolve() : reject(new Error(`sqlite test worker exit ${code}`)));
    worker.on("error", reject);
  });
  const query = (kind: string, sql: string, args: unknown[] = []) => new Promise<unknown>((resolve, reject) => {
    queue.push({ resolve, reject });
    worker.stdin.write(JSON.stringify({ kind, sql, args }) + "\n");
  });
  let closing = false;
  return {
    execAsync: (sql: string) => query("exec", sql),
    getAllAsync: (sql: string, ...args: unknown[]) => query("read", sql, args),
    getFirstAsync: async (sql: string, ...args: unknown[]) => (await query("read", sql, args) as Record<string, unknown>[])[0] ?? null,
    runAsync: (sql: string, ...args: unknown[]) => query("write", sql, args),
    closeAsync: () => {
      if (!closing) { closing = true; worker.stdin.end(); }
      return exit;
    },
  };
}

let directory: string;
let db: ReturnType<typeof sqliteFile>;
let store: ReturnType<typeof getLocalDatabase>;
let pageListeners: Map<string, () => void>;

async function open() {
  __resetLocalDatabaseForTests();
  pageListeners = new Map();
  vi.stubGlobal("window", { addEventListener: (name: string, listener: () => void) => pageListeners.set(name, listener) });
  db = sqliteFile(directory + "/opco-client-v10-epoch2.db");
  sqlite.openDatabaseAsync.mockResolvedValue(db);
  store = getLocalDatabase();
  await store.getSelectedContractId();
}

async function reopen() {
  // Exercise the runtime's pagehide close handler, then a new singleton over the
  // same file. Only this test's temporary storage is used or removed.
  expect(pageListeners.has("pagehide")).toBe(true);
  pageListeners.get("pagehide")!();
  await db.closeAsync();
  await open();
}

async function prepareDefinitions() {
  await store.upsertContextSnapshot(ownerKey, me, context, syncedAt);
  await store.upsertAppViewDefinition({ ownerKey, contractId, appViewId: views[0].id, appViewType: "PANEL", definition: { kind: "unsupported", appView: views[0] }, lastPreparedAt: syncedAt, status: "ready" });
}

function timedOutTransport() {
  const diagnostics: OpcoNetworkDiagnostics[] = [];
  const fetcher = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(Object.assign(new Error("synthetic transport abort"), { name: "AbortError" })), { once: true });
  }));
  const api = createOpcoApi({ apiUrl: "https://opco.example.invalid", fetcher, platformOS: "web", onRequestDiagnostics: event => { diagnostics.push(event); recordHomeNavigationTransport(event); } });
  return { api, fetcher, diagnostics };
}

async function failRead(cache = store, scope = { ownerKey, contractId }, expectedStatus: "absent" | "error" = "absent") {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const transport = timedOutTransport();
  const onCached = vi.fn();
  const result = loadAppViewsWithCache({ api: transport.api, cache, ...scope, token, onCached }).catch(error => error);
  // Queue a read behind the navigation read so cache state has settled before
  // advancing the real API timeout virtually (production remains 12 seconds).
  await store.getAppViews(ownerKey, contractId);
  await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
  const error = await result;
  expect(error).toBeInstanceOf(AppViewsUnavailableError);
  expect(error.cacheRead.status).toBe(expectedStatus);
  expect(error.remoteCause).toBeInstanceOf(OpcoNetworkError);
  expect(error.remoteCause.message).toBe("La solicitud a Opco agoto el tiempo de espera.");
  expect(error.message).toContain(expectedStatus === "error" ? "No se pudo leer la lista" : "No hay una lista");
  expect(onCached).not.toHaveBeenCalled();
  expect(transport.fetcher).toHaveBeenCalledOnce();
  expect(transport.diagnostics[0]).toMatchObject({ pathTemplate: "/api/v1/contracts/:contractId/views", timeoutMs: 12_000, abortControllerTriggered: true, responseStarted: false, operationResult: "transport_timeout" });
  return { error, transport };
}

beforeEach(async () => {
  directory = mkdtempSync("/tmp/opco-home-timeout-sqlite-");
  await open();
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db.closeAsync();
  __resetLocalDatabaseForTests();
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});

describe("Home offline navigation and timed-out transport after SQLite reopen", () => {
  it("presents assigned cache before the timeout and returns it after the timeout", async () => {
    await prepareDefinitions();
    const online = createOpcoApi({ apiUrl: "https://opco.example.invalid", fetcher: async () => new Response(JSON.stringify({ ok: true, data: { views } })) });
    await loadAppViewsWithCache({ api: online, cache: store, ownerKey, contractId, token });
    expect((await store.getAppViews(ownerKey, contractId))?.views).toEqual(views);
    await reopen();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const transport = timedOutTransport();
    let cachedReady!: () => void;
    const early = new Promise<void>(resolve => { cachedReady = resolve; });
    const onCached = vi.fn(cachedReady);
    const result = loadAppViewsWithCache({ api: transport.api, cache: store, ownerKey, contractId, token, onCached });
    await early;
    expect(onCached).toHaveBeenCalledWith(expect.objectContaining({ views }));
    expect(transport.diagnostics).toEqual([]);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(await result).toMatchObject({ offline: true, fromCache: true, views });
    expect(getHomeExperienceSections(getHomeExperienceCards((await result).views, {}))[0].cards[0].appView.id).toBe(views[0].id);
    expect(transport.fetcher).toHaveBeenCalledOnce();
    expect(transport.diagnostics[0].operationResult).toBe("transport_timeout");
    expect(getLocalDatabaseStorageState().status).toBe("ready");
    expect(await store.countPendingOperations(ownerKey)).toBe(0);
  });

  it("explains absent navigation cache while preserving the timeout cause", async () => {
    await reopen();
    await failRead();
    expect(getLocalDatabaseStorageState().status).toBe("ready");
  });

  it("restores session and definition cache but cannot reconstruct assignments from definitions alone", async () => {
    await prepareDefinitions();
    await reopen();
    expect(await store.getAppViewDefinition(ownerKey, contractId, views[0].id)).not.toBeNull();
    const restored = await restoreSession({ getAccessToken: async () => token, getSessionOwnerKey: async () => ownerKey, clearSession: vi.fn() }, { getMe: async () => { throw new OpcoNetworkError(); } }, store);
    expect(restored).toMatchObject({ status: "offline", snapshot: { ownerKey, context } });
    expect(await store.getAppViews(ownerKey, contractId)).toBeNull();
    await failRead();
  });

  it.each([{ ownerKey: "other-owner", contractId }, { ownerKey, contractId: "other-contract" }])("never borrows assigned views from a different scope: %j", async scope => {
    await store.upsertAppViews(ownerKey, contractId, views, syncedAt);
    await reopen();
    await failRead(store, scope);
    expect((await store.getAppViews(ownerKey, contractId))?.views).toEqual(views);
  });

  it("distinguishes a failed cache read and preserves the cached list and remote cause", async () => {
    await store.upsertAppViews(ownerKey, contractId, views, syncedAt);
    await reopen();
    const read = vi.spyOn(store, "getAppViews").mockRejectedValueOnce(new Error("synthetic cache read failure"));
    await failRead(store, { ownerKey, contractId }, "error");
    expect(read).toHaveBeenCalled();
    expect((await store.getAppViews(ownerKey, contractId))?.views).toEqual(views);
  });

  it("exposes persistence failure and never certifies preparation, even with prepared definitions", async () => {
    await prepareDefinitions();
    const write = vi.spyOn(store, "upsertAppViews").mockRejectedValueOnce(new Error("synthetic cache write failure"));
    const api = createOpcoApi({ apiUrl: "https://opco.example.invalid", fetcher: async () => new Response(JSON.stringify({ ok: true, data: { views } })) });
    const onCacheWrite = vi.fn();
    const result = await loadAppViewsWithCache({ api, cache: store, ownerKey, contractId, token, onCacheWrite });
    expect(result).toMatchObject({ offline: false, views });
    expect(await result.cacheWrite).toMatchObject({ status: "error", errorCode: "HOME_CACHE_WRITE_FAILED" });
    expect(onCacheWrite).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
    const preparationApi = { getEntityDefinition: vi.fn(), getEntityRecords: vi.fn(), getAttendanceWorkflow: vi.fn(), getStateUpdateWorkflow: vi.fn() };
    await prewarmAssignedAppViewsOnce({ api: preparationApi, appViews: views, ownerKey, contractId, token, store, homeListWrite: result.cacheWrite! });
    const preparation = await store.getOfflinePreparationDiagnostics(ownerKey);
    expect(preparation).toMatchObject({ status: "failed", homeList: { status: "error", errorCode: "HOME_CACHE_WRITE_FAILED" } });
    expect(preparationApi.getEntityDefinition).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledOnce();
    await reopen();
    expect(await store.getAppViewDefinition(ownerKey, contractId, views[0].id)).not.toBeNull();
    await failRead();
    expect((await store.getOfflinePreparationDiagnostics(ownerKey))?.status).toBe("failed");
    vi.useRealTimers();
    const retry = await loadAppViewsWithCache({ api, cache: store, ownerKey, contractId, token });
    await prewarmAssignedAppViewsOnce({ api: preparationApi, appViews: retry.views, ownerKey, contractId, token, store, homeListWrite: retry.cacheWrite! });
    expect(await store.getOfflinePreparationDiagnostics(ownerKey)).toMatchObject({ status: "completed", homeList: { status: "persisted" } });
    await reopen();
    expect((await store.getAppViews(ownerKey, contractId))?.views).toEqual(views);
  });

  it("correlates safe read/write/transport metadata without exposing scope IDs or labels", async () => {
    await store.upsertAppViews(ownerKey, contractId, views, syncedAt);
    await reopen();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const transport = timedOutTransport();
    const pending = loadAppViewsWithCache({ api: transport.api, cache: store, ownerKey, contractId, token });
    await store.getAppViews(ownerKey, contractId);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    expect((await pending).views).toEqual(views);
    const requestId = transport.diagnostics[0].diagnosticRequestId;
    const events = getHomeNavigationEvents().filter(event => event.requestId === requestId);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: "cache_read", result: "valid", count: 1, syncedAt }),
      expect.objectContaining({ phase: "remote", result: "error", errorCode: "REMOTE_TIMEOUT", timeoutMs: 12000 }),
    ]));
    const text = JSON.stringify(homeNavigationRows(events, ownerKey, contractId));
    for (const privateValue of [ownerKey, contractId, token, views[0].name, views[0].id]) expect(text).not.toContain(privateValue);
    expect(homeNavigationRows(events, "another-owner", contractId)).toEqual([["Inicio", "Sin lectura registrada en este runtime para el scope activo"]]);
  });

  it("preserves an authoritative empty assignment list instead of calling it missing cache", async () => {
    await store.upsertAppViews(ownerKey, contractId, [], syncedAt);
    await reopen();
    const api = { getAppViews: async () => { throw new OpcoNetworkError(); } };
    expect(await loadAppViewsWithCache({ api, cache: store, ownerKey, contractId, token })).toMatchObject({ offline: true, fromCache: true, views: [] });
  });

  it("does not retain the views request in the existing STATE_UPDATE request history", () => {
    expect(isStateUpdateDiagnosticPath("/api/v1/contracts/:contractId/views")).toBe(false);
    expect(isStateUpdateDiagnosticPath("/api/v1/me")).toBe(false);
    expect(isStateUpdateDiagnosticPath("/api/v1/context")).toBe(false);
  });
});
