// @ts-expect-error Node types are intentionally absent from Expo config.
import { readFileSync } from "node:fs";
import React, { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { View, Text, ScrollView, TextInput, Pressable, Platform } from "react-native";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { panelReadRows } from "./panel-read-presentation";
import { buildPanelTableModel, buildPanelKpiModel, isPanelDatasetStateCurrent, normalizePanelFilters } from "./panel-renderer-logic";
import type { PanelDataset, PanelModuleConfig } from "../../lib/opco-api";
import { FieldFrame } from "../../components/field-frame";
import { useFieldAccessibility } from "../../components/field-accessibility";
import { FormAction, FormActions } from "../../components/form-actions";
import { RecordFieldInput } from "../records/RecordFieldInput";
import { CompactSelect } from "../../components/compact-select";
import { ReadLoadingState } from "../../components/read-loading-indicator";
vi.mock("react-native", async () => import("react-native-web"));
// Non-BOOLEAN generic controls are exercised by Chromium and the existing form suite.
// Avoid the Expo platform resolver in this server-only BOOLEAN fixture.
vi.mock("../records/RecordFieldInput", () => ({ RecordFieldInput: () => null }));
const module: PanelModuleConfig = { id: "table", title: "Título configurado", datasetId: "rows", layout: { x: 0, y: 0, w: 12, h: 6 }, visualization: { type: "TABLE", config: { columns: [{ fieldId: "text" }, { fieldId: "relation" }, { fieldId: "select" }, { fieldId: "internal", valueDisplay: "INTERNAL_VALUE" }, { fieldId: "empty" }, { fieldId: "missing" }, { fieldId: "zero" }], paginated: true, searchable: true } } };
const dataset: PanelDataset = { id: "rows", pagination: { page: 1, pageSize: 25, total: 1, hasMore: false }, schema: { fields: [
  { id: "text", name: "Texto", type: "TEXT" }, { id: "relation", name: "Referencias", type: "RELATION" }, { id: "select", name: "Selección", type: "SELECT", options: [{ id: "old-id", value: "canonical", label: "Etiqueta" }] }, { id: "internal", name: "Interno", type: "SELECT", options: [{ id: "old-id", value: "canonical", label: "Etiqueta" }] }, { id: "empty", name: "Vacío", type: "TEXT" }, { id: "missing", name: "Ausente", type: "TEXT" }, { id: "zero", name: "Cero", type: "INTEGER" },
] }, rows: [{ id: "stable-row", values: { text: "Texto extenso ".repeat(100), relation: [{ id: "r1", displayName: "Nombre legible" }, "unknown"], select: "old-id", internal: "old-id", empty: null, zero: 0 } }] };
function freeze<T>(x: T): T { if (x && typeof x === "object") { Object.freeze(x); Object.values(x).forEach(freeze); } return x; }
describe("PANEL-only read projection", () => {
  it("keeps row/column IDs, order, complete text and source/model immutable", () => {
    const m = freeze(structuredClone(module)), d = freeze(structuredClone(dataset)), model = freeze(buildPanelTableModel(m, d)!); const before = JSON.stringify([m, d, model]);
    const rows = panelReadRows(m, d, model); expect(rows[0].id).toBe("stable-row"); expect(rows[0].cells).toHaveLength(7); expect(rows[0].cells[0][0].text).toBe(d.rows[0].values.text); expect(JSON.stringify([m, d, model])).toBe(before);
  });
  it("keeps every MANY entry and secondary IDs without inventing labels", () => { const cells = panelReadRows(module, dataset, buildPanelTableModel(module, dataset)!)[0].cells; expect(cells[1]).toEqual([{ text: "Nombre legible", status: "value" }, { text: "Referencia sin etiqueta disponible", status: "unavailable", detail: "Identificador: unknown" }]); });
  it.each(["unknown", { id: "unknown" }])("ONE missing label is explicit %s", raw => { const d = structuredClone(dataset); d.rows[0].values.relation = raw; expect(panelReadRows(module, d, buildPanelTableModel(module, d)!)[0].cells[1][0].status).toBe("unavailable"); });
  it("preserves historical SELECT optionId and INTERNAL_VALUE precedence", () => { const cells = panelReadRows(module, dataset, buildPanelTableModel(module, dataset)!)[0].cells; expect(cells[2][0].text).toBe("Etiqueta"); expect(cells[3][0].text).toBe("canonical"); });
  it("does not turn absent, null, zero or false into one empty value", () => { const d = structuredClone(dataset); d.schema.fields.push({ id: "false", type: "BOOLEAN", name: "Falso" }); d.rows[0].values.false = false; const m = structuredClone(module); if (m.visualization.type === "TABLE") m.visualization.config.columns.push({ fieldId: "false" }); const cells = panelReadRows(m, d, buildPanelTableModel(m, d)!)[0].cells; expect(cells[4][0].status).toBe("empty"); expect(cells[5][0].status).toBe("unavailable"); expect(cells[6][0].text).toBe("0"); expect(cells[7][0]).toEqual({ text: "No", status: "value" }); d.rows[0].values.false = true; expect(panelReadRows(m, d, buildPanelTableModel(m, d)!)[0].cells[7][0].text).toBe("Sí"); });
  it("does not change legacy formatter/model output", () => { const model = buildPanelTableModel(module, dataset)!; panelReadRows(module, dataset, model); expect(model.rows[0].values[1]).toBe("Nombre legible"); expect(model.rows[0].values[4]).toBe(""); });
});
const sourcePath = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env.OPCO_PANEL_SOURCE_FILE ?? "src/renderers/panels/PanelRenderer.tsx";
const sf = ts.createSourceFile(sourcePath, readFileSync(sourcePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["PanelFilters", "PanelBooleanFilter", "PanelSearchField", "PanelTableHeading", "PanelTablePagination", "PanelModuleFrame", "PanelModule", "isPanelTableModule", "PanelTable", "PanelState"];
const code = names.map(name => sf.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)?.getText(sf) ?? "").join("\n");
const deps = { React, View, Text, ScrollView, TextInput, Pressable, Platform, useState, CompactSelect, FieldFrame, useFieldAccessibility, FormAction, FormActions, RecordFieldInput, ReadLoadingState, panelReadRows, buildPanelTableModel, buildPanelKpiModel, isPanelDatasetStateCurrent, styles: {}, tableStyles: {}, stableTextInputStyle: {}, getRelationTargetEntityTypeId: () => null, PanelKpi: () => <Text>KPI unchanged</Text> };
const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const components = new Function(...Object.keys(deps), js + ";return {PanelModule,PanelFilters,PanelModuleFrame:typeof PanelModuleFrame==='undefined'?null:PanelModuleFrame,PanelTablePagination:typeof PanelTablePagination==='undefined'?null:PanelTablePagination};")(...Object.values(deps));
const props = (changes = {}) => ({ module, currentQueryKey: "query", page: 1, search: "00001", onSearch: vi.fn(), onNextPage: vi.fn(), onPreviousPage: vi.fn(), onRetry: vi.fn(), state: { queryKey: "query", fromCache: true, isLoading: false, error: null, panel: { datasets: [dataset], metrics: [] } }, ...changes });
describe("actual PANEL presentation components", () => {
  it("regression: labeled search and complete typed relation presentation with same commands", () => { const p = props(); const html = renderToStaticMarkup(<components.PanelModule {...p} />); expect(html).toContain('aria-label="Buscar registros"'); expect(html).toContain('aria-labelledby='); expect(html).toContain("Referencia sin etiqueta disponible"); expect(html).toContain("Identificador: unknown"); expect(html).toContain("Sin valor"); expect(html).toContain("Texto extenso ".repeat(100)); expect(p.onSearch).not.toHaveBeenCalled(); expect(p.onNextPage).not.toHaveBeenCalled(); });
  it("preserves empty/error/loading branches and pagination visibility", () => {
    const empty = { ...dataset, rows: [] }; const html = renderToStaticMarkup(<components.PanelModule {...props({ state: { queryKey: "query", panel: { datasets: [empty] }, isLoading: false } })} />); expect(html).toContain("No hay datos para mostrar"); expect(html).not.toContain("Siguiente");
    expect(renderToStaticMarkup(<components.PanelModule {...props({ state: { queryKey: "query", panel: null, error: "Error conservado" } })} />)).toContain("Error conservado");
    expect(renderToStaticMarkup(<components.PanelModule {...props({ state: undefined })} />)).toContain("Esperando datos");
  });
  it("keeps copy visible beside refresh error and retires incompatible query", () => { const p = props(); const state = { ...p.state, error: "Error de actualización" }; const html = renderToStaticMarkup(<components.PanelModule {...p} state={state} />); expect(html).toContain("Error de actualización"); expect(html).toContain("Texto extenso"); const retired = renderToStaticMarkup(<components.PanelModule {...p} currentQueryKey="new-query" />); expect(retired).not.toContain("Texto extenso"); });
  it("keeps BOOLEAN tri-state, optional values and required notice", () => { const filters = [{ id: "flag", label: "Filtro booleano", valueType: "BOOLEAN", required: true }] as const; const fields = { flag: { id: "flag-field", key: "flag", name: "Filtro booleano", type: "BOOLEAN", options: [], config: {} } }; const onChange = vi.fn(); for (const value of ["", "false", "true"]) { const html = renderToStaticMarkup(<components.PanelFilters filters={filters} fields={fields} metadataError={null} values={{ flag: value }} relationOptions={{}} onChange={onChange} onRelationSearch={vi.fn()} />); expect(html).toContain("Sí"); expect(html).toContain("No"); expect(html.includes("Selección requerida")).toBe(value === ""); expect(normalizePanelFilters(filters as never, { flag: value })).toEqual(value === "" ? {} : { flag: value === "true" }); } expect(onChange).not.toHaveBeenCalled(); });
});

it("keeps TABLE in a single scrollable module and KPI in its legacy frame", () => {
  const child = <Text>Contenido completo</Text>;
  const table = components.PanelModuleFrame({ isTable: true, isKpi: false, children: child });
  const kpi = components.PanelModuleFrame({ isTable: false, isKpi: true, children: child });
  expect(table.type).toBe(ScrollView); expect(table.props.nestedScrollEnabled).toBe(true); expect(table.props.children).toBe(child);
  expect(kpi.type).toBe(View); expect(kpi.props.children).toBe(child);
});
it("keeps pagination commands and disabled values in an accessible sticky footer", () => {
  const p = props(); const element = components.PanelModule(p); let pagination: React.ReactElement | undefined;
  const visit = (node: React.ReactNode) => React.Children.forEach(node, child => {
    if (!React.isValidElement(child)) return;
    const c = child as React.ReactElement<{children?:React.ReactNode}>;
    if (c.type === components.PanelTablePagination) pagination = c;
    visit(c.props.children);
  });
  visit(element); expect(pagination).toBeDefined();
  const command = pagination!.props as {onPreviousPage:unknown;onNextPage:unknown;previousDisabled:boolean;nextDisabled:boolean};
  expect(command.onPreviousPage).toBe(p.onPreviousPage); expect(command.onNextPage).toBe(p.onNextPage);
  expect(command.previousDisabled).toBe(true); expect(command.nextDisabled).toBe(true);
  const html = renderToStaticMarkup(element);
  expect(html).toContain('aria-label="Anterior"'); expect(html).toContain('aria-label="Siguiente"');
  expect(html).toContain('position:sticky'); expect(html).toContain('Página 1');
  expect(p.onPreviousPage).not.toHaveBeenCalled(); expect(p.onNextPage).not.toHaveBeenCalled();
});
it("does not truncate the configured TABLE title or add editing actions", () => {
  const m={...module,title:"Título completo ".repeat(40)}; const html=renderToStaticMarkup(<components.PanelModule {...props({module:m})} />); expect(html).toContain(m.title); expect(html).not.toContain("Editar"); expect(html).not.toContain("Crear registro");
});
