import { ComponentType, createElement } from "react";

import { AppView, AppViewType } from "@/lib/opco-api";
import { RecordsRenderer } from "@/renderers/records/RecordsRenderer";
import { AppViewRendererProps } from "@/renderers/types";
import { UnsupportedRenderer } from "@/renderers/unsupported/UnsupportedRenderer";

export const rendererRegistry: Record<AppViewType, ComponentType<AppViewRendererProps>> = {
  BOARD: UnsupportedRenderer,
  DASHBOARD: UnsupportedRenderer,
  RECORDS: RecordsRenderer as ComponentType<AppViewRendererProps>,
  WORKFLOW: UnsupportedRenderer,
};

export function resolveAppViewRenderer(type: AppViewType) {
  return rendererRegistry[type];
}

export function renderAppView(appView: AppView) {
  return createElement(resolveAppViewRenderer(appView.type), { appView });
}
