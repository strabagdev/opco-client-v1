import type { AttendanceBatchEntry, AttendanceContextField, AttendanceItem, AttendanceWorkflowConfig, EntityRecordValue } from "../../../lib/opco-api";
import { canonicalAttendanceContextValue } from "./attendance-workflow-logic";

export type ConfirmationRow = { label: string; current: string; requested: string; changed: boolean | null };
const unavailable = "No disponible en esta lectura";
const empty = "Sin valor";

/** Read-only presentation of the captured command. Never constructs or authorizes a write. */
export function attendanceConfirmationRows({ config, fields, entry, current, currentExtras, currentStatus, currentStatusOptionId, requestedStatus, relationLabel }: {
  config: AttendanceWorkflowConfig;
  fields: AttendanceContextField[];
  entry?: AttendanceBatchEntry;
  current?: AttendanceItem["attendance"];
  currentExtras?: Record<string, EntityRecordValue>;
  currentStatus: string | null;
  currentStatusOptionId: string | null;
  requestedStatus: string;
  relationLabel(fieldId: string, recordId: string): string | undefined;
}): ConfirmationRow[] {
  const rows: ConfirmationRow[] = [{ label: "Estado", current: currentStatus ?? "Sin estado", requested: requestedStatus || unavailable,
    changed: currentStatusOptionId && entry ? currentStatusOptionId !== entry.statusOptionId : null }];
  if (config.observationFieldId) {
    const known = currentExtras && Object.prototype.hasOwnProperty.call(currentExtras, config.observationFieldId) || !!current;
    const previous = currentExtras && Object.prototype.hasOwnProperty.call(currentExtras, config.observationFieldId)
      ? currentExtras[config.observationFieldId] : current?.observation;
    const next = entry?.observation;
    rows.push({ label: "Observación", current: known ? String(previous ?? "") || empty : unavailable,
      requested: entry ? String(next ?? "") || empty : unavailable,
      changed: known && entry ? String(previous ?? "") !== String(next ?? "") : null });
  }
  for (const field of fields) {
    const known = currentExtras && Object.prototype.hasOwnProperty.call(currentExtras, field.id)
      || !!current?.contextValues && Object.prototype.hasOwnProperty.call(current.contextValues, field.id);
    const previous = currentExtras && Object.prototype.hasOwnProperty.call(currentExtras, field.id)
      ? currentExtras[field.id] : current?.contextValues?.[field.id];
    const next = entry?.contextValues?.[field.id];
    const canonical = (raw: unknown) => {
      const value = field.type === "SELECT" && raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as { optionId?: string }).optionId : raw;
      try { return canonicalAttendanceContextValue(field, value as EntityRecordValue | undefined); }
      catch { return undefined; } // Unknown historical data is shown, never repaired by presentation.
    };
    const display = (raw: unknown) => {
      if (raw === null || raw === undefined || raw === "") return empty;
      if (field.type === "SELECT") {
        const value = typeof raw === "object" && !Array.isArray(raw) ? (raw as { optionId?: unknown }).optionId : raw;
        return field.options.find(option => option.optionId === value || option.value === value)?.label ?? "Selección no disponible";
      }
      const id = canonical(raw);
      const stored = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
      const label = stored && typeof stored === "object" ? (stored as { displayName?: string }).displayName : undefined;
      const original = Array.isArray(previous) && previous.length === 1 ? previous[0] : previous;
      const retainedLabel = canonical(previous) === id && original && typeof original === "object"
        ? (original as { displayName?: string }).displayName : undefined;
      return id ? relationLabel(field.id, id) ?? label ?? retainedLabel ?? "Selección no disponible" : "Selección no disponible";
    };
    rows.push({ label: field.name, current: known ? display(previous) : unavailable, requested: entry ? display(next) : unavailable,
      changed: known && entry && canonical(previous) !== undefined && canonical(next) !== undefined ? canonical(previous) !== canonical(next) : null });
  }
  return rows;
}
