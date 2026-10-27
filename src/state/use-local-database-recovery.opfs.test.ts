import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetLocalDatabaseForTests,
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
  closeAsync: vi.fn(async () => undefined),
  execAsync: vi.fn(async () => undefined),
  getAllAsync: vi.fn(async () => []),
  getFirstAsync: vi.fn(async () => null),
  runAsync: vi.fn(async () => undefined),
};
let reload: ReturnType<typeof vi.fn>;
let listeners: Map<string, () => void>;

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
    addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
    location: { reload },
  });
});
afterEach(() => { __resetLocalDatabaseForTests(); vi.unstubAllGlobals(); });

describe("explicit retry of an OPFS-blocked initial opening", () => {
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
    listeners.get("pagehide")!();
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
