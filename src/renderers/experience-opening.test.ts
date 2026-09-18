import { describe, expect, it } from "vitest";

declare const require: (id: string) => { readFileSync: (path: string, encoding: string) => string };

describe("shared experience opening diagnostics", () => {
  it("covers every registered AppView category", () => {
    const source = require("fs").readFileSync("src/renderers/registry.ts", "utf8");
    for (const type of ["RECORDS", "WORKFLOW", "REPORT", "PANEL", "BOARD", "DASHBOARD"]) {
      expect(source).toContain(`${type}:`);
    }
  });

  it("distinguishes workflow and report variants", () => {
    const source = require("fs").readFileSync("src/renderers/experience-opening.tsx", "utf8");
    expect(source).toContain('appView.config.workflowKey');
    expect(source).toContain('appView.config.presentationMode');
  });

  it("instruments real renderer milestones without changing their data APIs", () => {
    const files = [
      "src/renderers/panels/PanelRenderer.tsx",
      "src/renderers/reports/ReportRenderer.tsx",
      "src/renderers/workflows/attendance/AttendanceWorkflow.tsx",
      "src/renderers/workflows/state-update/StateUpdateWorkflow.tsx",
      "src/renderers/unsupported/UnsupportedRenderer.tsx",
      "src/renderers/workflows/unsupported/UnsupportedWorkflow.tsx",
    ];

    for (const file of files) {
      expect(require("fs").readFileSync(file, "utf8")).toContain("useExperienceOpeningTelemetry");
    }
  });
});
