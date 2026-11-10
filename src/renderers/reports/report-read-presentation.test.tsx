// @ts-expect-error Node types are intentionally absent from Expo config.
import { readFileSync } from "node:fs";
import React, { useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Pressable, ScrollView, Text, View } from "react-native";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { EntityField, ReportResponse } from "../../lib/opco-api";
import { FormAction, FormActions } from "../../components/form-actions";
import { DateFieldInput, MonthFieldInput } from "../records/temporal-input.web";
import { shiftMonth } from "./report-time-filter";
import { buildReportTableModel, buildReportMatrixModel } from "./report-renderer-logic";
import { reportReadRows } from "./report-read-presentation";
vi.mock("react-native", async () => import("react-native-web"));
const f = (id: string, key: string, type: EntityField["type"]): EntityField => ({ id, key, type, name: key, active: true, searchable: false, required: false, order: 0, multiple: false, config: {}, options: [] });
const report: ReportResponse = {
  appView: { id: "view", name: "Consulta configurada", slug: "report" }, entity: { id: "entity", name: "Entidad", slug: "entity" }, from: "2026-11-01", to: "2026-11-30",
  config: { entityTypeId: "entity", dateFieldId: "f-date", presentationMode: "TABLE", table: { visibleFieldIds: ["f-name", "f-relation", "f-choice", "f-internal", "f-empty", "f-missing", "f-zero", "f-date"], defaultSortDirection: "asc" }, valueDisplay: { "f-internal": "INTERNAL_VALUE" } },
  fields: [f("f-name", "name", "TEXT"), f("f-relation", "ref", "RELATION"), { ...f("f-choice", "choice", "SELECT"), options: [{ id: "old-id", value: "canonical", label: "Etiqueta disponible", active: true, order: 0 }] }, { ...f("f-internal", "internal", "SELECT"), options: [{ id: "old-id", value: "canonical", label: "Etiqueta disponible", active: true, order: 0 }] }, f("f-empty", "empty", "TEXT"), f("f-missing", "missing", "TEXT"), f("f-zero", "zero", "INTEGER"), f("f-date", "date", "DATE")],
  records: [{ id: "record-stable", displayName: "Sin cambiar", updatedAt: "2026-11-08T00:00:00Z", values: { name: "Texto extenso ".repeat(80), ref: [{ id: "r1", displayName: "Referencia legible" }, "unknown"], choice: "old-id", internal: "old-id", empty: null, zero: 0, date: "2026-11-08" } }],
};
function freeze<T>(x: T): T { if (x && typeof x === "object") { Object.freeze(x); Object.values(x).forEach(freeze); } return x; }
describe("REPORT TABLE visual projection", () => {
  it("uses field.key for data and stable field IDs for configured order, without mutation", () => {
    const input = freeze(structuredClone(report)), table = freeze(buildReportTableModel(input)!); const before = JSON.stringify([input, table]);
    const rows = reportReadRows(input, table); expect(rows[0].id).toBe("record-stable"); expect(rows[0].cells).toHaveLength(8); expect(rows[0].cells[0][0].text).toBe(input.records[0].values.name); expect(JSON.stringify([input, table])).toBe(before);
  });
  it("keeps each MANY entry, readable names and secondary IDs", () => {
    expect(reportReadRows(report, buildReportTableModel(report)!)[0].cells[1]).toEqual([{ text: "Referencia legible", status: "value" }, { text: "Referencia sin etiqueta disponible", status: "unavailable", detail: "Identificador: unknown" }]);
  });
  it.each(["unknown", { id: "unknown" }])("handles ONE without a label explicitly %s", raw => { const input = structuredClone(report); input.records[0].values.ref = raw; expect(reportReadRows(input, buildReportTableModel(input)!)[0].cells[1][0].status).toBe("unavailable"); });
  it("preserves canonical/historical SELECT and INTERNAL_VALUE uppercase", () => {
    const cells = reportReadRows(report, buildReportTableModel(report)!)[0].cells; expect(cells[2][0].text).toBe("Etiqueta disponible"); expect(cells[3][0].text).toBe("CANONICAL");
    const input = structuredClone(report); input.records[0].values.choice = "canonical"; expect(reportReadRows(input, buildReportTableModel(input)!)[0].cells[2][0].text).toBe("Etiqueta disponible");
  });
  it("distinguishes missing/null/zero and preserves TABLE date formatting", () => { const cells = reportReadRows(report, buildReportTableModel(report)!)[0].cells; expect(cells[4][0].status).toBe("empty"); expect(cells[5][0].status).toBe("unavailable"); expect(cells[6][0].text).toBe("0"); expect(cells[7][0].text).toBe("2026-11-08"); });
  it("does not reinterpret unknown SELECT as empty or an invented label", () => { const input = structuredClone(report); input.records[0].values.choice = "unresolved"; expect(reportReadRows(input, buildReportTableModel(input)!)[0].cells[2][0]).toEqual({ text: "Opción sin etiqueta disponible", status: "unavailable", detail: "Valor: unresolved" }); });
  it("leaves MATRIX consolidation and formatted model unchanged", () => {
    const matrixInput = { ...report, config: { entityTypeId: "entity", dateFieldId: "f-date", presentationMode: "MATRIX" as const, matrix: { rowFieldId: "f-relation", columnFieldId: "f-date", valueFieldId: "f-choice", summaryFieldId: "f-internal" } } };
    const before = buildReportMatrixModel(matrixInput); reportReadRows(report, buildReportTableModel(report)!); expect(buildReportMatrixModel(matrixInput)).toEqual(before);
  });
});
const sourcePath = (globalThis as unknown as {process?: {env:Record<string,string|undefined>}}).process?.env.OPCO_REPORT_SOURCE_FILE ?? "src/renderers/reports/ReportRenderer.tsx";
const sf = ts.createSourceFile(sourcePath, readFileSync(sourcePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const code = ["ReportTableControls", "ReportTable", "PeriodControl", "DateInput"].map(name => sf.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text===name)?.getText(sf)??"").join("\n");
const deps = {React,useState,View,Text,ScrollView,Pressable,FormAction,FormActions,DateFieldInput,MonthFieldInput,shiftMonth,reportReadRows,styles:{},tableStyles:{}};
const js = ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
const components = new Function(...Object.keys(deps),js+";return{ReportTable,ReportTableControls:typeof ReportTableControls==='undefined'?null:ReportTableControls,PeriodControl};")(...Object.values(deps));
describe("actual REPORT TABLE components", () => {
  it("regression: preserves every relation entry and complete text without new query actions", () => { const html = renderToStaticMarkup(<components.ReportTable table={buildReportTableModel(report)!} report={report} />); expect(html).toContain("Referencia sin etiqueta disponible"); expect(html).toContain("Identificador: unknown"); expect(html).toContain("Texto extenso ".repeat(80)); expect(html).toContain("CANONICAL"); expect(html).not.toContain("Siguiente"); expect(html).not.toContain("Buscar registros"); });
  it.each([true,false])("keeps period and refresh commands with original disabled=%s", allowChange => {
    const onChange=vi.fn(),onRefresh=vi.fn(),period={mode:"RANGE" as const,from:"2026-11-01",to:"2026-11-30"};
    const root=components.ReportTableControls({allowChange,onChange,onRefresh,period}); const actions: React.ReactElement[]=[];let control:React.ReactElement|undefined;
    const visit=(n:React.ReactNode)=>React.Children.forEach(n,c=>{if(!React.isValidElement(c))return;const e=c as React.ReactElement<{children?:React.ReactNode}>;if(e.type===FormAction)actions.push(e);if(e.type===components.PeriodControl)control=e;visit(e.props.children)});visit(root);
    expect(actions).toHaveLength(1);expect(actions[0].props).toMatchObject({onPress:onRefresh,disabled:!allowChange});expect(control!.props).toMatchObject({period,onChange,allowChange});expect(onRefresh).not.toHaveBeenCalled();expect(onChange).not.toHaveBeenCalled();
    const html=renderToStaticMarkup(root);expect(html).toContain("Actualizar");expect(html).toContain(allowChange?"Desde":"Período");
  });
  it("keeps MONTH controls and accessible previous/next names",()=>{const html=renderToStaticMarkup(<components.ReportTableControls allowChange period={{mode:"MONTH",month:"2026-11"}} onChange={vi.fn()} onRefresh={vi.fn()}/>);expect(html).toContain('aria-label="Mes anterior"');expect(html).toContain('aria-label="Mes siguiente"');expect(html).toContain("2026-11");});
});
