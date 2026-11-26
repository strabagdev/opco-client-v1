import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetLocalDatabaseForTests,
  closeLocalDatabase,
  getLocalDatabase,
  getLocalDatabaseStorageState,
  retryLocalDatabaseInitialization,
} from "../lib/local-db";
import { getLocalDatabaseRecoveryGuidance } from "./local-database-recovery-logic";
import { useLocalDatabaseRecovery } from "./use-local-database-recovery";

const sqlite = vi.hoisted(() => ({ openDatabaseAsync: vi.fn(), deleteDatabaseAsync: vi.fn() }));
const effects = vi.hoisted(() => [] as (() => void | (() => void))[]);
vi.mock("expo-sqlite", () => sqlite);
vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [typeof value === "function" ? value() : value, vi.fn()],
}));

const busy = () => new Error("createSyncAccessHandle failed because another open Access Handle exists");
const db = {
  withTransactionAsync: vi.fn(async (task: () => Promise<void>) => task()),
  closeAsync: vi.fn(async () => undefined),
  execAsync: vi.fn(async () => undefined),
  getAllAsync: vi.fn(async () => []),
  getFirstAsync: vi.fn(async () => null),
  runAsync: vi.fn(async () => undefined),
};
let reload: ReturnType<typeof vi.fn>;
let listeners: Map<string, (event: { persisted: boolean }) => void>;

function RecoveryHarness() {
  const input = {
    connectivityStatus: "offline",
    emptyRecordsSyncSummary: { conflictCount: 0, failedCount: 0, pendingCount: 0, syncingCount: 0 },
    setBootstrapAttempt: vi.fn(),
    setContext: vi.fn(),
    setMe: vi.fn(),
    setPendingRecordsCount: vi.fn(),
    setRecordsReconnectRefreshKey: vi.fn(),
    setRecordsSyncSummary: vi.fn(),
    setSelectedContractIdState: vi.fn(),
    setStatus: vi.fn(),
  };
  return { input, ...useLocalDatabaseRecovery(input) };
}

beforeEach(() => {
  __resetLocalDatabaseForTests();
  vi.clearAllMocks();
  effects.length = 0;
  sqlite.openDatabaseAsync.mockReset().mockResolvedValue(db);
  for (const method of Object.values(db)) method.mockClear();
  reload = vi.fn();
  listeners = new Map();
  vi.stubGlobal("window", {
    addEventListener: (name: string, callback: (event: { persisted: boolean }) => void) => listeners.set(name, callback),
    location: { reload },
  });
});
afterEach(() => { __resetLocalDatabaseForTests(); vi.unstubAllGlobals(); });

describe("explicit retry of an OPFS-blocked initial opening", () => {
  it("reloads explicitly once after an indeterminate close, without probing, resetting or reopening", async () => {
    await getLocalDatabase().getSelectedContractId();
    db.closeAsync.mockRejectedValueOnce(new Error("synthetic close outcome"));
    await expect(closeLocalDatabase()).rejects.toThrow("synthetic close outcome");
    const worker = vi.fn();
    vi.stubGlobal("Worker", worker);
    Object.assign(window, { Worker: worker });
    const recovery = RecoveryHarness();
    const cleanup = effects.map(effect => effect());
    const guidance = getLocalDatabaseRecoveryGuidance(recovery.localDatabaseStorageState);
    expect(guidance.reloadOnRetry).toBe(true);
    expect(guidance.canRequestDestructiveReset).toBe(false);
    expect(guidance.body).toContain("misma base");
    expect(guidance.body).not.toContain("Otra pestaña");
    expect(worker).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    await Promise.all(Array.from({ length: 20 }, () => recovery.retryLocalStorage()));
    expect(reload).toHaveBeenCalledOnce();
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledOnce();
    expect(sqlite.deleteDatabaseAsync).not.toHaveBeenCalled();
    expect(recovery.input.setBootstrapAttempt).not.toHaveBeenCalled();
    for (const dispose of cleanup) dispose?.();
  });

  it("does not reload for a close failure until its warning was presented and retries a refused reload only on click", async () => {
    await getLocalDatabase().getSelectedContractId();
    const stale = RecoveryHarness();
    db.closeAsync.mockRejectedValueOnce(new Error("synthetic close outcome"));
    await expect(closeLocalDatabase()).rejects.toThrow();
    await stale.retryLocalStorage();
    expect(reload).not.toHaveBeenCalled();
    const current = RecoveryHarness();
    reload.mockImplementationOnce(() => { throw new Error("synthetic reload refused"); });
    await expect(current.retryLocalStorage()).rejects.toThrow("synthetic reload refused");
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledOnce();
    await current.retryLocalStorage();
    expect(reload).toHaveBeenCalledTimes(2);
    expect(sqlite.deleteDatabaseAsync).not.toHaveBeenCalled();
  });

  it("does not invent a reload API on native after a close failure", async () => {
    vi.unstubAllGlobals();
    await getLocalDatabase().getSelectedContractId();
    db.closeAsync.mockRejectedValueOnce(new Error("synthetic native close outcome"));
    await expect(closeLocalDatabase()).rejects.toThrow();
    const guidance = getLocalDatabaseRecoveryGuidance(getLocalDatabaseStorageState());
    expect(guidance.reloadOnRetry).toBe(false);
    expect(guidance.canRequestDestructiveReset).toBe(false);
    expect(guidance.body).toContain("vuelve a abrir la aplicación");
    await expect(retryLocalDatabaseInitialization()).rejects.toMatchObject({ causeCode: "CLOSE_FAILED" });
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledOnce();
  });

  it("ignores a late initial-opening probe after the runtime becomes quarantined by a close failure", async () => {
    let probe: { onmessage?: (event: { data: string }) => void } = {};
    const postMessage = vi.fn(), terminate = vi.fn();
    vi.stubGlobal("Worker", class {
      constructor() { probe = this; }
      onmessage?: (event: { data: string }) => void;
      postMessage = postMessage;
      terminate = terminate;
    });
    const saved = new Map();
    Object.assign(window, { Worker, location: { reload, href: "https://local.example/" }, sessionStorage: {
      getItem: (key: string) => saved.get(key), setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key),
    } });
    sqlite.openDatabaseAsync.mockRejectedValueOnce(busy());
    await expect(getLocalDatabase().getSelectedContractId()).rejects.toThrow();
    RecoveryHarness();
    const cleanup = effects.map(effect => effect());
    try {
      expect(postMessage).toHaveBeenCalledOnce();
      await retryLocalDatabaseInitialization();
      db.closeAsync.mockRejectedValueOnce(new Error("synthetic close failure"));
      await expect(closeLocalDatabase()).rejects.toThrow();
      probe.onmessage!({ data: "free" });
      expect(reload).not.toHaveBeenCalled();
      expect(getLocalDatabaseStorageState()).toMatchObject({ cause: "CLOSE_FAILED", retryRequiresReload: true });
    } finally { for (const dispose of cleanup) dispose?.(); }
  });

  it("starts an availability check automatically and reloads without a Retry click after release", async () => {
    const postMessage = vi.fn(), terminate = vi.fn();
    let probe: { onmessage?: (e: { data: string }) => void } = {};
    vi.stubGlobal("Worker", class {
      constructor() { probe = this; }
      onmessage?: (e: { data: string }) => void;
      postMessage = postMessage;
      terminate = terminate;
    });
    const saved = new Map();
    Object.assign(window, { Worker, location: { reload, href: "https://local.example/" }, sessionStorage: {
      getItem: (k: string) => saved.get(k), setItem: (k: string, v: string) => saved.set(k, v), removeItem: (k: string) => saved.delete(k),
    } });
    sqlite.openDatabaseAsync.mockRejectedValueOnce(busy()).mockRejectedValueOnce(new Error("Invalid VFS state"));
    await expect(getLocalDatabase().getSelectedContractId()).rejects.toThrow();
    RecoveryHarness();
    const cleanup = effects.map(effect => effect());
    try {
      expect(postMessage).toHaveBeenCalledOnce();
      probe.onmessage!({ data: "free" });
      expect(reload).toHaveBeenCalledOnce();
      expect(sqlite.openDatabaseAsync).toHaveBeenCalledOnce();
      expect(terminate).toHaveBeenCalledOnce();
    } finally { for (const dispose of cleanup) dispose?.(); }
  });

  it("warns before reloading a fresh document instead of retrying the poisoned worker", async () => {
    sqlite.openDatabaseAsync.mockRejectedValueOnce(busy()).mockRejectedValueOnce(new Error("Invalid VFS state"));
    await expect(getLocalDatabase().getSelectedContractId()).rejects.toMatchObject({ causeCode: "ACCESS_HANDLE_BUSY" });
    const recovery = RecoveryHarness();
    const guidance = getLocalDatabaseRecoveryGuidance(recovery.localDatabaseStorageState);
    await recovery.retryLocalStorage();
    await recovery.retryLocalStorage();
    expect(guidance.body).toMatch(/recargar[áa]/i);
    expect(guidance.body).toContain("pendientes");
    expect(guidance.canRequestDestructiveReset).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(sqlite.deleteDatabaseAsync).not.toHaveBeenCalled();
    expect(recovery.input.setBootstrapAttempt).not.toHaveBeenCalled();
  });

  it("rechecks current state and ignores a late blocked-screen click after the runtime becomes ready", async () => {
    sqlite.openDatabaseAsync.mockRejectedValueOnce(busy());
    await expect(getLocalDatabase().getSelectedContractId()).rejects.toThrow();
    const recovery = RecoveryHarness();
    await retryLocalDatabaseInitialization();
    await recovery.retryLocalStorage();
    expect(reload).not.toHaveBeenCalled();
    expect(recovery.input.setBootstrapAttempt).not.toHaveBeenCalled();
    expect(recovery.input.setStatus).not.toHaveBeenCalled();
    expect(getLocalDatabaseStorageState().status).toBe("ready");
  });

  it("does not reload from a stale callback that has not presented the reload warning", async () => {
    const recovery = RecoveryHarness();
    sqlite.openDatabaseAsync.mockRejectedValueOnce(busy());
    await expect(getLocalDatabase().getSelectedContractId()).rejects.toThrow();
    await recovery.retryLocalStorage();
    expect(reload).not.toHaveBeenCalled();
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(recovery.input.setBootstrapAttempt).not.toHaveBeenCalled();
  });

  it("leaves storage intact and permits another explicit click if document reload throws", async () => {
    sqlite.openDatabaseAsync.mockRejectedValueOnce(busy());
    await expect(getLocalDatabase().getSelectedContractId()).rejects.toThrow();
    const recovery = RecoveryHarness();
    reload.mockImplementationOnce(() => { throw new Error("reload refused"); });
    await expect(recovery.retryLocalStorage()).rejects.toThrow("reload refused");
    await recovery.retryLocalStorage();
    expect(reload).toHaveBeenCalledTimes(2);
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledTimes(1);
    expect(sqlite.deleteDatabaseAsync).not.toHaveBeenCalled();
  });

  it.each(["open failed", "Invalid VFS state", "quota exceeded", "database is malformed"])(
    "keeps the existing retry for an unrelated initial error: %s", async (message) => {
      sqlite.openDatabaseAsync.mockRejectedValueOnce(new Error(message));
      await expect(getLocalDatabase().getSelectedContractId()).rejects.toThrow();
      const recovery = RecoveryHarness();
      await recovery.retryLocalStorage();
      expect(reload).not.toHaveBeenCalled();
      expect(sqlite.openDatabaseAsync).toHaveBeenCalledTimes(2);
      expect(recovery.input.setStatus).toHaveBeenCalledWith("loading");
    },
  );

  it("does not reload a previously operational runtime after pagehide and another blocked open", async () => {
    const store = getLocalDatabase();
    await store.getSelectedContractId();
    listeners.get("pagehide")!({ persisted: false });
    await closeLocalDatabase();
    sqlite.openDatabaseAsync.mockRejectedValueOnce(busy());
    await expect(store.getSelectedContractId()).rejects.toThrow();
    await RecoveryHarness().retryLocalStorage();
    expect(reload).not.toHaveBeenCalled();
    expect(getLocalDatabaseStorageState().status).toBe("ready");
  });

  it("does not extend document reload to migration failures", async () => {
    db.execAsync.mockRejectedValueOnce(busy());
    await expect(getLocalDatabase().getSelectedContractId()).rejects.toThrow();
    await RecoveryHarness().retryLocalStorage();
    expect(reload).not.toHaveBeenCalled();
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledTimes(2);
  });

  it("does not classify an operational write failure as a reloadable initial open", async () => {
    const store = getLocalDatabase();
    await store.getSelectedContractId();
    db.runAsync.mockRejectedValueOnce(busy());
    await expect(store.setSelectedContractId("synthetic-contract", "synthetic-owner")).rejects.toThrow();
    await RecoveryHarness().retryLocalStorage();
    expect(reload).not.toHaveBeenCalled();
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  it("keeps native retry behavior when there is no document reload API", async () => {
    vi.unstubAllGlobals();
    sqlite.openDatabaseAsync.mockRejectedValueOnce(busy());
    await expect(getLocalDatabase().getSelectedContractId()).rejects.toThrow();
    await RecoveryHarness().retryLocalStorage();
    expect(reload).not.toHaveBeenCalled();
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledTimes(2);
  });

  it("fails closed for a pre-existing global state whose ready history is unknown", async () => {
    getLocalDatabaseStorageState();
    const global = globalThis as unknown as { __opcoClientLocalDatabaseState: { hasReachedReady?: boolean } };
    delete global.__opcoClientLocalDatabaseState.hasReachedReady;
    sqlite.openDatabaseAsync.mockRejectedValueOnce(busy());
    await expect(getLocalDatabase().getSelectedContractId()).rejects.toThrow();
    await RecoveryHarness().retryLocalStorage();
    expect(reload).not.toHaveBeenCalled();
  });
});
