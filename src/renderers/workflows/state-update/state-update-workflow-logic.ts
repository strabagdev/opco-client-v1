import {
  EntityField,
  EntityRecordValue,
  StateUpdateBatchResult,
  StateUpdateCurrentFieldValue,
  StateUpdateEntry,
  StateUpdateField,
  StateUpdateOption,
} from "@/lib/opco-api";

export const STATE_UPDATE_SEARCH_DEBOUNCE_MS = 300;

export type StateUpdateFormValues = Record<string, string | boolean>;

export function formatLocalDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function shiftLocalDate(value: string, amount: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  date.setDate(date.getDate() + amount);

  return formatLocalDateInput(date);
}

export function normalizeStateUpdateSearch(value: string) {
  return value.trim();
}

export function shouldSearchStateUpdateSubjects(value: string) {
  return normalizeStateUpdateSearch(value).length > 0;
}

export function defaultStateValues(fields: StateUpdateField[]) {
  return fields.reduce<StateUpdateFormValues>((values, field) => {
    values[field.fieldId] = stateFieldType(field) === "BOOLEAN" ? false : field.defaultOptionId ?? "";

    return values;
  }, {});
}

export function buildEffectiveStateSnapshot({
  currentStateValues,
  fields,
  formValues,
}: {
  currentStateValues?: StateUpdateCurrentFieldValue[];
  fields: StateUpdateField[];
  formValues: StateUpdateFormValues;
}) {
  const currentValues = currentStateValues ?? [];
  const stateValues: StateUpdateEntry["stateValues"] = [];
  let hasChanges = false;
  let error: string | null = null;

  for (const field of fields) {
    const snapshot = buildEffectiveFieldSnapshot({
      currentValue: currentStateValue(currentValues, field.fieldId),
      field,
      formValue: formValues[field.fieldId],
    });

    if (snapshot.error) {
      error = snapshot.error;
      break;
    }

    if (snapshot.value) {
      stateValues.push(snapshot.value);
    }

    hasChanges = hasChanges || snapshot.hasChanges;
  }

  return { error, hasChanges, stateValues };
}

export function stateFieldOptionLabel(field: StateUpdateField, optionId: string | null | undefined) {
  if (!optionId) {
    return null;
  }

  return field.options.find((option) => option.optionId === optionId)?.label ?? null;
}

export function activeStateOptions(field: StateUpdateField): StateUpdateOption[] {
  return [...field.options]
    .filter((option) => option.active !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function currentStateValue(values: StateUpdateCurrentFieldValue[], fieldId: string) {
  return values.find((value) => value.fieldId === fieldId) ?? null;
}

function normalizeOptionId(value: string | null | undefined) {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}

function validStateFieldOption(field: StateUpdateField, optionId: string | null | undefined) {
  if (!optionId) {
    return null;
  }

  return field.options.find((option) => option.optionId === optionId && option.active !== false) ?? null;
}

function buildEffectiveFieldSnapshot({
  currentValue,
  field,
  formValue,
}: {
  currentValue: StateUpdateCurrentFieldValue | null;
  field: StateUpdateField;
  formValue: string | boolean | undefined;
}) {
  if (stateFieldType(field) === "SELECT") {
    const formOptionId = normalizeOptionId(typeof formValue === "string" ? formValue : undefined);
    const currentOptionId = normalizeOptionId(currentValue?.optionId);
    const defaultOptionId = validStateFieldOption(field, field.defaultOptionId)?.optionId ?? null;
    const effectiveOptionId = formOptionId ?? currentOptionId ?? defaultOptionId;

    if (!effectiveOptionId) {
      return missingStateFieldSnapshot(field);
    }

    if (!validStateFieldOption(field, effectiveOptionId)) {
      return { error: `${field.label} tiene una opcion no valida.`, hasChanges: false, value: null };
    }

    return {
      error: null,
      hasChanges: effectiveOptionId !== currentOptionId,
      value: { fieldId: field.fieldId, optionId: effectiveOptionId },
    };
  }

  const formStateValue = normalizeScalarStateValue(field, formValue);
  const currentState = normalizeCurrentScalarStateValue(field, currentValue);
  const effectiveValue = formStateValue.hasValue ? formStateValue.value : currentState.value;

  if (formStateValue.error) {
    return { error: formStateValue.error, hasChanges: false, value: null };
  }

  if (!hasNonEmptyScalarValue(field, effectiveValue)) {
    return missingStateFieldSnapshot(field);
  }

  return {
    error: null,
    hasChanges: !stateScalarValuesEqual(field, currentState.value, effectiveValue),
    value: {
      fieldId: field.fieldId,
      optionId: null,
      value: effectiveValue,
    },
  };
}

function missingStateFieldSnapshot(field: StateUpdateField) {
  if (field.required) {
    return { error: `${field.label} es obligatorio.`, hasChanges: false, value: null };
  }

  return { error: null, hasChanges: false, value: null };
}

function normalizeScalarStateValue(field: StateUpdateField, value: string | boolean | undefined) {
  if (stateFieldType(field) === "BOOLEAN") {
    return { error: null, hasValue: typeof value === "boolean", value: value === true };
  }

  const textValue = typeof value === "string" ? value.trim() : "";

  if (!textValue) {
    return { error: null, hasValue: false, value: null };
  }

  if (stateFieldType(field) === "INTEGER") {
    if (!/^-?\d+$/.test(textValue)) {
      return { error: `${field.label} debe ser un entero valido.`, hasValue: false, value: null };
    }

    return { error: null, hasValue: true, value: Number.parseInt(textValue, 10) };
  }

  if (stateFieldType(field) === "DECIMAL" || stateFieldType(field) === "MONEY") {
    if (!/^-?\d+(\.\d+)?$/.test(textValue)) {
      return { error: `${field.label} debe ser un decimal valido.`, hasValue: false, value: null };
    }

    return { error: null, hasValue: true, value: Number.parseFloat(textValue) };
  }

  if (stateFieldType(field) === "DATE" && !isValidStateDateValue(textValue)) {
    return { error: `${field.label} debe ser una fecha valida.`, hasValue: false, value: null };
  }

  return { error: null, hasValue: true, value: textValue };
}

function normalizeCurrentScalarStateValue(field: StateUpdateField, currentValue: StateUpdateCurrentFieldValue | null) {
  if (!currentValue || currentValue.value === undefined) {
    return { value: null };
  }

  if (stateFieldType(field) === "DATE" && typeof currentValue.value === "string") {
    return { value: currentValue.value.slice(0, 10) };
  }

  return { value: currentValue.value };
}

function hasNonEmptyScalarValue(field: StateUpdateField, value: unknown) {
  if (stateFieldType(field) === "BOOLEAN") {
    return typeof value === "boolean";
  }

  if (value === null || value === undefined) {
    return false;
  }

  return typeof value !== "string" || value.trim().length > 0;
}

function stateScalarValuesEqual(field: StateUpdateField, currentValue: unknown, requestedValue: unknown) {
  return JSON.stringify(normalizeComparableStateScalar(field, currentValue)) ===
    JSON.stringify(normalizeComparableStateScalar(field, requestedValue));
}

function normalizeComparableStateScalar(field: StateUpdateField, value: unknown) {
  if (stateFieldType(field) === "DATE" && typeof value === "string") {
    return value.slice(0, 10);
  }

  return value;
}

export function formValueFromStateValue(field: StateUpdateField, value: StateUpdateCurrentFieldValue | null | undefined) {
  if (stateFieldType(field) === "SELECT") {
    return value?.optionId ?? "";
  }

  if (stateFieldType(field) === "BOOLEAN") {
    return value?.value === true;
  }

  if (stateFieldType(field) === "DATE" && typeof value?.value === "string") {
    return value.value.slice(0, 10);
  }

  return value?.value === null || value?.value === undefined ? "" : String(value.value);
}

export function formatStateValueLabel(field: StateUpdateField, value: StateUpdateCurrentFieldValue | null | undefined) {
  if (!value) {
    return null;
  }

  if (stateFieldType(field) === "SELECT") {
    return value.label ?? stateFieldOptionLabel(field, value.optionId);
  }

  return value.label ?? formatStateScalarLabel(field, value.value);
}

function formatStateScalarLabel(field: StateUpdateField, value: unknown) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    return null;
  }

  if (stateFieldType(field) === "BOOLEAN") {
    return value === true ? "Si" : "No";
  }

  return String(value);
}

export function stateFieldType(field: StateUpdateField) {
  return field.type ?? "SELECT";
}

function isValidStateDateValue(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function firstBlockingStateUpdateResult(results: StateUpdateBatchResult[]) {
  return results.find((result) => result.result === "CONFLICT" || result.result === "ERROR") ?? null;
}

export function hasSuccessfulStateUpdateResult(results: StateUpdateBatchResult[]) {
  return results.some((result) => (
    result.result === "CREATED" ||
    result.result === "UNCHANGED" ||
    result.result === "UPDATED"
  ));
}

export function stateUpdateSuccessLabel(result: StateUpdateBatchResult | undefined, updateLabel: string, createLabel: string) {
  if (!result) {
    return createLabel;
  }

  if (result.result === "UNCHANGED") {
    return "El estado ya estaba registrado.";
  }

  if (result.result === "UPDATED") {
    return updateLabel;
  }

  return createLabel;
}

export type StateUpdateConflictRow = {
  existing: string | null;
  fieldId: string;
  fieldType?: string | null;
  label: string;
  requested: string | null;
  technicalExisting?: EntityRecordValue;
  technicalRequested?: EntityRecordValue;
};

export function buildStateUpdateConflictRows(
  conflict: Extract<StateUpdateBatchResult, { result: "CONFLICT" }>,
  stateFields: StateUpdateField[],
  extraFields: EntityField[] = [],
) {
  return [
    ...stateConflictRows(conflict, stateFields),
    ...extraConflictRows(conflict, extraFields),
  ];
}

function stateConflictRows(
  conflict: Extract<StateUpdateBatchResult, { result: "CONFLICT" }>,
  fields: StateUpdateField[],
) {
  return fields
    .map<StateUpdateConflictRow | null>((field) => {
      const existing = conflict.existing.stateValues.find((value) => value.fieldId === field.fieldId);
      const requested = conflict.requested.stateValues.find((value) => value.fieldId === field.fieldId);
      const existingLabel = formatStateValueLabel(field, existing);
      const requestedLabel = formatStateValueLabel(field, requested);

      if (stateConflictValuesEqual(field, existing, requested)) {
        return null;
      }

      return {
        existing: existingLabel,
        fieldId: field.fieldId,
        fieldType: "STATE",
        label: field.label,
        requested: requestedLabel,
        technicalExisting: technicalStateValue(field, existing),
        technicalRequested: technicalStateValue(field, requested),
      };
    })
    .filter((row): row is StateUpdateConflictRow => Boolean(row));
}

function stateConflictValuesEqual(
  field: StateUpdateField,
  existing: StateUpdateCurrentFieldValue | undefined,
  requested: StateUpdateCurrentFieldValue | undefined,
) {
  if (stateFieldType(field) === "SELECT") {
    return (existing?.optionId ?? null) === (requested?.optionId ?? null);
  }

  return stateScalarValuesEqual(field, existing?.value, requested?.value);
}

function technicalStateValue(
  field: StateUpdateField,
  value: StateUpdateCurrentFieldValue | undefined,
): EntityRecordValue {
  if (stateFieldType(field) === "SELECT") {
    return value?.optionId ?? null;
  }

  return value?.value ?? null;
}

function extraConflictRows(
  conflict: Extract<StateUpdateBatchResult, { result: "CONFLICT" }>,
  fields: EntityField[],
) {
  const fieldIds = orderedExtraConflictFieldIds(conflict, fields);

  return fieldIds
    .map<StateUpdateConflictRow | null>((fieldId) => {
      const field = fields.find((candidate) => candidate.id === fieldId || candidate.key === fieldId);
      const metadata = conflict.extraValues?.find((value) => value.fieldId === fieldId);
      const existing = readConflictExtraValue(conflict.existing.extraValues, fieldId, field) ?? metadata?.remoteValue;
      const requested = readConflictExtraValue(conflict.requested.extraValues, fieldId, field) ?? metadata?.localValue;

      if (areExtraConflictValuesEqual(existing, requested)) {
        return null;
      }

      return {
        existing: formatExtraConflictValue(field, existing),
        fieldId,
        fieldType: metadata?.fieldType ?? field?.type ?? null,
        label: metadata?.fieldLabel ?? field?.name ?? fallbackFieldLabel(fieldId),
        requested: formatExtraConflictValue(field, requested),
        technicalExisting: existing,
        technicalRequested: requested,
      };
    })
    .filter((row): row is StateUpdateConflictRow => Boolean(row));
}

function orderedExtraConflictFieldIds(
  conflict: Extract<StateUpdateBatchResult, { result: "CONFLICT" }>,
  fields: EntityField[],
) {
  const fieldIds = new Set<string>();

  for (const difference of conflict.extraValues ?? []) {
    fieldIds.add(difference.fieldId);
  }

  for (const fieldId of Object.keys(conflict.existing.extraValues ?? {})) {
    fieldIds.add(fieldId);
  }

  for (const fieldId of Object.keys(conflict.requested.extraValues ?? {})) {
    fieldIds.add(fieldId);
  }

  return [...fieldIds].sort((left, right) => {
    const leftField = fields.find((field) => field.id === left || field.key === left);
    const rightField = fields.find((field) => field.id === right || field.key === right);

    return (leftField?.order ?? Number.MAX_SAFE_INTEGER) - (rightField?.order ?? Number.MAX_SAFE_INTEGER);
  });
}

function readConflictExtraValue(
  values: Record<string, EntityRecordValue> | undefined,
  fieldId: string,
  field?: EntityField,
) {
  if (!values) {
    return undefined;
  }

  if (fieldId in values) {
    return values[fieldId];
  }

  if (field?.key && field.key in values) {
    return values[field.key];
  }

  if (field?.id && field.id in values) {
    return values[field.id];
  }

  return undefined;
}

function formatExtraConflictValue(field: EntityField | undefined, value: EntityRecordValue | undefined) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (field?.type === "SELECT") {
    return optionLabel(field, value) ?? String(value);
  }

  if (field?.type === "MULTISELECT") {
    const values: EntityRecordValue[] = Array.isArray(value) ? value as EntityRecordValue[] : [value];
    const labels = values
      .map((item) => optionLabel(field, item) ?? String(item))
      .filter((item) => item.trim().length > 0);

    return labels.length > 0 ? labels.join(", ") : null;
  }

  if (typeof value === "boolean") {
    return value ? "Si" : "No";
  }

  if (typeof value === "object") {
    const displayName = readDisplayName(value);
    return displayName ?? JSON.stringify(value);
  }

  return String(value);
}

function optionLabel(field: EntityField, value: EntityRecordValue) {
  const normalized = String(readRelationId(value) ?? value);

  return field.options?.find((option) => option.value === normalized || option.id === normalized)?.label ?? null;
}

function readDisplayName(value: object) {
  if ("displayName" in value && typeof value.displayName === "string") {
    return value.displayName;
  }

  if ("label" in value && typeof value.label === "string") {
    return value.label;
  }

  return null;
}

function readRelationId(value: EntityRecordValue) {
  return value && typeof value === "object" && !Array.isArray(value) && "id" in value
    ? (value as { id: unknown }).id
    : null;
}

function areExtraConflictValuesEqual(left: EntityRecordValue | undefined, right: EntityRecordValue | undefined) {
  return JSON.stringify(normalizeExtraConflictValue(left)) === JSON.stringify(normalizeExtraConflictValue(right));
}

function normalizeExtraConflictValue(value: EntityRecordValue | undefined): unknown {
  if (Array.isArray(value)) {
    return (value as EntityRecordValue[]).map(normalizeExtraConflictValue).sort();
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }

  return value ?? null;
}

function fallbackFieldLabel(fieldId: string) {
  return `Campo ${fieldId.slice(0, 8)}`;
}
