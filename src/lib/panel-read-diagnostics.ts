import type { PanelSnapshotScope } from "./local-db";

export type PanelReadEvent = {
  readId: string; at: string; scopeFingerprint: string; datasetFingerprint: string; keyFingerprint: string;
  expectedRevision: string | null; actualRevision: string | null;
  phase: "request" | "response" | "definition" | "snapshot_write" | "snapshot_read";
  result: "started" | "received" | "matched" | "reconciled" | "persisted" | "hit" | "miss" | "failed" | "cancelled";
  errorCode: string | null; page: number; pageSize: number;
  syncedAt: string | null;
};
type ReadScope = { readId: string; key: PanelSnapshotScope };
let sequence = 0;
let events: readonly PanelReadEvent[] = [];
const scopes = new Map<string, string>();
const listeners = new Set<() => void>();
function fingerprint(value: string) {
  let hash = 0;
  for (let n = 0; n < value.length; n++) hash = ((hash << 5) - hash + value.charCodeAt(n)) | 0;
  return `panel_fp_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value ?? null;
}
const safeRevision = (value?: string | null) => !value ? null : /^[a-f0-9]{64}$/i.test(value) ? value : fingerprint(value);

export function beginPanelRead(key: PanelSnapshotScope): ReadScope {
  const readId = `panel-read-${Date.now()}-${++sequence}`;
  scopes.set(readId, JSON.stringify([key.ownerKey, key.contractId]));
  // Scope equality is exact and internal; a diagnostic fingerprint is never authorization.
  if (scopes.size > 80) scopes.delete(scopes.keys().next().value!);
  return { readId, key };
}
export function recordPanelRead(scope: ReadScope, phase: PanelReadEvent["phase"], result: PanelReadEvent["result"],
  revision?: string | null, errorCode: string | null = null, syncedAt?: string | null) {
  const key = { ...scope.key, configRevision: revision ?? scope.key.configRevision ?? null };
  const event: PanelReadEvent = {
    readId: scope.readId, at: new Date().toISOString(), phase, result,
    scopeFingerprint: fingerprint(JSON.stringify([key.ownerKey, key.contractId, key.appViewId])),
    datasetFingerprint: fingerprint(key.datasetId),
    keyFingerprint: fingerprint(JSON.stringify(stable({ ...key, filters: key.filters ?? {}, search: key.search?.trim() || "" }))),
    expectedRevision: safeRevision(scope.key.configRevision), actualRevision: safeRevision(revision),
    errorCode: errorCode && /^PANEL_[A-Z_]+$/.test(errorCode) ? errorCode : null,
    page: key.page, pageSize: key.pageSize,
    syncedAt: syncedAt && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(syncedAt) ? syncedAt : null,
  };
  events = [...events, event].slice(-80);
  listeners.forEach(listener => { try { listener(); } catch { /* Observers cannot fail a read. */ } });
}
export const getPanelReadEvents = () => events;
export function subscribePanelReadEvents(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function panelReadRows(history: readonly PanelReadEvent[], ownerKey: string | null, contractId: string | null): string[][] {
  const scope = JSON.stringify([ownerKey, contractId]);
  const selected = ownerKey && contractId ? history.filter(event => scopes.get(event.readId) === scope) : [];
  return selected.length ? selected.map((event, n) => [`PANEL ${n + 1}`, JSON.stringify(event)]) : [["PANEL", "Sin lectura registrada para el scope activo"]];
}
