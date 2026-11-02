import { describe, expect, it, vi } from "vitest";
import type { PanelAppView } from "./opco-api";
import { reconcilePanelDefinition, coherentCachedPanelViews, PanelDefinitionError, parseCoherentPanelDefinition } from "./panel-definition";
const old: PanelAppView = { id: "view", type: "PANEL", name: "Synthetic", slug: "synthetic", icon: null, sortOrder: 1, configRevision: "r1", config: { schemaVersion: 1, filters: [{ id: "context", label: "Context", valueType: "TEXT" }], datasets: [{ id: "rows", source: { type: "ENTITY", entityTypeId: "target" }, transformation: { type: "RECORDS", fieldIds: ["code"], pagination: { pageSize: 25 } } }] } };
const next = { ...old, configRevision: "r2", config: { ...old.config, layout: { columns: 12, rowHeight: 96 } } };
const request = (api: Parameters<typeof reconcilePanelDefinition>[0]["api"]) => ({ api, appView: old, revision: "r2", token: "synthetic", contractId: "contract", assertActive() {} });
describe("PANEL definition reconciliation", () => {
  it("does not fetch definitions when revision already matches", async () => { const api = { getAppViews: vi.fn() }; expect(await reconcilePanelDefinition({ ...request(api), revision: "r1" })).toBe(old); expect(api.getAppViews).not.toHaveBeenCalled(); });
  it("fetches once and accepts only an assigned matching revision with compatible context", async () => { const api = { getAppViews: vi.fn().mockResolvedValue({ views: [next] }) }; expect(await reconcilePanelDefinition(request(api))).toEqual(next); expect(api.getAppViews).toHaveBeenCalledOnce(); });
  it("terminates on unavailable, inconsistent or unassigned definitions without recursive retries", async () => {
    for (const views of [[], [old], [{ ...next, type: "REPORT" }]]) { const api = { getAppViews: vi.fn().mockResolvedValue({ views }) }; await expect(reconcilePanelDefinition(request(api))).rejects.toMatchObject({ code: "PANEL_DEFINITION_UNAVAILABLE" }); expect(api.getAppViews).toHaveBeenCalledOnce(); }
    const api = { getAppViews: vi.fn().mockRejectedValue(new Error("private transport payload")) }; await expect(reconcilePanelDefinition(request(api))).rejects.toThrow(PanelDefinitionError); expect(api.getAppViews).toHaveBeenCalledOnce();
  });
  it("rejects changed context meaning and never silently reapplies old filters", async () => { const api = { getAppViews: vi.fn().mockResolvedValue({ views: [{ ...next, config: { ...next.config, datasets: [] } }] }) }; await expect(reconcilePanelDefinition(request(api))).rejects.toMatchObject({ code: "PANEL_CONTEXT_CHANGED" }); });
  it("respects cancellation while the definition response is in flight", async () => { let release!: (v: unknown) => void; const api = { getAppViews: vi.fn(() => new Promise<any>(r => { release = r; })) }; let active = true; const pending = reconcilePanelDefinition({ ...request(api), assertActive() { if (!active) throw new Error("retired"); } }); active = false; release({ views: [next] }); await expect(pending).rejects.toThrow("retired"); });
  it("never reconstructs assignments from a coherent receipt or affects other renderers", async () => {
    const cache = { getCoherentPanelDefinition: vi.fn().mockResolvedValue(next) }, scope = { ownerKey: "owner", contractId: "contract" };
    expect(await coherentCachedPanelViews(cache, scope, [], old.id)).toEqual([]); expect(cache.getCoherentPanelDefinition).not.toHaveBeenCalled();
    expect(await coherentCachedPanelViews(cache, scope, [old], old.id)).toEqual([next]); expect(cache.getCoherentPanelDefinition).toHaveBeenCalledWith({ ...scope, appViewId: old.id });
    expect(parseCoherentPanelDefinition("{}", old.id)).toBeNull(); expect(parseCoherentPanelDefinition(JSON.stringify({ version: 1, appView: next }), "another-view")).toBeNull();
  });
});
