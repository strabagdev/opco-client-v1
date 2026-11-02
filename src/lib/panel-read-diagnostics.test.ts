import { describe, expect, it } from "vitest";
import { beginPanelRead, recordPanelRead, getPanelReadEvents, panelReadRows, subscribePanelReadEvents } from "./panel-read-diagnostics";
const key = { ownerKey: "private-owner", contractId: "private-contract", appViewId: "private-view", datasetId: "private-dataset", configRevision: "a".repeat(64), filters: { privateFilter: "private-record-value" }, search: "private-search", page: 1, pageSize: 25 };
describe("PANEL sanitized read diagnostics", () => {
  it("logs actual read/write revision and key fingerprints, never values or identity", () => {
    const read = beginPanelRead(key); recordPanelRead(read, "response", "received", "b".repeat(64)); recordPanelRead(read, "snapshot_write", "persisted", "b".repeat(64));
    const next = beginPanelRead({ ...key, configRevision: "b".repeat(64) }); recordPanelRead(next, "snapshot_read", "hit", "b".repeat(64));
    const own = getPanelReadEvents().filter(e => e.readId === read.readId || e.readId === next.readId);
    expect(own[1].keyFingerprint).toBe(own[2].keyFingerprint); expect(own[1].expectedRevision).toBe("a".repeat(64)); expect(own[1].actualRevision).toBe("b".repeat(64));
    const copied = JSON.stringify(panelReadRows(getPanelReadEvents(), key.ownerKey, key.contractId));
    for (const value of [key.ownerKey, key.contractId, key.appViewId, key.datasetId, key.search, "privateFilter", "private-record-value"]) expect(copied).not.toContain(value);
  });
  it("does not expose arbitrary revision/error strings or let observers fail a read", () => {
    const read = beginPanelRead(key); const stop = subscribePanelReadEvents(() => { throw new Error("observer failure"); });
    expect(() => recordPanelRead(read, "definition", "failed", "Bearer private-token", "payload: private-token")).not.toThrow(); stop();
    const value = JSON.stringify(getPanelReadEvents()); expect(value).not.toContain("private-token"); expect(value).not.toContain("Bearer"); expect(getPanelReadEvents().at(-1)?.errorCode).toBeNull();
  });
  it("filters exact scopes even if fingerprints collide", () => {
    const a = beginPanelRead({ ...key, ownerKey: "Aa" }), b = beginPanelRead({ ...key, ownerKey: "BB" });
    recordPanelRead(a, "snapshot_read", "hit"); recordPanelRead(b, "snapshot_read", "miss");
    expect(getPanelReadEvents().at(-1)?.scopeFingerprint).toBe(getPanelReadEvents().at(-2)?.scopeFingerprint);
    const selected = panelReadRows(getPanelReadEvents(), "Aa", key.contractId).map(([, value]) => JSON.parse(value));
    expect(selected).toHaveLength(1); expect(selected[0].result).toBe("hit");
  });
  it("bounds history and uses the same safe rows for display and copy", () => {
    for (let n = 0; n < 90; n++) recordPanelRead(beginPanelRead(key), "snapshot_read", "miss", undefined, "PANEL_SNAPSHOT_MISSING");
    expect(getPanelReadEvents()).toHaveLength(80); expect(panelReadRows(getPanelReadEvents(), key.ownerKey, key.contractId)).toHaveLength(80);
    expect(panelReadRows(getPanelReadEvents(), "different", key.contractId)).toEqual([["PANEL", "Sin lectura registrada para el scope activo"]]);
  });
});

it("uses the PANEL read ID in the existing HTTP diagnostic header without changing its query", async () => {
  const { createOpcoApi } = await import("./opco-api");
  let requestUrl = "", requestId = "";
  const api = createOpcoApi({ apiUrl: "https://synthetic.invalid", fetcher: async (url, init) => {
    requestUrl = String(url); requestId = new Headers(init?.headers).get("X-Opco-Request-Id") ?? "";
    return Response.json({ ok: true, data: { configRevision: "a".repeat(64), datasets: [], filters: [], modules: [] } });
  } });
  await api.getPanel("synthetic", "contract", "view", { datasetId: "rows", page: 1, pageSize: 25 }, { diagnosticRequestId: "panel-read-synthetic" });
  expect(requestId).toBe("panel-read-synthetic"); expect(new URL(requestUrl).searchParams.toString()).toBe("datasetId=rows&page=1&pageSize=25");
});
