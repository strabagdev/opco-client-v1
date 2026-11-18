import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PanelDataset, PanelModuleConfig } from "../../lib/opco-api";
import { panelGroupedRows, PanelGroupedRecords } from "./PanelGroupedRecords";
vi.mock("react-native", async () => import("react-native-web"));
const module: PanelModuleConfig = { id: "details", datasetId: "daily", layout: { x: 0, y: 0, w: 12, h: 6 }, visualization: { type: "TABLE", config: { columns: [{ fieldId: "date" }, { fieldId: "status" }, { fieldId: "resource" }] } } };
const dataset: PanelDataset = { id: "daily", coverage: { source: "SERVER", includesPending: false }, pagination: { page: 1, pageSize: 1, total: 2, hasMore: true, unit: "GROUP" },
  schema: { fields: [{ id: "code", name: "Identificador", type: "TEXT" }, { id: "name", name: "Nombre", type: "TEXT" }, { id: "date", name: "Fecha", type: "DATE" }, { id: "status", name: "Estado configurado", type: "SELECT", options: [{ id: "opt-a", value: "internal-a", label: "A" }] }, { id: "resource", name: "Recurso configurado", type: "RELATION" }] },
  rows: ["r1", "r2"].map(id => ({ id, values: { code: "FICTICIO-001", name: "Nombre ficticio", date: "2026-11-17", status: "internal-a", resource: { id: "lot", displayName: "Recurso ficticio" } } })),
  grouping: { relationFieldId: "person", primaryFieldId: "code", secondaryFieldId: "name", totalRecords: 3, groups: [{ key: "relation:person-1", relationRecordId: "person-1", displayName: "Etiqueta", count: 2, recordIds: ["r1", "r2"] }] } };
describe("PANEL grouped server records", () => {
  it("presents a compact identity, name and complete count without technical IDs", () => {
    const before = JSON.stringify(dataset); const html = renderToStaticMarkup(<PanelGroupedRecords module={module} dataset={dataset} />);
    expect(html).toContain("FICTICIO-001"); expect(html).toContain("Nombre ficticio"); expect(html).toContain("2 registros"); expect(html).toContain("Ver detalle"); expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("person-1"); expect(html).not.toContain("relation:person"); expect(html).not.toContain("r1"); expect(JSON.stringify(dataset)).toBe(before);
  });
  it("retains equivalent deliveries as independently identified rows with readable configured labels", () => {
    const group = panelGroupedRows(module, dataset)[0]; expect(group.complete).toBe(true); expect(group.records.map(row => row.id)).toEqual(["r1", "r2"]);
    expect(group.records[0].fields.map(field => [field.label, field.values[0].text])).toEqual([["Fecha", "17-11-2026"], ["Estado configurado", "A"], ["Recurso configurado", "Recurso ficticio"]]);
  });
  it("never merges different related IDs because their labels are the same", () => {
    const copy = structuredClone(dataset); copy.grouping!.groups.push({ ...copy.grouping!.groups[0], key: "relation:person-2", relationRecordId: "person-2", recordIds: ["r1"], count: 1 });
    expect(panelGroupedRows(module, copy)).toHaveLength(2);
  });
  it("marks absent or duplicated group members incomplete instead of inventing a full count", () => {
    for (const ids of [["r1", "missing"], ["r1", "r1"]]) { const copy = structuredClone(dataset); copy.grouping!.groups[0].recordIds = ids; expect(panelGroupedRows(module, copy)[0].complete).toBe(false); }
  });
});
