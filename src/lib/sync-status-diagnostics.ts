import type { AppShellStatusIndicator } from "./app-shell-feedback";
import type { ConnectivityStatus } from "./connectivity";
import type { ExperienceActivitySnapshot } from "./experience-activity";
import type { SQLiteCoordinatorDiagnostics } from "./local-db";
import type { WriteFeedbackSnapshot } from "./write-feedback";

export type SyncChecklistState = "Sin comprobar" | "En curso" | "Correcto" | "Pendiente" | "Error" | "No aplica";

export type SyncChecklistItem = {
  activeSince: string | null;
  checkedAt: string | null;
  count: number | null;
  detail: string;
  id: string;
  label: string;
  state: SyncChecklistState;
};

export type SyncStatusHistoryEvent = {
  at: string;
  from: SyncChecklistState | "Sin información";
  process: string;
  reason: string;
  runId: string | null;
  to: SyncChecklistState | "Sin información";
};

export type SyncStatusHistory = {
  events: SyncStatusHistoryEvent[];
  scopeKey: string | null;
};

export type SyncStatusDiagnosticsInput = {
  connectivity: { checkedAt: string | null; status: ConnectivityStatus };
  conflicts: number;
  errors: number;
  experience: ExperienceActivitySnapshot;
  indicator: AppShellStatusIndicator;
  offlinePreparation: {
    activeInCurrentRuntime: boolean;
    completedAt: string | null;
    startedAt: string | null;
    status: "idle" | "running" | "completed" | "failed" | null;
  };
  pendingCount: number;
  readiness: {
    active: boolean;
    checkedAt: string | null;
    failed: boolean;
    reason: string | null;
    runId: string | null;
    startedAt: string | null;
  };
  readIssue: boolean;
  session: { restoring: boolean; status: "loading" | "anonymous" | "authenticated" | "offline" };
  sync: {
    active: boolean;
    completedAt: string | null;
    lastSuccessAt: string | null;
    result: string | null;
    runId: string | null;
    startedAt: string | null;
  };
  writeFeedback: WriteFeedbackSnapshot | null;
};

export type SyncStatusDiagnostics = {
  activities: string[];
  checklist: SyncChecklistItem[];
  indicator: AppShellStatusIndicator;
  lastSuccessfulSyncAt: string | null;
  reason: string;
};

export function buildSyncStatusDiagnostics(input: SyncStatusDiagnosticsInput): SyncStatusDiagnostics {
  const activities = [
    input.session.restoring ? "Restauración de sesión" : null,
    input.readiness.active ? "Comprobación de disponibilidad" : null,
    input.sync.active ? "Envío de cambios" : null,
    input.experience.activeRuns.length > 0 ? `Actualización de ${input.experience.appViewTitle ?? "experiencia"}` : null,
    input.offlinePreparation.activeInCurrentRuntime ? "Preparación offline" : null,
  ].filter((value): value is string => Boolean(value));

  return {
    activities,
    checklist: [
      item("connectivity", "Conexión con Opco", connectivityState(input), null, input.connectivity.checkedAt, null,
        input.connectivity.status === "online" ? "Navegador online; no confirma por sí solo acceso a Opco." : `Conectividad ${input.connectivity.status}.`),
      item("session", "Sesión", sessionState(input), null, null, null,
        input.session.restoring ? "Restaurando sesión." : sessionDetail(input.session.status)),
      item("readiness", "Disponibilidad del servicio", readinessState(input), null, input.readiness.checkedAt, input.readiness.active ? input.readiness.startedAt : null,
        input.readiness.reason ?? (input.readiness.active ? "Comprobando Operational Core." : "Sin comprobación activa.")),
      item("pending", "Cambios locales pendientes", input.pendingCount > 0 ? "Pendiente" : "Correcto", input.pendingCount, null, null,
        input.pendingCount > 0 ? "Hay intención local durable sin completar." : "No hay cambios locales pendientes."),
      item("send", "Envío de cambios", syncState(input), input.sync.active ? input.pendingCount : null, input.sync.completedAt, input.sync.active ? input.sync.startedAt : null,
        input.sync.active ? "Motor de pendientes activo." : syncDetail(input.sync.result)),
      item("receive", "Recepción / actualización local", input.readIssue ? "Error" : input.sync.result === "noop" ? "No aplica" : input.sync.completedAt ? "Correcto" : "Sin comprobar", null, input.sync.completedAt, null,
        input.readIssue ? "Una lectura reciente informó un problema de conectividad." : input.sync.result === "noop" ? "La última ejecución no encontró cambios que enviar o recibir." : input.sync.completedAt ? "Última actualización conocida; puede ser parcial." : "Sin información de actualización completa."),
      item("experience", "Experiencia visible", experienceState(input), input.experience.activeRuns.length || null, input.experience.updatedAt,
        input.experience.activeRuns[0]?.startedAt ?? null, experienceDetail(input.experience)),
      item("write-result", "Resultado de escritura", writeFeedbackState(input.writeFeedback), null, input.writeFeedback?.recordedAt ?? null, null,
        writeFeedbackDetail(input.writeFeedback)),
      item("problems", "Errores y conflictos", input.errors + input.conflicts > 0 ? "Error" : "Correcto", input.errors + input.conflicts, null, null,
        input.errors || input.conflicts ? `${input.errors} errores; ${input.conflicts} conflictos.` : "Sin errores ni conflictos retenidos."),
      item("offline-preparation", "Preparación offline", offlinePreparationState(input), null, input.offlinePreparation.completedAt,
        input.offlinePreparation.activeInCurrentRuntime ? input.offlinePreparation.startedAt : null, offlinePreparationDetail(input)),
    ],
    indicator: input.indicator,
    lastSuccessfulSyncAt: input.sync.lastSuccessAt,
    reason: indicatorReason(input),
  };
}

export function updateSyncStatusHistory({
  at,
  current,
  next,
  runIds = {},
  scopeKey,
}: {
  at: string;
  current: SyncStatusHistory;
  next: SyncStatusDiagnostics;
  runIds?: Record<string, string | null>;
  scopeKey: string | null;
}): SyncStatusHistory {
  if (!scopeKey) {
    return current.scopeKey === null && current.events.length === 0 ? current : { events: [], scopeKey: null };
  }

  const previousEvents = current.scopeKey === scopeKey ? current.events : [];
  const latestByProcess = new Map<string, SyncStatusHistoryEvent>();
  previousEvents.forEach((event) => latestByProcess.set(event.process, event));
  const snapshots = [
    { detail: next.reason, process: "Indicador", state: indicatorStateLabel(next.indicator.state) },
    ...next.checklist.map((entry) => ({ detail: entry.detail, process: entry.label, state: entry.state })),
  ];
  const additions: SyncStatusHistoryEvent[] = [];

  for (const snapshot of snapshots) {
    const previous = latestByProcess.get(snapshot.process);

    if (previous?.to === snapshot.state) {
      continue;
    }

    additions.push({
      at,
      from: previous?.to ?? "Sin información",
      process: snapshot.process,
      reason: sanitizeDiagnosticText(snapshot.detail),
      runId: sanitizeRunId(runIds[snapshot.process]),
      to: snapshot.state,
    });
  }

  if (current.scopeKey === scopeKey && additions.length === 0) {
    return current;
  }

  return {
    events: [...previousEvents, ...additions].slice(-50),
    scopeKey,
  };
}

export function formatSyncStatusDiagnosticsCopy(
  diagnostics: SyncStatusDiagnostics,
  history: SyncStatusHistory,
  sqlite?: SQLiteCoordinatorDiagnostics,
) {
  const currentSince = [...history.events].reverse().find((event) => event.process === "Indicador")?.at ?? "Sin información";
  const lines = [
    "Sincronización",
    `Estado actual: ${indicatorStateLabel(diagnostics.indicator.state)}`,
    `Motivo: ${diagnostics.reason}`,
    `Estado desde: ${currentSince}`,
    `Anima: ${diagnostics.indicator.state === "working" ? "sí" : "no"}`,
    `Actividades concurrentes: ${diagnostics.activities.join(", ") || "Ninguna"}`,
    `Última sincronización exitosa: ${diagnostics.lastSuccessfulSyncAt ?? "Sin información"}`,
    "",
    "Coordinador SQLite",
    ...sqliteCoordinatorCopyLines(sqlite),
    "",
    "Checklist",
    ...diagnostics.checklist.map((entry) =>
      `${entry.label}: ${entry.state}; cantidad=${entry.count ?? "No aplica"}; comprobado=${entry.checkedAt ?? "Sin información"}; inicio=${activeSince(entry, history)}; duración=${formatActiveDuration(activeSince(entry, history))}; detalle=${entry.detail}`
    ),
    "",
    "Historial en memoria (máximo 50; estado actual y última actividad son conceptos distintos)",
    ...(history.events.length
      ? history.events.map((event) => `${event.at} | ${event.process} | ${event.from} -> ${event.to} | ${event.reason}${event.runId ? ` | run=${event.runId}` : ""}`)
      : ["Sin información"]),
  ];

  return lines.join("\n");
}

function sqliteCoordinatorCopyLines(diagnostics?: SQLiteCoordinatorDiagnostics) {
  if (!diagnostics) return ["Sin información"];
  const operation = (item: SQLiteCoordinatorDiagnostics["active"]) => item
    ? `${item.id}; nombre=${item.name}; estado=${item.status}; encolada=${item.enqueuedAt}; inicio=${item.startedAt ?? "Sin información"}; duración=${item.durationMs}ms`
    : "Ninguna";

  return [
    `Storage: ${diagnostics.storageStatus}; apertura=${diagnostics.hasDatabasePromise ? "presente" : "ausente"}; migración=${diagnostics.hasMigrationPromise ? "activa" : "inactiva"}`,
    `Activa: ${operation(diagnostics.active)}`,
    `En espera (${diagnostics.waitingTotal}): ${Object.entries(diagnostics.waitingByName).map(([name, count]) => `${name}=${count}`).join(", ") || "Ninguna"}`,
    `Muestra pendientes (${diagnostics.waiting.length}; omitidas=${diagnostics.waitingOmitted}): ${diagnostics.waiting.length ? diagnostics.waiting.map((item) => operation(item)).join(" | ") : "Ninguna"}`,
    `Últimas (${diagnostics.recent.length}): ${diagnostics.recent.length ? diagnostics.recent.map((item) => operation(item)).join(" | ") : "Sin información"}`,
  ];
}

export function fingerprintSyncDiagnosticScope(ownerKey: string, contractId: string) {
  const value = `${ownerKey}:${contractId}`;
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }

  return `sync_scope_${Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8)}`;
}

function item(id: string, label: string, state: SyncChecklistState, count: number | null, checkedAt: string | null, activeSince: string | null, detail: string): SyncChecklistItem {
  return { activeSince, checkedAt, count, detail, id, label, state };
}

function connectivityState(input: SyncStatusDiagnosticsInput): SyncChecklistState {
  if (input.connectivity.status === "unknown") return "Sin comprobar";
  return input.connectivity.status === "online" ? "Correcto" : "Pendiente";
}

function sessionState(input: SyncStatusDiagnosticsInput): SyncChecklistState {
  if (input.session.restoring || input.session.status === "loading") return "En curso";
  if (input.session.status === "anonymous") return "Error";
  return input.session.status === "authenticated" ? "Correcto" : "Pendiente";
}

function readinessState(input: SyncStatusDiagnosticsInput): SyncChecklistState {
  if (input.readiness.active) return "En curso";
  if (input.readiness.failed) return "Error";
  return input.readiness.checkedAt ? "Correcto" : "Sin comprobar";
}

function syncState(input: SyncStatusDiagnosticsInput): SyncChecklistState {
  if (input.sync.active) return "En curso";
  if (input.errors > 0) return "Error";
  if (input.pendingCount > 0) return "Pendiente";
  if (!input.sync.completedAt) return "No aplica";
  if (input.sync.result === "noop") return "No aplica";
  return input.sync.result === "success" || input.sync.result === "reconciled_success" ? "Correcto" : "Pendiente";
}

function offlinePreparationState(input: SyncStatusDiagnosticsInput): SyncChecklistState {
  if (input.offlinePreparation.activeInCurrentRuntime) return "En curso";
  if (input.offlinePreparation.status === "failed") return "Error";
  if (input.offlinePreparation.status === "completed") return "Correcto";
  if (input.offlinePreparation.status === "running") return "Pendiente";
  return "Sin comprobar";
}

function experienceState(input: SyncStatusDiagnosticsInput): SyncChecklistState {
  if (!input.experience.scopeKey) return "No aplica";
  if (input.experience.errorCode) return "Error";
  if (input.experience.activeRuns.length > 0) return "En curso";
  if (input.experience.result === "success") return "Correcto";
  if (input.experience.result === "partial") return "Pendiente";
  if (input.experience.result === "cancelled") return "Pendiente";
  return "Sin comprobar";
}

function writeFeedbackState(feedback: WriteFeedbackSnapshot | null): SyncChecklistState {
  if (!feedback?.kind) return "Sin comprobar";
  return feedback.kind === "server-confirmed" ? "Correcto" : "Pendiente";
}

function indicatorReason(input: SyncStatusDiagnosticsInput) {
  if (input.indicator.state === "error") return "Error, conflicto o recuperación local retenida.";
  if (input.writeFeedback?.kind === "server-confirmed") return "La experiencia visible confirmó una escritura con Opco.";
  if (input.writeFeedback?.kind === "local-saved") return input.pendingCount > 0
    ? `Guardado local confirmado; ${input.pendingCount} cambios permanecen pendientes de envío.`
    : "Guardado local confirmado; no se presenta como sincronización completada.";
  if (input.connectivity.status !== "online") return input.pendingCount > 0
    ? `Sin conexión; ${input.pendingCount} cambios locales permanecen pendientes.`
    : "Conectividad del navegador offline o desconocida.";
  if (input.sync.active) return "Sincronización real de cambios pendiente en curso.";
  if (input.readiness.active) return "Comprobación activa de disponibilidad de Operational Core.";
  if (input.session.restoring) return "Restauración activa de sesión.";
  if (input.experience.activeRuns.length > 0) return `Actualización activa de ${input.experience.appViewTitle ?? "la experiencia visible"}.`;
  if (input.offlinePreparation.status === "failed") return "La última preparación offline quedó incompleta; el detalle permanece disponible en Diagnóstico.";
  if (input.offlinePreparation.status === "running") return input.offlinePreparation.activeInCurrentRuntime
    ? "Preparación offline activa; no representa envío de cambios."
    : "La preparación offline anterior quedó interrumpida; el detalle permanece disponible en Diagnóstico.";
  if (input.indicator.state === "pending") return `${input.pendingCount} cambios locales pendientes; sin envío activo.`;
  return "Online, sin pendientes, errores ni operación global activa.";
}

function indicatorStateLabel(state: AppShellStatusIndicator["state"]): SyncChecklistState | "Sin información" {
  if (state === "working") return "En curso";
  if (state === "pending") return "Pendiente";
  if (state === "error") return "Error";
  if (state === "offline") return "Pendiente";
  return "Correcto";
}

function sessionDetail(status: SyncStatusDiagnosticsInput["session"]["status"]) {
  if (status === "authenticated") return "Sesión autenticada.";
  if (status === "offline") return "Sesión offline conservada; no confirma acceso actual a Opco.";
  if (status === "anonymous") return "No hay sesión autenticada.";
  return "Sesión sin comprobar.";
}

function syncDetail(result: string | null) {
  if (!result) return "No hay ejecución registrada.";
  return `Último resultado: ${sanitizeDiagnosticText(result)}.`;
}

function offlinePreparationDetail(input: SyncStatusDiagnosticsInput) {
  if (input.offlinePreparation.activeInCurrentRuntime) return "Precarga GET/SQLite activa; no envía cambios.";
  if (input.offlinePreparation.status === "running") return "Estado running persistido sin actividad confirmada en este runtime.";
  if (!input.offlinePreparation.status) return "Sin información.";
  return `Último estado: ${input.offlinePreparation.status}; no representa envío de cambios.`;
}

function experienceDetail(experience: ExperienceActivitySnapshot) {
  if (!experience.scopeKey) return "No hay una experiencia instrumentada visible.";
  const title = sanitizeDiagnosticText(experience.appViewTitle ?? "Experiencia");
  const runs = experience.activeRuns.map((run) => run.id).join(", ");
  if (experience.activeRuns.length > 0) return `${title}: ${experience.activeRuns.length} lectura(s) activa(s); ejecuciones=${runs}.`;
  if (experience.errorCode) return `${title}: fallo retenido (${sanitizeDiagnosticText(experience.errorCode)}).`;
  return `${title}: último resultado ${experience.result}; sin lectura activa.`;
}

function writeFeedbackDetail(feedback: WriteFeedbackSnapshot | null) {
  if (!feedback?.kind) return "Sin confirmación de escritura reciente en el alcance visible.";
  const title = sanitizeDiagnosticText(feedback.appViewTitle ?? "Experiencia");
  return feedback.kind === "server-confirmed"
    ? `${title}: escritura confirmada por Opco.`
    : `${title}: guardado local confirmado; no implica sincronización con Opco.`;
}

function sanitizeRunId(value: string | null | undefined) {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/.test(value) ? value : null;
}

function sanitizeDiagnosticText(value: string) {
  return value.replace(/[\r\n|]+/g, " ").slice(0, 240);
}

export function activeSince(entry: SyncChecklistItem, history: SyncStatusHistory) {
  if (entry.activeSince) return entry.activeSince;
  if (entry.state !== "En curso") return "No aplica";
  return [...history.events].reverse().find((event) => event.process === entry.label && event.to === "En curso")?.at ?? "Sin información";
}

export function formatActiveDuration(startedAt: string, nowMs = Date.now()) {
  if (startedAt === "No aplica" || startedAt === "Sin información") return startedAt;
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) return "Sin información";
  return `${Math.max(0, Math.floor((nowMs - startedMs) / 1000))}s`;
}
