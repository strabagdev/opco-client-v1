import { describe, expect, it, vi } from "vitest";

import { WorkflowAppView } from "@/lib/opco-api";

import { resolveWorkflowRenderer } from "./registry";

vi.mock("@/renderers/records/RecordsRenderer", () => ({
  RecordsRenderer() {
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

describe("workflow renderer registry", () => {
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
