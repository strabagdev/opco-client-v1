import { ComponentType, createElement } from "react";

import { AppView, AppViewType, WorkflowAppView } from "@/lib/opco-api";
import { isStateUpdateCompatibleWorkflow } from "../lib/state-update-offline";
import { ReportRenderer } from "@/renderers/reports/ReportRenderer";
import { RecordsRenderer } from "@/renderers/records/RecordsRenderer";
import { AppViewRendererProps } from "@/renderers/types";
import { UnsupportedRenderer } from "@/renderers/unsupported/UnsupportedRenderer";
import { AttendanceWorkflow } from "@/renderers/workflows/attendance/AttendanceWorkflow";
import { StateUpdateWorkflow } from "@/renderers/workflows/state-update/StateUpdateWorkflow";
import { UnsupportedWorkflow } from "@/renderers/workflows/unsupported/UnsupportedWorkflow";

export const rendererRegistry: Record<AppViewType, ComponentType<AppViewRendererProps>> = {
  BOARD: UnsupportedRenderer,
  DASHBOARD: UnsupportedRenderer,
  REPORT: ReportRenderer as ComponentType<AppViewRendererProps>,
  RECORDS: RecordsRenderer as ComponentType<AppViewRendererProps>,
  WORKFLOW: UnsupportedRenderer,
};

export function resolveAppViewRenderer(type: AppViewType) {
  return rendererRegistry[type];
}

export function resolveWorkflowRenderer(appView: WorkflowAppView) {
  if (!isStateUpdateCompatibleWorkflow(appView.config.workflowKey)) {
    return UnsupportedWorkflow as ComponentType<AppViewRendererProps<WorkflowAppView>>;
  }

  if (appView.config.workflowKey === "attendance") {
    return AttendanceWorkflow as ComponentType<AppViewRendererProps<WorkflowAppView>>;
  }

  if (appView.config.workflowKey === "state-update") {
    return StateUpdateWorkflow as ComponentType<AppViewRendererProps<WorkflowAppView>>;
  }

  return UnsupportedWorkflow as ComponentType<AppViewRendererProps<WorkflowAppView>>;
}

export function renderAppView(appView: AppView) {
  if (appView.type === "WORKFLOW") {
    return createElement(resolveWorkflowRenderer(appView), { appView });
  }

  return createElement(resolveAppViewRenderer(appView.type), { appView });
}
