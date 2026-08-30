import { describe, expect, it } from "vitest";

import { GLOBAL_DIAGNOSTIC_TABS, GLOBAL_DIAGNOSTICS_BUTTON, normalizeDiagnosticTabId } from "./app-diagnostics";

describe("global app diagnostics", () => {
  it("defines the initial diagnostics tabs in one extensible list", () => {
    expect(GLOBAL_DIAGNOSTIC_TABS).toEqual([
      { id: "pwa", label: "PWA" },
      { id: "state-update", label: "STATE_UPDATE" },
      { id: "records", label: "RECORDS" },
    ]);
  });

  it("keeps the modal on a valid selected tab and falls back to PWA", () => {
    expect(normalizeDiagnosticTabId("records")).toBe("records");
    expect(normalizeDiagnosticTabId("state-update")).toBe("state-update");
    expect(normalizeDiagnosticTabId("missing")).toBe("pwa");
    expect(normalizeDiagnosticTabId(null)).toBe("pwa");
  });

  it("uses a technical diagnostics icon and clear accessibility label", () => {
    expect(GLOBAL_DIAGNOSTICS_BUTTON).toEqual({
      accessibilityLabel: "Diagnostico",
      icon: "chart-no-axes-column",
    });
  });
});
