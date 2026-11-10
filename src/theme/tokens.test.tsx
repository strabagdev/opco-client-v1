// @ts-expect-error Node types are intentionally absent from Expo config.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { activeThemeName, borderWidth, colors, focusOffset, metrics, space, themes, typography } from "./tokens";
import { actionColors, webFieldStyle } from "./control-presentation";
import { colors as paintColors } from "./paint";
import { desktopPalette } from "../lib/desktop-presentation";
import { FormAction } from "../components/form-actions";
import { CompactSelect } from "../components/compact-select";
import { DateFieldInput } from "../renderers/records/temporal-input.web";
vi.mock("react-native", async () => import("react-native-web"));
const approved = JSON.parse(readFileSync("design/proposals/visual-identity-2026-11-09/tokens.proposed.json", "utf8"));
function luminance(hex: string) {
  const values = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
}
function ratio(a: string, b: string) { const values = [luminance(a), luminance(b)].sort((x, y) => x - y); return (values[1] + 0.05) / (values[0] + 0.05); }
describe("approved shared theme contract, light active", () => {
  it("ships both exact approved palettes while remaining light without preference/storage effects", () => {
    expect(themes).toEqual(approved.themes); expect(activeThemeName).toBe("light"); expect(colors).toBe(themes.light);
    for (const key of ["surface", "primary", "text", "border", "controlBorder"] as const) expect(paintColors[key]).toBe(desktopPalette[key]);
    expect(space).toEqual(approved.space); expect(metrics).toEqual(approved.metrics);
    for (const [role, text] of Object.entries(typography)) expect(text).toEqual({ fontSize: approved.typography[role].size, lineHeight: approved.typography[role].lineHeight, fontWeight: String(approved.typography[role].weight) });
  });
  it.each(["light", "dark"] as const)("meets contrast for 49 defined role pairs in %s without rounding", theme => {
    const p = themes[theme]; let checks = 0;
    function test(fg: keyof typeof p, bg: keyof typeof p, minimum: number) { expect(ratio(p[fg], p[bg]), `${theme}/${fg}/${bg}`).toBeGreaterThanOrEqual(minimum); checks++; }
    for (const bg of ["canvas", "surface", "surfaceRaised", "surfaceSubtle", "surfaceAlternate"] as const) for (const fg of ["text", "textSecondary", "textQuiet"] as const) test(fg, bg, 4.5);
    for (const bg of ["primary", "primaryHover", "primaryPressed"] as const) test("onPrimary", bg, 4.5);
    for (const bg of ["secondary", "secondaryHover", "secondaryPressed"] as const) test("onSecondary", bg, 4.5);
    test("onSelection", "selection", 4.5); test("onDisabled", "disabled", 4.5);
    for (const bg of ["nav", "navHover", "navSelected"] as const) { test("onNav", bg, 4.5); test("navSecondary", bg, 4.5); test("focusOnNavigation", bg, 3); }
    for (const role of ["info", "success", "warning", "danger", "conflict"] as const) { test(role, `${role}Surface`, 4.5); test(`${role}Border`, `${role}Surface`, 3); }
    for (const bg of ["canvas", "surface", "surfaceRaised", "surfaceSubtle"] as const) test("focus", bg, 3);
    for (const bg of ["canvas", "surface", "surfaceRaised"] as const) test("controlBorder", bg, 3);
    expect(checks).toBe(49);
  });
  it("uses explicit hover/pressed/disabled pairs and gives disabled precedence", () => {
    for (const p of [themes.light, themes.dark]) {
      expect(actionColors(true, { hovered: true }, p).backgroundColor).toBe(p.primaryHover);
      expect(actionColors(true, { hovered: true, pressed: true }, p).backgroundColor).toBe(p.primaryPressed);
      expect(actionColors(false, { pressed: true }, p).backgroundColor).toBe(p.secondaryPressed);
      expect(actionColors(true, { disabled: true, hovered: true, pressed: true }, p)).toEqual({ backgroundColor: p.disabled, color: p.onDisabled, borderColor: p.disabledBorder });
    }
  });
  it("keeps field dimensions while applying focus, invalid and disabled paint", () => {
    const base = webFieldStyle(), focused = webFieldStyle(false, true, true), disabled = webFieldStyle(true, true, true);
    expect(focused.borderColor).toBe(paintColors.danger); expect(focused.outline).toBe(`${borderWidth.focus}px solid ${paintColors.focus}`);
    expect(focused.outlineOffset).toBe(focusOffset); expect(focused.minHeight).toBe(44); expect(disabled.outline).toBeUndefined(); expect(disabled.color).toBe(paintColors.onDisabled);
    for (const key of ["padding", "borderWidth", "fontSize", "minHeight", "boxSizing"] as const) expect(focused[key]).toBe(base[key]);
    expect(base.colorScheme).toBe("inherit");
  });
  it("keeps explicit disabled/busy semantics and controlled IDs without side effects", () => {
    const change = vi.fn(); const html = renderToStaticMarkup(<><FormAction label="Guardar" busy disabled onPress={change} /><CompactSelect label="Selección" options={[{ value: "00001", label: "Etiqueta" }]} value="00001" onChange={change} /><DateFieldInput label="Fecha" required value="2026-11-09" onChange={change} /></>);
    expect(html).toContain('aria-disabled="true"'); expect(html).toContain('aria-busy="true"'); expect(html).toContain('value="00001" selected=""'); expect(html).toContain('value="2026-11-09"'); expect(change).not.toHaveBeenCalled();
  });
});
