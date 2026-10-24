import type { EntityDefinition, EntityField, EntityRecordValue } from "./opco-api";
import { buildInitialFormValues, buildSubmitValues, type RecordFormErrors, type RecordFormValues } from "./record-form";

// Read provenance belongs to each snapshot, never to the definition or the outbox.
export type StateUpdateExtraValuesFormat = "field-value";

export function resolveStateUpdateSelectExtra(field: EntityField, value: unknown, format?: StateUpdateExtraValuesFormat) {
  if (value === null || value === undefined || value === "") return { value: "", issue: undefined, label: null };
  const options = typeof value === "string" ? (field.options ?? []).filter(option =>
    option.value === value || (format !== "field-value" && option.id === value)) : [];
  const values = new Set(options.map(option => option.value));
  if (values.size === 1) {
    const option = options[0];
    return { value: option.value, label: option.label, issue: option.active === false
      ? "La opción guardada ya no está disponible. Revisa la selección antes de guardar." : undefined };
  }
  return { value, label: null, issue: values.size > 1
    ? "La selección guardada es ambigua. Selecciona explícitamente una opción antes de guardar."
    : "La selección guardada no está disponible. Conéctate para actualizar las opciones o revisa la selección." };
}

export function buildStateUpdateExtraForm(definition: EntityDefinition, stored: Record<string, EntityRecordValue> = {}, format?: StateUpdateExtraValuesFormat) {
  const keyed: Record<string, EntityRecordValue> = {};
  const issues: RecordFormErrors = {};
  for (const field of definition.fields) {
    const hasId = Object.hasOwn(stored, field.id), hasKey = Object.hasOwn(stored, field.key);
    const raw = hasId ? stored[field.id] : stored[field.key];
    keyed[field.key] = raw;
    if (field.type === "SELECT") {
      const resolved = resolveStateUpdateSelectExtra(field, raw, format);
      // Unresolved values stay visible; they must never become a different option or empty.
      keyed[field.key] = resolved.value as EntityRecordValue;
      if (resolved.issue) issues[field.key] = resolved.issue;
    }
    if (hasId && hasKey && field.id !== field.key && JSON.stringify(stored[field.id]) !== JSON.stringify(stored[field.key])) {
      issues[field.key] = "El campo tiene valores incompatibles. Revisa su selección antes de guardar.";
    }
  }
  return { values: buildInitialFormValues(definition, keyed), issues };
}

export function buildStateUpdateExtraSubmit(fields: EntityField[], values: RecordFormValues) {
  const keyed = buildSubmitValues(fields, values);
  return Object.fromEntries(fields.filter(field => Object.hasOwn(keyed, field.key)).map(field => [field.id, keyed[field.key]]));
}

// UI only: an ambiguous legacy ID may equal another option's canonical value.
// Keep the raw form value intact, while preventing that unrelated option appearing selected.
export function unavailableStateUpdateExtraInput(field: EntityField, value: unknown) {
  let unavailable = `__unavailable__${JSON.stringify(value)}`;
  while (field.options?.some(option => option.value === unavailable)) unavailable += "_";
  return unavailable;
}
