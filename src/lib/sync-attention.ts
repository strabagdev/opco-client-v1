import type { AppView } from "./opco-api";

export type SyncAttentionProblem = {
  key: string;
  state: "pending" | "failed" | "conflict";
  appViewId: string | null;
  experience: string | null;
  recordId: string;
  recordName: string | null;
  date: string | null;
  workflow: boolean;
  href: { pathname: string; params: Record<string, string> } | null;
};
export type AttentionRow = {
  owner_key: string; contract_id: string; entity_type_id: string; local_id: string;
  display_name: string | null; values_json: string | null; sync_status: string;
  payload_json: string | null; operation: string | null;
};
function object(value: string | null): Record<string, unknown> {
  try { const p = JSON.parse(value ?? "{}"); return p && typeof p === "object" && !Array.isArray(p) ? p : {}; } catch { return {}; }
}
export function attentionDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : null;
}
export function buildSyncAttentionProblems(rows: AttentionRow[], definitions: AppView[], scope: { ownerKey: string; contractId: string }): SyncAttentionProblem[] {
  const problems = new Map<string, SyncAttentionProblem>();
  for (const row of rows) {
    if (row.owner_key !== scope.ownerKey || row.contract_id !== scope.contractId || row.sync_status === "synced") continue;
    const values = object(row.values_json), payload = object(row.payload_json);
    const id = typeof values.appViewId === "string" ? values.appViewId : typeof payload.appViewId === "string" ? payload.appViewId : null;
    const views = definitions.filter(v => id ? v.id === id : v.type === "RECORDS" && v.config.entityTypeId === row.entity_type_id);
    const candidate = views.length === 1 ? views[0] : null;
    const view = candidate && (candidate.type === "RECORDS" && candidate.config.entityTypeId === row.entity_type_id || candidate.type === "WORKFLOW" && candidate.config.targetEntityTypeId === row.entity_type_id) ? candidate : null;
    const workflow = row.operation === "STATE_UPDATE" || Boolean(id && typeof values.subjectRecordId === "string");
    const date = attentionDate(values.date ?? payload.date);
    const key = JSON.stringify([scope.ownerKey, scope.contractId, row.entity_type_id, row.local_id]);
    const state = row.sync_status === "conflict" ? "conflict" : row.sync_status === "failed" ? "failed" : "pending";
    const appViewId = view?.id ?? id;
    const supportedWorkflow = view?.type === "WORKFLOW" && ["attendance", "state-update"].includes(String(view.config.workflowKey));
    const href: SyncAttentionProblem["href"] = Boolean(row.values_json) && view && (!workflow || supportedWorkflow && (date || view.config.workflowKey === "state-update" && !view.config.dateFieldId))
      ? workflow
        ? { pathname: "/view/[appViewId]", params: { appViewId: view.id, attentionRecordId: row.local_id, ...(date ? { attentionDate: date } : {}) } }
        : state === "conflict"
          ? { pathname: "/view/[appViewId]/record/[recordId]/conflict", params: { appViewId: view.id, recordId: row.local_id } }
          : state === "pending"
            ? { pathname: "/view/[appViewId]/record/[recordId]", params: { appViewId: view.id, recordId: row.local_id } }
            : { pathname: "/view/[appViewId]/problems", params: { appViewId: view.id } }
      : null;
    const problem: SyncAttentionProblem = { key, state, appViewId, experience: view?.name ?? null, recordId: row.local_id,
      recordName: typeof values.subjectDisplayName === "string" ? values.subjectDisplayName : row.display_name ?? (typeof payload.subjectDisplayName === "string" ? payload.subjectDisplayName : null), date, workflow, href };
    const previous = problems.get(key);
    if (!previous || ({ pending: 0, failed: 1, conflict: 2 })[state] > ({ pending: 0, failed: 1, conflict: 2 })[previous.state]) problems.set(key, problem);
  }
  return [...problems.values()].sort((a, b) => ({ conflict: 0, failed: 1, pending: 2 })[a.state] - ({ conflict: 0, failed: 1, pending: 2 })[b.state]);
}
export function syncAttentionReason(problem: SyncAttentionProblem) {
  return problem.state === "conflict" ? "Tu cambio local no pudo aplicarse. Revisa las dos versiones antes de decidir."
    : problem.state === "failed" ? "El cambio no pudo sincronizarse y sigue guardado en este dispositivo."
    : "El cambio está guardado en este dispositivo y pendiente de sincronización.";
}
