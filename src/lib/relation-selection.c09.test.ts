// @ts-expect-error Node types intentionally absent from the Expo config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { localRelationSelection, loadStateUpdateRelationPage, RelationSelectionError } from "./state-update-relations";
import { OpcoApiError, OpcoNetworkError, type EntityField } from "./opco-api";
import { revisionCanonical } from "./revision-receipts";
import { catalogCoverageMessage } from "./app-view-definitions-cache";
import { getUnknownRelationValueErrors } from "./record-form";

const field = { id: "relation", key: "related", name: "Related", type: "RELATION", required: false,
  config: { relation: { targetEntityTypeId: "catalog", relationKind: "ONE" } } } as EntityField;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture() {
  const cache = new Map<string, any>();
  const key = (q: any, id = q.recordId) => JSON.stringify([q.ownerKey, q.contractId, q.entityTypeId, id]);
  const remote = (id: string) => ({ id, displayName: `Choice ${id}`, values: {}, updatedAt: "2026-11-24T00:00:00Z" });
  const store = {
    getCachedRecord: vi.fn(async (q: any) => cache.get(key(q)) ?? null),
    upsertRemoteRecords: vi.fn(async (q: any) => { for (const r of q.records) cache.set(key(q, r.id), { ...r, localId: r.id, serverId: r.id, syncStatus: "synced" }); }),
    listCachedRecords: vi.fn(async (q: any) => ({ records: [...cache.entries()].filter(([k]) => k.startsWith(JSON.stringify([q.ownerKey, q.contractId, q.entityTypeId]).slice(0, -1) + ",")).map(([, r]) => r), pagination: { page: 1, totalPages: 1 } })),
  };
  let generation = 1;
  const api = { getAuthSessionGeneration: () => generation, isAuthSessionCurrent: (g: number) => g === generation,
    getEntityRecord: vi.fn(async (_t: string, _c: string, _e: string, id: string) => ({ record: remote(id) })),
    getEntityRecords: vi.fn(async (_t: string, _c: string, _e: string, q: any) => ({ records: [remote(`page-${q.page}-${q.search ?? ""}`)], pagination: { page: q.page, totalPages: 6 } })),
  };
  const input: any = { api, store, token: "synthetic", ownerKey: "org:A", contractId: "contract", fields: [field], online: true, scope: "record-1", identity: "record", selected: { relation: ["090"] } };
  return { api, store, cache, input, remote, nextSession() { generation++; } };
}
function hook(input: any, subscribeOfflinePreparationExecution: any = () => () => {}) {
  const src = ts.createSourceFile("hook.ts", readFileSync("src/renderers/workflows/state-update/use-extra-relations.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const node = src.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "useExtraRelations")!;
  let cells: any[] = [], cursor = 0, dirty = true, pending: (() => void)[] = [], layouts: (() => void)[] = [], value: any;
  const same = (a: any[], b: any[]) => a?.length === b?.length && a.every((v, i) => Object.is(v, b[i]));
  const useState = (initial: any) => { const n = cursor++; if (!cells[n]) cells[n] = { value: initial }; return [cells[n].value, (next: any) => { cells[n].value = typeof next === "function" ? next(cells[n].value) : next; dirty = true; }]; };
  const useRef = (initial: any) => { const n = cursor++; return cells[n] ??= { current: initial }; };
  const memoCell = (f: () => any, deps: any[]) => { const n = cursor++; if (!cells[n] || !same(cells[n].deps, deps)) cells[n] = { deps, value: f() }; return cells[n].value; };
  const effect = (f: () => any, deps: any[], layout: boolean) => { const n = cursor++; if (!cells[n] || !same(cells[n].deps, deps)) { const old = cells[n]; cells[n] = { deps, cleanup: old?.cleanup }; (layout ? layouts : pending).push(() => { cells[n].cleanup?.(); cells[n].cleanup = f(); }); } };
  const deps = { revisionCanonical, useState, useRef, useMemo: memoCell, useCallback: (fn: any, deps: any[]) => memoCell(() => fn, deps), subscribeOfflinePreparationExecution, useEffect: (f: any, d: any) => effect(f, d, false), useLayoutEffect: (f: any, d: any) => effect(f, d, true), localRelationSelection, loadStateUpdateRelationPage, RelationSelectionError, catalogCoverageMessage };
  const fn = new Function(...Object.keys(deps), ts.transpileModule(node.getText(src).replace(/^export /, "") + ";return useExtraRelations;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(...Object.values(deps));
  function render() { dirty = false; cursor = 0; pending = []; layouts = []; value = fn(input); layouts.forEach(f => f()); pending.forEach(f => f()); }
  render();
  return {
    get value() { if (dirty) render(); return value; },
    update(patch: any) { input = { ...input, ...patch }; render(); },
    async until(done = () => Boolean(value.catalogs.relation?.loaded || value.catalogs.relation?.error)) { for (let n = 0; n < 160; n++) { await Promise.resolve(); if (dirty) render(); if (done()) return; } throw Error("Hook did not reach the asserted completion phase"); },
    unmount() { cells.forEach(c => c?.cleanup?.()); cells = []; },
  };
}

describe("C09 selection is resolved by exact identity independently of the page", () => {
  it.each([[["090"]], [["090", "137"]]])("hydrates cold selected identities %j beyond page 25", async ids => {
    const f = fixture(), h = hook({ ...f.input, fields: [{ ...field, config: { relation: { targetEntityTypeId: "catalog", relationKind: ids.length > 1 ? "MANY" : "ONE" } } }], selected: { relation: ids } }); await h.until();
    expect(h.value.catalogs.relation.options.map((o: any) => o.id)).toEqual(expect.arrayContaining(ids));
    expect(getUnknownRelationValueErrors([field], { related: ids }, { related: { isLoaded: true, options: h.value.catalogs.relation.options } })).toEqual({});
    expect(f.api.getEntityRecord.mock.calls.map(c => c[3])).toEqual(ids); h.unmount();
  });
  it("searching and paging keep resolved ONE/MANY selections by ID", async () => {
    const f = fixture(), h = hook({ ...f.input, selected: { relation: ["090", "137"] } }); await h.until();
    h.value.search("relation", "different"); await h.until(); h.value.more("relation"); await h.until();
    expect(h.value.catalogs.relation.options.map((o: any) => o.id)).toEqual(expect.arrayContaining(["090", "137", "page-2-different"]));
    expect(f.api.getEntityRecords).toHaveBeenLastCalledWith("synthetic", "contract", "catalog", expect.objectContaining({ search: "different", page: 2, pageSize: 25 })); h.unmount();
  });
  it.each([[[]], [["137"]]])("late resolution cannot restore removed/replaced selection %j", async ids => {
    const f = fixture(), held = deferred<any>(); f.api.getEntityRecord.mockImplementationOnce(() => held.promise);
    const h = hook(f.input); await h.until(() => f.api.getEntityRecord.mock.calls.length === 1);
    h.update({ selected: { relation: ids } }); await h.until(); held.resolve({ record: f.remote("090") });
    await h.until(() => true); expect(h.value.catalogs.relation.options.map((o: any) => o.id)).not.toContain("090");
    expect(f.cache.size).toBe(ids.length + 1); h.unmount();
  });
  it.each(["owner", "contract", "field", "record", "generation"])("retires resolution after %s changes", async change => {
    const f = fixture(), held = deferred<any>(); f.api.getEntityRecord.mockImplementationOnce(() => held.promise);
    const h = hook(f.input); await h.until(() => f.api.getEntityRecord.mock.calls.length === 1);
    const patch: any = { selected: { relation: [] } };
    if (change === "owner") patch.ownerKey = "org:B";
    if (change === "contract") patch.contractId = "other";
    if (change === "field") patch.fields = [{ ...field, config: { relation: { targetEntityTypeId: "other", relationKind: "ONE" } } }];
    if (change === "record") patch.scope = "record-2";
    if (change === "generation") { f.nextSession(); patch.authGeneration = 2; }
    h.update(patch); await h.until(); const before = f.store.upsertRemoteRecords.mock.calls.length;
    held.resolve({ record: f.remote("090") }); await h.until(() => true);
    expect(f.store.upsertRemoteRecords).toHaveBeenCalledTimes(before); expect(h.value.catalogs.relation.options.map((o: any) => o.id)).not.toContain("090"); h.unmount();
  });
  it("reports pending resolution without declaring the ID invalid", async () => {
    const f = fixture(), held = deferred<any>(); f.api.getEntityRecord.mockImplementationOnce(() => held.promise); const h = hook(f.input);
    await h.until(() => f.api.getEntityRecord.mock.calls.length === 1); expect(h.value.catalogs.relation).toMatchObject({ loaded: false, loading: true, error: null });
    held.resolve({ record: f.remote("090") }); await h.until(); h.unmount();
  });
  it("reopening offline resolves only the same owner's stored identities", async () => {
    const f = fixture(); await f.store.upsertRemoteRecords({ ownerKey: "org:A", contractId: "contract", entityTypeId: "catalog", records: [f.remote("090"), f.remote("137")] });
    const h = hook({ ...f.input, online: false, selected: { relation: ["090", "137"] } }); await h.until();
    expect(h.value.catalogs.relation.options).toHaveLength(2); expect(f.api.getEntityRecord).not.toHaveBeenCalled(); h.unmount();
    const b = hook({ ...f.input, ownerKey: "org:B", online: false }); await b.until();
    expect(b.value.catalogs.relation).toMatchObject({ loaded: false, error: expect.stringContaining("dispositivo") }); expect(b.value.catalogs.relation.options).toEqual([]); expect(b.value.dependencyNotice).toContain("dispositivo"); b.unmount();
  });
  it.each([404, 403, 500, "network"])("distinguishes remote %s from a missing offline dependency", async outcome => {
    const f = fixture(); f.api.getEntityRecord.mockRejectedValue(outcome === "network" ? new OpcoNetworkError() : new OpcoApiError("Synthetic", "HTTP_ERROR", outcome as number));
    const h = hook(f.input); await h.until();
    expect(h.value.catalogs.relation.loaded).toBe(false); const message = h.value.catalogs.relation.error;
    expect(message).toContain(outcome === 404 ? "ya no está disponible" : outcome === "network" ? "dispositivo" : "comprobar");
    expect(f.cache.size).toBe(1); h.unmount();
  });
  it("does not accept a different ID returned by an exact response", async () => {
    const f = fixture(); f.api.getEntityRecord.mockResolvedValue({ record: f.remote("different") }); const h = hook(f.input); await h.until();
    expect(h.value.catalogs.relation.loaded).toBe(false); expect(f.cache.size).toBe(1); h.unmount();
  });
});

it("resolves an existing RECORDS local alias through its acknowledged server ID without rewriting selection", async () => {
  const f = fixture(); const cached = { localId: "stable-local", serverId: "090", displayName: "Choice 090", syncStatus: "synced" };
  f.store.getCachedRecord.mockResolvedValue(cached);
  const result = await localRelationSelection(f.store, { ownerKey: "org:A", contractId: "contract", field, ids: ["stable-local"], identity: "record", remote: { api: f.api, token: "synthetic", online: true } });
  expect(f.api.getEntityRecord).toHaveBeenCalledWith("synthetic", "contract", "catalog", "090");
  expect(result).toEqual([{ id: "stable-local", displayName: "Choice 090" }]);
});


describe("C09 visible coverage follows the existing preparation seal", () => {
 function coverageFixture(online = false) {
  const f=fixture(), fact={fieldId:"relation",name:"Related",required:true,count:25,coverage:"partial"}, listener={current:null as any};
  const store={...f.store,getLocalCatalogCoverage:vi.fn(async()=>({view:[fact]}))};
  f.cache.set(JSON.stringify(["org:A", "contract", "catalog", "090"]), { ...f.remote("090"), localId: "090", serverId: "090", syncStatus: "synced" });
  const input={...f.input,online,store,appView:{id:"view",type:"WORKFLOW",config:{workflowKey:"state-update"}}};
  const subscribe=vi.fn((q:any)=>{listener.current=q.onChange;q.onChange({active:false,phase:"idle",diagnostics:null});return()=>{};});
  return{...f,store,input,listener,subscribe,fact};
 }
 it("reads once after idle/seal, not on completed telemetry or every progress event, without reloading options",async()=>{
  const f=coverageFixture(),h=hook(f.input,f.subscribe);await h.until();expect(h.value.dependencyNotice).toContain("parcial");const reads=f.store.getLocalCatalogCoverage.mock.calls.length,options=f.api.getEntityRecords.mock.calls.length;
  for(let n=0;n<5;n++)f.listener.current({active:true,phase:"preparing",diagnostics:{status:"running"}});
  f.listener.current({active:true,phase:"checking",diagnostics:{status:"completed"}});await h.until(()=>true);expect(f.store.getLocalCatalogCoverage).toHaveBeenCalledTimes(reads);
  f.store.getLocalCatalogCoverage.mockResolvedValue({view:[{...f.fact,coverage:"complete"}]});f.listener.current({active:false,phase:"idle",diagnostics:{status:"completed"}});
  await h.until(()=>h.value.dependencyNotice===null);expect(f.store.getLocalCatalogCoverage).toHaveBeenCalledTimes(reads+1);expect(f.api.getEntityRecords).toHaveBeenCalledTimes(options);
  f.listener.current({active:false,phase:"idle",diagnostics:{status:"completed"}});await h.until(()=>true);expect(f.store.getLocalCatalogCoverage).toHaveBeenCalledTimes(reads+1);h.unmount();
 });
 it("keeps a genuinely partial catalog partial after failed preparation and ignores a retired read",async()=>{
  const f=coverageFixture(),h=hook(f.input,f.subscribe);await h.until();const old=deferred<any>();f.store.getLocalCatalogCoverage.mockImplementationOnce(()=>old.promise);
  f.listener.current({active:true});f.listener.current({active:false,diagnostics:{status:"failed"}});await h.until(()=>f.store.getLocalCatalogCoverage.mock.calls.length===2);
  h.update({ownerKey:"org:B"});await h.until();old.resolve({view:[{...f.fact,coverage:"complete"}]});await h.until(()=>true);expect(h.value.dependencyNotice).toContain("parcial");h.unmount();
 });
 it("keeps an already resolved catalog through compatible credential renewal, but not another generation",async()=>{
  const f=coverageFixture(true),h=hook(f.input,f.subscribe);await h.until();const old=h.value.catalogs.relation.options;const delayed=deferred<any>();f.api.getEntityRecords.mockImplementationOnce(()=>delayed.promise);
  h.update({token:"renewed-synthetic",fields:[{config:field.config,type:field.type,key:field.key,name:field.name,id:field.id,required:field.required}]});expect(h.value.catalogs.relation.loaded).toBe(true);expect(h.value.catalogs.relation.options).toEqual(old);
  await h.until(()=>f.api.getEntityRecords.mock.calls.length===2);expect(h.value.catalogs.relation.loaded).toBe(true);
  f.nextSession();h.update({authGeneration:2,selected:{relation:[]}});expect(h.value.catalogs.relation.loaded).toBe(false);delayed.resolve({records:[],pagination:{page:1,totalPages:1}});await h.until();h.unmount();
 });
});


describe("local preparation notices versus actionable relation errors", () => {
  it.each(["partial", "none", "empty"])("keeps %s local coverage in diagnostics without an online preparation warning", async coverage => {
    const f = fixture(), fact = { fieldId: "relation", name: "Related", required: true, count: 0, coverage };
    const getLocalCatalogCoverage = vi.fn(async () => ({ view: [fact] }));
    const h = hook({ ...f.input, store: { ...f.store, getLocalCatalogCoverage }, appView: { id: "view", type: "WORKFLOW", config: { workflowKey: "state-update" } } });
    await h.until(); expect(h.value.catalogs.relation.loaded).toBe(true); expect(h.value.dependencyNotice).toBeNull();
    expect(getLocalCatalogCoverage).toHaveBeenCalled(); expect(fact.coverage).toBe(coverage); h.unmount();
  });
  it("still shows an actual selected relation rejection online", async () => {
    const f = fixture(); f.api.getEntityRecord.mockRejectedValue(new OpcoApiError("Not permitted", "FORBIDDEN", 403));
    const h = hook(f.input); await h.until(); expect(h.value.catalogs.relation.loaded).toBe(false);
    expect(h.value.dependencyNotice).toContain("comprobar"); h.unmount();
  });
});
