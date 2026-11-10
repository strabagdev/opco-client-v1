import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import {
  getDiagnosticsModalHeight,
  shouldShowDiagnosticsTabScrollIndicator,
} from "./app-diagnostics-layout";
import { APP_SHELL_WIDE_BREAKPOINT } from "./app-shell-layout";

declare const require: (id: string) => { readFileSync: (path: string, encoding: string) => string };

describe("diagnostics modal layout", () => {
  it("uses collapsed accessible disclosure rows without nested detail scrolling", () => {
    const source = require("fs").readFileSync("app/(app)/_layout.tsx", "utf8");
    const stateUpdateSource = require("fs").readFileSync("src/state/session.tsx", "utf8");

    expect(source).toContain("function DiagnosticDisclosureRow");
    expect(source).toContain("const [expanded, setExpanded] = useState(false)");
    expect(source).toContain("accessibilityState={{ expanded }}");
    expect(source).not.toMatch(/disclosureDetail:[\s\S]{0,180}overflow/);
    expect(stateUpdateSource).toContain("function StateUpdateDisclosureRow");
    expect(stateUpdateSource).toContain("accessibilityState={{ expanded }}");
    expect(stateUpdateSource).toContain("{action}");
  });
  it.each(["error", "working", "pending", "offline", "idle"])("opens the correct diagnostics tab from the real %s status action", state => {
    const text = require("fs").readFileSync("app/(app)/_layout.tsx", "utf8");
    const source = ts.createSourceFile("layout.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let indicator: ts.VariableDeclaration | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(source) === "statusIndicator") indicator = node;
      ts.forEachChild(node, visit);
    };
    visit(source);
    let action: ts.JsxAttribute | undefined, label: ts.JsxAttribute | undefined;
    const props = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === "Pressable") {
        action = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === "onPress") as ts.JsxAttribute;
        label = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === "accessibilityLabel") as ts.JsxAttribute;
      }
      ts.forEachChild(node, props);
    };
    expect(indicator?.initializer).toBeDefined(); props(indicator!.initializer!);
    const expression = (action!.initializer as ts.JsxExpression).expression!.getText(source);
    const js = ts.transpileModule("const press = " + expression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const select = vi.fn(), open = vi.fn();
    new Function("shellStatusIndicator", "setSelectedDiagnosticsTab", "setIsDiagnosticsOpen", js + ";press();")({ state }, select, open);
    expect(select).toHaveBeenCalledExactlyOnceWith(state === "error" ? "problems" : "sync");
    expect(open).toHaveBeenCalledExactlyOnceWith(true);
    // Keep both the current user-facing status and the detailed accessible status.
    expect(label?.initializer?.getText(source)).toContain("statusPresentation.label");
    expect(label?.initializer?.getText(source)).toContain("shellStatusIndicator.accessibilityLabel");
    expect(text).toContain('accessibilityRole="progressbar"');
    expect(text).toContain("accessibilityValue={{");
    expect(text).toContain("styles.offlinePreparationProgressTrack");
    expect(text).toContain('preparationProgress?.state === "incomplete"');
    expect(text).toContain("GLOBAL_DIAGNOSTICS_BUTTON.accessibilityLabel");
    expect(text).not.toContain("cacheBannerMessage");
  });
  it.each([
    { layout: "compact", width: 390 },
    { layout: "compact", width: 768 },
    { layout: "wide", width: 1024 },
    { layout: "wide", width: 1280 },
  ])("uses the $layout header arrangement at $width px", ({ layout, width }) => {
    expect(width >= APP_SHELL_WIDE_BREAKPOINT).toBe(layout === "wide");
  });
  it("wires one responsive header to the existing status, account menu and back handler", () => {
    const text = require("fs").readFileSync("app/(app)/_layout.tsx", "utf8");
    const source = ts.createSourceFile("layout.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const headers: ts.JsxSelfClosingElement[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "AppShellHeader") headers.push(node);
      ts.forEachChild(node, visit);
    };
    visit(source); expect(headers).toHaveLength(1);
    const attributes = Object.fromEntries(headers[0].attributes.properties.filter(ts.isJsxAttribute).map(p => [p.name.getText(source), p.initializer?.getText(source)]));
    expect(attributes).toMatchObject({ status: "{statusIndicator}", menu: "{userMenuButton}", onBack: "{goBack}", width: "{width}", wide: "{isWideLayout}" });
    // Responsive component rendering at all four widths is covered by app-shell-navigation.test.tsx.
  });
  it("replaces generic RECORDS save/cache banners without removing contextual recovery UI", () => {
    const listSource = require("fs").readFileSync("src/renderers/records/RecordsRenderer.tsx", "utf8");
    const detailSource = require("fs").readFileSync("src/renderers/records/RecordDetailScreen.tsx", "utf8");
    const formSource = require("fs").readFileSync("src/renderers/records/RecordFormScreen.tsx", "utf8");

    expect(listSource).not.toContain("Datos guardados localmente.");
    expect(detailSource).not.toContain("Datos guardados localmente.");
    expect(formSource).toContain("reportWriteFeedback");
    expect(detailSource).toContain("record.syncErrorMessage");
    expect(detailSource).toContain("Revisar conflicto");
    expect(detailSource).toContain("Reintentar");
  });
  it.each([
    { height: 900, name: "desktop", width: 1280 },
    { height: 768, name: "tablet", width: 1000 },
    { height: 844, name: "mobile", width: 390 },
    { height: 600, name: "short mobile", width: 390 },
  ])("keeps the $name panel inside the viewport", ({ height, width }) => {
    const panelHeight = getDiagnosticsModalHeight({ height, width });
    const gutter = width < 760 ? 12 : 24;

    expect(panelHeight).toBeLessThanOrEqual(height - gutter * 2);
    expect(panelHeight).toBeLessThanOrEqual(820);
    expect(panelHeight).toBeGreaterThan(0);
  });

  it("uses the available height instead of shrinking fixed modal regions", () => {
    expect(getDiagnosticsModalHeight({ height: 768, width: 1000 })).toBe(720);
    expect(getDiagnosticsModalHeight({ height: 600, width: 390 })).toBe(576);
  });

  it("makes tab overflow discoverable on compact widths", () => {
    expect(shouldShowDiagnosticsTabScrollIndicator(390)).toBe(true);
    expect(shouldShowDiagnosticsTabScrollIndicator(1000)).toBe(false);
  });
});
