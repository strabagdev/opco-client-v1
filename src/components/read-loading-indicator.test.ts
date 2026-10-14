
import { describe, expect, it } from "vitest";
declare const require: (id: string) => { readFileSync: (path: string, encoding: string) => string };

const { readFileSync } = require("node:fs");

describe("read loading indicator integration", () => {
  const indicator = readFileSync(
    "src/components/read-loading-indicator.tsx",
    "utf8",
  );

  it("keeps body loading states static and reduced motion in the central header", () => {
    const shell = readFileSync("app/(app)/_layout.tsx", "utf8");
    expect(indicator).toContain("ReadLoadingState");
    expect(indicator).not.toContain("Animated");
    expect(indicator).not.toContain("progressbar");
    expect(indicator).toContain("Esperando datos…");
    expect(indicator).toContain("AccessibilityInfo.isReduceMotionEnabled()");
    expect(indicator).toContain('"reduceMotionChanged"');
    expect(shell).toContain('accessibilityLiveRegion="polite"');
    expect(shell).toContain('shellStatusIndicator.state !== "working" || reducedMotion');
    expect(shell).toContain("animation.stop()");
  });

  it("keeps a static per-module state for PANEL and action spinners for writes/pagination", () => {
    expect(indicator).toContain("compact?: boolean");
    expect(indicator).toContain("Actualizando este módulo…");
    const panel = readFileSync("src/renderers/panels/PanelRenderer.tsx", "utf8");
    expect(panel).toContain('ReadLoadingState mode="refresh"');
    for (const file of ["src/renderers/records/RecordsRenderer.tsx", "src/renderers/workflows/attendance/AttendanceWorkflow.tsx", "src/renderers/workflows/state-update/StateUpdateWorkflow.tsx"]) {
      expect(readFileSync(file, "utf8")).toContain("ActivityIndicator");
    }
  });

  it("covers all initial bodies without animated refresh bars", () => {
    for (const file of ["app/(app)/index.tsx", "app/(app)/view/[appViewId].tsx", "src/renderers/records/RecordsRenderer.tsx", "src/renderers/workflows/attendance/AttendanceWorkflow.tsx", "src/renderers/workflows/state-update/StateUpdateWorkflow.tsx", "src/renderers/reports/ReportRenderer.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("ReadLoadingState");
      expect(source).not.toContain("ReadLoadingIndicator");
      expect(source).not.toContain('mode="refresh"');
    }
    expect(readFileSync("app/(app)/index.tsx", "utf8")).toContain("useHomeReadActivity");
    expect(readFileSync("src/renderers/use-experience-activity.ts", "utf8")).toContain("useFocusEffect");
  });

  it("uses the same central channel for RECORDS detail/form/problems and their route bootstrap", () => {
    for (const file of ["RecordFormScreen", "RecordDetailScreen", "RecordProblemsScreen"]) {
      const source = readFileSync(`src/renderers/records/${file}.tsx`, "utf8");
      expect(source).toContain("useExperienceActivityReporter");
      expect(source).toContain("ReadLoadingState");
      expect(source).not.toContain("<ActivityIndicator />");
    }
    expect(readFileSync("src/renderers/records/RecordFormScreen.tsx", "utf8")).toContain('<ActivityIndicator color="#ffffff" />');
    for (const file of ["record/new.tsx", "record/[recordId].tsx", "record/[recordId]/edit.tsx", "problems.tsx"]) {
      const source = readFileSync(`app/(app)/view/[appViewId]/${file}`, "utf8");
      expect(source).toContain("useExperienceBootstrapActivity");
      expect(source).toContain("ReadLoadingState");
      expect(source).not.toContain("ActivityIndicator");
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
    expect(home).toContain("getStateUpdateSnapshotCoverage");
    expect(records).toContain("JSON.stringify(debouncedSearch)");
    expect(attendance).toContain("loadedDate === date");
    expect(attendance).toContain("isAttendanceRequestCurrent");
    expect(stateUpdate).toContain("normalizeStateUpdateLogicalDate(response.date) === date");
    expect(stateUpdate).toContain("!isStateUpdateVisualRequestCurrent(requestSequenceRef.current, requestId)");
    expect(panel).toContain("requestSeq.current !== seq");
    expect(panel).toContain("previous.queryKey === queryKey");
    expect(report).toContain("loadedQueryKey === reportQueryKey");
    expect(report).toContain("isMounted = false");
  });
});
