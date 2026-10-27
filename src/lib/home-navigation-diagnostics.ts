import type { OpcoNetworkDiagnostics } from "./opco-api";

export const HOME_VIEWS_PATH = "/api/v1/contracts/:contractId/views";
export type HomeNavigationEvent = {
  requestId: string;
  ownerFingerprint: string;
  contractFingerprint: string;
  pathTemplate: typeof HOME_VIEWS_PATH;
  phase: "cache_read" | "cache_write" | "remote";
  result: "valid" | "absent" | "error" | "persisted" | "started" | "success";
  count: number | null;
  syncedAt: string | null;
  at: string;
  errorCode: string | null;
  timeoutMs?: number;
  requestDurationMs?: number;
  responseStarted?: boolean;
  httpStatus?: number | null;
};
type Scope = Pick<HomeNavigationEvent, "requestId" | "ownerFingerprint" | "contractFingerprint">;
let sequence = 0;
let events: readonly HomeNavigationEvent[] = [];
const listeners = new Set<() => void>();
// Exact scopes stay internal; fingerprints are presentation, never authorization.
const scopes = new Map<string, string>();
function notify() {
  listeners.forEach(listener => { try { listener(); } catch { /* Diagnostic observers cannot break navigation or persistence. */ } });
}

function fingerprint(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return `fp_${Math.abs(hash).toString(16).padStart(8, "0")}`;
}
export function beginHomeNavigation(ownerKey: string, contractId: string): Scope {
  const scope = { requestId: `home-views-${Date.now()}-${++sequence}`, ownerFingerprint: fingerprint(ownerKey), contractFingerprint: fingerprint(contractId) };
  scopes.set(scope.requestId, JSON.stringify([ownerKey, contractId]));
  if (scopes.size > 30) scopes.delete(scopes.keys().next().value!);
  return scope;
}
export function recordHomeNavigation(scope: Scope, event: Pick<HomeNavigationEvent, "phase" | "result" | "count" | "syncedAt" | "errorCode">) {
  const next: HomeNavigationEvent = { ...scope, ...event, pathTemplate: HOME_VIEWS_PATH, at: new Date().toISOString() };
  events = [...events, next].slice(-30);
  notify();
}
export function recordHomeNavigationTransport(diagnostics: OpcoNetworkDiagnostics) {
  if (diagnostics.pathTemplate !== HOME_VIEWS_PATH) return;
  const scope = events.find(event => event.requestId === diagnostics.diagnosticRequestId);
  if (!scope) return;
  const next: HomeNavigationEvent = {
    requestId: scope.requestId, ownerFingerprint: scope.ownerFingerprint, contractFingerprint: scope.contractFingerprint,
    pathTemplate: HOME_VIEWS_PATH, phase: "remote", result: diagnostics.operationResult === "success" ? "success" : "error",
    at: diagnostics.requestCompletedAt, count: null, syncedAt: null,
    errorCode: diagnostics.operationResult === "transport_timeout" ? "REMOTE_TIMEOUT" : diagnostics.httpStatus && diagnostics.httpStatus >= 400 ? "REMOTE_HTTP_ERROR" : diagnostics.operationResult === "success" ? null : "REMOTE_READ_ERROR",
    timeoutMs: diagnostics.timeoutMs, requestDurationMs: diagnostics.requestDurationMs,
    responseStarted: diagnostics.responseStarted, httpStatus: diagnostics.httpStatus,
  };
  events = [...events, next].slice(-30);
  notify();
}
export const getHomeNavigationEvents = () => events;
export function subscribeHomeNavigationEvents(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function homeNavigationCachePresent(history: readonly HomeNavigationEvent[], ownerKey: string | null, contractId: string | null) {
  const scope = JSON.stringify([ownerKey, contractId]);
  let present = false;
  for (const event of history) {
    if (scopes.get(event.requestId) !== scope) continue;
    if (event.phase === "cache_read") present = event.result === "valid";
    if (event.phase === "cache_write" && event.result === "persisted") present = true;
  }
  return present;
}
export function homeNavigationRows(history: readonly HomeNavigationEvent[], ownerKey: string | null, contractId: string | null): string[][] {
  if (!ownerKey || !contractId) return [["Inicio", "Scope no disponible"]];
  const scope = JSON.stringify([ownerKey, contractId]);
  const scoped = history.filter(event => scopes.get(event.requestId) === scope);
  return scoped.length ? scoped.map((event, index) => [`Inicio ${index + 1}`, JSON.stringify(event)]) : [["Inicio", "Sin lectura registrada en este runtime para el scope activo"]];
}
