import type { EntityDefinition, EntityField, EntityRecordValue } from "./opco-api";
import { buildInitialFormValues, buildSubmitValues, getRelationTargetEntityTypeId, type RecordFormErrors, type RecordFormValues } from "./record-form";

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
  const unresolvedValues: Record<string, string[]> = {};
  for (const field of definition.fields) {
    const hasId = Object.hasOwn(stored, field.id), hasKey = Object.hasOwn(stored, field.key);
    const raw = hasId ? stored[field.id] : stored[field.key];
    keyed[field.key] = raw;
    if (field.type === "MULTISELECT") {
      const entries = raw == null ? [] : Array.isArray(raw) ? raw : [raw];
      const resolved = entries.map(value => resolveStateUpdateSelectExtra(field, value, format));
      keyed[field.key] = resolved.map(value => value.value) as EntityRecordValue;
      const issue = resolved.find(value => value.issue)?.issue;
      if (issue) unresolvedValues[field.key] = resolved.filter(value => value.issue).map(value => String(value.value));
      if (issue || (raw != null && !Array.isArray(raw))) issues[field.key] = issue ?? "La selección múltiple guardada tiene un formato inválido. Revisa las opciones.";
    }
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
  return { values: buildInitialFormValues(definition, keyed), issues: { ...issues, ...stateUpdateExtraMetadataErrors(definition.fields) },
    ...(Object.keys(unresolvedValues).length ? { unresolvedValues } : {}) };
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

export function stateUpdateExtraMetadataErrors(fields: EntityField[]): RecordFormErrors {
  return Object.fromEntries(fields.filter(field =>
    (["SELECT", "MULTISELECT"].includes(field.type) && !field.options) ||
    (field.type === "RELATION" && !getRelationTargetEntityTypeId(field)))
    .map(field => [field.key, "La definición guardada no incluye el catálogo de este campo. Conéctate para actualizarla antes de guardar."]));
}

export function reviewStateUpdateMultipleSelection(field: EntityField, selected: string[], unresolved: string[]) {
  const values = selected.map(value => unresolved.find(raw => unavailableStateUpdateExtraInput(field, raw) === value) ?? value);
  return { values, unresolved: unresolved.filter(value => selected.includes(unavailableStateUpdateExtraInput(field, value))) };
}
