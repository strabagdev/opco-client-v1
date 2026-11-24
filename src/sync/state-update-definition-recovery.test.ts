import { describe, expect, it, vi } from "vitest";
import type { CachedAppViewDefinition } from "../lib/app-view-definitions-cache";
import type { PendingOperation } from "../lib/offline-records";
import { OpcoApiError, type WorkflowAppView, type AttendanceWorkflowConfig } from "../lib/opco-api";
import { operationalCalendarKey } from "../lib/operational-calendar";
import type { OfflineStateUpdatePayload } from "../lib/state-update-offline";
import { syncPendingStateUpdatesOnce } from "./state-update-sync";

const calendar = { version: 1 as const, timeZone: "America/Santiago", dayStart: "08:00", bands: [] };
const instant = "2026-11-24T09:10:11.092Z";
function fixture() {
  let generation = 1;
  const view = { id: "view", name: "Synthetic", slug: "view", type: "WORKFLOW", sortOrder: 0, icon: null,
    config: { workflowKey: "attendance", sourceEntityTypeId: "people", targetEntityTypeId: "events", personFieldId: "person", dateFieldId: "day", statusFieldId: "state", defaultCheckInOptionId: "a", operationalCalendar: calendar } } as WorkflowAppView & { config: AttendanceWorkflowConfig };
  const payload: OfflineStateUpdatePayload = { clientRequestId: "immutable-request", appViewId: "view", subjectRecordId: "person", subjectDisplayName: "Synthetic", date: "2026-11-23", historyMode: "update-current", uniqueness: "subject-date", stateValues: [{ fieldId: "state", optionId: "a" }], extraValues: { lot: "lot-one" }, eventOccurredAt: instant, operationalDay: { version: 1, calendarKey: operationalCalendarKey(calendar), mode: "AUTO" } };
  const operation: PendingOperation = { attempts: 0, clientRequestId: "immutable-request", contractId: "contract", entityTypeId: "events", id: "operation", localRecordId: "local", ownerKey: "org:A", operation: "STATE_UPDATE", payload, createdAt: instant, updatedAt: instant, serverRecordId: null, lastErrorCode: null, lastErrorMessage: null };
  const operations = [operation];
  const store = {
    getAppViewDefinition: vi.fn(async (): Promise<CachedAppViewDefinition | null> => null),
    getAppViews: vi.fn(async () => null as { views: WorkflowAppView[]; syncedAt: string } | null), upsertAppViews: vi.fn(async () => {}),
    listPendingStateUpdateOperations: vi.fn(async () => operations.slice()), markStateUpdateOperationSyncing: vi.fn(async () => true),
    retryStateUpdateOperation: vi.fn(async () => {}), failStateUpdateOperation: vi.fn(async () => {}), markStateUpdateOperationConflict: vi.fn(async () => {}),
    completeStateUpdateOperation: vi.fn(async (op: PendingOperation) => { operations.splice(operations.indexOf(op), 1); }),
  };
  const api = { getAuthSessionGeneration: () => generation,
    getAppViews: vi.fn(async () => ({ views: [view] })),
    saveStateUpdateWorkflow: vi.fn(async () => ({ appView: { id: "view", name: "Synthetic", slug: "view" }, results: [{ result: "CREATED" as const, subjectRecordId: "person", recordId: "server", updatedAt: instant }] })),
  };
  const cached = (changes: Partial<CachedAppViewDefinition> = {}): CachedAppViewDefinition => ({ ownerKey: "org:A", contractId: "contract", appViewId: "view", appViewType: "WORKFLOW", workflowKey: "attendance", status: "ready", lastPreparedAt: instant, definition: { kind: "attendance", appView: view, statuses: [] }, ...changes });
  const run = () => syncPendingStateUpdatesOnce({ api, store, ownerKey: "org:A", token: "synthetic-A", syncRunId: "isolated-run" });
  return { api, store, operation, operations, view, cached, run, retire: () => { generation++; } };
}
function unchanged(f: ReturnType<typeof fixture>, before: string) {
  expect(JSON.stringify(f.operation.payload)).toBe(before); expect(f.operation.clientRequestId).toBe("immutable-request"); expect(f.operation.localRecordId).toBe("local"); expect(f.operation.ownerKey).toBe("org:A");
}

describe("STATE_UPDATE missing operational definition recovery", () => {
  it("recovers missing config through assigned views before sending the unchanged intent", async () => {
    const f = fixture(), before = JSON.stringify(f.operation.payload); const r = await f.run();
    expect(r.completed).toBe(1); expect(f.api.getAppViews).toHaveBeenCalledOnce(); expect(f.api.getAppViews).toHaveBeenCalledWith("synthetic-A", "contract", expect.anything());
    expect(f.api.saveStateUpdateWorkflow).toHaveBeenCalledWith("synthetic-A", "contract", "view", expect.objectContaining({ clientRequestId: "immutable-request", date: "2026-11-23", eventOccurredAt: instant, operationalDay: (f.operation.payload as OfflineStateUpdatePayload).operationalDay, extraValues: { lot: "lot-one" } }), expect.anything());
    expect(f.store.failStateUpdateOperation).not.toHaveBeenCalled(); unchanged(f, before);
  });
  it("uses an available matching definition without an extra config request", async () => {
    const f = fixture(); f.store.getAppViewDefinition.mockResolvedValue(f.cached()); expect((await f.run()).completed).toBe(1); expect(f.api.getAppViews).not.toHaveBeenCalled();
  });
  it("revalidates a stale cached calendar instead of treating it as a proven remote change", async () => {
    const f = fixture(), oldView = structuredClone(f.view); oldView.config.operationalCalendar = { ...calendar, dayStart: "09:00" };
    const cached = f.cached(); cached.definition.appView = oldView; f.store.getAppViewDefinition.mockResolvedValue(cached);
    expect((await f.run()).completed).toBe(1); expect(f.api.getAppViews).toHaveBeenCalledOnce(); expect(f.store.failStateUpdateOperation).not.toHaveBeenCalled();
  });
  it("recovers config from a partial/error definition without certifying offline coverage", async () => {
    const f = fixture(); const cached=f.cached(); cached.definition={kind:"error",appView:f.view};f.store.getAppViewDefinition.mockResolvedValue(cached);
    expect((await f.run()).completed).toBe(1);expect(f.api.getAppViews).toHaveBeenCalledOnce();
  });
  it("does not reuse another user's or contract's cached definition", async () => {
    const f = fixture(); f.store.getAppViewDefinition.mockResolvedValue(f.cached({ ownerKey: "org:B", contractId: "other" })); expect((await f.run()).completed).toBe(1); expect(f.api.getAppViews).toHaveBeenCalledOnce(); expect(f.store.upsertAppViews.mock.calls[0].slice(0, 2)).toEqual(["org:A", "contract"]);
  });
  it.each(["network", "server", "forbidden"])("keeps metadata %s errors retryable with no blind write", async kind => {
    const f = fixture(), before = JSON.stringify(f.operation.payload); f.api.getAppViews.mockRejectedValue(kind === "network" ? new TypeError("Controlled transport failure") : new OpcoApiError("Controlled definition failure", kind === "server" ? "DB_UNAVAILABLE" : "APP_VIEW_FORBIDDEN", kind === "server" ? 503 : 403));
    const r = await f.run(); expect(r).toMatchObject({ retriable: 1, failed: 0 }); expect(f.store.retryStateUpdateOperation).toHaveBeenCalledWith(f.operation, "STATE_UPDATE_DEFINITION_UNAVAILABLE", expect.any(String)); expect(f.api.saveStateUpdateWorkflow).not.toHaveBeenCalled(); expect(f.store.failStateUpdateOperation).not.toHaveBeenCalled(); unchanged(f, before);
  });
  it("does not certify compatibility from an offline navigation-cache fallback", async () => {
    const f = fixture(); f.api.getAppViews.mockRejectedValue(new TypeError("Offline")); f.store.getAppViews.mockResolvedValue({ views: [f.view], syncedAt: instant });
    expect(await f.run()).toMatchObject({ retriable: 1, failed: 0 }); expect(f.api.saveStateUpdateWorkflow).not.toHaveBeenCalled();
  });
  it("keeps a missing assigned view retryable rather than inventing a changed calendar", async () => {
    const f = fixture(); f.api.getAppViews.mockResolvedValue({ views: [] }); expect(await f.run()).toMatchObject({ retriable: 1, failed: 0 }); expect(f.api.saveStateUpdateWorkflow).not.toHaveBeenCalled();
  });
  it("keeps the existing protection when a verified definition removed the calendar", async () => {
    const f = fixture(); delete f.view.config.operationalCalendar; expect(await f.run()).toMatchObject({ failed: 1, completed: 0 }); expect(f.store.failStateUpdateOperation).toHaveBeenCalledWith(f.operation, "OPERATIONAL_CALENDAR_CHANGED", expect.any(String), undefined, null); expect(f.api.saveStateUpdateWorkflow).not.toHaveBeenCalled();
  });
  it("keeps the existing review when an available calendar really differs", async () => {
    const f = fixture(); f.view.config.operationalCalendar = { ...calendar, dayStart: "09:00" }; expect(await f.run()).toMatchObject({ failed: 1, completed: 0 }); expect(f.store.failStateUpdateOperation).toHaveBeenCalledWith(f.operation, "OPERATIONAL_DAY_REVIEW_REQUIRED", expect.any(String), undefined, null); expect(f.api.saveStateUpdateWorkflow).not.toHaveBeenCalled();
  });
  it("retires a delayed config response without caching it or sending with the next session", async () => {
    const f = fixture(), before = JSON.stringify(f.operation.payload); f.api.getAppViews.mockImplementation(async () => { f.retire(); return { views: [f.view] }; });
    expect(await f.run()).toMatchObject({ retriable: 1, failed: 0 }); expect(f.store.retryStateUpdateOperation).toHaveBeenCalledWith(f.operation, "AUTH_SESSION_CHANGED", expect.any(String)); expect(f.store.upsertAppViews).not.toHaveBeenCalled(); expect(f.api.saveStateUpdateWorkflow).not.toHaveBeenCalled(); unchanged(f, before);
  });
  it("rechecks the generation after awaiting a cached definition", async () => {
    const f = fixture(); f.store.getAppViewDefinition.mockImplementation(async () => { f.retire(); return f.cached(); }); expect(await f.run()).toMatchObject({ retriable: 1, failed: 0 }); expect(f.api.saveStateUpdateWorkflow).not.toHaveBeenCalled();
  });
  it("shares recovery only inside this run and revalidates on a later run", async () => {
    const f = fixture(); f.operations.push({ ...f.operation, id: "second", clientRequestId: "second-request", localRecordId: "second-local" }); expect((await f.run()).completed).toBe(2); expect(f.api.getAppViews).toHaveBeenCalledOnce();
    f.operations.push({ ...f.operation, id: "later", clientRequestId: "later-request" }); expect((await f.run()).completed).toBe(1); expect(f.api.getAppViews).toHaveBeenCalledTimes(2);
  });
});
