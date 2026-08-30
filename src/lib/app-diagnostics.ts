export type DiagnosticTabId = "pwa" | "state-update" | "records";

export type DiagnosticTab = {
  id: DiagnosticTabId;
  label: string;
};

export const GLOBAL_DIAGNOSTIC_TABS: DiagnosticTab[] = [
  { id: "pwa", label: "PWA" },
  { id: "state-update", label: "STATE_UPDATE" },
  { id: "records", label: "RECORDS" },
];

export const GLOBAL_DIAGNOSTICS_BUTTON = {
  accessibilityLabel: "Diagnostico",
  icon: "chart-no-axes-column",
};

export function normalizeDiagnosticTabId(value: string | null | undefined): DiagnosticTabId {
  return GLOBAL_DIAGNOSTIC_TABS.some((tab) => tab.id === value) ? value as DiagnosticTabId : "pwa";
}
