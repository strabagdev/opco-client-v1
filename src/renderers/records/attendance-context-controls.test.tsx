// Actual context renderer/controls with synthetic data, SSR only; no browser/device evidence.
// @ts-expect-error Node types are intentionally absent from Expo config.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Text, View } from "react-native";
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { CompactSelect } from "../../components/compact-select";
import { RecordFieldInput } from "./RecordFieldInput";
import { getRelationTargetEntityTypeId } from "../../lib/record-form";
import { attendanceRelationField } from "../workflows/attendance/attendance-workflow-logic";
vi.mock("react-native", async () => import("react-native-web"));
vi.mock("./temporal-input", async () => import("./temporal-input.web"));
const path = "src/renderers/workflows/attendance/AttendanceWorkflow.tsx", text = readFileSync(path, "utf8"), source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let declaration: ts.FunctionDeclaration | undefined; function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "AttendanceContextSelectors") declaration = node; ts.forEachChild(node, visit); } visit(source);
const code = ts.transpileModule(declaration!.getText(source), { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
describe("real Attendance context controls", () => {
 it.each([390, 1440])("renders related and SELECT labels/IDs in compact controls at %s, without business writes", width => {
  const styles = { contextBlock: {}, contextField: {}, contextLabel: {}, error: {} };
  const context = { React, Text, View, CompactSelect, RecordFieldInput, attendanceRelationField, getRelationTargetEntityTypeId, useWindowDimensions: () => ({ width }), APP_SHELL_WIDE_BREAKPOINT: 1024, desktopStyles: styles, baseStyles: styles };
  const Component = new Function(...Object.keys(context), code + ";return AttendanceContextSelectors;")(...Object.values(context));
  const onChange = vi.fn(); const html = renderToStaticMarkup(<Component fields={[{ id: "related", key: "related", name: "Related context", type: "RELATION", required: true, config: { relation: { targetEntityTypeId: "catalog", relationKind: "ONE" } } }, { id: "choice", name: "Choice", type: "SELECT", required: true, options: [{ optionId: "option-a", label: "Choice label", value: "canonical-a" }] }]} values={{ related: "record-id", choice: "option-a" }} errors={{}} onChange={onChange} relations={{ catalogs: { related: { options: [{ id: "record-id", displayName: "Catalog label" }], hasMore: false, loading: false, error: null } }, search: vi.fn(), more: vi.fn() }} />);
  expect(html).toContain('aria-label="Related context"'); expect(html).toContain('value="record-id"'); expect(html).toContain("Catalog label"); expect(html).toContain('value="option-a"'); expect(html).toContain("Choice label"); expect(onChange).not.toHaveBeenCalled();
 });
 it("keeps the context before the worker search and search has no required-context gate", () => {
  expect(text.indexOf("<AttendanceContextSelectors")).toBeLessThan(text.indexOf('testID="attendance-search"'));
  expect(text.slice(text.indexOf("async function searchPeople"), text.indexOf("async function selectPerson"))).not.toContain("attendanceContextValidationErrors(");
 });
});
