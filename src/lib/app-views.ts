import { AppView, AppViewType } from "./opco-api";

export const APP_VIEW_TYPE_LABELS: Record<AppViewType, string> = {
  BOARD: "Tablero",
  DASHBOARD: "Dashboard",
  RECORDS: "Registros",
  WORKFLOW: "Workflow",
};

export function sortAppViews(views: AppView[]) {
  return [...views].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function getAppViewTypeLabel(type: AppViewType) {
  return APP_VIEW_TYPE_LABELS[type];
}

export function buildAppViewHref(appViewId: string) {
  return `/view/${encodeURIComponent(appViewId)}`;
}

export function buildAppViewRecordHref(appViewId: string, recordId: string) {
  return `/view/${encodeURIComponent(appViewId)}/record/${encodeURIComponent(recordId)}`;
}

export function buildNewAppViewRecordHref(appViewId: string) {
  return `/view/${encodeURIComponent(appViewId)}/record/new`;
}

export function buildEditAppViewRecordHref(appViewId: string, recordId: string) {
  return `/view/${encodeURIComponent(appViewId)}/record/${encodeURIComponent(recordId)}/edit`;
}
