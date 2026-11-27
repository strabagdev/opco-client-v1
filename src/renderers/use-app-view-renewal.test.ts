// @ts-expect-error Node types are intentionally absent from the Expo config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { loadAppViewsWithCache } from "../lib/app-navigation-cache";
import { selectContractId } from "../lib/contract-selection";
import { revisionCanonical } from "../lib/revision-receipts";
import { coherentCachedPanelViews } from "../lib/panel-definition";
import { getAppViewBootstrapState, resolveAppViewLoadError } from "./use-app-view-state";
import { OpcoApiError } from "../lib/opco-api";
const view = { id: "view", name: "Synthetic", type: "WORKFLOW", config: { workflowKey: "attendance", sourceEntityTypeId: "people" } };
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  let generation = 1;
  const snapshots = new Map<string, any>();
  const cache = { getAppViews: vi.fn(async (o: string, c: string) => snapshots.get(JSON.stringify([o, c])) ?? null),
    upsertAppViews: vi.fn(async (o: string, c: string, views: any[], syncedAt: string) => { snapshots.set(JSON.stringify([o, c]), { views, syncedAt }); }) };
  const api = { getAppViews: vi.fn(async () => ({ views: [view] })), getAuthSessionGeneration: () => generation, isAuthSessionCurrent: (g: number) => g === generation };
  const input: any = { api, definitionCache: cache, ownerKey: "org:A", selectedContractId: "contract", status: "authenticated", token: "synthetic-1", context: { contracts: [{ id: "contract" }] } };
  return { input, api, cache, nextGeneration() { generation++; } };
}
// Execute the real hook with deterministic React hook cells. Real DOM/focus is
// checked separately in Chromium/OPFS; this is not a browser integration claim.
function mount(session: any) {
  const source = ts.createSourceFile("hook.ts", readFileSync("src/renderers/use-app-view.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const node = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "useAppView")!;
  let cells: any[] = [], cursor = 0, dirty = true, effects: (() => void)[] = [], value: any;
  const same = (a: any[], b: any[]) => a?.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const useState = (initial: any) => { const n = cursor++; cells[n] ??= { value: initial }; return [cells[n].value, (next: any) => { cells[n].value = typeof next === "function" ? next(cells[n].value) : next; dirty = true; }]; };
  const useMemo = (fn: () => any, deps: any[]) => { const n = cursor++; if (!cells[n] || !same(cells[n].deps, deps)) cells[n] = { deps, value: fn() }; return cells[n].value; };
  const useEffect = (fn: () => any, deps: any[]) => { const n = cursor++; if (!cells[n] || !same(cells[n].deps, deps)) { const old = cells[n]; cells[n] = { deps, cleanup: old?.cleanup }; effects.push(() => { cells[n].cleanup?.(); cells[n].cleanup = fn(); }); } };
  const publish = vi.fn(), dependencies = { useState, useMemo, useEffect, useSession: () => session, usePublishDesktopCatalog: () => publish, loadAppViewsWithCache, selectContractId, revisionCanonical, coherentCachedPanelViews, getAppViewBootstrapState, resolveAppViewLoadError };
  const fn = new Function(...Object.keys(dependencies), ts.transpileModule(node.getText(source).replace(/^export /, "") + ";return useAppView;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(dependencies));
  const render = () => { dirty = false; cursor = 0; effects = []; value = fn("view"); effects.forEach(f => f()); };
  render();
  return { get value() { if (dirty) render(); return value; }, publish,
    update(patch: any) { session = { ...session, ...patch }; render(); },
    async until(done = () => Boolean(value.appView && !value.isLoading)) { for (let n = 0; n < 160; n++) { await Promise.resolve(); if (dirty) render(); if (done()) return; } throw Error("AppView hook did not settle"); },
    unmount() { cells.forEach(c => c.cleanup?.()); cells = []; } };
}
describe("Attendance bootstrap during compatible credential renewal", () => {
  it("never switches a resolved form to initial loading and retains an identical view object", async () => {
    const f = fixture(), h = mount(f.input); await h.until(); const first = h.value.appView;
    const pending = deferred<any>(); f.api.getAppViews.mockImplementationOnce(() => pending.promise); h.update({ token: "synthetic-2" });
    expect(h.value.isLoading).toBe(false); expect(h.value.appView).toBe(first);
    pending.resolve({ views: [{ ...view, config: { ...view.config } }] }); await h.until(() => f.api.getAppViews.mock.calls.length === 2 && !h.value.isLoading);
    await h.until(() => true); expect(h.value.appView).toBe(first);
    h.update({ offlinePreparationDiagnostics: { status: "running" } }); await h.until(() => true); expect(f.api.getAppViews).toHaveBeenCalledTimes(2); h.unmount();
  });
  it.each(["owner", "contract", "logout-same-owner"])("retires the view immediately on %s and ignores a late previous response", async change => {
    const f = fixture(), h = mount(f.input); await h.until(); const pending = deferred<any>(); f.api.getAppViews.mockImplementationOnce(() => pending.promise); h.update({ token: "renewed" });
    f.nextGeneration(); f.api.getAppViews.mockImplementation(() => new Promise(() => {}));
    h.update(change === "owner" ? { ownerKey: "org:B", token: "B" } : change === "contract" ? { selectedContractId: "other" } : { token: "new-A" });
    expect(h.value.appView).toBeNull(); const calls = h.publish.mock.calls.length; pending.resolve({ views: [view] }); await h.until(() => true);
    expect(h.publish).toHaveBeenCalledTimes(calls); h.unmount();
  });
  it.each(["denied", "unassigned"])("retires the retained form after a real %s result", async outcome => {
    const f = fixture(), h = mount(f.input); await h.until();
    if (outcome === "denied") f.api.getAppViews.mockRejectedValue(new OpcoApiError("Denied", "FORBIDDEN", 403));
    else f.api.getAppViews.mockResolvedValue({ views: [] });
    h.update({ token: "renewed" }); await h.until(() => h.value.appView === null && !h.value.isLoading); expect(h.value.appView).toBeNull(); h.unmount();
  });
  it("publishes a changed configuration rather than preserving an obsolete object", async () => {
    const f = fixture(), h = mount(f.input); await h.until(); const previous = h.value.appView;
    f.api.getAppViews.mockResolvedValue({ views: [{ ...view, config: { ...view.config, sourceEntityTypeId: "other" } }] }); h.update({ token: "renewed" });
    await h.until(() => h.value.appView?.config.sourceEntityTypeId === "other"); expect(h.value.appView).not.toBe(previous); h.unmount();
  });
});


describe("generic resolved views during compatible renewal", () => {
  function sharedFixture(kind: string) {
    const f = fixture(), resolved = kind === "RECORDS" ? { id: "view", name: "Shared records", type: "RECORDS", config: { entityTypeId: "events" } }
      : kind === "REPORT" ? { id: "view", name: "Shared report", type: "REPORT", config: { entityTypeId: "events", presentationMode: "TABLE" } }
      : { id: "view", name: "Shared state", type: "WORKFLOW", config: { workflowKey: "state-update", sourceEntityTypeId: "people" } };
    f.api.getAppViews.mockResolvedValue({ views: [resolved] } as any);
    return { ...f, resolved };
  }
  it.each(["RECORDS", "state-update", "REPORT"])("keeps %s mounted with the same definition while renewing", async kind => {
    const f = sharedFixture(kind), h = mount(f.input); await h.until(); const first = h.value.appView;
    const response = deferred<any>(); f.api.getAppViews.mockImplementationOnce(() => response.promise); h.update({ token: "renewed-synthetic" });
    expect(h.value.isLoading).toBe(false); expect(h.value.appView).toBe(first);
    response.resolve({ views: [{ ...f.resolved, config: { ...f.resolved.config } }] }); await h.until();
    expect(h.value.appView).toBe(first); h.unmount();
  });
  it.each(["RECORDS", "state-update", "REPORT"])("does not retain %s after authorization denial", async kind => {
    const f = sharedFixture(kind), h = mount(f.input); await h.until();
    f.api.getAppViews.mockRejectedValue(new OpcoApiError("Denied", "FORBIDDEN", 403)); h.update({ token: "renewed-synthetic" });
    await h.until(() => !h.value.isLoading && h.value.appView === null); expect(h.value.appView).toBeNull(); h.unmount();
  });
  it.each(["RECORDS", "state-update", "REPORT"])("retires %s for another session generation of the same owner", async kind => {
    const f = sharedFixture(kind), h = mount(f.input); await h.until(); f.nextGeneration(); f.api.getAppViews.mockImplementation(() => new Promise(() => {}));
    h.update({ token: "another-login" }); expect(h.value.appView).toBeNull(); h.unmount();
  });
});
