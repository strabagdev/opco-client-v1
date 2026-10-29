import type { AttendanceBatchEntry, AttendanceContextField, AttendanceItem, AttendanceWorkflowConfig } from "../../../lib/opco-api";
import { attendanceEntryExtraValues } from "./attendance-workflow-logic";

export function copyAttendanceEntry(entry: AttendanceBatchEntry): AttendanceBatchEntry {
  return { ...entry, ...(entry.contextValues ? { contextValues: { ...entry.contextValues } } : {}) };
}

/** Visual edit context, never a new durable identity or an authorization. Unknown choices stay invalid. */
export function attendanceEditContextValues(fields: AttendanceContextField[], item: AttendanceItem, remembered: Record<string, string | null>) {
  if (!item.attendance) return { ...remembered };
  const stored = item.attendance.contextValues ?? {};
  return Object.fromEntries(fields.filter(field => Object.prototype.hasOwnProperty.call(stored, field.id)).map(field => {
    const raw = stored[field.id];
    const value = raw && typeof raw === "object" ? raw.optionId : raw;
    const option = field.options.find(option => option.optionId === value || option.value === value);
    return [field.id, option?.optionId ?? value ?? null];
  }));
}

export function attendanceCommandKey(scope: string, config: AttendanceWorkflowConfig, fields: AttendanceContextField[], entry: AttendanceBatchEntry) {
  const extras = { ...attendanceEntryExtraValues(entry, config, fields) };
  // Core treats an empty optional observation as no text. Preserve the submitted value itself.
  if (config.observationFieldId && (extras[config.observationFieldId] === null || extras[config.observationFieldId] === "")) extras[config.observationFieldId] = "";
  return JSON.stringify([scope, entry.personRecordId, entry.statusOptionId, Object.entries(extras).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]);
}

export function attendanceContentChanged(config: AttendanceWorkflowConfig, fields: AttendanceContextField[], item: AttendanceItem, entry: AttendanceBatchEntry) {
  if (!item.attendance) return false;
  return attendanceCommandKey("", config, fields, entry) !== attendanceCommandKey("", config, fields, {
    personRecordId: item.person.id,
    statusOptionId: item.attendance.statusOptionId ?? "",
    contextValues: attendanceEditContextValues(fields, item, {}),
    ...(config.observationFieldId ? { observation: item.attendance.observation ?? "" } : {}),
  });
}

/** Canonical comparison in memory only; does not alter the wire payload or persisted outbox. */
export function attendanceAttemptKey(scope: string, command: unknown): string {
  const sorted = (value: unknown): unknown => Array.isArray(value) ? value.map(sorted)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, v]) => [key, sorted(v)])) : value;
  return JSON.stringify([scope, sorted(command)]);
}
