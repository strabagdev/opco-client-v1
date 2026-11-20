import type { LocalDatabase } from "../../../lib/local-db";
import type { AttendanceWorkflowConfig, WorkflowAppView } from "../../../lib/opco-api";
import { normalizeStateUpdateLogicalDate, normalizeStateUpdateRecord } from "../../../lib/state-update-offline";
import { stateUpdateItemToAttendanceItem } from "../../../lib/attendance-offline";
import { attendanceReadScope, attendanceHistoryMode } from "../../../lib/attendance-repetition";
import { fingerprintSyncDiagnosticScope } from "../../../lib/sync-status-diagnostics";
import { presentCaptureTime } from "../../../lib/capture-time";
import { attentionDate } from "../../../lib/sync-attention";
import { attendanceContextFieldsFromPreparedDefinition } from "./attendance-workflow-logic";
import { inspectAttendanceLocalReadTrace } from "./attendance-local-read-trace";
import { loadAttendanceRecordPresentation, type AttendanceRecordPresentation } from "./attendance-record-presentation";

export type AttendanceReadView = WorkflowAppView & { config: AttendanceWorkflowConfig };
export type AttendanceLocalReadScope = { ownerKey: string; contractId: string; appView: AttendanceReadView; recordId: string; requestedDate?: string };
export type AttendanceLocalReader = Pick<LocalDatabase, "getCachedRecord" | "getAppViewDefinition" | "getAttendanceDailyRecords" |
  "listStateUpdateLatest" | "getAttendanceDaySnapshotHydration" | "listPendingStateUpdateOperations">;

export class AttendanceLocalReadError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
/** The attention link carries a LOCAL identity. Never replace it by a subject/date match or a server alias. */
export async function readAttendanceLocalRecord(store: AttendanceLocalReader, input: AttendanceLocalReadScope) {
  const { ownerKey, contractId, appView, recordId } = input;
  if (!ownerKey || !contractId || !recordId) throw new AttendanceLocalReadError("LOCAL_REFERENCE_MISSING", "Falta la referencia del cambio local. No se eligió otro registro.");
  const cached = await store.getCachedRecord({ ownerKey, contractId, entityTypeId: appView.config.targetEntityTypeId, recordId });
  if (!cached || cached.localId !== recordId) throw new AttendanceLocalReadError("LOCAL_RECORD_NOT_FOUND", "El cambio seleccionado no está disponible en esta copia local. No se eligió otro registro ni se modificó la operación.");
  const values = cached.values;
  if (values.appViewId !== appView.id || typeof values.subjectRecordId !== "string")
    throw new AttendanceLocalReadError("LOCAL_RECORD_SCOPE_MISMATCH", "La referencia no corresponde a esta experiencia. El cambio se conserva sin abrir otro registro.");
  if (!Array.isArray(values.stateValues)) throw new AttendanceLocalReadError("LOCAL_RECORD_INVALID", "La copia del cambio no permite interpretar su estado. Se conserva la operación para diagnóstico.");
  const record = normalizeStateUpdateRecord(cached);
  const date = attentionDate(record.date);
  if (!date) throw new AttendanceLocalReadError("LOCAL_DATE_UNAVAILABLE", "La fecha guardada del cambio no es válida. No se sustituyó por la fecha actual.");
  const scope = { ownerKey, contractId, appViewId: appView.id, targetEntityTypeId: appView.config.targetEntityTypeId, date };
  const prepared = await store.getAppViewDefinition(ownerKey, contractId, appView.id);
  const definition = prepared?.definition;
  const compatible = definition?.kind === "state-update" && definition.appView.id === appView.id &&
    definition.targetEntityTypeId === scope.targetEntityTypeId && definition.sourceEntityTypeId === appView.config.sourceEntityTypeId;
  const configuredFields = appView.config.contextFieldIds ?? [];
  const fields = compatible ? attendanceContextFieldsFromPreparedDefinition(definition.extraFields, configuredFields) : [];
  const missingFields = configuredFields.filter(id => !fields.some(field => field.id === id));
  const item = stateUpdateItemToAttendanceItem({ subject: record.subject, current: { recordId: cached.localId,
    updatedAt: record.updatedAt ?? "", stateValues: record.stateValues, extraValues: record.extraValues,
    ...(record.captureTime ? { captureTime: record.captureTime as import("../../../lib/capture-time").CaptureTimeRead } : {}),
    ...(record.eventOccurredAt ? { eventOccurredAt: record.eventOccurredAt } : {}),
  } }, appView.config.statusFieldId, appView.config.observationFieldId, fields);
  const statuses = compatible ? definition.stateFields.find(field => field.fieldId === appView.config.statusFieldId)?.options ?? [] : [];
  const presentation: AttendanceRecordPresentation = await loadAttendanceRecordPresentation(store, scope,
    { ...item.attendance!, person: item.person }, fields, statuses);
  // A pre-capture command's transport event is not an accredited automatic DATETIME capture.
  if (!record.captureTime) {
    presentation.capture = presentCaptureTime(null, "UTC", date);
    presentation.timestamps = presentation.timestamps.filter(time => time.label !== "Hora de captura");
  }
  presentation.syncLabel ??= cached.syncStatus === "synced" ? "Sincronizado" : undefined;
  for (const id of missingFields) presentation.fields.push({ key: id, label: "Contexto configurado sin metadata local", fullWidth: false,
    values: [{ text: "Etiqueta y valor legible no disponibles en esta copia", status: "unavailable" }] });
  return { cached, record, scope, prepared, presentation, fields, missingFields,
    requestedDateMatches: input.requestedDate === undefined || normalizeStateUpdateLogicalDate(input.requestedDate) === date };
}

type Detail = Awaited<ReturnType<typeof readAttendanceLocalRecord>>;
/** Explicit, local-only inspection. Errors are reported per read, never interpreted as an empty query. */
export async function inspectAttendanceLocalQueries(store: AttendanceLocalReader, input: AttendanceLocalReadScope, detail: Detail) {
  const displayed = detail;
  detail = await readAttendanceLocalRecord(store, input);
  const scope = { ...detail.scope, ...attendanceReadScope(input.appView.config), date: input.requestedDate ?? detail.scope.date };
  const selected = (row: { localRecordId?: string; serverRecordId?: string; recordId?: string }) =>
    [row.localRecordId, row.serverRecordId, row.recordId].some(id => id === detail.cached.localId || !!detail.cached.serverId && id === detail.cached.serverId);
  const query = async <T,>(read: () => Promise<T>) => {
    try { return { status: "read" as const, value: await read() }; }
    catch (error) { return { status: "error" as const, code: error instanceof Error ? error.name : "LOCAL_READ_FAILED" }; }
  };
  const [daily, personSelection, dayListing, recent, hydration, operations] = await Promise.all([
    query(() => store.getAttendanceDailyRecords({ ...scope, historyMode: attendanceHistoryMode(input.appView.config), uniqueness: "subject-date", subjectRecordId: detail.record.subject.id })),
    query(() => store.getAttendanceDailyRecords({ ownerKey: scope.ownerKey, contractId: scope.contractId, appViewId: scope.appViewId,
      targetEntityTypeId: scope.targetEntityTypeId, date: scope.date, subjectRecordId: detail.record.subject.id })),
    query(() => store.listStateUpdateLatest({ ...scope, page: 1, pageSize: Number.MAX_SAFE_INTEGER })),
    query(() => store.listStateUpdateLatest({ ...scope, page: 1, pageSize: 20 })),
    query(() => store.getAttendanceDaySnapshotHydration(scope)),
    query(() => store.listPendingStateUpdateOperations(scope.ownerKey)),
  ]);
  const pending = operations.status === "read" ? operations.value.filter(op => op.ownerKey === scope.ownerKey && op.contractId === scope.contractId &&
    op.entityTypeId === scope.targetEntityTypeId && op.localRecordId === detail.cached.localId && (op.payload as Record<string, unknown>).appViewId === scope.appViewId) : [];
  const contextIds = new Set(input.appView.config.contextFieldIds ?? []);
  const contextValue = (raw: unknown): unknown => Array.isArray(raw) ? raw.map(contextValue) : raw && typeof raw === "object"
    ? "id" in raw ? { id: raw.id } : "optionId" in raw ? { optionId: raw.optionId } : "unavailable" : raw;
  const definition = detail.prepared?.definition;
  const after = await store.getCachedRecord({ ownerKey: scope.ownerKey, contractId: scope.contractId, entityTypeId: scope.targetEntityTypeId, recordId: input.recordId });
  const identityContent = (row: typeof after) => row ? JSON.stringify([row.localId, row.serverId, row.syncStatus, row.remoteUpdatedAt, row.values]) : null;
  const stableAcrossReads = identityContent(after) === identityContent(detail.cached);
  return {
    version: 1, observedAt: new Date().toISOString(), readOnly: true, interpretation: "Diagnóstico local; no acredita frescura remota ni resuelve la omisión del grupo.",
    consistency: { atomic: false, selectedRecordStableAcrossReads: stableAcrossReads,
      displayedRecordStillCurrent: identityContent(displayed.cached) === identityContent(detail.cached),
      conclusion: stableAcrossReads ? "Comparación local; las consultas se ejecutaron por separado." : "El registro cambió durante la lectura (por ejemplo, un ACK). No atribuir una exclusión a estas lecturas; comprobar de nuevo manualmente." },
    scope: { fingerprint: fingerprintSyncDiagnosticScope(scope.ownerKey, scope.contractId), appViewId: scope.appViewId,
      targetEntityTypeId: scope.targetEntityTypeId, subjectFingerprint: fingerprintSyncDiagnosticScope("subject", detail.record.subject.id) },
    request: { recordId: input.recordId, requestedDate: input.requestedDate ?? null, queryDate: scope.date,
      historyMode: scope.historyMode ?? "update-current", uniqueness: "subject-date", dayPageSize: "all-local", recentPage: 1, recentPageSize: 20 },
    stored: { localId: detail.cached.localId, serverId: detail.cached.serverId, date: detail.record.date, rawDate: detail.cached.values.date,
      syncStatus: detail.cached.syncStatus, eventOccurredAt: detail.record.eventOccurredAt ?? null, captureTime: detail.record.captureTime ?? null,
      expectedUpdatedAt: detail.record.expectedUpdatedAt ?? null, requestedDateMatches: detail.requestedDateMatches,
      stateValues: detail.record.stateValues.map(value => ({ fieldId: value.fieldId, optionId: value.optionId ?? null })),
      contexts: Object.fromEntries(Object.entries(detail.record.extraValues ?? {}).filter(([id]) => contextIds.has(id)).map(([id, value]) => [id, contextValue(value)])),
      missingContextMetadata: detail.missingFields },
    definition: { status: detail.prepared?.status ?? "missing", kind: definition?.kind ?? null, lastPreparedAt: detail.prepared?.lastPreparedAt ?? null,
      repetitionPolicy: input.appView.config.repetitionPolicy ?? "ONE_PER_DAY", captureConfig: input.appView.config.captureTime ?? null },
    previousScreenReads: { durable: false, note: "Últimas 30 lecturas en memoria del mismo scope y día. No reconstruye lecturas de antes de la reapertura ni acredita el estado actual de la lista.",
      events: inspectAttendanceLocalReadTrace(scope, detail.cached.localId, detail.cached.serverId, detail.record.subject.id) },
    daily: daily.status === "read" ? { status: daily.status, count: daily.value.length, selectedIncluded: daily.value.some(selected),
      historyMode: attendanceHistoryMode(input.appView.config), uniqueness: "subject-date",
      identities: daily.value.map(row => ({ localId: row.localRecordId, serverId: row.serverRecordId ?? null, syncStatus: row.syncStatus })) } : daily,
    personSelection: personSelection.status === "read" ? { status: personSelection.status, count: personSelection.value.length,
      selectedIncluded: personSelection.value.some(selected), historyMode: "append (default del lector)", uniqueness: "subject-date" } : personSelection,
    dayListing: dayListing.status === "read" ? { status: dayListing.status, selectedIncluded: dayListing.value.items.some(selected),
      returned: dayListing.value.items.length, pagination: dayListing.value.pagination,
      note: "Colección local usada por el grupo; no acredita que el servidor esté preparado por completo." } : dayListing,
    recent: recent.status === "read" ? { status: recent.status, selectedIncluded: recent.value.items.some(selected),
      returned: recent.value.items.length, pagination: recent.value.pagination } : recent,
    hydration: hydration.status === "read" ? { status: hydration.status, value: hydration.value } : hydration,
    outbox: operations.status === "read" ? { status: operations.status, activeMatchingOperations: pending.length,
      note: "Este lector enumera pending_create/pending_update/syncing; no acredita ausencia de operaciones fallidas o en conflicto.",
      operations: pending.map(op => { const payload = op.payload as Record<string, unknown>; return { clientRequestId: op.clientRequestId, localRecordId: op.localRecordId,
        eventOccurredAt: payload.eventOccurredAt ?? null, date: payload.date ?? null, captureTime: payload.captureTime ?? null,
        contexts: Object.fromEntries(Object.entries((payload.extraValues ?? {}) as Record<string, unknown>).filter(([id]) => contextIds.has(id)).map(([id, value]) => [id, contextValue(value)])) }; }) } : operations,
  };
}
