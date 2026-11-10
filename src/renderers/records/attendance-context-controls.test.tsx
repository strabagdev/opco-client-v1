// Actual context renderer/controls with synthetic data, SSR only; no browser/device evidence.
// @ts-expect-error Node types are intentionally absent from Expo config.
import { readFileSync } from "node:fs";
import React, { useId } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Text, View } from "react-native";
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { CompactSelect } from "../../components/compact-select";
import { RecordFieldInput } from "./RecordFieldInput";
import { FormLayout, FormGrid } from "../../components/form-layout";
import { FieldFrame } from "../../components/field-frame";
import { getRelationTargetEntityTypeId } from "../../lib/record-form";
import { attendanceRelationField, attendanceContextValidationErrors, attendanceContextFieldsFromPreparedDefinition } from "../workflows/attendance/attendance-workflow-logic";
vi.mock("react-native", async () => import("react-native-web"));
vi.mock("./temporal-input", async () => import("./temporal-input.web"));
const path = "src/renderers/workflows/attendance/AttendanceWorkflow.tsx", text = readFileSync(path, "utf8"), source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let declaration: ts.FunctionDeclaration | undefined; function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "AttendanceContextSelectors") declaration = node; ts.forEachChild(node, visit); } visit(source);
const code = ts.transpileModule(declaration!.getText(source), { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
describe("real Attendance context controls", () => {
 it.each([false, true])("renders related and SELECT labels/IDs without business writes (historical multiple=%s)", multiple => {
  const styles = { contextBlock: {}, contextField: {}, contextLabel: {}, error: {} };
  const context = { React, useId, Text, View, FormLayout, FormGrid, FieldFrame, CompactSelect, RecordFieldInput, attendanceRelationField, getRelationTargetEntityTypeId, desktopStyles: styles, baseStyles: styles };
  const Component = new Function(...Object.keys(context), code + ";return AttendanceContextSelectors;")(...Object.values(context));
  const onChange = vi.fn(); const html = renderToStaticMarkup(<Component fields={[{ id: "related", key: "related", name: "Related context", type: "RELATION", multiple, required: true, config: { relation: { targetEntityTypeId: "catalog", relationKind: "ONE" } } }, { id: "choice", name: "Choice", type: "SELECT", required: true, options: [{ optionId: "option-a", label: "Choice label", value: "canonical-a" }] }]} values={{ related: "record-id", choice: "option-a" }} errors={{ choice: "Revisa el contexto", related: "Revisa la relación" }} onChange={onChange} relations={{ catalogs: { related: { options: [{ id: "record-id", displayName: "Catalog label" }], hasMore: true, loading: false, error: null } }, search: vi.fn(), more: vi.fn() }} />);
  expect(html).toContain('aria-label="Related context"'); expect(html).toContain('value="record-id"'); expect(html).toContain("Catalog label"); expect(html).toContain('value="option-a"'); expect(html).toContain("Choice label"); expect(onChange).not.toHaveBeenCalled();
  expect(html).toContain("Buscar opciones"); expect(html).toContain("Selección actual"); expect(html).toContain("Más opciones");
  expect(html).toContain("Revisa el contexto"); expect(html).toContain("Revisa la relación");
  for (const match of html.matchAll(/aria-(?:labelledby|describedby)="([^"]+)"/g)) for (const id of match[1].split(" ")) expect(html).toContain(`id="${id}"`);
  expect(html.indexOf("Related context")).toBeLessThan(html.indexOf("Choice label"));
 });
 it("keeps the context before the worker search and search has no required-context gate", () => {
  expect(text.indexOf("<AttendanceContextSelectors")).toBeLessThan(text.indexOf('testID="attendance-search"'));
  expect(text.slice(text.indexOf("async function searchPeople"), text.indexOf("async function selectPerson"))).not.toContain("attendanceContextValidationErrors(");
 });
 it("does not expand Attendance to MANY contexts or weaken required-context validation", () => {
  const relation = { id: "related", key: "related", name: "Related context", type: "RELATION" as const, required: true, multiple: true, config: { relation: { targetEntityTypeId: "catalog", relationKind: "MANY" } } };
  expect(attendanceContextFieldsFromPreparedDefinition([relation], [relation.id])).toEqual([]);
  expect(attendanceContextValidationErrors([{ ...relation, multiple: false }], { related: "record-id" })).toHaveLength(1);
  expect(attendanceContextValidationErrors([{ ...relation, multiple: false, config: { relation: { targetEntityTypeId: "catalog", relationKind: "ONE" } } }], {})).toEqual([{ fieldId: "related", message: "Related context es obligatorio." }]);
 });
});
