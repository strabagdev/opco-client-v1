import { actionSurface } from "../../../theme/operational-presentation";
import { colors } from "../../../theme/tokens";
// @ts-expect-error Node types are intentionally absent from the Expo config.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { View, Text, ScrollView, Pressable } from "react-native";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { EntityField, StateUpdateBatchResult, StateUpdateField } from "@/lib/opco-api";
import { buildStateUpdateConflictRows, type StateUpdateConflictRow } from "./state-update-workflow-logic";
import { presentStateUpdateConflictRows } from "./state-update-conflict-presentation";
import { StateUpdateConflictValues } from "./state-update-conflict-values";
vi.mock("react-native", async () => import("react-native-web"));
const relation = { id: "reference-id", key: "reference-key", name: "Referencia", type: "RELATION", options: [{ id: "ref-2", label: "Catálogo autorizado" }] } as unknown as EntityField;
const select = { id: "select-id", key: "select-key", name: "Categoría", type: "SELECT", options: [{ id: "option-id", value: "canonical", label: "Categoría visible", active: true }] } as unknown as EntityField;
const state = { fieldId: "state-id", label: "Estado", type: "SELECT", options: [{ optionId: "state-option", value: "canonical-state", label: "Estado visible" }] } as StateUpdateField;
const row = (a: unknown, b: unknown, type = "RELATION"): StateUpdateConflictRow => ({ fieldId: relation.id, fieldType: type, label: "Referencia", existing: "old formatted text", requested: "old formatted text", technicalExisting: a as never, technicalRequested: b as never });
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
describe("read-only conflict presentation", () => {
  it("uses same-snapshot displayName, then same-field labels/catalog, without replacing IDs", () => {
    const input = freeze([row({ id: "ref-1", displayName: "Etiqueta del snapshot" }, ["ref-1", "ref-2", "missing"]) ]); const before = JSON.stringify(input);
    const result = presentStateUpdateConflictRows(input, [], [relation]);
    expect(result[0].server).toEqual([{ label: "Etiqueta del snapshot" }]);
    expect(result[0].local).toEqual([{ label: "Etiqueta del snapshot" }, { label: "Catálogo autorizado" }, { label: "Referencia sin etiqueta disponible", detail: "Identificador: missing" }]);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("retains each side's own label, multiple order and duplicate entries", () => {
    expect(presentStateUpdateConflictRows([row({ id: "ref-1", displayName: "Anterior" }, [{ id: "ref-1", displayName: "Actual" }, "ref-1"])], [], [relation])[0]).toMatchObject({ server: [{ label: "Anterior" }], local: [{ label: "Actual" }, { label: "Actual" }] });
  });
  it("does not resolve a relation from another field's catalog", () => {
    const wrong = { ...relation, id: "other-id", key: "other-key" }; expect(presentStateUpdateConflictRows([row("ref-2", "ref-2")], [], [wrong])[0].local[0].label).toBe("Referencia sin etiqueta disponible");
  });
  it("accepts key aliases and distinguishes unavailable metadata from an empty relation", () => {
    const a = { ...row([], "ref-2"), fieldId: relation.key }; expect(presentStateUpdateConflictRows([a], [], [relation])[0]).toMatchObject({ server: [{ label: "Sin valor" }], local: [{ label: "Catálogo autorizado" }] });
    expect(presentStateUpdateConflictRows([row("ref-2", { unknown: "object" })], [], [])[0].local).toEqual([{ label: "Referencia sin etiqueta disponible" }]);
  });
  it.each([null, undefined, "", []])("empty %s stays distinct from unavailable", empty => { expect(presentStateUpdateConflictRows([row(empty, "missing")], [], [relation])[0].server).toEqual([{ label: "Sin valor" }]); });
  it("resolves canonical extras and legacy option IDs with their snapshot provenance", () => {
    const r = { ...row("canonical", "option-id", "SELECT"), fieldId: select.id };
    expect(presentStateUpdateConflictRows([r], [], [select])[0].local[0].label).toBe("Categoría visible");
    expect(presentStateUpdateConflictRows([r], [], [select], { server: "field-value", local: "field-value" })[0].local[0]).toEqual({ label: "Opción sin etiqueta disponible", detail: "Valor: option-id" });
  });
  it("does not reinterpret ambiguous option IDs as another canonical value", () => {
    const ambiguous = { ...select, options: [...select.options!, { id: "other", value: "option-id", label: "Otra", active: true, order: 1 }] };
    const r = { ...row("canonical", "option-id", "SELECT"), fieldId: select.id };
    expect(presentStateUpdateConflictRows([r], [], [ambiguous])[0].local[0].label).toBe("Opción sin etiqueta disponible");
  });
  it("renders every MULTISELECT value including unavailable ones", () => {
    const r = { ...row(["canonical"], ["canonical", "missing"], "MULTISELECT"), fieldId: select.id };
    expect(presentStateUpdateConflictRows([r], [], [{ ...select, type: "MULTISELECT" }])[0].local).toEqual([{ label: "Categoría visible" }, { label: "Opción sin etiqueta disponible", detail: "Valor: missing" }]);
  });
  it.each(["SELECT", "MULTISELECT"])("does not expose %s values as labels when field metadata is absent", type => {
    const r = { ...row("old-id", ["missing-id"], type), fieldId: select.id };
    expect(presentStateUpdateConflictRows([r], [], [])[0]).toMatchObject({
      server: [{ label: "Opción sin etiqueta disponible", detail: "Valor: old-id" }],
      local: [{ label: "Opción sin etiqueta disponible", detail: "Valor: missing-id" }],
    });
  });
  it("keeps state optionId separate from canonical extra values, using snapshot labels if supplied", () => {
    const r = { ...row("state-option", "canonical-state", "STATE"), fieldId: state.fieldId, existing: null, requested: null };
    expect(presentStateUpdateConflictRows([r], [state], [select])[0]).toMatchObject({ server: [{ label: "Estado visible" }], local: [{ label: "Opción sin etiqueta disponible", detail: "Valor: canonical-state" }] });
    expect(presentStateUpdateConflictRows([{ ...r, requested: "Etiqueta del servidor" }], [state], [])[0].local[0].label).toBe("Etiqueta del servidor");
  });
  it.each([0, false, "00027-K"])('preserves scalar %s and never mutates the original', value => { expect(presentStateUpdateConflictRows([{ ...row(value, value, "TEXT"), existing: String(value), requested: String(value) }], [], [])[0].local[0].label).toBe(String(value)); });
  it("does not put unformatted object JSON in the primary UI", () => { expect(presentStateUpdateConflictRows([row({ a: "sensitive" }, { a: "sensitive" }, "OTHER")], [], [])[0].local[0]).toEqual({ label: "Valor sin presentación disponible" }); });
});
const conflict = { result: "CONFLICT", subjectName: "Sujeto sintético", subjectRecordId: "subject", existing: { recordId: "remote", updatedAt: "base", stateValues: [{ fieldId: "state-id", optionId: "state-option", label: "Estado visible" }], extraValues: { [relation.id]: [{ id: "ref-1", displayName: "Relación anterior" }] } }, requested: { stateValues: [{ fieldId: "state-id", optionId: "state-new", label: "Otro estado" }], extraValues: { [relation.id]: ["ref-2", "missing"] } } } as Extract<StateUpdateBatchResult, { result: "CONFLICT" }>;
const sourcePath = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env.OPCO_CONFLICT_SOURCE_FILE ?? "src/renderers/workflows/state-update/StateUpdateWorkflow.tsx";
const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const modalNode = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "ConflictModal")!;
const code = ts.transpileModule(modalNode.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const deps = { actionSurface, colors, React, Modal: View, View, Text, ScrollView, Pressable, StateUpdateConflictValues, buildStateUpdateConflictRows, useStateUpdateStyles: () => ({}) };
const Modal = new Function(...Object.keys(deps), code + ";return ConflictModal;")(...Object.values(deps));
describe("real conflict modal projection", () => {
  it("regression: RELATION MANY labels replace ID/JSON in the real dialog", () => {
    const command = freeze(structuredClone(conflict)); const before = JSON.stringify(command); const onConfirm = vi.fn(), onCancel = vi.fn();
    const html = renderToStaticMarkup(<Modal conflict={command} fields={[state]} extraFields={[relation]} onConfirm={onConfirm} onCancel={onCancel} isSaving={false} />);
    expect(html).toContain("Catálogo autorizado"); expect(html).toContain("Relación anterior"); expect(html).toContain("Referencia sin etiqueta disponible"); expect(html).toContain("Identificador: missing"); expect(html).not.toContain('&quot;displayName&quot;');
    expect(JSON.stringify(command)).toBe(before); expect(onConfirm).not.toHaveBeenCalled(); expect(onCancel).not.toHaveBeenCalled();
  });
  it("identifies server versus local proposed value, without introducing another version or write", () => {
    const html = renderToStaticMarkup(<Modal conflict={conflict} fields={[state]} extraFields={[relation]} onConfirm={vi.fn()} onCancel={vi.fn()} isSaving={false} />);
    expect(html).toContain("En el servidor"); expect(html).toContain("Tu cambio propuesto"); expect(html).toContain("Edición local por confirmar"); expect(html).toContain("Confirmar cambio"); expect(html).toContain("Cancelar");
  });
  it("persisted conflicts identify the local saved intent and preserve server/local labels", () => {
    const html = renderToStaticMarkup(<StateUpdateConflictValues rows={buildStateUpdateConflictRows(conflict, [state], [relation])} fields={[state]} extraFields={[relation]} persisted />);
    expect(html).toContain("Guardado en este dispositivo"); expect(html).toContain("En el servidor"); expect(html).toContain("Otro estado");
  });
});
