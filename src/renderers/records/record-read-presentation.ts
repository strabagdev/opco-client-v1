import type { EntityDefinition, EntityField, EntityRecord } from "../../lib/opco-api";
import { formatRecordValue, getRecordListFields } from "../../lib/entity-record-display";
import type { ReadField, ReadValue } from "../../components/read-field-list";

/** RECORDS-only, immutable display projection. No cache lookup, normalization or command construction. */
export function buildRecordReadFields(definition: EntityDefinition, record: Pick<EntityRecord, "values">, mode: "detail" | "list" = "detail"): ReadField[] {
  const fields = mode === "list" ? getRecordListFields(definition) : [...definition.fields]
    .filter(field => field.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return fields.map(field => {
    const raw = record.values[field.key];
    return { key: field.key, label: field.name,
      fullWidth: field.type === "TEXTAREA" || (field.type === "RELATION" && Array.isArray(raw) && raw.length > 1),
      values: presentValue(field, raw) };
  });
}

function presentValue(field: EntityField, raw: unknown): ReadValue[] {
  if (raw === undefined) return [{ text: "Dato no disponible en esta copia", status: "unavailable" }];
  if (raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0)) return [{ text: "Sin valor", status: "empty" }];
  if (field.type === "RELATION") {
    const values = Array.isArray(raw) ? raw : [raw];
    const labels = new Map<string, string>();
    for (const item of values) {
      const ref = reference(item);
      if (ref.id && ref.label) labels.set(ref.id, ref.label);
    }
    return values.map(value => {
      const ref = reference(value), label = ref.label ?? (ref.id ? labels.get(ref.id) : undefined);
      return label ? { text: label, status: "value" } : { text: "Referencia sin etiqueta disponible", status: "unavailable",
        ...(ref.id ? { detail: `Identificador: ${ref.id}` } : {}) };
    });
  }
  if (field.type === "SELECT" || field.type === "MULTISELECT") return (Array.isArray(raw) ? raw : [raw]).map(value => {
    // Generic records store FieldOption.value. A coincident optionId is not another value.
    const option = field.options?.find(option => option.value === value);
    return option ? { text: option.label, status: "value" } : { text: "Opción sin etiqueta disponible", status: "unavailable",
      ...(typeof value === "string" || typeof value === "number" ? { detail: `Valor: ${value}` } : {}) };
  });
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return [{ text: formatRecordValue(raw, field), status: "value" }];
  }
  return [{ text: "Valor sin presentación disponible", status: "unavailable" }];
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
