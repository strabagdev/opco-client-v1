import { describe, expect, it } from "vitest";

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
  it("renders status as a live non-button indicator and keeps the diagnostics button", () => {
    const source = require("fs").readFileSync("app/(app)/_layout.tsx", "utf8");

    expect(source).toContain('accessibilityLiveRegion="polite"');
    expect(source).toContain("style={styles.statusIndicator}");
    expect(source).not.toContain('accessibilityHint="Abre el diagnóstico de sincronización"');
    expect(source).not.toContain("diagnosticTabForStatusIndicator");
    expect(source).toContain("GLOBAL_DIAGNOSTICS_BUTTON.accessibilityLabel");
    expect(source).toContain("onPress={() => setIsDiagnosticsOpen(true)}");
    expect(source).toContain("styles.headerStatusZone");
    expect(source).toContain("styles.headerStatusRow");
    expect(source).toContain("const statusIndicator = (");
    expect(source).not.toContain("cacheBannerMessage");
  });
  it.each([
    { layout: "compact", width: 390 },
    { layout: "compact", width: 768 },
    { layout: "wide", width: 1024 },
    { layout: "wide", width: 1280 },
  ])("uses the $layout header arrangement at $width px", ({ layout, width }) => {
    expect(width >= APP_SHELL_WIDE_BREAKPOINT).toBe(layout === "wide");
  });
  it("keeps equal wide zones and separates the three compact header rows", () => {
    const source = require("fs").readFileSync("app/(app)/_layout.tsx", "utf8");

    expect(source).toContain("styles.headerIdentity");
    expect(source).toContain("styles.headerStatusZone");
    expect(source).toContain("styles.headerActions");
    expect(source).toMatch(/headerIdentity:[\s\S]{0,180}flex: 1/);
    expect(source).toMatch(/headerStatusZone:[\s\S]{0,180}flex: 1/);
    expect(source).toMatch(/headerActions:[\s\S]{0,180}flex: 1/);
    expect(source).toContain("{isWideLayout ? userMenuButton : null}");
    expect(source).toContain("!isWideLayout ? <View style={styles.headerUserRow}>{userMenuButton}</View> : null");
    expect(source).toContain("!isWideLayout ? <View style={styles.headerStatusRow}>{statusIndicator}</View> : null");
    expect(source).toMatch(/headerUserRow:[\s\S]{0,180}justifyContent: "center"[\s\S]{0,100}width: "100%"/);
    expect(source).toMatch(/headerStatusRow:[\s\S]{0,180}justifyContent: "center"[\s\S]{0,80}width: "100%"/);
    expect(source).toContain("styles.userButtonTextCompact");
    expect(source).not.toMatch(/userDisplayName[^\n]*numberOfLines/);
    expect(source).toMatch(/statusLabel:[\s\S]{0,180}flexShrink: 1/);
    expect(source).toMatch(/userButtonText:[\s\S]{0,180}flexShrink: 1/);
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
