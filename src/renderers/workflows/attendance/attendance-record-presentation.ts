import {presentCaptureTime,type CaptureTimeRead} from "../../../lib/capture-time";
import type { ReadField, ReadValue } from "../../../components/read-field-list";
import type { LocalDatabase } from "../../../lib/local-db";
import type { AttendanceContextField, AttendanceContextValues } from "../../../lib/opco-api";
import { readAttendanceContextValue } from "../../../lib/attendance-context-values";
import { getRelationTargetEntityTypeId } from "../../../lib/record-form";
import { resolveStateUpdateSelectExtra } from "../../../lib/state-update-extras";
import { attendanceRelationField } from "./attendance-workflow-logic";
import { parseSubjectPresentation, projectSubject, validSubjectProjection, verifyPresentationDefinition, type PresentedSubject, type SubjectPresentationDefinition } from "../../../lib/subject-presentation";

export type AttendanceReadRecord = {
  recordId: string;
  person: PresentedSubject;
  statusLabel: string | null;
  statusOptionId: string | null;
  contextValues?: AttendanceContextValues;
  observation?: string | null;
  captureTime?: CaptureTimeRead;
  eventOccurredAt?: string;
  updatedAt: string;
};
export type AttendancePresentationScope = {
  ownerKey: string; contractId: string; appViewId: string; targetEntityTypeId: string; date: string;
};
export type AttendanceRecordPresentation = {
  record: AttendanceReadRecord;
  reference: string;
  referenceKind: "local" | "server" | "unknown";
  serverId?: string;
  fields: ReadField[];
  capture?: {compact:string;detail:string};
  timestamps: { label: string; text: string }[];
  syncLabel?: string;
};
export type AttendancePresentationStore = Pick<LocalDatabase, "getCachedRecord" | "getAttendanceDailyRecords">;
/** Enrich the label only, using the existing authorized definition and exact scoped source row. */
export async function readAttendancePresentedSubject(store: AttendancePresentationStore, scope: AttendancePresentationScope,
  subject: PresentedSubject, config: unknown, metadata?: SubjectPresentationDefinition): Promise<PresentedSubject> {
  if (config === undefined) return subject;
  try {
    const definition = verifyPresentationDefinition(metadata, undefined, parseSubjectPresentation(config)!);
    if (validSubjectProjection(subject.presentation, definition, subject.id)) return subject;
    const cached = await store.getCachedRecord({ownerKey: scope.ownerKey, contractId: scope.contractId,
      entityTypeId: definition.sourceEntityTypeId, recordId: subject.id});
    if (!cached || (cached.serverId ?? cached.localId) !== subject.id) return subject;
    return {...subject, presentation: projectSubject(definition, subject.id, cached.values, [], cached.remoteUpdatedAt ?? undefined)};
  } catch { return subject; }
}
const unavailable = (text = "Valor no disponible en esta lectura"): ReadValue => ({ text, status: "unavailable" });
const value = (text: string): ReadValue => ({ text, status: "value" });
const nonempty = (raw: unknown): raw is string => typeof raw === "string" && raw.trim().length > 0;
const validTime = (raw: unknown): raw is string => nonempty(raw) && Number.isFinite(Date.parse(raw));

export function attendanceTimestamp(label: string, raw: unknown, timeZone?: string) {
  if (!validTime(raw)) return null;
  let zone = timeZone;
  try { zone ??= Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* Use explicit UTC below. */ }
  try {
    const formatter = new Intl.DateTimeFormat("es-CL", { timeZone: zone || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    return { label, text: `${formatter.format(new Date(raw))} · ${zone || "UTC"}` };
  } catch {
    return { label, text: `${new Date(raw).toISOString()} · UTC` };
  }
}

/** Presentation reads only. The immutable local row ID is retained after ACK; a server ID is an alias, not a replacement. */
export async function loadAttendanceRecordPresentation(store: AttendancePresentationStore, scope: AttendancePresentationScope,
  record: AttendanceReadRecord, fields: AttendanceContextField[], statuses: { optionId: string; label: string }[] = [], timeZone?: string,
): Promise<AttendanceRecordPresentation> {
  const storageScope = { ownerKey: scope.ownerKey, contractId: scope.contractId, entityTypeId: scope.targetEntityTypeId };
  let cached = await store.getCachedRecord({ ...storageScope, appViewId: scope.appViewId, date: scope.date, recordId: record.recordId });
  let knownServerId: string | undefined;
  if (!cached) {
    // Historical/offline definitions can lack the projection configuration. The identity read
    // remains owner/contract/entity scoped and must independently match view, person and DATE.
    const daily = await store.getAttendanceDailyRecords({ ...scope, subjectRecordId: record.person.id });
    const identity = daily.find(item => item.localRecordId === record.recordId || item.serverRecordId === record.recordId);
    knownServerId = identity?.serverRecordId;
    const candidate = await store.getCachedRecord({ ...storageScope, recordId: identity?.localRecordId ?? record.recordId });
    if (candidate?.values.appViewId === scope.appViewId && candidate.values.subjectRecordId === record.person.id && candidate.values.date === scope.date) cached = candidate;
  }
  // The scoped projection can omit intent metadata. Consult its *same* physical row; never another subject/date.
  const physical = cached ? await store.getCachedRecord({ ...storageScope, recordId: cached.localId }) : null;
  const serverId = cached?.serverId ?? physical?.serverId ?? knownServerId;
  // This is the existing v10 virtual-snapshot codec, not a locally created identity.
  // Editing a historical snapshot can add an intent marker without changing its origin.
  const localReference = physical && physical.localId !== serverId && !physical.localId.startsWith("state_update_snapshot_");
  const reference = localReference ? physical!.localId : serverId ?? record.recordId;
  const referenceKind = localReference ? "local" : serverId ? "server" : "unknown";
  const readFields: ReadField[] = [{ key: "state", label: "Estado", fullWidth: false,
    values: [value(record.statusLabel || statuses.find(s => s.optionId === record.statusOptionId)?.label || (record.statusOptionId ? "Estado sin etiqueta disponible" : "Sin estado"))] }];
  for (const field of fields) {
    const known = Object.hasOwn(record.contextValues ?? {}, field.id);
    const raw = readAttendanceContextValue(field, record.contextValues?.[field.id]);
    let values: ReadValue[];
    if (!known) values = [unavailable()];
    else if (raw == null || raw === "" || Array.isArray(raw) && raw.length === 0) values = [{ text: "Sin valor", status: "empty" }];
    else if (field.type === "SELECT") {
      if (raw && typeof raw === "object" && !Array.isArray(raw) && "optionId" in raw) {
        const label = "label" in raw && nonempty(raw.label) ? raw.label : field.options.find(o => o.optionId === raw.optionId)?.label;
        values = [label ? value(label) : unavailable("Selección sin etiqueta disponible")];
      } else {
        const definition = { ...field, key: field.key ?? field.id,
          options: field.options.map(o => ({ id: o.optionId, label: o.label, value: o.value ?? o.optionId, active: true, order: o.order ?? 0 })) };
        const resolved = resolveStateUpdateSelectExtra(definition, raw, cached?.values.extraValuesFormat === "field-value" ? "field-value" : undefined);
        values = [resolved.label ? value(resolved.label) : unavailable("Selección sin etiqueta disponible")];
      }
    } else {
      const entityTypeId = getRelationTargetEntityTypeId(attendanceRelationField(field));
      values = await Promise.all((Array.isArray(raw) ? raw : [raw]).map(async item => {
        if (item && typeof item === "object" && !Array.isArray(item) && "displayName" in item && nonempty(item.displayName)) return value(item.displayName);
        const id = typeof item === "string" ? item : item && typeof item === "object" && !Array.isArray(item) && "id" in item && typeof item.id === "string" ? item.id : null;
        if (!id || !entityTypeId) return unavailable("Relación sin etiqueta disponible");
        let related;
        try { related = await store.getCachedRecord({ ownerKey: scope.ownerKey, contractId: scope.contractId, entityTypeId, recordId: id }); }
        catch { return unavailable("No pudimos leer la etiqueta local de la relación"); }
        return related && (related.serverId === id || related.localId === id) && nonempty(related.displayName)
          ? value(related.displayName) : unavailable("Relación sin etiqueta disponible");
      }));
    }
    readFields.push({ key: field.id, label: field.name, fullWidth: false, values });
  }
  const creationPrefix = `state_update_${encodeURIComponent(scope.appViewId)}_`;
  const creationSuffix = physical?.localId.startsWith(creationPrefix) ? physical.localId.slice(creationPrefix.length) : "";
  const captureProven = localReference && physical!.values.__opcoStateUpdateIntent === 1 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(creationSuffix);
  const captured = captureProven && validTime(physical!.values.eventOccurredAt) ? physical!.values.eventOccurredAt : undefined;
  const capture = record.captureTime ?? (physical?.values.captureTime as CaptureTimeRead | undefined);
  const presentation = capture ? presentCaptureTime(capture.source === "DEVICE_CONFIRMATION" ? capture.value : null,capture.timeZone,scope.date) : undefined;
  const referenceTime = capture ? null : attendanceTimestamp(captured ? "Hora de captura" : "Hora de referencia", captured ?? record.eventOccurredAt, timeZone);
  const modified = serverId || cached?.remoteUpdatedAt
    ? attendanceTimestamp("Última modificación", record.updatedAt || cached?.remoteUpdatedAt, timeZone) : null;
  const syncLabel = cached && cached.syncStatus !== "synced" ? ({ pending_create: "Guardado local · pendiente", pending_update: "Cambio local · pendiente", syncing: "Sincronizando", failed: "Error de sincronización", conflict: "Conflicto pendiente" }[cached.syncStatus]) : undefined;
  return { record, reference, referenceKind, serverId, fields: readFields,
    ...(presentation?{capture:presentation}:{}),
    timestamps: [referenceTime, modified].filter((t): t is NonNullable<typeof t> => !!t), syncLabel };
}

/** Overlay aliases of one row, never collapse independent records by person or timestamp. */
export function distinctAttendancePresentations(rows: AttendanceRecordPresentation[]) {
  const unique: { row: AttendanceRecordPresentation; aliases: Set<string> }[] = [];
  for (const row of rows) {
    const aliases = new Set([row.reference, row.serverId, row.record.recordId].filter((id): id is string => Boolean(id)));
    const matches = unique.filter(existing => existing.row.record.person.id === row.record.person.id &&
      [...aliases].some(id => existing.aliases.has(id)));
    if (!matches.length) unique.push({row, aliases});
    else {
      const first = matches[0];
      for (const match of matches) for (const id of match.aliases) aliases.add(id);
      const pending = matches.find(match => match.row.syncLabel)?.row;
      first.row = row.syncLabel || !pending ? row : pending;
      first.aliases = aliases;
      for (const match of matches.slice(1)) unique.splice(unique.indexOf(match), 1);
    }
  }
  return unique.map(item => item.row);
}

/** Only the configured related entity's ID groups records. Text, time and state never identify a row. */
export function groupAttendancePresentations(rows: AttendanceRecordPresentation[]) {
  const groups = new Map<string, { subject: PresentedSubject; rows: AttendanceRecordPresentation[] }>();
  for (const row of distinctAttendancePresentations(rows)) {
    const group = groups.get(row.record.person.id) ?? { subject: row.record.person, rows: [] };
    group.rows.push(row);
    groups.set(row.record.person.id, group);
  }
  return [...groups.values()];
}
