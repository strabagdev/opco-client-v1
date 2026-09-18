import { describe, expect, it } from "vitest";

import {
  getDiagnosticsModalHeight,
  shouldShowDiagnosticsTabScrollIndicator,
} from "./app-diagnostics-layout";

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
  it("keeps the status point and label in one accessible control that selects sync", () => {
    const source = require("fs").readFileSync("app/(app)/_layout.tsx", "utf8");
    const controlStart = source.indexOf('accessibilityHint="Abre el diagnóstico de sincronización"');
    const controlEnd = source.indexOf("</Pressable>", controlStart);
    const control = source.slice(controlStart, controlEnd);

    expect(controlStart).toBeGreaterThan(-1);
    expect(control).toContain("shellStatusIndicator.label");
    expect(control).toContain("shellStatusIndicator.accessibilityLabel");
    expect(control).toContain("diagnosticTabForStatusIndicator(selectedDiagnosticsTab)");
    expect(control).toContain("setIsDiagnosticsOpen(true)");
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
