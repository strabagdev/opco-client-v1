// Real private field renderer, isolated from workflow effects; browser evidence covers layout/lifecycle.
// @ts-expect-error Node types are intentionally absent from the Expo config.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { FieldFrame } from "../../../components/field-frame";
import { useFieldAccessibility } from "../../../components/field-accessibility";
import { CompactSelect, activateCompactCheckboxFromKeyboard } from "../../../components/compact-select";
import { DateFieldInput, TimeFieldInput, DateTimeFieldInput } from "../../records/temporal-input.web";
import type { StateUpdateField } from "../../../lib/opco-api";
import { stateFieldType } from "./state-update-workflow-logic";
vi.mock("react-native", async () => import("react-native-web"));
const path = "src/renderers/workflows/state-update/StateUpdateWorkflow.tsx";
const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "StateFieldInput")!;
const code = ts.transpileModule(node.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const dependencies = { React, Platform, Pressable, Text, TextInput, View, FieldFrame, useFieldAccessibility, CompactSelect, activateCompactCheckboxFromKeyboard,
  DateFieldInput, TimeFieldInput, DateTimeFieldInput, stateFieldType, useStateUpdateStyles: () => ({}), stateFormStyles: {} };
const Component = new Function(...Object.keys(dependencies), code + ";return StateFieldInput;")(...Object.values(dependencies));
const field = (type: StateUpdateField["type"]) => ({ fieldId: "stable-field-id", label: "Dato configurado", type, required: true,
  options: [{ optionId: "stable-option-id", label: "Etiqueta visible", value: "canonical-extra-value", active: true }, { optionId: "inactive-id", label: "Anterior", active: false }] }) as StateUpdateField;

describe("real STATE_UPDATE field composition", () => {
  it.each([
    ["SELECT", "stable-option-id", 'value="stable-option-id" selected=""'],
    ["TEXT", "00027-K", 'value="00027-K"'], ["TEXTAREA", "Texto existente", 'value="Texto existente"'],
    ["DECIMAL", "10.1", 'value="10.1"'], ["DATE", "2026-11-08", 'value="2026-11-08"'],
    ["TIME", "08:30", 'value="08:30"'], ["DATETIME", "2026-11-08T08:30", 'value="08:30"'],
  ] as const)("keeps %s controlled values and labels without a new command", (type, value, expected) => {
    const onChange = vi.fn(); const html = renderToStaticMarkup(<Component field={field(type)} value={value} onChange={onChange} />);
    expect(html).toContain(expected); expect(html).toContain("Dato configurado (obligatorio)"); expect(onChange).not.toHaveBeenCalled();
    const id = html.match(/aria-labelledby="([^"]+)"/)?.[1]; expect(id).toBeTruthy();
    for (const label of id!.split(" ")) expect(html).toContain(`id="${label}"`);
  });
  it("preserves the state optionId contract, required placeholder and unavailable selection", () => {
    const html = renderToStaticMarkup(<Component field={field("SELECT")} value="old-id" onChange={vi.fn()} />);
    expect(html).toContain('value="old-id" disabled="" selected=""'); expect(html).toContain('value="inactive-id" disabled=""');
    expect(html).not.toContain('value="canonical-extra-value"'); expect(html).toContain('value="" disabled=""');
  });
  it.each([false, true, undefined])("does not initialize or invert BOOLEAN %s", value => {
    const onChange = vi.fn(); const html = renderToStaticMarkup(<Component field={field("BOOLEAN")} value={value} onChange={onChange} />);
    expect(html).toContain('role="checkbox"'); expect(html).toContain(`aria-checked="${value === true}"`); expect(onChange).not.toHaveBeenCalled();
  });
});
