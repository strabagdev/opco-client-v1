import { describe, expect, it, vi } from "vitest";

import { ReportAppView, WorkflowAppView } from "@/lib/opco-api";

import { resolveAppViewRenderer, resolveWorkflowRenderer } from "./registry";

vi.mock("@/renderers/records/RecordsRenderer", () => ({
  RecordsRenderer() {
    return null;
  },
}));

vi.mock("@/renderers/reports/ReportRenderer", () => ({
  ReportRenderer() {
    return null;
  },
}));

vi.mock("@/renderers/unsupported/UnsupportedRenderer", () => ({
  UnsupportedRenderer() {
    return null;
  },
}));

vi.mock("@/renderers/workflows/attendance/AttendanceWorkflow", () => ({
  AttendanceWorkflow() {
    return null;
  },
}));

vi.mock("@/renderers/workflows/state-update/StateUpdateWorkflow", () => ({
  StateUpdateWorkflow() {
    return null;
  },
}));

vi.mock("@/renderers/workflows/unsupported/UnsupportedWorkflow", () => ({
  UnsupportedWorkflow() {
    return null;
  },
}));

const attendanceView: WorkflowAppView = {
  config: {
    dateFieldId: "field_date",
    personFieldId: "field_person",
    sourceEntityTypeId: "people",
    statusFieldId: "field_status",
    targetEntityTypeId: "attendance",
    workflowKey: "attendance",
  },
  icon: "workflow",
  id: "view_attendance",
  name: "Asistencia",
  slug: "asistencia",
  sortOrder: 1,
  type: "WORKFLOW",
};

const reportView: ReportAppView = {
  config: {
    entityTypeId: "attendance",
    dateFieldId: "field_date",
    presentationMode: "MATRIX",
    matrix: {
      columnFieldId: "field_date",
      rowFieldId: "field_person",
      valueFieldId: "field_status",
    },
  },
  icon: "table",
  id: "view_report",
  name: "Asistencia mensual",
  slug: "asistencia-mensual",
  sortOrder: 2,
  type: "REPORT",
};

describe("workflow renderer registry", () => {
  it("resolves report renderer as its own AppView type", () => {
    expect(resolveAppViewRenderer(reportView.type).name).toBe("ReportRenderer");
  });

  it("resolves attendance workflow by workflowKey", () => {
    expect(resolveWorkflowRenderer(attendanceView).name).toBe("AttendanceWorkflow");
  });

  it("resolves state-update workflow by workflowKey", () => {
    expect(resolveWorkflowRenderer({
      ...attendanceView,
      config: {
        sourceEntityTypeId: "equipment",
        subjectFieldId: "field_equipment",
        targetEntityTypeId: "equipment_events",
        workflowKey: "state-update",
      },
      id: "view_state_update",
      name: "Estados",
      slug: "estados",
    }).name).toBe("StateUpdateWorkflow");
  });

  it("uses controlled unsupported renderer for unknown workflow keys", () => {
    expect(resolveWorkflowRenderer({
      ...attendanceView,
      config: { workflowKey: "inspection" },
    }).name).toBe("UnsupportedWorkflow");
  });
});
