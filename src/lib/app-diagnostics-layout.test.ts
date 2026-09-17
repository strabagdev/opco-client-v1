import { describe, expect, it } from "vitest";

import {
  getDiagnosticsModalHeight,
  shouldShowDiagnosticsTabScrollIndicator,
} from "./app-diagnostics-layout";

describe("diagnostics modal layout", () => {
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
