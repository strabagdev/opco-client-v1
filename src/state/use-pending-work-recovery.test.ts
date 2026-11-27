import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePendingWorkLifecycle } from "./use-pending-work-lifecycle";
import { OpcoApiError } from "../lib/opco-api";
import type { PendingOperation } from "../lib/offline-records";

const h = vi.hoisted(() => {
  const refs: { current: unknown }[] = [], callbacks: { deps: unknown[]; value: unknown }[] = [];
  const effects: { deps: unknown[]; cleanup?: () => void }[] = [], states: unknown[] = [];
  const listeners = new Set<(state: string) => void>();
  let ri = 0, ci = 0, ei = 0, si = 0, pending: (() => void)[] = [];
  const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const appState = { currentState: "active", addEventListener: (_: string, fn: (state: string) => void) => {
    listeners.add(fn); return { remove: () => listeners.delete(fn) };
  } };
  return {
    appState, sync: vi.fn(),
    begin() { ri = ci = ei = si = 0; pending = []; }, flush() { pending.forEach(fn => fn()); },
    reset() { effects.forEach(e => e.cleanup?.()); refs.length = callbacks.length = effects.length = states.length = 0; listeners.clear(); appState.currentState = "active"; },
    useRef<T>(value: T) { const i = ri++; refs[i] ??= { current: value }; return refs[i] as { current: T }; },
    useCallback<T>(value: T, deps: unknown[]) { const i = ci++; if (!callbacks[i] || !same(callbacks[i].deps, deps)) callbacks[i] = { deps, value }; return callbacks[i].value as T; },
    useEffect(fn: () => void | (() => void), deps: unknown[]) { const i = ei++; const previous = effects[i]; if (!previous || !same(previous.deps, deps)) pending.push(() => { previous?.cleanup?.(); effects[i] = { deps, cleanup: fn() ?? undefined }; }); },
    useState<T>(initial: T) { const i = si++; if (!(i in states)) states[i] = initial; return [states[i] as T, (next: T | ((value: T) => T)) => { states[i] = typeof next === "function" ? (next as (v: T) => T)(states[i] as T) : next; }] as const; },
    change(state: string) { appState.currentState = state; listeners.forEach(fn => fn(state)); },
  };
});
vi.mock("react", () => ({ useRef: h.useRef, useCallback: h.useCallback, useEffect: h.useEffect, useState: h.useState }));
vi.mock("react-native", () => ({ AppState: h.appState, Platform: { OS: "web" } }));
vi.mock("../sync/pending-work-sync", async importOriginal => ({ ...await importOriginal<typeof import("../sync/pending-work-sync")>(), syncPendingWork: h.sync }));
vi.mock("../lib/token-storage", () => ({ setSessionOwnerKey: vi.fn(), setSession: vi.fn() }));
vi.mock("../lib/app-view-prewarm", () => ({ invalidateHomePreparation: vi.fn(), prewarmAssignedAppViewsOnce: vi.fn() }));
vi.mock("../lib/app-navigation-cache", () => ({ buildOwnerKey: () => "org:A", appViewsAuthorizationScope: () => "auth", createAppViewsReadEvent: vi.fn(), loadAppViewsWithCache: vi.fn(async () => ({ offline: false, views: [] })) }));

type Input = Parameters<typeof usePendingWorkLifecycle>[0];
function result(records = 0, state = 0) {
  return { records: { completed: 0, conflicts: 0, failed: 0, retriable: records }, stateUpdate: { result: { completed: 0, conflicts: 0, failed: 0, retriable: state }, operationsSelected: state } };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
function fixture() {
  let generation = 1, eligible = false;
  const cache = { countPendingOperations: vi.fn<Input["definitionCache"]["countPendingOperations"]>(async () => Number(eligible)), listPendingStateUpdateOperations: vi.fn<Input["definitionCache"]["listPendingStateUpdateOperations"]>(async () => []), upsertContextSnapshot: vi.fn() };
  const api = { getAuthSessionGeneration: () => generation, getReady: vi.fn<() => Promise<void>>(async () => undefined),
    getMe: vi.fn(async () => ({})), getContext: vi.fn(async () => ({ contracts: [{ id: "contract" }] })),
    commitAuthSession: vi.fn(async (_: unknown, fn: () => Promise<void>) => fn()), refreshSession: vi.fn() };
  let input: Input = { api: api as never, definitionCache: cache as never, ownerKey: "org:A", selectedContractIdState: "contract", token: "opaque-A", status: "authenticated", connectivityStatus: "online",
    recordOfflinePreparationDiagnostics: vi.fn(), persistStateUpdateReconnectDiagnostics: vi.fn(), refreshPendingRecordsCount: vi.fn(), refreshStateUpdateDiagnostics: vi.fn(), setContext: vi.fn(), setMe: vi.fn(), setRecordsReconnectRefreshKey: vi.fn(), setSelectedContractIdState: vi.fn(), setStatus: vi.fn(), setToken: vi.fn(), shouldShowStateUpdateDiagnostics: false, syncPendingStateUpdatesWithTelemetry: vi.fn() };
  function TestComponent(next: Partial<Input> = {}) { input = { ...input, ...next }; h.begin(); const output = usePendingWorkLifecycle(input); h.flush(); return output; }
  const output = TestComponent();
  return { api, cache, render: TestComponent, output, setEligible(value: boolean) { eligible = value; }, retire(next: Partial<Input>) { generation++; return TestComponent(next); } };
}
beforeEach(() => { vi.useFakeTimers(); h.sync.mockReset(); h.sync.mockResolvedValue(result()); });
afterEach(() => { h.reset(); vi.clearAllTimers(); vi.useRealTimers(); vi.clearAllMocks(); });

async function settled() { await vi.advanceTimersByTimeAsync(300); }

describe("C-10 existing lifecycle recovery after a business attempt", () => {
  it.each([[1, 0], [0, 1], [1, 1]])("ready200 with retriable RECORDS=%i STATE_UPDATE=%i recovers automatically", async (records, state) => {
    const f = fixture(); await settled(); f.setEligible(true);
    h.sync.mockResolvedValueOnce(result(records, state)).mockImplementationOnce(async () => { f.setEligible(false); return result(); });
    await f.output.syncPendingRecords("reconnect");
    expect(f.api.getReady).toHaveBeenCalledTimes(1); expect(h.sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999); expect(h.sync).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(h.sync).toHaveBeenCalledTimes(2);
    const count = f.cache.countPendingOperations.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120000); expect(h.sync).toHaveBeenCalledTimes(2); expect(f.cache.countPendingOperations).toHaveBeenCalledTimes(count);
  });

  it("uses the existing 5/15/30/60s backoff for repeated transients, without an immediate loop", async () => {
    const f = fixture(); await settled(); f.setEligible(true); h.sync.mockResolvedValue(result(1, 1));
    await f.output.syncPendingRecords("reconnect");
    for (const [i, delay] of [5000, 15000, 30000, 60000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1); expect(h.sync).toHaveBeenCalledTimes(i + 1);
      await vi.advanceTimersByTimeAsync(1); expect(h.sync).toHaveBeenCalledTimes(i + 2);
    }
    f.setEligible(false); await vi.advanceTimersByTimeAsync(60000); const count = f.cache.countPendingOperations.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120000); expect(h.sync).toHaveBeenCalledTimes(5); expect(f.cache.countPendingOperations).toHaveBeenCalledTimes(count);
  });

  it("retains the readiness recovery when Core returns without another online event", async () => {
    const f = fixture(); await settled(); f.setEligible(true);
    f.api.getReady.mockRejectedValueOnce(Error("controlled down")).mockRejectedValueOnce(Error("controlled down")).mockRejectedValueOnce(Error("controlled down"));
    const first = f.output.syncPendingRecords("reconnect"); await vi.advanceTimersByTimeAsync(1500); await first;
    expect(h.sync).not.toHaveBeenCalled(); h.sync.mockImplementationOnce(async () => { f.setEligible(false); return result(); });
    await vi.advanceTimersByTimeAsync(5000); expect(h.sync).toHaveBeenCalledTimes(1);
  });

  it("a manual run consumes the scheduled wait and owns the next decision while its ACK is pending", async () => {
    const f = fixture(); await settled(); f.setEligible(true); const ack = deferred<ReturnType<typeof result>>();
    h.sync.mockResolvedValueOnce(result(1, 1)).mockImplementationOnce(() => ack.promise);
    await f.output.syncPendingRecords("reconnect"); await vi.advanceTimersByTimeAsync(1000);
    const manual = f.output.syncPendingRecords(); await settled(); await vi.advanceTimersByTimeAsync(10000);
    expect(h.sync).toHaveBeenCalledTimes(2); f.setEligible(false); ack.resolve(result()); await manual;
    await vi.advanceTimersByTimeAsync(120000); expect(h.sync).toHaveBeenCalledTimes(2);
  });

  it.each(["offline", "background", "session", "same-user-new-generation", "empty"])("cancels or reevaluates recovery for %s", async mode => {
    const f = fixture(); await settled(); f.setEligible(true); h.sync.mockResolvedValueOnce(result(1)); await f.output.syncPendingRecords("reconnect");
    if (mode === "offline") f.render({ connectivityStatus: "offline" });
    if (mode === "background") h.change("background");
    if (mode === "session") f.retire({ ownerKey: null, token: null, status: "anonymous", selectedContractIdState: null });
    if (mode === "same-user-new-generation") f.retire({ connectivityStatus: "offline" });
    if (mode === "empty") f.setEligible(false);
    await vi.advanceTimersByTimeAsync(120000); expect(h.sync).toHaveBeenCalledTimes(1);
    const count = f.cache.countPendingOperations.mock.calls.length; await vi.advanceTimersByTimeAsync(120000); expect(f.cache.countPendingOperations).toHaveBeenCalledTimes(count);
  });

  it("does not retry validation, conflicts or an invalid authentication", async () => {
    const f = fixture(); await settled(); f.setEligible(true);
    h.sync.mockImplementationOnce(async () => {
      // The real store excludes rows after marking them failed/conflict.
      f.setEligible(false);
      return { ...result(), records: { completed: 0, retriable: 0, failed: 1, conflicts: 1 } };
    });
    await f.output.syncPendingRecords("reconnect"); await vi.advanceTimersByTimeAsync(60000); expect(h.sync).toHaveBeenCalledTimes(1);
    h.sync.mockRejectedValueOnce(new OpcoApiError("controlled invalid", "TOKEN_INVALID", 401)); await expect(f.output.syncPendingRecords()).rejects.toThrow("controlled invalid");
    await vi.advanceTimersByTimeAsync(60000); expect(h.sync).toHaveBeenCalledTimes(2);
  });
  it("manual transient failure retains backoff and a direct observer cannot reset an active run", async () => {
    const f = fixture(); await settled(); f.setEligible(true); h.sync.mockResolvedValue(result(1));
    await f.output.syncPendingRecords("reconnect"); await vi.advanceTimersByTimeAsync(1000);
    const gate = deferred<ReturnType<typeof result>>(); h.sync.mockImplementationOnce(() => gate.promise);
    const manual = f.output.syncPendingRecords(); await settled();
    f.output.requestPendingWorkRecovery({ authGeneration: 1, ownerKey: "org:A", selectedContractId: "contract", token: "opaque-A" });
    gate.resolve(result(0, 1)); await manual;
    await vi.advanceTimersByTimeAsync(14999); expect(h.sync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(h.sync).toHaveBeenCalledTimes(3);
  });

  it("shares a single scheduled wait with direct callers; an old session cannot cancel B's recovery", async () => {
    const f = fixture(); await settled();
    const b = f.retire({ ownerKey: "org:B", token: "opaque-B" }); await settled(); f.setEligible(true);
    const scope = { authGeneration: 2, ownerKey: "org:B", selectedContractId: "contract", token: "opaque-B" };
    b.requestPendingWorkRecovery(scope); b.requestPendingWorkRecovery(scope);
    f.output.requestPendingWorkRecovery({ ...scope, ownerKey: "org:A", authGeneration: 1, token: "opaque-A" });
    h.sync.mockImplementationOnce(async () => { f.setEligible(false); return result(); });
    expect(vi.getTimerCount()).toBe(1); await vi.advanceTimersByTimeAsync(5000);
    expect(h.sync).toHaveBeenCalledTimes(1); expect(h.sync.mock.calls[0][0]).toMatchObject({ ownerKey: "org:B", token: "opaque-B" });
  });

  it("rechecks generation after the asynchronous pending query, including A logout A", async () => {
    const f = fixture(); await settled(); f.setEligible(true); h.sync.mockResolvedValueOnce(result(1)); await f.output.syncPendingRecords("reconnect");
    const count = deferred<number>(); f.cache.countPendingOperations.mockImplementationOnce(() => count.promise);
    await vi.advanceTimersByTimeAsync(5000); f.setEligible(false); f.retire({}); await settled();
    count.resolve(1); await settled(); expect(h.sync).toHaveBeenCalledTimes(1);
  });

  it("a recoverable auth refresh uses the same wait, while TOKEN_INVALID is not retried", async () => {
    const f = fixture(); await settled();
    const expired = "eyJhbGciOiJIUzI1NiJ9." + btoa(JSON.stringify({ exp: 1 })) + ".synthetic";
    const out = f.render({ token: expired }); await settled(); f.setEligible(true);
    f.api.refreshSession.mockRejectedValueOnce(new OpcoApiError("temporary", "DB_UNAVAILABLE", 503)).mockResolvedValueOnce({ accessToken: "opaque-new" });
    await out.syncPendingRecords("reconnect"); expect(h.sync).not.toHaveBeenCalled();
    h.sync.mockImplementationOnce(async () => { f.setEligible(false); return result(); });
    await vi.advanceTimersByTimeAsync(5000); expect(h.sync).toHaveBeenCalledTimes(1);
    expect(h.sync.mock.calls[0][0].token).toBe("opaque-new");
  });

});

describe("C10 publication review directed gaps", () => {
  it("R1: an old empty eligibility query must not cancel a newer manual recovery", async () => {
    const f = fixture(); await settled(); f.setEligible(true); h.sync.mockResolvedValue(result(1));
    await f.output.syncPendingRecords("reconnect");
    // The old pending work has meanwhile been acknowledged by another supported path.
    f.setEligible(false); const oldRead = deferred<number>();
    f.cache.countPendingOperations.mockImplementationOnce(() => oldRead.promise);
    await vi.advanceTimersByTimeAsync(5000);
    // A distinct new local intention is now saved, and its manual send fails transiently.
    f.setEligible(true); await f.output.syncPendingRecords();
    expect(h.sync).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(1);
    oldRead.resolve(0); await settled();
    expect.soft(vi.getTimerCount(), "old read cleared the new 15-second recovery").toBe(1);
    await vi.advanceTimersByTimeAsync(14700);
    expect(h.sync, "new eligible intention must receive the scheduled automatic pass").toHaveBeenCalledTimes(3);
  });

  it("R2: A's late completion must not clear B's active flag or overwrite B's diagnostics", async () => {
    const f = fixture(); await settled();
    const aReply = deferred<ReturnType<typeof result>>(), bReply = deferred<ReturnType<typeof result>>();
    h.sync.mockImplementationOnce(() => aReply.promise).mockImplementationOnce(() => bReply.promise);
    let aDiagnostics = {} as Record<string, unknown>, bDiagnostics = {} as Record<string, unknown>;
    const persistA = vi.fn<Input["persistStateUpdateReconnectDiagnostics"]>(async update => { aDiagnostics = update(aDiagnostics as never) as unknown as Record<string, unknown>; });
    const persistB = vi.fn<Input["persistStateUpdateReconnectDiagnostics"]>(async update => { bDiagnostics = update(bDiagnostics as never) as unknown as Record<string, unknown>; });
    const aOutput = f.render({ persistStateUpdateReconnectDiagnostics: persistA });
    f.setEligible(true); const a = aOutput.syncPendingRecords(); await settled();
    f.setEligible(false); const bOutput = f.retire({ ownerKey: "org:B", token: "opaque-B", persistStateUpdateReconnectDiagnostics: persistB }); await settled();
    f.setEligible(true); const b = bOutput.syncPendingRecords(); await settled();
    try {
      expect(h.sync).toHaveBeenCalledTimes(2);
      expect(f.render().isPendingWorkSyncing).toBe(true);
      const bRunId = (bDiagnostics.lastReconnectPreflight as { syncRunId: string }).syncRunId;
      const successful = result(); successful.records.completed = 1; aReply.resolve(successful); await a; await settled();
      expect.soft((bDiagnostics.lastReconnectPreflight as {syncRunId:string}).syncRunId, "late A result replaced B preflight").toBe(bRunId);
      expect(f.render().isPendingWorkSyncing, "B is still awaiting its own ACK").toBe(true);
    } finally { f.setEligible(false); bReply.resolve(result()); await b; }
  });
});

describe("C10 publication review stale positive eligibility", () => {
  it("R1b: a stale positive query must not bypass the newer manual backoff", async () => {
    const f=fixture(); await settled(); f.setEligible(true); h.sync.mockResolvedValue(result(1));
    await f.output.syncPendingRecords("reconnect"); const oldRead=deferred<number>();
    f.cache.countPendingOperations.mockImplementationOnce(()=>oldRead.promise);
    await vi.advanceTimersByTimeAsync(5000); await f.output.syncPendingRecords();
    expect(h.sync).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(1);
    oldRead.resolve(1); await settled();
    expect(h.sync,"an old eligibility result sent again immediately instead of waiting15s").toHaveBeenCalledTimes(2);
  });
});


const aScope = { authGeneration: 1, ownerKey: "org:A", selectedContractId: "contract", token: "opaque-A" };
const stateResult = () => ({ completedAt: new Date().toISOString(), startedAt: new Date().toISOString(), operationsSelected: 1, syncRunId: "manual-state", result: { completed: 1, conflicts: 0, failed: 0, retriable: 0, lastRequestDiagnostics: null, operationsAttempted: 1, operationsSelected: 1, reconciledAfterTimeout: false, timeoutOccurred: false } });
describe("C10 run ownership and existing coordinator", () => {
  it.each(["error", "same-owner-new-generation"])("late %s cannot finalize the new session's active run", async mode => {
    const f = fixture(); await settled(); const oldReply = deferred<ReturnType<typeof result>>(), newReply = deferred<ReturnType<typeof result>>();
    h.sync.mockImplementationOnce(() => oldReply.promise).mockImplementationOnce(() => newReply.promise);
    const old = f.output.syncPendingRecords().catch(() => undefined); await settled();
    const current = f.retire(mode === "error" ? { ownerKey: "org:B", token: "opaque-B" } : {}); await settled();
    const fresh = current.syncPendingRecords(); await settled();
    if (mode === "error") oldReply.reject(new Error("controlled old failure")); else oldReply.resolve(result());
    await old; expect(f.render().isPendingWorkSyncing).toBe(true);
    newReply.resolve(result()); await fresh; expect(f.render().isPendingWorkSyncing).toBe(false);
  });
  it("late readiness finally cannot clear B's readiness indicator", async () => {
    const f = fixture(); await settled(); const oldReady = deferred<void>(), newReady = deferred<void>();
    f.api.getReady.mockImplementationOnce(() => oldReady.promise).mockImplementationOnce(() => newReady.promise);
    const old = f.output.syncPendingRecords("reconnect"); await settled();
    const b = f.retire({ ownerKey: "org:B", token: "opaque-B" }); await settled();
    const fresh = b.syncPendingRecords("reconnect"); await settled();
    oldReady.resolve(); await old; expect(f.render().isOperationalCoreReadinessChecking).toBe(true);
    newReady.resolve(); await fresh; expect(h.sync).toHaveBeenCalledTimes(1);
  });
  it("a stale refresh cannot publish its token or clear B's active flag", async () => {
    const f = fixture(); await settled();
    const expired = "eyJhbGciOiJIUzI1NiJ9." + btoa(JSON.stringify({ exp: 1 })) + ".synthetic";
    const refreshed = deferred<{accessToken:string}>(), ack = deferred<ReturnType<typeof result>>(), publishToken = vi.fn();
    const a = f.render({token:expired,setToken:publishToken}); await settled();
    f.api.refreshSession.mockImplementationOnce(() => refreshed.promise);
    const old = a.syncPendingRecords("reconnect"); await settled();
    const b = f.retire({ ownerKey: "org:B", token: "opaque-B" }); await settled();
    h.sync.mockImplementationOnce(() => ack.promise); const fresh = b.syncPendingRecords(); await settled();
    refreshed.resolve({accessToken:"opaque-old-refresh"}); await old;
    expect(publishToken).not.toHaveBeenCalled(); expect(f.render().isPendingWorkSyncing).toBe(true);
    ack.resolve(result()); await fresh;
  });
  it("rechecks run identity inside the asynchronous diagnostic persistence callback", async () => {
    const f = fixture(); await settled(); const entered = deferred<void>(), release = deferred<void>();
    let diagnostics = {} as Record<string, unknown>;
    const persist = vi.fn<Input["persistStateUpdateReconnectDiagnostics"]>(async update => { entered.resolve(); await release.promise; diagnostics = update(diagnostics as never) as unknown as Record<string, unknown>; });
    const a = f.render({ persistStateUpdateReconnectDiagnostics: persist });
    await a.syncPendingRecords(); await entered.promise;
    f.retire({ownerKey:"org:B", token:"opaque-B", persistStateUpdateReconnectDiagnostics: vi.fn()}); await settled();
    release.resolve(); await settled(); expect(diagnostics.lastReconnectPreflight).toBeUndefined();
  });
  it.each([0, 1])("foreground eligibility %i cannot supersede a newer manual wait", async count => {
    const f = fixture(); await settled(); h.change("background");
    const oldRead = deferred<number>(); f.cache.countPendingOperations.mockImplementationOnce(() => oldRead.promise);
    h.change("active"); await settled(); f.setEligible(true); h.sync.mockResolvedValue(result(1));
    await f.output.syncPendingRecords(); expect(vi.getTimerCount()).toBe(1);
    oldRead.resolve(count); await settled(); expect(h.sync).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(1);
  });
  it("A's outstanding run does not block a current B recovery", async () => {
    const f = fixture(); await settled(); const ack = deferred<ReturnType<typeof result>>();
    h.sync.mockImplementationOnce(() => ack.promise); const a = f.output.syncPendingRecords(); await settled();
    const b = f.retire({ownerKey:"org:B",token:"opaque-B"}); await settled(); f.setEligible(true);
    b.requestPendingWorkRecovery({authGeneration:2,ownerKey:"org:B",selectedContractId:"contract",token:"opaque-B"});
    await vi.advanceTimersByTimeAsync(5000); expect(h.sync).toHaveBeenCalledTimes(2);
    f.setEligible(false); ack.resolve(result()); await a;
  });
  it("manual STATE_UPDATE waits for the current combined pass without another engine or global mutex", async () => {
    const f = fixture(); await settled(); const ack = deferred<ReturnType<typeof result>>();
    h.sync.mockImplementationOnce(() => ack.promise);
    const combined = f.output.syncPendingRecords(); await settled(); const work = vi.fn(async () => stateResult());
    const manual = f.output.coordinateStateUpdateDiagnosticSync(aScope, work); await settled(); expect(work).not.toHaveBeenCalled();
    ack.resolve(result()); await combined; expect(await manual).toMatchObject({operationsSelected:1, result:{completed:1}});
    expect(work).toHaveBeenCalledOnce(); expect(h.sync).toHaveBeenCalledOnce();
  });
  it("a combined caller waits for a manual pass and still sends RECORDS afterward", async () => {
    const f = fixture(); await settled(); const gate = deferred<ReturnType<typeof stateResult>>();
    const work = vi.fn(() => gate.promise); const manual = f.output.coordinateStateUpdateDiagnosticSync(aScope,work); await settled();
    const combined = f.output.syncPendingRecords(); await settled(); expect(h.sync).not.toHaveBeenCalled();
    gate.resolve(stateResult()); await manual; await combined; expect(h.sync).toHaveBeenCalledOnce();
  });
  it("an obsolete manual waiter cannot execute in a new A login", async () => {
    const f = fixture(); await settled(); const ack = deferred<ReturnType<typeof result>>();
    h.sync.mockImplementationOnce(() => ack.promise); const combined = f.output.syncPendingRecords(); await settled();
    const work = vi.fn(async () => stateResult()); const manual = f.output.coordinateStateUpdateDiagnosticSync(aScope,work);
    f.retire({}); await settled(); ack.resolve(result()); await combined;
    expect(await manual).toBeNull(); expect(work).not.toHaveBeenCalled();
  });
  it("a successful manual STATE_UPDATE does not erase the pending RECORDS recovery or backoff", async () => {
    const f = fixture(); await settled(); f.setEligible(true); h.sync.mockResolvedValue(result(1));
    await f.output.syncPendingRecords("reconnect"); await vi.advanceTimersByTimeAsync(1000);
    await f.output.coordinateStateUpdateDiagnosticSync(aScope,async () => stateResult());
    await vi.advanceTimersByTimeAsync(14999); expect(h.sync).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(h.sync).toHaveBeenCalledTimes(2);
  });
  it("publishes the verified view refresh after a valid same-session token refresh", async () => {
    const f=fixture();await settled();const expired="eyJhbGciOiJIUzI1NiJ9."+btoa(JSON.stringify({exp:1}))+".synthetic";
    f.render({token:expired,connectivityStatus:"offline"});await settled();f.setEligible(true);
    // Startup's first eligibility check finds no work; reconnect owns the next pass.
    f.cache.countPendingOperations.mockResolvedValueOnce(0);
    f.api.refreshSession.mockResolvedValue({accessToken:"opaque-refreshed"});
    h.sync.mockImplementationOnce(async()=>{f.setEligible(false);return result();});
    const publish=vi.fn();f.render({connectivityStatus:"online",setRecordsReconnectRefreshKey:publish});
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.sync).toHaveBeenCalledOnce();expect(publish).toHaveBeenCalledOnce();
  });
  it("a manual diagnostic exception does not strand an already scheduled RECORDS recovery", async () => {
    const f=fixture();await settled();f.setEligible(true);h.sync.mockResolvedValue(result(1));
    await f.output.syncPendingRecords("reconnect");
    await expect(f.output.coordinateStateUpdateDiagnosticSync(aScope,async()=>{throw new Error("controlled manual exception");})).rejects.toThrow("controlled manual exception");
    await vi.advanceTimersByTimeAsync(14999);expect(h.sync).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);expect(h.sync).toHaveBeenCalledTimes(2);
  });
  it("manual failure releases the coordinator and a subsequent combined action can run", async () => {
    const f = fixture(); await settled();
    await expect(f.output.coordinateStateUpdateDiagnosticSync(aScope,async () => {throw new Error("controlled");})).rejects.toThrow("controlled");
    await f.output.syncPendingRecords(); expect(h.sync).toHaveBeenCalledOnce(); expect(f.render().isPendingWorkSyncing).toBe(false);
  });
});

describe("C11 work arriving after a flight selected its commands", () => {
  it.each(["RECORDS", "STATE_UPDATE"])("recovers a new %s command after a successful older snapshot", async kind => {
    const f = fixture(); await settled();
    let statePending = false;
    const stateOperation: PendingOperation = { id: "state", ownerKey: "org:A", contractId: "contract", entityTypeId: "target", localRecordId: "local-state", clientRequestId: "same-state-request", operation: "STATE_UPDATE", attempts: 0, createdAt: "2026-11-25T10:00:00.000Z", updatedAt: "2026-11-25T10:00:00.000Z", payload: {}, serverRecordId: null, lastErrorCode: null, lastErrorMessage: null };
    f.cache.listPendingStateUpdateOperations.mockImplementation(async () => statePending ? [stateOperation] : []);
    const pending = (value: boolean) => { if (kind === "RECORDS") f.setEligible(value); else statePending = value; };
    const ack = deferred<ReturnType<typeof result>>();
    h.sync.mockImplementationOnce(() => ack.promise).mockImplementationOnce(async () => { pending(false); return result(); });
    const first = f.output.syncPendingRecords(); await settled();
    pending(true); // The second durable command was absent from the engine's first selection.
    await f.output.syncPendingRecords();
    expect(h.sync).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    ack.resolve(result()); await first;
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(4999); expect(h.sync).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1); expect(h.sync).toHaveBeenCalledTimes(2);
    const reads = f.cache.countPendingOperations.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120000);
    expect(h.sync).toHaveBeenCalledTimes(2); expect(f.cache.countPendingOperations).toHaveBeenCalledTimes(reads);
  });

  it("coalesces a burst of absorbed triggers into the existing single recovery wait", async () => {
    const f = fixture(); await settled(); const ack = deferred<ReturnType<typeof result>>();
    h.sync.mockImplementationOnce(() => ack.promise).mockImplementationOnce(async () => { f.setEligible(false); return result(); });
    const first = f.output.syncPendingRecords(); await settled(); f.setEligible(true);
    await Promise.all(Array.from({ length: 12 }, () => f.output.syncPendingRecords()));
    expect(h.sync).toHaveBeenCalledOnce();
    ack.resolve(result()); await first; expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000); expect(h.sync).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks remaining work even without an absorbed trigger, including a shared login engine snapshot", async () => {
    const f = fixture(); await settled(); const ack = deferred<ReturnType<typeof result>>();
    h.sync.mockImplementationOnce(() => ack.promise).mockImplementationOnce(async () => { f.setEligible(false); return result(); });
    const first = f.output.syncPendingRecords(); await settled(); f.setEligible(true);
    ack.resolve(result()); await first;
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000); expect(h.sync).toHaveBeenCalledTimes(2);
  });

  it("retains a new demand received while the final eligibility read returns an older empty result", async () => {
    const f = fixture(); await settled(); const ack = deferred<ReturnType<typeof result>>(), count = deferred<number>();
    h.sync.mockImplementationOnce(() => ack.promise).mockImplementationOnce(async () => { f.setEligible(false); return result(); });
    const first = f.output.syncPendingRecords(); await settled();
    const reads = f.cache.countPendingOperations.mock.calls.length;
    f.cache.countPendingOperations.mockImplementationOnce(() => count.promise);
    ack.resolve(result()); await settled();
    expect(f.cache.countPendingOperations).toHaveBeenCalledTimes(reads + 1);
    f.setEligible(true); await f.output.syncPendingRecords();
    count.resolve(0); await first;
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000); expect(h.sync).toHaveBeenCalledTimes(2);
  });

  it.each(["conflicts", "definitive-errors", "other-owner"])("stops when only %s remain outside eligibility", async mode => {
    const f = fixture(); await settled(); const ack = deferred<ReturnType<typeof result>>();
    h.sync.mockImplementationOnce(() => ack.promise);
    const first = f.output.syncPendingRecords(); await settled();
    await f.output.syncPendingRecords();
    const completed = result();
    if (mode === "conflicts") completed.records.conflicts = 1;
    if (mode === "definitive-errors") completed.records.failed = 1;
    if (mode === "other-owner") f.cache.countPendingOperations.mockImplementation(async owner => Number(owner === "org:B"));
    ack.resolve(completed); await first;
    expect(f.cache.countPendingOperations).toHaveBeenLastCalledWith("org:A");
    expect(f.cache.listPendingStateUpdateOperations).toHaveBeenLastCalledWith("org:A");
    expect(vi.getTimerCount()).toBe(0);
    const reads = f.cache.countPendingOperations.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120000);
    expect(h.sync).toHaveBeenCalledOnce(); expect(f.cache.countPendingOperations).toHaveBeenCalledTimes(reads);
  });

  it("a late demand with no remaining eligible work makes at most one deferred check, never a send loop", async () => {
    const f = fixture(); await settled(); const ack = deferred<ReturnType<typeof result>>(), count = deferred<number>();
    h.sync.mockImplementationOnce(() => ack.promise);
    const first = f.output.syncPendingRecords(); await settled();
    f.cache.countPendingOperations.mockImplementationOnce(() => count.promise);
    const reads = f.cache.countPendingOperations.mock.calls.length;
    ack.resolve(result()); await settled();
    expect(f.cache.countPendingOperations).toHaveBeenCalledTimes(reads + 1);
    await f.output.syncPendingRecords(); count.resolve(0); await first;
    await vi.advanceTimersByTimeAsync(5000); expect(h.sync).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    const afterCheck = f.cache.countPendingOperations.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120000); expect(f.cache.countPendingOperations).toHaveBeenCalledTimes(afterCheck);
  });

  it.each(["user", "same-user-new-generation", "contract"])("a retired final read cannot alter the current recovery after a %s change", async mode => {
    const f = fixture(); await settled(); const ack = deferred<ReturnType<typeof result>>(), count = deferred<number>();
    h.sync.mockImplementationOnce(() => ack.promise);
    const first = f.output.syncPendingRecords(); await settled();
    const reads = f.cache.countPendingOperations.mock.calls.length;
    f.cache.countPendingOperations.mockImplementationOnce(() => count.promise);
    ack.resolve(result()); await settled();
    expect(f.cache.countPendingOperations).toHaveBeenCalledTimes(reads + 1);
    const current = mode === "contract" ? f.render({ selectedContractIdState: "other-contract" })
      : f.retire(mode === "user" ? { ownerKey: "org:B", token: "opaque-B" } : {});
    await settled(); f.setEligible(true); h.sync.mockResolvedValueOnce(result(1));
    await current.syncPendingRecords(); expect(vi.getTimerCount()).toBe(1);
    count.resolve(1); await first; expect(vi.getTimerCount()).toBe(1);
    h.sync.mockImplementationOnce(async () => { f.setEligible(false); return result(); });
    await vi.advanceTimersByTimeAsync(4999); expect(h.sync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(h.sync).toHaveBeenCalledTimes(3);
  });

  it("preserves the current backoff when a flight with absorbed work fails transiently", async () => {
    const f = fixture(); await settled(); f.setEligible(true);
    h.sync.mockResolvedValueOnce(result(1)); await f.output.syncPendingRecords();
    const ack = deferred<ReturnType<typeof result>>(); h.sync.mockImplementationOnce(() => ack.promise);
    const second = f.output.syncPendingRecords(); await settled(); await f.output.syncPendingRecords();
    ack.resolve(result(1)); await second; expect(vi.getTimerCount()).toBe(1);
    h.sync.mockImplementationOnce(async () => { f.setEligible(false); return result(); });
    await vi.advanceTimersByTimeAsync(14999); expect(h.sync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(h.sync).toHaveBeenCalledTimes(3);
  });

  it("does not send blindly when the post-ACK eligibility read fails", async () => {
    const f = fixture(); await settled();
    f.cache.countPendingOperations.mockRejectedValueOnce(new Error("controlled local read failure"));
    await expect(f.output.syncPendingRecords()).rejects.toThrow("controlled local read failure");
    await vi.advanceTimersByTimeAsync(120000); expect(h.sync).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0); expect(f.render().isPendingWorkSyncing).toBe(false);
  });
});

it("background write recovery revalidates assignments without forcing complete preparation on every backoff",async()=>{
 const preparer=await import("../lib/app-view-prewarm");const prepare=vi.mocked(preparer.prewarmAssignedAppViewsOnce);prepare.mockClear();
 const f=fixture();await settled();f.setEligible(true);h.sync.mockResolvedValueOnce(result(1)).mockResolvedValueOnce(result(1)).mockImplementationOnce(async()=>{f.setEligible(false);return result();});
 await f.output.syncPendingRecords("manual-retry");await vi.advanceTimersByTimeAsync(5000);await settled();expect(prepare).toHaveBeenCalledTimes(1);
 expect(prepare.mock.calls[0][0]).toMatchObject({trigger:"startup-with-pending",reuseCompleted:true});expect(prepare.mock.calls[0][0].invalidationKey).toBeUndefined();
 await vi.advanceTimersByTimeAsync(15000);await settled();expect(h.sync).toHaveBeenCalledTimes(3);expect(prepare).toHaveBeenCalledTimes(2);expect(prepare.mock.calls[1][0]).toMatchObject({trigger:"startup-with-pending",reuseCompleted:true});expect(prepare.mock.calls[1][0].invalidationKey).toBeUndefined();
 await vi.advanceTimersByTimeAsync(120000);expect(h.sync).toHaveBeenCalledTimes(3);expect(prepare).toHaveBeenCalledTimes(2);
});
