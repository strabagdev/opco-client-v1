// @ts-expect-error Node types intentionally absent from Expo application config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { revisionCanonical } from "../lib/revision-receipts";

function mount() {
  const source = ts.createSourceFile("navigation.tsx", readFileSync("src/components/desktop-navigation.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "DesktopNavigationProvider")!;
  let version = 1, session: any, dirty = true, cursor = 0, cells: any[] = [], pending: (() => void)[] = [];
  const same = (a: any[], b: any[]) => a?.length === b?.length && a.every((v, i) => Object.is(v, b[i]));
  const useState = (initial: any) => { const i = cursor++; cells[i] ??= { value: initial }; return [cells[i].value, (next: any) => { const v = typeof next === "function" ? next(cells[i].value) : next; if (v !== cells[i].value) { cells[i].value = v; dirty = true; } }]; };
  const useRef = (initial: any) => cells[cursor++] ??= { current: initial };
  const memo = (f: any, deps: any[]) => { const i = cursor++; if (!cells[i] || !same(cells[i].deps, deps)) cells[i] = { deps, value: f() }; return cells[i].value; };
  const useEffect = (f: any, deps: any[]) => { const i = cursor++; if (!cells[i] || !same(cells[i].deps, deps)) { const old = cells[i]; cells[i] = { deps, cleanup: old?.cleanup }; pending.push(() => { old?.cleanup?.(); cells[i].cleanup = f(); }); } };
  const api = { getAuthSessionGeneration: () => version, isAuthSessionCurrent: (v: number) => v === version };
  const cache = { getAppViews: vi.fn(async () => ({ views: [{ id: "view", name: "Synthetic", type: "RECORDS", config: {} }] })) };
  session = { api, ownerKey: "org:A", selectedContractId: "contract", definitionCache: cache };
  let listener: (() => void) | undefined;
  const subscribe = vi.fn((fn: () => void) => { listener = fn; return () => { listener = undefined; }; });
  const env = { useState, useRef, useCallback: (fn: any, deps: any[]) => memo(() => fn, deps), useEffect,
    useSession: () => session, subscribeLocalDatabaseCacheChanges: subscribe, revisionCanonical, scopedDesktopCatalog: (c: any) => c?.views ?? [],
    Catalog: { Provider: "Catalog" }, Views: { Provider: "Views" }, React: { createElement: (type: any, props: any, ...children: any[]) => ({ type, props, children }) } };
  const code = ts.transpileModule(node.getText(source).replace(/^export /, "") + ";return DesktopNavigationProvider;", { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const fn = new Function(...Object.keys(env), code)(...Object.values(env));
  let output: any;
  const render = () => { dirty = false; cursor = 0; pending = []; output = fn({ children: null }); pending.forEach(f => f()); };
  render();
  return { cache, subscribe, notify: () => listener?.(), get catalog() { return cells[0].value; },
    get dirty() { return dirty; }, get output() { if (dirty) render(); return output; },
    async settle() { for (let i = 0; i < 30; i++) { await Promise.resolve(); if (dirty) render(); } },
    change(patch: any, newGeneration = false) { if (newGeneration) version++; session = { ...session, ...patch }; render(); },
    publish(views: any[]) { output.props.value(JSON.stringify([session.ownerKey, session.selectedContractId]), views); },
    stop() { cells.forEach(c => c.cleanup?.()); } };
}

describe("navigation consumes only relevant committed catalog changes", () => {
  it("subscribes to its navigation scope, keeps identical catalog identity, and applies a real change", async () => {
    const h = mount(); await h.settle(); const first = h.catalog;
    expect(h.subscribe).toHaveBeenCalledWith(expect.any(Function), { ownerKey: "org:A", contractId: "contract", kinds: ["navigation"] });
    h.notify(); await h.settle(); expect(h.catalog).toBe(first);
    h.publish([{ ...first.views[0], config: {} }]); await h.settle(); expect(h.catalog).toBe(first);
    h.publish([{ ...first.views[0], name: "Changed" }]); await h.settle(); expect(h.catalog.views[0].name).toBe("Changed"); h.stop();
  });
  it("an old owner read cannot replace a newer owner's catalog", async () => {
    const h = mount(); await h.settle(); let release!: (v: any) => void;
    h.cache.getAppViews.mockImplementationOnce(() => new Promise(r => { release = r; })); h.notify();
    h.change({ ownerKey: "org:B" }, true); await h.settle(); release({ views: [{ id: "old", name: "Old" }] }); await h.settle();
    expect(h.catalog.scope).toBe(JSON.stringify(["org:B", "contract"])); expect(h.catalog.views[0].id).toBe("view"); h.stop();
  });
  it("rejects a pending read across A logout A with a new generation", async () => {
    const h = mount(); await h.settle(); let release!: (v: any) => void;
    h.cache.getAppViews.mockImplementationOnce(() => new Promise(r => { release = r; })); h.notify(); h.change({}, true); await h.settle();
    release({ views: [{ id: "old", name: "Old" }] }); await h.settle(); expect(h.catalog.views[0].id).toBe("view"); h.stop();
  });
});
