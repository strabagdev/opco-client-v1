import type { EntityField, StateUpdateField } from "@/lib/opco-api";
import { resolveStateUpdateSelectExtra, type StateUpdateExtraValuesFormat } from "../../../lib/state-update-extras";
import { stateFieldType, type StateUpdateConflictRow } from "./state-update-workflow-logic";

export type ConflictDisplayItem = { label: string; detail?: string };
export type ConflictDisplayRow = { fieldId: string; label: string; server: ConflictDisplayItem[]; local: ConflictDisplayItem[] };

/** Read-only projection. The original rows/values remain the inputs to comparison and resolution. */
export function presentStateUpdateConflictRows(rows: StateUpdateConflictRow[], fields: StateUpdateField[], extras: EntityField[], formats: {
  server?: StateUpdateExtraValuesFormat; local?: StateUpdateExtraValuesFormat;
} = {}): ConflictDisplayRow[] {
  return rows.map(row => {
    const state = row.fieldType === "STATE" ? fields.find(field => field.fieldId === row.fieldId) : undefined;
    const extra = !state ? extras.find(field => field.id === row.fieldId || field.key === row.fieldId) : undefined;
    const type = state ? stateFieldType(state) : extra?.type ?? row.fieldType;
    // Labels from this same field/snapshot may explain a scalar on the other side.
    // No cross-field map, fetch, cache mutation or inference of a business value.
    const embedded = new Map<string, string>();
    if (type === "RELATION") for (const raw of [row.technicalExisting, row.technicalRequested]) {
      for (const item of Array.isArray(raw) ? raw : [raw]) {
        const ref = reference(item);
        if (ref.id && ref.label) embedded.set(ref.id, ref.label);
      }
    }
    function display(raw: unknown, oldLabel: string | null, format?: StateUpdateExtraValuesFormat): ConflictDisplayItem[] {
      if (raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0)) return [{ label: "Sin valor" }];
      if (type === "RELATION") return (Array.isArray(raw) ? raw : [raw]).map(item => {
        const ref = reference(item);
        const label = ref.label ?? (ref.id ? embedded.get(ref.id) ?? extra?.options?.find(option => option.id === ref.id)?.label : undefined);
        return label ? { label } : { label: "Referencia sin etiqueta disponible", ...(ref.id ? { detail: `Identificador: ${ref.id}` } : {}) };
      });
      if (type === "SELECT" && state) {
        const label = state.options.find(option => option.optionId === raw)?.label ?? (oldLabel && oldLabel !== raw ? oldLabel : undefined);
        return [label ? { label } : unavailableOption(raw)];
      }
      if (type === "SELECT" || type === "MULTISELECT") return (Array.isArray(raw) ? raw : [raw]).map(item => {
        const resolved = extra ? resolveStateUpdateSelectExtra(extra, item, format) : undefined;
        return resolved?.label ? { label: resolved.label } : unavailableOption(item);
      });
      if (typeof raw === "object") return [{ label: "Valor sin presentación disponible" }];
      return [{ label: oldLabel ?? String(raw) }];
    }
    return { fieldId: row.fieldId, label: row.label,
      server: display(row.technicalExisting, row.existing, formats.server),
      local: display(row.technicalRequested, row.requested, formats.local) };
  });
}

function reference(value: unknown): { id?: string; label?: string } {
  if (typeof value === "string") return { id: value };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const ref = value as { id?: unknown; displayName?: unknown };
    return { ...(typeof ref.id === "string" ? { id: ref.id } : {}),
      ...(typeof ref.displayName === "string" && ref.displayName.trim() ? { label: ref.displayName } : {}) };
  }
  return {};
}

function unavailableOption(value: unknown): ConflictDisplayItem {
  return { label: "Opción sin etiqueta disponible", ...(typeof value === "string" || typeof value === "number" ? { detail: `Valor: ${value}` } : {}) };
}
