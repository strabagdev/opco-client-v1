import {afterEach,describe,expect,it,vi} from "vitest";
import {emptyStateUpdateReconnectDiagnostics,useSessionDiagnostics} from "./use-session-diagnostics";
import type {PendingOperation} from "../lib/offline-records";
import {OpcoApiError} from "../lib/opco-api";
import type {OpcoApi} from "../lib/opco-api";
import type {LocalDatabase} from "../lib/local-db";
import type {StateUpdateOutboxDiagnostics} from "../lib/state-update-offline";
const hooks = vi.hoisted(() => {
  const callbacks: { deps: unknown[]; value: unknown }[] = [];
  const effects: { cleanup?: () => void; deps: unknown[] }[] = [];
  const refs: { current: unknown }[] = [];
  const states: unknown[] = [];
  let callbackIndex = 0;
  let effectIndex = 0;
  let refIndex = 0;
  let stateIndex = 0;
  let pendingEffects: (() => void | (() => void))[] = [];

  const sameDeps = (left: unknown[], right: unknown[]) =>
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

  return {
    beginRender() {
      callbackIndex = 0;
      effectIndex = 0;
      refIndex = 0;
      stateIndex = 0;
      pendingEffects = [];
    },
    flushEffects() {
      for (const run of pendingEffects) run();
      pendingEffects = [];
    },
    reset() {
      callbacks.splice(0);
      effects.splice(0);
      refs.splice(0);
      states.splice(0);
    },
    useCallback<T>(callback: T, deps: unknown[]) {
      const index = callbackIndex++;
      const previous = callbacks[index];
      if (!previous || !sameDeps(previous.deps, deps)) callbacks[index] = { deps, value: callback };
      return callbacks[index].value as T;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = effectIndex++;
      const previous = effects[index];
      if (!previous || !sameDeps(previous.deps, deps)) {
        previous?.cleanup?.();
        pendingEffects.push(() => {
          const cleanup = effect();
          effects[index] = { cleanup: cleanup ?? undefined, deps };
        });
      }
    },
    useRef<T>(initial: T) {
      const index = refIndex++;
      refs[index] ??= { current: initial };
      return refs[index] as { current: T };
    },
    useState<T>(initial: T) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      const setState = (next: T | ((current: T) => T)) => {
        states[index] = typeof next === "function" ? (next as (current: T) => T)(states[index] as T) : next;
      };
      return [states[index] as T, setState] as const;
    },
  };
});

vi.mock("react", () => ({
  useCallback: hooks.useCallback,
  useEffect: hooks.useEffect,
  useRef: hooks.useRef,
  useState: hooks.useState,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return {promise, resolve, reject};
}
function operation(owner: string): PendingOperation {
  return {id: `op-${owner}`, ownerKey: owner, contractId: "contract", entityTypeId: "events", localRecordId: `local-${owner}`, serverRecordId: null,
    operation: "STATE_UPDATE", clientRequestId: `request-${owner}`, createdAt: "2026-11-23T00:00:00.000Z", updatedAt: "2026-11-23T00:00:00.000Z", attempts: 0, lastErrorCode: null, lastErrorMessage: null,
    payload: {appViewId: "view", subjectRecordId: `subject-${owner}`, date: "2026-11-23", stateValues: [{fieldId: "state", value: "A"}], extraValues: {context: "synthetic"}, expectedUpdatedAt: null}} as PendingOperation;
}
const ack = (owner: string) => ({appView: {id: "view"}, results: [{result: "CREATED" as const, recordId: `server-${owner}`, subjectRecordId: `subject-${owner}`, updatedAt: "2026-11-23T01:00:00.000Z"}]});
const disposals: (() => Promise<void>)[] = [];
function fixture() {
  let generation = 1;
  const recovery = vi.fn();
  const coordinate = vi.fn<Parameters<typeof useSessionDiagnostics>[0]["coordinateStateUpdateSync"]>(async (_scope, work) => work());
  const complete = new Set<string>();
  const ops = new Map(["A", "B"].map(owner => [owner, operation(owner)]));
  const replies = new Map(["A", "B"].map(owner => [owner, deferred<ReturnType<typeof ack>>() ]));
  const started = new Map(["A", "B"].map(owner => [owner, deferred<void>()]));
  const runs: Promise<unknown>[] = [];
  const gates: (() => void)[] = [];
  function diagnostics(owner: string): StateUpdateOutboxDiagnostics {
    return {consistency: "OK", operations: !complete.has(owner) ? [{clientRequestId: `request-${owner}`, syncStatus: "pending_create"}] : [],
      localRecords: [{localRecordFingerprint: `local-${owner}`, syncStatus: complete.has(owner) ? "synced" : "pending_create"}],
      summary: {localTotal: 1, localSynced: complete.has(owner) ? 1 : 0, pendingCreate: complete.has(owner) ? 0 : 1, pendingUpdate: 0, syncing: 0, failed: 0, conflict: 0}} as StateUpdateOutboxDiagnostics;
  }
  const store = {
    getStateUpdateOutboxDiagnostics: vi.fn(async (owner: string) => diagnostics(owner)),
    getStateUpdateSyncDiagnosticsTelemetry: vi.fn(async (_owner: string) => emptyStateUpdateReconnectDiagnostics),
    setStateUpdateSyncDiagnosticsTelemetry: vi.fn(async () => undefined),
    listPendingStateUpdateOperations: vi.fn(async (owner: string) => complete.has(owner) ? [] : [ops.get(owner)!]),
    markStateUpdateOperationSyncing: vi.fn(async () => true),
    completeStateUpdateOperation: vi.fn(async (sent: PendingOperation) => { complete.add(sent.ownerKey); }),
    retryStateUpdateOperation: vi.fn(async () => undefined),
    retryFailedStateUpdateOperations: vi.fn(async () => 1),
    failStateUpdateOperation: vi.fn(async () => undefined),
    markStateUpdateOperationConflict: vi.fn(async () => undefined),
  };
  const api = {getAuthSessionGeneration: () => generation, saveStateUpdateWorkflow: vi.fn(async (token: string) => { started.get(token)!.resolve(); return replies.get(token)!.promise; })};
  function TestComponent(owner: string) {
    hooks.beginRender();
    return useSessionDiagnostics({ coordinateStateUpdateSync: coordinate,api: api as unknown as OpcoApi, ownerKey: owner, token: owner, definitionCache: store as unknown as LocalDatabase,
      onRetriableSync: recovery, connectivityStatus: "online", showStateUpdateDiagnostics: false, setStateUpdateReconnectRefreshKey: vi.fn()});
  }
  const f = {api, store, recovery, coordinate, complete, diagnostics, replies, started, render: TestComponent, gates,
    changeSession() {generation += 1;},
    run(owner: string) {const promise = TestComponent(owner).runStateUpdateDiagnosticSync(); runs.push(promise); return promise;},
    async refresh(owner: string) {await TestComponent(owner).refreshStateUpdateDiagnostics(); return TestComponent(owner);},
    track(promise: Promise<unknown>) {runs.push(promise); return promise;},
    async dispose() {for (const release of gates) release(); for (const [owner, reply] of replies) reply.resolve(ack(owner)); await Promise.allSettled(runs);},
  };
  disposals.push(f.dispose);
  return f;
}
afterEach(async () => {for (const dispose of disposals.splice(0)) await dispose(); hooks.reset();});

describe("C08 manual diagnostic action generation", () => {
  it("routes the real manual entry through the supplied existing coordinator before any business request", async () => {
    const f = fixture(), entered = deferred<void>(), release = deferred<void>();
    f.gates.push(() => release.resolve());
    f.coordinate.mockImplementation(async (_scope, work) => { entered.resolve(); await release.promise; return work(); });
    const run = f.run("A");
    const first = await Promise.race([entered.promise.then(() => "coordinator"), f.started.get("A")!.promise.then(() => "request")]);
    expect(first).toBe("coordinator"); expect(f.api.saveStateUpdateWorkflow).not.toHaveBeenCalled();
    expect(f.coordinate).toHaveBeenCalledWith({authGeneration:1,ownerKey:"A",token:"A"},expect.any(Function));
    release.resolve(); await f.started.get("A")!.promise; f.replies.get("A")!.resolve(ack("A")); await run;
  });
  it("keeps A's valid ACK but cannot publish A's run or diagnostics after switching to B", async () => {
    const f = fixture(), a = f.run("A"); await f.started.get("A")!.promise;
    f.changeSession(); await f.refresh("B");
    f.replies.get("A")!.resolve(ack("A")); await a;
    const b = f.render("B");
    expect(f.store.completeStateUpdateOperation).toHaveBeenCalledWith(fixtureOperation("A"), expect.objectContaining({recordId: "server-A"}));
    expect(f.complete.has("A")).toBe(true);
    expect(b.stateUpdateDiagnostics?.localRecords[0].localRecordFingerprint).toBe("local-B");
    expect(b.stateUpdateDiagnosticRun).toBeNull(); expect(b.stateUpdateDiagnosticsError).toBeNull();
    expect(b.isStateUpdateDiagnosticSyncing).toBe(false);
  });
  it("ignores A's late diagnostic read error and keeps B usable", async () => {
    const f = fixture(), reading = deferred<void>(), failed = deferred<StateUpdateOutboxDiagnostics>();
    f.gates.push(() => failed.resolve(f.diagnostics("A")));
    f.store.getStateUpdateOutboxDiagnostics.mockImplementation(async owner => {if (owner === "A") {reading.resolve(); return failed.promise;} return f.diagnostics(owner);});
    const a = f.run("A"); await reading.promise; f.changeSession(); await f.refresh("B");
    failed.reject(new Error("Controlled late diagnostic read error")); await a;
    expect(f.render("B").stateUpdateDiagnosticsError).toBeNull();
    expect(f.render("B").stateUpdateDiagnostics?.localRecords[0].localRecordFingerprint).toBe("local-B");
    expect(f.api.saveStateUpdateWorkflow).not.toHaveBeenCalled(); expect(f.complete.size).toBe(0);
  });
  it("does not clear B's busy indicator when A finishes, and B can complete its own action", async () => {
    const f = fixture(), a = f.run("A"); await f.started.get("A")!.promise;
    f.changeSession(); expect(f.render("B").isStateUpdateDiagnosticSyncing).toBe(false);
    const b = f.run("B"); expect(f.render("B").isStateUpdateDiagnosticSyncing).toBe(true);
    f.replies.get("A")!.resolve(ack("A")); await a; await f.started.get("B")!.promise;
    expect(f.render("B").isStateUpdateDiagnosticSyncing).toBe(true);
    f.replies.get("B")!.resolve(ack("B")); await b;
    expect(f.render("B").isStateUpdateDiagnosticSyncing).toBe(false);
    expect(f.render("B").stateUpdateDiagnosticRun?.rows.map(row => row.clientRequestId)).toEqual(["request-B"]);
    expect(f.complete).toEqual(new Set(["A", "B"]));
  });
  it("treats A logout A as a different action generation even with identical owner/token", async () => {
    const f = fixture(), old = f.run("A"); await f.started.get("A")!.promise;
    f.changeSession(); f.changeSession(); await f.refresh("A"); expect(f.render("A").isStateUpdateDiagnosticSyncing).toBe(false);
    f.replies.get("A")!.resolve(ack("A")); await old;
    expect(f.render("A").stateUpdateDiagnosticRun).toBeNull(); expect(f.complete.has("A")).toBe(true);
    const fresh = f.run("A"); await fresh; expect(f.render("A").isStateUpdateDiagnosticSyncing).toBe(false);
    expect(f.render("A").stateUpdateDiagnosticRun).not.toBeNull();
  });
  it("suppresses an error after a durable ACK when the old telemetry read rejects", async () => {
    const f = fixture(), read = deferred<void>(), failure = deferred<typeof emptyStateUpdateReconnectDiagnostics>();
    f.gates.push(() => failure.resolve(emptyStateUpdateReconnectDiagnostics));
    f.store.getStateUpdateSyncDiagnosticsTelemetry.mockImplementation(async owner => {if (owner === "A") {read.resolve(); return failure.promise;}return emptyStateUpdateReconnectDiagnostics;});
    const a = f.run("A"); await f.started.get("A")!.promise; f.replies.get("A")!.resolve(ack("A")); await read.promise;
    f.changeSession(); await f.refresh("B"); failure.reject(new Error("Controlled late telemetry error")); await a;
    expect(f.complete.has("A")).toBe(true); expect(f.render("B").stateUpdateDiagnosticsError).toBeNull();
    expect(f.render("B").stateUpdateDiagnosticRun).toBeNull();
  });
  it("does not expose a completed previous login's manual result or snapshot in B", async () => {
    const f = fixture(), a = f.run("A"); await f.started.get("A")!.promise;
    f.replies.get("A")!.resolve(ack("A")); await a;
    expect(f.render("A").stateUpdateDiagnosticRun).not.toBeNull();
    f.changeSession(); const b = f.render("B");
    expect(b.stateUpdateDiagnosticRun).toBeNull(); expect(b.stateUpdateDiagnostics).toBeNull();
    expect(b.stateUpdateDiagnosticsError).toBeNull(); expect(b.isStateUpdateDiagnosticSyncing).toBe(false);
  });
  it("does not enqueue from an old callback or repeat the current action on double press", async () => {
    const f = fixture(), old = f.render("A").runStateUpdateDiagnosticSync;
    f.changeSession(); await f.refresh("B"); await old; expect(f.api.saveStateUpdateWorkflow).not.toHaveBeenCalled();
    const b = f.run("B"); await f.started.get("B")!.promise; await f.run("B");
    expect(f.api.saveStateUpdateWorkflow).toHaveBeenCalledTimes(1); f.replies.get("B")!.resolve(ack("B")); await b;
  });
  it("does not start manual sync or publish a retry error after the retry owner's session changes", async () => {
    const f = fixture(), started = deferred<void>(), finish = deferred<number>();
    f.gates.push(() => finish.resolve(1));
    f.store.retryFailedStateUpdateOperations.mockImplementation(async () => {started.resolve();return finish.promise;});
    const retry = f.track(f.render("A").retryFailedStateUpdateDiagnostics()); await started.promise; f.changeSession(); await f.refresh("B");
    finish.reject(new Error("Controlled old retry failure")); await retry;
    expect(f.render("B").stateUpdateDiagnosticsError).toBeNull(); expect(f.api.saveStateUpdateWorkflow).not.toHaveBeenCalled();
  });
  it("reports a transient manual result to the existing lifecycle with its original generation", async () => {
    const f = fixture(), a = f.run("A"); await f.started.get("A")!.promise;
    f.replies.get("A")!.reject(new OpcoApiError("controlled temporary", "DB_UNAVAILABLE", 503) as never); await a;
    expect(f.recovery).toHaveBeenCalledOnce();
    expect(f.recovery).toHaveBeenCalledWith({authGeneration: 1, ownerKey: "A", token: "A"});
    expect(f.complete.size).toBe(0); expect(f.store.retryStateUpdateOperation).toHaveBeenCalled();
  });
  it("a late transient retains A's scope for recovery instead of adopting B's generation", async () => {
    const f = fixture(), a = f.run("A"); await f.started.get("A")!.promise;
    f.changeSession(); await f.refresh("B");
    f.replies.get("A")!.reject(new OpcoApiError("controlled temporary", "DB_UNAVAILABLE", 503) as never); await a;
    expect(f.recovery).toHaveBeenCalledWith({authGeneration: 1, ownerKey: "A", token: "A"});
    expect(f.render("B").stateUpdateDiagnosticRun).toBeNull(); expect(f.render("B").stateUpdateDiagnosticsError).toBeNull();
  });
  it("a valid ACK does not request another recovery", async () => {
    const f = fixture(), a = f.run("A"); await f.started.get("A")!.promise;
    f.replies.get("A")!.resolve(ack("A")); await a; expect(f.recovery).not.toHaveBeenCalled();
  });

});
function fixtureOperation(owner: string) {return expect.objectContaining({ownerKey: owner, clientRequestId: `request-${owner}`, localRecordId: `local-${owner}`});}
