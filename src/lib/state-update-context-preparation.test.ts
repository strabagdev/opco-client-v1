import { describe, expect, it, vi } from "vitest";
import { prepareStateUpdateContextOnce, stateUpdateContextPreparationKey, type StateUpdateContextPreparationInput } from "./app-view-prewarm";
import type { StateUpdateCurrentCoverage } from "./state-update-offline";
import type { StateUpdateResponse } from "./opco-api";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
let sequence = 0;
function fixture() {
  const scope = { ownerKey: `owner-${++sequence}`, contractId: "contract", appViewId: "view", sourceEntityTypeId: "source", targetEntityTypeId: "target", date: "2026-10-20", dateFieldId: "date", uniqueness: "subject-date-fields" as const, historyMode: "update-current" as const,
    identity: { version: 1 as const, definitionId: "definition", values: { context: "option-a" } } };
  const records = ["subject", "empty"].map(id => ({ id, serverId: id, displayName: id, values: {}, updatedAt: "2026-10-20T00:00:00Z" }));
  const coverage = new Map<string, StateUpdateCurrentCoverage>();
  const persisted = new Map<string, string>();
  const response = (identity = scope.identity, subjectId = "subject"): StateUpdateResponse => ({
    appView: { id: scope.appViewId, name: "Synthetic", slug: "synthetic" }, sourceEntityType: { id: "source", name: "Subjects" }, targetEntityType: { id: "target", name: "Reports" },
    date: scope.date, dateFieldId: "date", subjectFieldId: "subject-field", historyMode: "update-current", uniqueness: "subject-date-fields", identityContext: identity,
    items: [{ subject: { id: subjectId, displayName: subjectId }, current: subjectId === "empty" ? null : { recordId: "report-a", updatedAt: "2026-10-20T00:00:00Z", stateValues: [] } }], latest: [], stateFields: [], extraFields: [],
  });
  const api = {
    getEntityRecords: vi.fn(async () => ({ records, pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1, hasMore: false } })),
    getStateUpdateWorkflow: vi.fn(async (_t: string, _c: string, _v: string, query: { identity?: typeof scope.identity; subjectRecordId?: string }) => response(query.identity, query.subjectRecordId)),
  };
  const store = {
    reconcileRemoteRecordsSnapshot: vi.fn(async () => undefined),
    listCachedRecords: vi.fn(async () => ({ records, pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1, hasMore: false } })),
    getStateUpdateCurrentCoverage: vi.fn(async (s: typeof scope) => coverage.get(stateUpdateContextPreparationKey(s)) ?? null),
    setStateUpdateCurrentCoverage: vi.fn(async (s: typeof scope & { coverage: StateUpdateCurrentCoverage }) => { coverage.set(stateUpdateContextPreparationKey(s), JSON.parse(JSON.stringify(s.coverage))); }),
    upsertStateUpdateSnapshot: vi.fn(async (s: typeof scope & { items: StateUpdateResponse["items"] }) => {
      for (const item of s.items) if (item.current) persisted.set(stateUpdateContextPreparationKey(s) + item.current.recordId, item.current.recordId);
      return { staleSyncedRemoved: 0, contentVerified: true, persistedRemoteEventCount: s.items.filter(item => item.current).length };
    }),
  };
  const controller = new AbortController();
  const input = { api, store, scope, token: "synthetic", signal: controller.signal } as unknown as StateUpdateContextPreparationInput;
  return { input, scope, api, store, coverage, persisted, controller, response };
}

describe("selected context uses the existing preparation coordinator", () => {
  it("coalesces concurrent requests, reuses verified coverage and permits explicit refresh", async () => {
    const f = fixture(), hold = deferred<void>();
    const read = f.api.getEntityRecords.getMockImplementation()!;
    f.api.getEntityRecords.mockImplementationOnce(async () => { await hold.promise; return read(); });
    const first = prepareStateUpdateContextOnce(f.input), second = prepareStateUpdateContextOnce({ ...f.input });
    hold.resolve(); await Promise.all([first, second]);
    expect(f.api.getEntityRecords).toHaveBeenCalledOnce(); expect(f.api.getStateUpdateWorkflow).toHaveBeenCalledTimes(2);
    expect(f.coverage.get(stateUpdateContextPreparationKey(f.scope))).toMatchObject({ status: "complete", sourceComplete: true, subjects: { empty: { status: "verified", remoteRecordId: null } } });
    await prepareStateUpdateContextOnce(f.input);
    expect(f.api.getEntityRecords).toHaveBeenCalledOnce();
    await prepareStateUpdateContextOnce({ ...f.input, force: true });
    expect(f.api.getEntityRecords).toHaveBeenCalledTimes(2); expect(f.persisted.size).toBe(1);
  });

  it("keeps failed persistence partial and permits a later explicit retry", async () => {
    const f = fixture(); f.store.upsertStateUpdateSnapshot.mockRejectedValueOnce(new Error("controlled write failure"));
    await expect(prepareStateUpdateContextOnce(f.input)).rejects.toThrow("STATE_UPDATE_CURRENT_PREPARATION_FAILED");
    expect(f.coverage.get(stateUpdateContextPreparationKey(f.scope))?.status).toBe("partial");
    await prepareStateUpdateContextOnce({ ...f.input, force: true });
    expect(f.coverage.get(stateUpdateContextPreparationKey(f.scope))?.status).toBe("complete");
  });

  it("a failed refresh retains the previous verified coverage instead of replacing it with an empty attempt", async () => {
    const f = fixture(); await prepareStateUpdateContextOnce(f.input);
    const previous = structuredClone(f.coverage.get(stateUpdateContextPreparationKey(f.scope)));
    f.api.getStateUpdateWorkflow.mockRejectedValueOnce(new Error("controlled remote failure"));
    await expect(prepareStateUpdateContextOnce({ ...f.input, force: true })).rejects.toThrow();
    expect(f.coverage.get(stateUpdateContextPreparationKey(f.scope))).toEqual(previous);
    expect(f.persisted.size).toBe(1);
  });
  it("never treats a retained complete marker as a successfully verified new refresh", async () => {
    const f = fixture(); await prepareStateUpdateContextOnce(f.input);
    const previous = structuredClone(f.coverage.get(stateUpdateContextPreparationKey(f.scope)));
    const actual = f.api.getEntityRecords.getMockImplementation()!;
    f.api.getEntityRecords.mockImplementationOnce(async () => { const response = await actual(); return { ...response, pagination: { ...response.pagination, total: 3 } }; });
    await expect(prepareStateUpdateContextOnce({ ...f.input, force: true })).rejects.toThrow("STATE_UPDATE_CURRENT_PREPARATION_INCOMPLETE");
    expect(f.coverage.get(stateUpdateContextPreparationKey(f.scope))).toEqual(previous);
  });
  it("a failed refresh cannot restore complete over an intervening invalidation", async () => {
    const f = fixture(); await prepareStateUpdateContextOnce(f.input);
    const key = stateUpdateContextPreparationKey(f.scope), invalidated = { ...f.coverage.get(key)!, status: "partial" as const, subjects: {} };
    f.api.getStateUpdateWorkflow.mockImplementationOnce(async () => { f.coverage.set(key, invalidated); throw new Error("controlled failure after invalidation"); });
    await expect(prepareStateUpdateContextOnce({ ...f.input, force: true })).rejects.toThrow();
    expect(f.coverage.get(key)).toEqual(invalidated);
  });

  it.each(["date", "identity"])("rejects a response from another %s", async difference => {
    const f = fixture(); f.api.getStateUpdateWorkflow.mockImplementation(async () => ({ ...f.response(), ...(difference === "date" ? { date: "2026-10-19" } : { identityContext: { ...f.scope.identity, values: { context: "wrong" } } }) }));
    await expect(prepareStateUpdateContextOnce(f.input)).rejects.toThrow();
    expect(f.store.upsertStateUpdateSnapshot).not.toHaveBeenCalled();
    expect(f.coverage.get(stateUpdateContextPreparationKey(f.scope))?.status).toBe("partial");
  });

  it("serializes a cancelled A writer before preparing A again; B stays isolated", async () => {
    const f = fixture(), hold = deferred<void>(), started = deferred<void>();
    const actual = f.api.getStateUpdateWorkflow.getMockImplementation()!;
    f.api.getStateUpdateWorkflow.mockImplementation(async (...args) => { started.resolve(); await hold.promise; return actual(...args); });
    const oldA = prepareStateUpdateContextOnce(f.input); await started.promise;
    f.controller.abort();
    const again = prepareStateUpdateContextOnce({ ...f.input, signal: new AbortController().signal });
    f.api.getStateUpdateWorkflow.mockImplementation(actual);
    const bScope = { ...f.scope, identity: { ...f.scope.identity, values: { context: "option-b" } } };
    await prepareStateUpdateContextOnce({ ...f.input, scope: bScope, signal: new AbortController().signal });
    expect(f.api.getEntityRecords).toHaveBeenCalledTimes(2); // old A + B; replacement A still waits
    hold.resolve(); await Promise.all([oldA, again]);
    expect(f.api.getEntityRecords).toHaveBeenCalledTimes(3);
    expect(f.coverage.get(stateUpdateContextPreparationKey(f.scope))?.status).toBe("complete");
    expect(f.coverage.get(stateUpdateContextPreparationKey(bScope))?.status).toBe("complete");
    expect(f.persisted.size).toBe(2);
  });

  it("does not download when an already cancelled context is requested", async () => {
    const f = fixture(); f.controller.abort(); await prepareStateUpdateContextOnce(f.input);
    expect(f.api.getEntityRecords).not.toHaveBeenCalled(); expect(f.api.getStateUpdateWorkflow).not.toHaveBeenCalled();
  });

  it("includes all scope and configuration identities in the single-flight key", () => {
    const f = fixture(), key = stateUpdateContextPreparationKey(f.scope);
    for (const field of ["ownerKey", "contractId", "appViewId", "sourceEntityTypeId", "targetEntityTypeId", "date", "dateFieldId"] as const) expect(stateUpdateContextPreparationKey({ ...f.scope, [field]: "different" })).not.toBe(key);
    expect(stateUpdateContextPreparationKey({ ...f.scope, identity: { ...f.scope.identity, definitionId: "other" } })).not.toBe(key);
  });
});
