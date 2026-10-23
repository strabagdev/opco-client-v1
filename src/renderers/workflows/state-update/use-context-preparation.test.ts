import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useContextPreparation } from "./use-context-preparation";
import type { StateUpdateContextPreparationInput } from "@/lib/app-view-prewarm";
import type { StateUpdateCurrentCoverage } from "@/lib/state-update-offline";

const h = vi.hoisted(() => {
  const refs: { current: unknown }[] = [], states: unknown[] = [];
  const callbacks: { deps: unknown[]; value: unknown }[] = [];
  const effects: { deps: unknown[]; run: () => void | (() => void); cleanup?: () => void }[] = [];
  let r = 0, s = 0, c = 0, e = 0;
  const pending: (() => void)[] = [];
  const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return {
    prepare: vi.fn(),
    begin() { r = s = c = e = 0; },
    flush() { for (const run of pending.splice(0)) run(); },
    replay() { for (const effect of effects) { effect.cleanup?.(); effect.cleanup = effect.run() || undefined; } },
    reset() { for (const effect of effects) effect.cleanup?.(); refs.length = states.length = callbacks.length = effects.length = pending.length = 0; },
    useRef<T>(initial: T) { return (refs[r++] ??= { current: initial }) as { current: T }; },
    useState<T>(initial: T) { const i = s++; if (!(i in states)) states[i] = initial; return [states[i] as T, (next: T | ((v: T) => T)) => { states[i] = typeof next === "function" ? (next as (v: T) => T)(states[i] as T) : next; }] as const; },
    useCallback<T>(fn: T, deps: unknown[]) { const i = c++; if (!callbacks[i] || !same(callbacks[i].deps, deps)) callbacks[i] = { deps, value: fn }; return callbacks[i].value as T; },
    useEffect(run: () => void | (() => void), deps: unknown[]) { const i = e++, old = effects[i]; if (!old || !same(old.deps, deps)) { old?.cleanup?.(); pending.push(() => { effects[i] = { run, deps, cleanup: run() || undefined }; }); } },
  };
});
vi.mock("react", () => ({ useRef: h.useRef, useState: h.useState, useCallback: h.useCallback, useEffect: h.useEffect }));
vi.mock("@/lib/app-view-prewarm", async () => ({ ...await import("../../../lib/app-view-prewarm"), prepareStateUpdateContextOnce: h.prepare }));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const coverage: StateUpdateCurrentCoverage = { status: "complete", sourceComplete: true, totalSubjects: 0, subjects: {}, requestCount: 0, durationMs: 1, refreshedAt: "2026-10-20T00:00:00Z" };
function fixture() {
  return { api: {}, token: "synthetic", store: { getStateUpdateCurrentCoverage: vi.fn(async () => coverage) }, scope: { ownerKey: "owner", contractId: "contract", appViewId: "view", sourceEntityTypeId: "source", targetEntityTypeId: "target", date: "2026-10-20", dateFieldId: "date", uniqueness: "subject-date-fields", historyMode: "update-current", identity: { version: 1, definitionId: "definition", values: { context: "a" } } } } as unknown as Omit<StateUpdateContextPreparationInput, "signal" | "force">;
}
function TestHarness(input: ReturnType<typeof fixture> | null, status = "online", canPrepare = true, refreshKey = 0) {
  h.begin(); const result = useContextPreparation({ input, connectivityStatus: status, canPrepare, refreshKey }); h.flush(); return result;
}
beforeEach(() => { h.reset(); h.prepare.mockReset().mockResolvedValue(undefined); });
afterEach(() => h.reset());

describe("automatic selected-context scheduling", () => {
  it("waits for complete context and prepares once despite renders/search/response changes", async () => {
    TestHarness(null); await settle(); expect(h.prepare).not.toHaveBeenCalled();
    const input = fixture(); TestHarness(input); await settle();
    for (let i = 0; i < 5; i++) { TestHarness({ ...input, scope: { ...input.scope } }); await settle(); }
    expect(h.prepare).toHaveBeenCalledOnce(); expect(TestHarness(input).phase).toBe("ready");
  });
  it("isolates late A completion from an active B and keeps B's indicator running", async () => {
    const a = fixture(), b = { ...a, scope: { ...a.scope, date: "2026-10-19" } }, old = deferred(), next = deferred();
    h.prepare.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    TestHarness(a); await settle(); const oldSignal = h.prepare.mock.calls[0][0].signal;
    TestHarness(b); await settle(); expect(oldSignal.aborted).toBe(true);
    old.resolve(); await settle(); expect(TestHarness(b).isPreparing).toBe(true);
    next.resolve(); await settle(); expect(TestHarness(b)).toMatchObject({ phase: "ready", isPreparing: false });
  });
  it("ends a failure without a render loop and permits manual retry", async () => {
    const input = fixture(), failure = new Error("controlled failure"); h.prepare.mockRejectedValueOnce(failure);
    TestHarness(input); await settle();
    for (let i = 0; i < 4; i++) { expect(TestHarness({ ...input })).toMatchObject({ phase: "failed", isPreparing: false, error: failure }); await settle(); }
    expect(h.prepare).toHaveBeenCalledOnce();
    await TestHarness(input).prepare(); await settle(); expect(h.prepare).toHaveBeenCalledTimes(2); expect(TestHarness(input).phase).toBe("ready");
  });
  it("refreshes again on reentry to a complete context", async () => {
    const a = fixture(), b = { ...a, scope: { ...a.scope, date: "2026-10-19" } };
    TestHarness(a); await settle(); TestHarness(b); await settle();
    TestHarness(a); await settle();
    expect(TestHarness(a)).toMatchObject({ phase: "ready", coverage, isPreparing: false });
    expect(h.prepare).toHaveBeenCalledTimes(3);
  });
  it("requests remote freshness rather than reusing a complete marker", async () => {
    const input = fixture(); TestHarness(input); await settle();
    expect(h.prepare).toHaveBeenLastCalledWith(expect.objectContaining({ force: true }));
    TestHarness(input, "offline"); await settle(); TestHarness(input); await settle();
    expect(h.prepare).toHaveBeenCalledTimes(2);
    expect(h.prepare).toHaveBeenLastCalledWith(expect.objectContaining({ force: true }));
  });
  it("fetches the remote change on reconnect even with complete coverage, through the real coordinator", async () => {
    const actual = await vi.importActual<typeof import("../../../lib/app-view-prewarm")>("../../../lib/app-view-prewarm");
    const base = fixture(); let stored = coverage, remote = 10, persisted = 10;
    const records = [{ id: "subject", serverId: "subject", displayName: "Synthetic", values: {}, updatedAt: "2026-10-20T00:00:00Z" }];
    const pagination = { page: 1, pageSize: 100, total: 1, totalPages: 1, hasMore: false };
    const api = {
      getEntityRecords: vi.fn(async () => ({ records, pagination })),
      getStateUpdateWorkflow: vi.fn(async () => ({ appView: { id: "view", name: "Synthetic", slug: "synthetic" },
        sourceEntityType: { id: "source", name: "Synthetic" }, targetEntityType: { id: "target", name: "Synthetic" },
        date: base.scope.date, dateFieldId: "date", subjectFieldId: "subject-field", uniqueness: "subject-date-fields", historyMode: "update-current",
        identityContext: base.scope.identity, stateFields: [], extraFields: [], latest: [],
        items: [{ subject: { id: "subject", displayName: "Synthetic" }, current: { recordId: "report", updatedAt: "2026-10-20T00:00:00Z", stateValues: [{ fieldId: "counter", value: remote }] } }],
      })),
    };
    const input = { ...base, api, store: {
      getStateUpdateCurrentCoverage: vi.fn(async () => stored),
      setStateUpdateCurrentCoverage: vi.fn(async ({ coverage: next }: { coverage: typeof coverage }) => { stored = next; }),
      reconcileRemoteRecordsSnapshot: vi.fn(async () => undefined), listCachedRecords: vi.fn(async () => ({ records, pagination })),
      upsertStateUpdateSnapshot: vi.fn(async () => { persisted = remote; return { staleSyncedRemoved: 0, contentVerified: true, persistedRemoteEventCount: 1 }; }),
    } } as unknown as ReturnType<typeof fixture>;
    h.prepare.mockImplementation(actual.prepareStateUpdateContextOnce);
    TestHarness(input); await settle(); await h.prepare.mock.results[0].value; await settle();
    expect(api.getEntityRecords).toHaveBeenCalledOnce(); expect(TestHarness(input).phase).toBe("ready");
    TestHarness(input, "offline"); await settle(); remote = 20;
    TestHarness(input); await settle(); await h.prepare.mock.results[1].value; await settle();
    expect(persisted).toBe(20); expect(api.getStateUpdateWorkflow).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 4; i++) { TestHarness({ ...input }); await settle(); }
    expect(api.getEntityRecords).toHaveBeenCalledTimes(2);
  });
  it("keeps valid persisted coverage distinct from a failed refresh", async () => {
    const input = fixture(), failure = new Error("controlled refresh failure");
    h.prepare.mockRejectedValueOnce(failure); TestHarness(input); await settle();
    expect(TestHarness(input)).toMatchObject({ phase: "failed", coverage, error: failure, isPreparing: false });
    for (let i = 0; i < 4; i++) { TestHarness({ ...input }); await settle(); }
    expect(h.prepare).toHaveBeenCalledOnce();
  });
  it("coalesces invalidations during a read into one subsequent fresh read", async () => {
    const input = fixture(), first = deferred(), next = deferred();
    h.prepare.mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    TestHarness(input); await settle();
    TestHarness(input, "online", true, 1); TestHarness(input, "online", true, 2); await settle();
    expect(h.prepare).toHaveBeenCalledOnce(); first.resolve(); await settle();
    expect(TestHarness(input, "online", true, 2).isPreparing).toBe(true); await settle();
    expect(h.prepare).toHaveBeenCalledTimes(2);
    next.resolve(); await settle();
    expect(TestHarness(input, "online", true, 2)).toMatchObject({ phase: "ready", isPreparing: false });
    for (let i = 0; i < 4; i++) { TestHarness({ ...input }, "online", true, 2); await settle(); }
    expect(h.prepare).toHaveBeenCalledTimes(2);
  });
  it("reads persisted offline coverage, never downloads offline and waits for reconnect sync", async () => {
    const input = fixture(); TestHarness(input, "offline"); await settle();
    expect(TestHarness(input, "offline")).toMatchObject({ phase: "offline", coverage, isPreparing: false }); expect(h.prepare).not.toHaveBeenCalled();
    TestHarness(input, "online", false); await settle(); expect(h.prepare).not.toHaveBeenCalled();
    TestHarness(input); await settle(); expect(h.prepare).toHaveBeenCalledOnce();
    TestHarness(input, "offline"); await settle(); TestHarness(input); await settle(); expect(h.prepare).toHaveBeenCalledTimes(2);
    TestHarness(input); await settle(); expect(h.prepare).toHaveBeenCalledTimes(2);
  });
  it("stops the indicator on disconnect even while the old network response is outstanding", async () => {
    const input = fixture(), hold = deferred(); h.prepare.mockReturnValueOnce(hold.promise);
    TestHarness(input); await settle(); expect(TestHarness(input).isPreparing).toBe(true);
    TestHarness(input, "offline"); await settle(); expect(TestHarness(input, "offline").isPreparing).toBe(false);
    hold.resolve(); await settle(); expect(TestHarness(input, "offline").phase).toBe("offline");
  });
  it("a concurrent marker read failure cannot finish an active preparation", async () => {
    const input = fixture(), hold = deferred();
    vi.mocked(input.store.getStateUpdateCurrentCoverage).mockRejectedValueOnce(new Error("controlled concurrent read"));
    h.prepare.mockReturnValueOnce(hold.promise); TestHarness(input); await settle();
    expect(TestHarness(input).isPreparing).toBe(true);
    hold.resolve(); await settle(); expect(TestHarness(input).phase).toBe("ready");
  });
  it("checks coverage again after the existing sync refresh signal, not during sync", async () => {
    const input = fixture(); TestHarness(input); await settle();
    TestHarness(input, "online", false, 1); await settle(); expect(h.prepare).toHaveBeenCalledOnce();
    TestHarness(input, "online", true, 1); await settle(); expect(h.prepare).toHaveBeenCalledTimes(2);
    TestHarness(input, "online", true, 1); await settle(); expect(h.prepare).toHaveBeenCalledTimes(2);
  });
  it("folds reconnect and repeated sync signals behind the existing sync gate into one read", async () => {
    const input = fixture(); TestHarness(input); await settle();
    TestHarness(input, "offline"); await settle();
    TestHarness(input, "online", false, 1); TestHarness(input, "online", false, 2); await settle();
    expect(h.prepare).toHaveBeenCalledOnce();
    TestHarness(input, "online", true, 2); await settle();
    for (let i = 0; i < 4; i++) { TestHarness({ ...input }, "online", true, 2); await settle(); }
    expect(h.prepare).toHaveBeenCalledTimes(2);
  });
  it("restarts a cancelled effect replay without concurrent uncontrolled preparation", async () => {
    const input = fixture(), hold = deferred(); h.prepare.mockReturnValueOnce(hold.promise);
    TestHarness(input); await settle(); h.replay(); await settle();
    expect(h.prepare.mock.calls[0][0].signal.aborted).toBe(true); expect(h.prepare).toHaveBeenCalledTimes(2);
    hold.resolve(); await settle(); expect(TestHarness(input).phase).toBe("ready");
  });
  it.each(["ownerKey", "contractId", "appViewId", "sourceEntityTypeId", "targetEntityTypeId", "date", "dateFieldId"] as const)("isolates a changed %s", async field => {
    const input = fixture(), hold = deferred(); h.prepare.mockReturnValueOnce(hold.promise); TestHarness(input); await settle();
    const changed = { ...input, scope: { ...input.scope, [field]: "other" } }; TestHarness(changed); await settle(); hold.resolve(); await settle();
    expect(TestHarness(changed)).toMatchObject({ phase: "ready", isPreparing: false }); expect(h.prepare).toHaveBeenCalledTimes(2);
  });
  it.each(["definition", "combination"])("isolates a changed identity %s", async field => {
    const input = fixture(), hold = deferred(); h.prepare.mockReturnValueOnce(hold.promise); TestHarness(input); await settle();
    const changed = { ...input, scope: { ...input.scope, identity: { ...input.scope.identity!,
      ...(field === "definition" ? { definitionId: "other" } : { values: { context: "b" } }) } } };
    TestHarness(changed); await settle(); hold.resolve(); await settle();
    expect(TestHarness(changed)).toMatchObject({ phase: "ready", isPreparing: false }); expect(h.prepare).toHaveBeenCalledTimes(2);
  });
});
