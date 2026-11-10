// @ts-expect-error Node types are intentionally absent from Expo config.
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { StyleSheet } from "react-native";
import { actionSurface, operationalPaint, recordStatusPaint } from "./operational-presentation";
import { colors, metrics, themes } from "./tokens";
import { APP_SHELL_DESKTOP_GUTTER, APP_SHELL_HORIZONTAL_GUTTER } from "../lib/app-shell-layout";
import { stableSubmitButtonStyle, stableTextInputStyle } from "../lib/visual-stability";
import { desktopPalette, desktopStyleColors } from "../lib/desktop-presentation";
vi.mock("react-native", async () => import("react-native-web"));

/** Evaluate the actual exported style factories without loading workflow/session effects. */
function factory(file: string, name: string) {
  const text = readFileSync(file, "utf8"), source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = source.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text.startsWith("create") && n.name.text.endsWith("Styles"));
  const factoryNames = ["createShellHeaderS", "createNavigationMenuS", "createConflictValuesS"];
  for (const n of source.statements) if (ts.isFunctionDeclaration(n) && factoryNames.includes(n.name?.text ?? "")) nodes.push(n);
  const js = ts.transpileModule(nodes.map(n => n.getText(source).replace(/^export /, "")).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("StyleSheet", "colors", "metrics", "desktopStyleColors", "desktopPalette", "Platform", "APP_SHELL_DESKTOP_GUTTER", "APP_SHELL_HORIZONTAL_GUTTER", "stableTextInputStyle", "stableSubmitButtonStyle", js + `;return ${name};`)(StyleSheet, colors, metrics, desktopStyleColors, desktopPalette, { OS: "web" }, APP_SHELL_DESKTOP_GUTTER, APP_SHELL_HORIZONTAL_GUTTER, stableTextInputStyle, stableSubmitButtonStyle);
}
const fixtures = [
  ["app/(app)/_layout.tsx", "createShellBaseStyles", "modalPanel", "modalTitle", "primaryModalButton", "primaryModalButtonText"],
  ["src/renderers/workflows/attendance/AttendanceWorkflow.tsx", "createAttendanceBaseStyles", "modalPanel", "modalTitle", "modalPrimaryButton", "modalPrimaryText"],
  ["src/renderers/workflows/state-update/StateUpdateWorkflow.tsx", "createStateUpdateBaseStyles", "modalPanel", "modalTitle", "modalPrimaryButton", "modalPrimaryText"],
  ["src/renderers/records/RecordConflictScreen.tsx", "createRecordConflictStyles", "screen", "title", "primaryButton", "primaryText"],
  ["src/state/session.tsx", "createSessionNoticeStorageStyles", "diagnostics", "title", "primaryButton", "primaryText"],
] as const;
describe("operational visual tokens without changing operational state", () => {
  it.each(["light", "dark"] as const)("preserves text/background/border pairs for every operational tone in %s", theme => {
    const p = themes[theme];
    for (const tone of ["info", "success", "warning", "danger", "conflict"] as const) expect(operationalPaint(tone, p)).toEqual({ color: p[tone], backgroundColor: p[`${tone}Surface`], borderColor: p[`${tone}Border`] });
    expect(operationalPaint("neutral", p).color).toBe(p.textSecondary);
    expect(recordStatusPaint("conflict", p)).toEqual(operationalPaint("conflict", p));
    expect(recordStatusPaint("failed", p)).toEqual(operationalPaint("danger", p));
    for (const pending of ["pending_create", "pending_update"]) expect(recordStatusPaint(pending, p)).toEqual(operationalPaint("warning", p));
    expect(recordStatusPaint("synced", p)).toEqual(operationalPaint("neutral", p)); // no invented ACK
  });
  it("changes only paint on hover, press and disabled, with disabled precedence", () => {
    for (const p of Object.values(themes)) {
      expect(actionSurface(true, { hovered: true }, false, p).backgroundColor).toBe(p.primaryHover);
      expect(actionSurface(true, { hovered: true, pressed: true }, false, p).backgroundColor).toBe(p.primaryPressed);
      expect(actionSurface(false, { pressed: true }, true, p)).toEqual({ backgroundColor: p.disabled, borderColor: p.disabledBorder, opacity: 1 });
    }
  });
  it.each(fixtures)("uses the selected palette in the actual %s factory", (file, name, surface, text, button, buttonText) => {
    const create = factory(file, name);
    for (const p of Object.values(themes)) {
      const s = create(p);
      if (s[surface].backgroundColor) expect(s[surface].backgroundColor).toBe(surface === "screen" ? p.canvas : p.surface);
      expect(s[text].color).toBe(p.text);
      expect(s[button].backgroundColor).toBe(p.primary);
      expect(s[buttonText].color).toBe(p.onPrimary);
    }
  });
  it("keeps navigation surfaces/labels and secondary diagnostics legible in both palettes", () => {
    for (const p of Object.values(themes)) {
      const s = factory("src/components/desktop-navigation.tsx", "createDesktopNavigationStyles")(p);
      expect(s.sidebar.backgroundColor).toBe(p.nav); expect(s.brand.color).toBe(p.onNav); expect(s.linkText.color).toBe(p.onNav);
      const d = factory("src/state/session.tsx", "createSessionNoticeDiagnosticsPanelStyles")(p);
      expect(d.button.backgroundColor).toBe(p.secondary); expect(d.buttonText.color).toBe(p.onSecondary); expect(d.button.minHeight).toBe(44);
    }
  });
});
