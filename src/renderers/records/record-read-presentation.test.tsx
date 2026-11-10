// @ts-expect-error Node types are intentionally absent from the Expo config.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Pressable, Text, View, ActivityIndicator, StyleSheet } from "react-native";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { EntityDefinition, EntityField, EntityRecord } from "../../lib/opco-api";
import { buildRecordListItem, formatRecordValue } from "../../lib/entity-record-display";
import { ReadFieldList } from "../../components/read-field-list";
import { buildRecordReadFields } from "./record-read-presentation";
vi.mock("react-native", async () => import("react-native-web"));
const field = (type: EntityField["type"], extra: Partial<EntityField> = {}) => ({ id: "field-id", key: "field-key", name: "Campo configurado", type, active: true, required: false, order: 0, options: [], config: { display: { showInClient: true } }, ...extra }) as EntityField;
const definition = (...fields: EntityField[]) => ({ id: "entity", name: "Entidad", fields }) as EntityDefinition;
const record = (values: EntityRecord["values"]) => ({ id: "record-stable", displayName: "Registro sintético", entityTypeId: "entity", updatedAt: "2026-11-08T12:00:00.000Z", values }) as EntityRecord;
const value = (f: EntityField, raw: unknown) => buildRecordReadFields(definition(f), record({ [f.key]: raw as never }))[0].values;
function freeze<T>(x: T): T { if (x && typeof x === "object") { Object.freeze(x); Object.values(x).forEach(freeze); } return x; }
describe("RECORDS-only read projection", () => {
  it("preserves active order, list visibility and primary-field exclusion", () => {
    const d = definition(field("TEXT", { id: "primary", key: "primary", order: 3, config: { display: { primary: true, showInClient: true } } }), field("TEXT", { id: "later", key: "later", order: 2 }), field("TEXT", { id: "first", key: "first", order: 1 }), field("TEXT", { id: "hidden", key: "hidden", config: { display: { showInClient: false } } }), field("TEXT", { id: "inactive", key: "inactive", active: false }));
    expect(buildRecordReadFields(d, record({}), "list").map(x => x.key)).toEqual(["first", "later"]);
    expect(buildRecordReadFields(d, record({})).map(x => x.key)).toEqual(["hidden", "first", "later", "primary"]);
  });
  it.each([null, "", []])("explicit empty %s is not unavailable", x => { expect(value(field("TEXT"), x)).toEqual([{ text: "Sin valor", status: "empty" }]); });
  it("distinguishes omitted and undefined data from explicit empty", () => {
    expect(buildRecordReadFields(definition(field("TEXT")), record({}))[0].values[0].status).toBe("unavailable");
    expect(value(field("TEXT"), undefined)[0].text).toBe("Dato no disponible en esta copia");
  });
  it.each([[false, "No"], [true, "Si"], [0, "0"], ["00027-K", "00027-K"], ["Texto\ncompleto", "Texto\ncompleto"]])("keeps scalar %s", (raw, text) => { expect(value(field(typeof raw === "boolean" ? "BOOLEAN" : "TEXT"), raw)[0]).toEqual({ text, status: "value" }); });
  it.each([["DATE", "2026-11-08", "08/11/2026"], ["TIME", "08:30", "08:30"]] as const)("preserves temporal %s semantics", (type, raw, text) => { expect(value(field(type), raw)[0].text).toBe(text); });
  it("uses existing decimal/date-time formatting without rounding or new parsing", () => {
    for (const f of [field("DECIMAL", { config: { decimalPlaces: 1 } }), field("DATETIME")]) {
      const raw = f.type === "DECIMAL" ? "10.15" : "2026-11-08T10:30:00.000Z";
      expect(value(f, raw)[0].text).toBe(formatRecordValue(raw, f));
    }
  });
  it("shows ONE/MANY embedded labels, every entry and secondary unknown IDs", () => {
    expect(value(field("RELATION"), { id: "r1", displayName: "Nombre relacionado" })[0]).toEqual({ text: "Nombre relacionado", status: "value" });
    expect(value(field("RELATION", { multiple: true }), ["r1", { id: "r1", displayName: "Nombre relacionado" }, "unknown"])).toEqual([{ text: "Nombre relacionado", status: "value" }, { text: "Nombre relacionado", status: "value" }, { text: "Referencia sin etiqueta disponible", status: "unavailable", detail: "Identificador: unknown" }]);
  });
  it("does not borrow labels from another field or infer from IDs", () => {
    const d = definition(field("RELATION", { key: "one" }), field("RELATION", { key: "two", id: "other" }));
    const fields = buildRecordReadFields(d, record({ one: { id: "r1", displayName: "Privado al campo" }, two: "r1" }));
    expect(fields[1].values[0].status).toBe("unavailable");
  });
  it("preserves generic SELECT canonical values, inactive labels, and unknown selections", () => {
    const f = field("SELECT", { options: [{ id: "option-id", value: "canonical", label: "Etiqueta existente", active: false, order: 0 }] });
    expect(value(f, "canonical")[0].text).toBe("Etiqueta existente");
    expect(value(f, "option-id")[0]).toEqual({ text: "Opción sin etiqueta disponible", status: "unavailable", detail: "Valor: option-id" });
    expect(value({ ...f, options: undefined }, "canonical")[0].status).toBe("unavailable");
    expect(value({ ...f, type: "MULTISELECT" }, ["canonical", "unknown"]).map(x => x.status)).toEqual(["value", "unavailable"]);
  });
  it("does not serialize unknown objects or reinterpret literal text JSON", () => {
    expect(value(field("TEXT"), { other: "value" })[0].text).toBe("Valor sin presentación disponible");
    expect(value(field("TEXT"), '{"id":"literal text"}')[0].text).toBe('{"id":"literal text"}');
  });
  it("is immutable and leaves global legacy formatters unchanged", () => {
    const d = freeze(definition(field("RELATION"))), r = freeze(record({ "field-key": ["r1", "r2"] })); const before = JSON.stringify([d, r]);
    buildRecordReadFields(d, r); expect(JSON.stringify([d, r])).toBe(before);
    expect(formatRecordValue(["r1", "r2"], d.fields[0])).toBe("r1, r2");
  });
  it("renders complete read-only values with labels and no input/write control", () => {
    const fields = buildRecordReadFields(definition(field("TEXTAREA")), record({ "field-key": "Texto extenso ".repeat(100) }));
    for (const compact of [false, true]) {
      const html = renderToStaticMarkup(<ReadFieldList fields={fields} compact={compact} />);
      expect(html).toContain("Texto extenso ".repeat(100)); expect(html).toContain("Campo configurado"); expect(html).not.toContain("<input"); expect(html).not.toContain('role="button"');
    }
  });
});
const sourcePath = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env.OPCO_RECORDS_SOURCE_FILE ?? "src/renderers/records/RecordsRenderer.tsx";
const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "RecordsListContent")!;
const code = ts.transpileModule(fn.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const Link = ({ children }: { children: React.ReactNode }) => <>{children}</>;
const deps = { React, View, Text, Pressable, ActivityIndicator, Link, ReadFieldList, buildRecordReadFields, buildAppViewRecordHref: () => "/unchanged-record", SyncBadge: () => null, ReadLoadingState: () => <Text>Cargando</Text>, styles: {} };
const List = new Function(...Object.keys(deps), code + ";return RecordsListContent;")(...Object.values(deps));
it("regression: actual RECORDS list distinguishes missing labels and explicit empty instead of raw IDs", () => {
  const d = definition(field("RELATION"), field("TEXT", { key: "empty", id: "empty-id", name: "Vacío" })); const r = record({ "field-key": "unknown-ref", empty: null }); const before = JSON.stringify(r); const retry = vi.fn(), loadMore = vi.fn();
  const html = renderToStaticMarkup(<List appViewId="view" definition={d} items={[buildRecordListItem({ definition: d, record: r })]} records={[r]} isLoading={false} isRefreshing={false} isLoadingMore={false} isOfflineData={true} localCoverage="partial" error={null} debouncedSearch="" canLoadMore={true} onLoadMore={loadMore} onRetry={retry} />);
  expect(html).toContain("Referencia sin etiqueta disponible"); expect(html).toContain("Identificador: unknown-ref"); expect(html).toContain("Sin valor"); expect(html).toContain("Cargar mas"); expect(html, "Cargar más expone su rol accesible").toContain('role="button"'); expect(JSON.stringify(r)).toBe(before); expect(loadMore).not.toHaveBeenCalled(); expect(retry).not.toHaveBeenCalled();
});


it("keeps every Link asChild style compatible with the installed Expo Slot", () => {
  // Expo Slot rejects child style arrays in development; Radix spreads them into invalid CSS keys in production.
  // Inspect the actual props, not colors/spacing or a duplicate implementation of the layout.
  const detailPath = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env.OPCO_DETAIL_SOURCE_FILE ?? "src/renderers/records/RecordDetailScreen.tsx";
  const detail = ts.createSourceFile(detailPath, readFileSync(detailPath, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const styles = new Proxy({}, { get: () => ({ minHeight: 44 }) }); let count = 0;
  for (const sf of [source, detail]) {
    function visit(node: ts.Node) {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sf) === "Link") {
        const child = node.children.find(n => ts.isJsxElement(n) && n.openingElement.tagName.getText(sf) === "Pressable");
        if (child && ts.isJsxElement(child)) {
          const attr = child.openingElement.attributes.properties.find(n => ts.isJsxAttribute(n) && n.name.getText(sf) === "style");
          if (attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
            const value = new Function("styles", "readStyles", "StyleSheet", "return " + attr.initializer.expression.getText(sf))(styles, styles, StyleSheet);
            expect(Array.isArray(value), "Link child style must be flattened before Slot merges it").toBe(false); count++;
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }
  expect(count).toBeGreaterThanOrEqual(4);
});
