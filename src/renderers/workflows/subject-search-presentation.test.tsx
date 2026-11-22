// Render the actual search fragments/styles without starting workflow persistence.
// @ts-expect-error Node types are intentionally absent from Expo config.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { CodeReader } from "../../components/code-reader";
import { colors } from "../../theme/paint";
import { metrics } from "../../theme/tokens";
import * as stability from "../../lib/visual-stability";
vi.mock("react-native", async () => import("react-native-web"));

function actualSearch(kind: "attendance" | "state-update") {
  const name = kind === "attendance" ? "Attendance" : "StateUpdate";
  const path = `src/renderers/workflows/${kind}/${name}Workflow.tsx`;
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let styleFunction: ts.FunctionDeclaration | undefined;
  let fragment: ts.JsxElement | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === `create${name}BaseStyles`) styleFunction = node;
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "View") {
      if ((kind === "attendance" && node.openingElement.getText(source).includes('testID="attendance-search"')) ||
          (kind === "state-update" && node.openingElement.getText(source).includes("styles.searchBlock"))) fragment = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!styleFunction || !fragment) throw Error("Actual search fragment/styles missing");
  function compile(text: string, context: Record<string, unknown>) {
    const js = ts.transpileModule(text, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    return new Function("exports", ...Object.keys(context), js)({}, ...Object.values(context));
  }
  const createStyles = compile(`${styleFunction.getText(source)}; return create${name}BaseStyles;`, { StyleSheet, colors, metrics, ...stability });
  const styles = createStyles();
  function render(ready: boolean, codeSearch = true) {
    const context = { React, View, Text, TextInput, CodeReader, styles, isDesktop: false,
      searchA11y: { labelId: "manual-label", controlProps: { accessibilityLabel: "Búsqueda manual", "aria-labelledby": "manual-label" } },
      appView: { config: { sourceEntityTypeId: "synthetic-source", ...(codeSearch ? { codeSearch: { fieldId: "identifier" } } : {}) } },
      requiredContextMissing: !ready, contextReady: ready, cameraIsActive: true, selectedItem: null, conflict: null,
      isSaving: false, isSearching: false, ownerKey: "synthetic-owner", selectedContractId: "synthetic-contract",
      resolutionScope: "synthetic-scope", readScope: "synthetic-scope", searchText: "000TEST", changeSearchText: vi.fn() };
    const Component = compile(`return function ActualSearch(){return (${fragment!.getText(source)});}`, context);
    return renderToStaticMarkup(<Component />);
  }
  return { styles, render };
}

describe.each(["attendance", "state-update"] as const)("%s manual search and scanner", kind => {
  it("keeps manual entry full width instead of letting the scanner squeeze its touch target", () => {
    const { styles } = actualSearch(kind);
    expect(styles.searchBlock).toMatchObject({ alignItems: "stretch", flexDirection: "column", width: "100%", minWidth: 0 });
    expect(styles.searchInput).toMatchObject({ width: "100%", minWidth: 0 });
    expect(styles.searchInput.minHeight).toBeGreaterThanOrEqual(44);
    expect(styles.searchInput.flex).toBeUndefined();
  });
  it("exposes editable manual entry and an independent scanner once the context is complete", () => {
    const html = actualSearch(kind).render(true);
    expect(html).toContain('aria-label="Búsqueda manual"');
    expect(html).toContain('value="000TEST"');
    expect(html).toContain('aria-label="Leer código con la cámara"');
    expect(html).not.toContain("readOnly");
    expect(html).not.toContain('aria-disabled="true"');
  });
  it("keeps both entry paths blocked until the required context is selected", () => {
    const html = actualSearch(kind).render(false);
    expect(html).toContain("readOnly");
    expect(html).toContain('aria-disabled="true"');
  });
  it("keeps the same manual field available when no scanner is configured", () => {
    const html = actualSearch(kind).render(true, false);
    expect(html).toContain('aria-label="Búsqueda manual"');
    expect(html).not.toContain("Escanear código");
    expect(html).not.toContain("readOnly");
  });
});
