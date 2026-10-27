// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { readFileSync } from "node:fs";
// @ts-expect-error Node types are intentionally absent from the Expo application config.
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearOpfsOpeningRecoveryBudget, OPFS_RECOVERY_RELOAD_KEY, startOpfsOpeningRecovery } from "./opfs-opening-recovery";

let values: Map<string, string>;
let worker: FakeWorker;
class FakeWorker {
  static created = 0;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { worker = this; FakeWorker.created++; }
  respond(data: string) { this.onmessage?.({ data }); }
}
function start(eligible = vi.fn(() => true)) {
  const reload = vi.fn(), onStatus = vi.fn();
  const stop = startOpfsOpeningRecovery({ isEligible: eligible, reload, onStatus });
  return { stop, reload, onStatus, eligible };
}
beforeEach(() => {
  vi.useFakeTimers(); FakeWorker.created = 0; values = new Map();
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("window", { Worker: FakeWorker, location: { href: "https://local.example/" }, sessionStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("bounded recovery of an initially blocked OPFS opening", () => {
  it("waits without opening SQLite, then reloads once only after the pool is free", () => {
    const r = start();
    expect(r.onStatus).toHaveBeenLastCalledWith("waiting");
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    worker.respond("busy");
    vi.advanceTimersByTime(1999);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    worker.respond("free");worker.respond("free");
    vi.runAllTimers();
    expect(r.reload).toHaveBeenCalledTimes(1);
    expect(values.get(OPFS_RECOVERY_RELOAD_KEY)).toBe("attempted");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(r.onStatus).toHaveBeenLastCalledWith("reloading");
  });
  it("does not overlap probes or accumulate requests while a worker is unresponsive", () => {
    const r = start(); vi.advanceTimersByTime(5000);
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(r.onStatus).toHaveBeenLastCalledWith("manual");
    worker.respond("free");expect(r.reload).not.toHaveBeenCalled();
  });
  it("backs off, terminates after twelve busy checks and keeps manual recovery available", () => {
    const r = start();
    for (let i = 0; i < 12; i++) {
      worker.respond("busy");
      if (i < 11) vi.advanceTimersByTime(Math.min(2000 * 2 ** i, 15000));
    }
    vi.runAllTimers();
    expect(worker.postMessage).toHaveBeenCalledTimes(12);
    expect(r.reload).not.toHaveBeenCalled();expect(r.onStatus).toHaveBeenLastCalledWith("manual");
  });
  it("retains the one-reload budget in the next document, including a race lost to another owner", () => {
    const first = start(); worker.respond("free");expect(first.reload).toHaveBeenCalledOnce();
    const next = start();expect(FakeWorker.created).toBe(1);
    expect(next.onStatus).toHaveBeenCalledWith("manual");expect(next.reload).not.toHaveBeenCalled();
    clearOpfsOpeningRecoveryBudget();expect(values.has(OPFS_RECOVERY_RELOAD_KEY)).toBe(false);
  });
  it("ignores a late availability result after the runtime became operational", () => {
    const r = start();r.eligible.mockReturnValue(false);worker.respond("free");
    expect(r.reload).not.toHaveBeenCalled();expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("cancels timers and worker on unmount and ignores late messages", () => {
    const r = start();r.stop();worker.respond("free");vi.runAllTimers();
    expect(r.reload).not.toHaveBeenCalled();expect(worker.postMessage).toHaveBeenCalledOnce();
  });
  it.each(["unsupported", "unrecognized"])("uses manual recovery when probe returns %s", message => {
    const r = start();worker.respond(message);
    expect(r.onStatus).toHaveBeenLastCalledWith("manual");expect(r.reload).not.toHaveBeenCalled();
  });
  it("uses manual recovery after worker failure or reload rejection, with no automatic loop", () => {
    const r = start();worker.onerror!();expect(r.onStatus).toHaveBeenLastCalledWith("manual");
    const next = start();next.reload.mockImplementation(() => { throw Error("reload denied"); });
    worker.respond("free");vi.runAllTimers();
    expect(next.onStatus).toHaveBeenLastCalledWith("manual");expect(next.reload).toHaveBeenCalledOnce();
  });
  it("does not run outside the eligible initial-opening failure", () => {
    const r = start(vi.fn(() => false));expect(FakeWorker.created).toBe(0);expect(r.reload).not.toHaveBeenCalled();
  });
  it("fails closed when per-tab reload budget cannot be persisted", () => {
    window.sessionStorage.setItem = () => { throw Error("storage denied"); };
    const r = start();expect(FakeWorker.created).toBe(0);expect(r.onStatus).toHaveBeenLastCalledWith("manual");
  });
});

const source = readFileSync(new URL("../../public/opfs-availability-worker.js", import.meta.url), "utf8");
function probe(files: [string, { kind: string; createSyncAccessHandle: ReturnType<typeof vi.fn> }][]) {
  const self = { postMessage: vi.fn(), onmessage: undefined as undefined | ((x: { data: string }) => Promise<void>) };
  const getDirectoryHandle = vi.fn(async () => ({ async *[Symbol.asyncIterator]() { yield* files; } }));
  runInNewContext(source, { self, navigator: { storage: { getDirectory: async () => ({ getDirectoryHandle }) } } });
  return { self, getDirectoryHandle, check: () => self.onmessage!({ data: "check" }) };
}
describe("actual availability-worker source against OPFS API boundary", () => {
  it("acquires all existing handles exclusively then releases them before reporting free; never reads/writes", async () => {
    const close = vi.fn(), acquire = vi.fn(async () => ({ close }));
    const p = probe([["second", { kind: "file", createSyncAccessHandle: acquire }], ["first", { kind: "file", createSyncAccessHandle: acquire }]]);
    await p.check();
    expect(p.getDirectoryHandle).toHaveBeenCalledWith("expo-sqlite", { create: false });
    expect(acquire).toHaveBeenCalledTimes(2);expect(acquire.mock.calls.every(c => c.length===0)).toBe(true);
    expect(close).toHaveBeenCalledTimes(2);expect(p.self.postMessage).toHaveBeenLastCalledWith("free");
    expect(close.mock.invocationCallOrder[1]).toBeLessThan(p.self.postMessage.mock.invocationCallOrder[0]);
  });
  it("releases partial acquisitions after BUSY and can check again without an Expo/VFS worker", async () => {
    const close = vi.fn(), acquire = vi.fn().mockRejectedValueOnce({ name: "NoModificationAllowedError" }).mockResolvedValue({ close });
    const p = probe([["a", { kind: "file", createSyncAccessHandle: vi.fn(async () => ({ close })) }],["b", { kind: "file", createSyncAccessHandle: acquire }]]);
    await p.check();expect(p.self.postMessage).toHaveBeenLastCalledWith("busy");expect(close).toHaveBeenCalledTimes(1);
    await p.check();expect(p.self.postMessage).toHaveBeenLastCalledWith("free");expect(close).toHaveBeenCalledTimes(3);
  });
  it("does not infer release from a missing/empty pool or another storage error", async () => {
    const p = probe([]);await p.check();expect(p.self.postMessage).toHaveBeenLastCalledWith("unsupported");
    const other = probe([["a", { kind: "file", createSyncAccessHandle: vi.fn(async () => {throw Error("storage failure");}) }]]);
    await other.check();expect(other.self.postMessage).toHaveBeenLastCalledWith("unsupported");
  });
});
