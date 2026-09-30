
import { describe, expect, it } from "vitest";
declare const require: (id: string) => { readFileSync: (path: string, encoding: string) => string };

const { readFileSync } = require("node:fs");

describe("read loading indicator integration", () => {
  const indicator = readFileSync(
    "src/components/read-loading-indicator.tsx",
    "utf8",
  );

  it("uses one accessible indeterminate bar with reduced-motion support", () => {
    expect(indicator).toContain('accessibilityRole="progressbar"');
    expect(indicator).toContain('accessibilityLiveRegion="polite"');
    expect(indicator).toContain("AccessibilityInfo.isReduceMotionEnabled()");
    expect(indicator).toContain('"reduceMotionChanged"');
    expect(indicator).toContain("Animated.loop");
    expect(indicator).toContain(
      'mode === "initial" ? "Cargando…" : "Actualizando…"',
    );
    expect(indicator).not.toContain("accessibilityValue");
  });

  it("covers Home, route bootstrap, RECORDS, workflows, PANEL, and REPORT", () => {
    const files = [
      "app/(app)/index.tsx",
      "app/(app)/view/[appViewId].tsx",
      "src/renderers/records/RecordsRenderer.tsx",
      "src/renderers/workflows/attendance/AttendanceWorkflow.tsx",
      "src/renderers/workflows/state-update/StateUpdateWorkflow.tsx",
      "src/renderers/panels/PanelRenderer.tsx",
      "src/renderers/reports/ReportRenderer.tsx",
    ];

    for (const file of files) {
      expect(readFileSync(file, "utf8")).toContain("ReadLoadingIndicator");
    }
  });

  it("keeps selection guards beside compatible-content refreshes", () => {
    const home = readFileSync("app/(app)/index.tsx", "utf8");
    const records = readFileSync(
      "src/renderers/records/RecordsRenderer.tsx",
      "utf8",
    );
    const attendance = readFileSync(
      "src/renderers/workflows/attendance/AttendanceWorkflow.tsx",
      "utf8",
    );
    const stateUpdate = readFileSync(
      "src/renderers/workflows/state-update/StateUpdateWorkflow.tsx",
      "utf8",
    );
    const panel = readFileSync(
      "src/renderers/panels/PanelRenderer.tsx",
      "utf8",
    );
    const report = readFileSync(
      "src/renderers/reports/ReportRenderer.tsx",
      "utf8",
    );

    expect(home).toContain("!isMounted || remoteSettled");
    expect(home).toContain("loadedViewsScope === viewsScope");
    expect(records).toContain("JSON.stringify(debouncedSearch)");
    expect(attendance).toContain("loadedDate === date");
    expect(attendance).toContain("isAttendanceRequestCurrent");
    expect(stateUpdate).toContain("response.date === date");
    expect(stateUpdate).toContain("requestId !== requestSequenceRef.current");
    expect(panel).toContain("requestSeq.current !== seq");
    expect(panel).toContain("previous.queryKey === queryKey");
    expect(report).toContain("loadedQueryKey === reportQueryKey");
    expect(report).toContain("isMounted = false");
  });
});
