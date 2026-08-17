import { EntityDefinition, EntityField, EntityRecordValue, OpcoApiError } from "./opco-api";

export type RecordFormValues = Record<string, string | boolean | string[]>;

export type RecordFormErrors = Record<string, string>;

export const WRITABLE_FIELD_TYPES = new Set([
  "BOOLEAN",
  "DATE",
  "DATETIME",
  "DECIMAL",
  "INTEGER",
  "MONEY",
  "MULTISELECT",
  "RELATION",
  "SELECT",
  "TEXT",
  "TEXTAREA",
]);

export const UNSUPPORTED_FIELD_TYPES = new Set(["FILE", "IMAGE"]);

export function getWritableFields(definition: EntityDefinition) {
  return [...definition.fields]
    .filter((field) => field.active !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function isFieldWritable(field: EntityField) {
  return WRITABLE_FIELD_TYPES.has(field.type);
}

export function isFieldUnsupported(field: EntityField) {
  return UNSUPPORTED_FIELD_TYPES.has(field.type) || !isFieldWritable(field);
}

export function buildInitialFormValues(
  definition: EntityDefinition,
  recordValues: Record<string, EntityRecordValue | undefined> = {},
): RecordFormValues {
  return getWritableFields(definition).reduce<RecordFormValues>((values, field) => {
    values[field.key] = formValueFromRecordValue(recordValues[field.key], field);

    return values;
  }, {});
}

export function validateRequiredFields(fields: EntityField[], values: RecordFormValues): RecordFormErrors {
  return fields.reduce<RecordFormErrors>((errors, field) => {
    if (!field.required || isFieldUnsupported(field)) {
      return errors;
    }

    if (isEmptyFormValue(values[field.key])) {
      errors[field.key] = "Este campo es obligatorio.";
    }

    return errors;
  }, {});
}

export function buildSubmitValues(fields: EntityField[], values: RecordFormValues) {
  return fields.reduce<Record<string, EntityRecordValue>>((payload, field) => {
    if (isFieldUnsupported(field)) {
      return payload;
    }

    const value = recordValueFromFormValue(values[field.key], field);

    if (value !== undefined) {
      payload[field.key] = value;
    }

    return payload;
  }, {});
}

export function buildChangedSubmitValues(
  fields: EntityField[],
  initialValues: RecordFormValues,
  currentValues: RecordFormValues,
) {
  const changedFields = fields.filter((field) => !areFormValuesEqual(initialValues[field.key], currentValues[field.key]));

  return buildSubmitValues(changedFields, currentValues);
}

export function extractApiFieldErrors(error: unknown): RecordFormErrors {
  if (!(error instanceof OpcoApiError)) {
    return {};
  }

  return readFieldErrors(error.details);
}

function formValueFromRecordValue(value: EntityRecordValue | undefined, field: EntityField): string | boolean | string[] {
  if (field.type === "BOOLEAN") {
    return value === true;
  }

  if (field.type === "MULTISELECT") {
    return Array.isArray(value) ? value.map((item) => String(readRelationId(item) ?? item)) : [];
  }

  if (field.type === "RELATION" && field.multiple) {
    return Array.isArray(value) ? value.map((item) => String(readRelationId(item) ?? item)) : [];
  }

  if (field.type === "RELATION") {
    return String(readRelationId(value) ?? value ?? "");
  }

  return value === undefined || value === null ? "" : String(value);
}

function recordValueFromFormValue(
  value: string | boolean | string[] | undefined,
  field: EntityField,
): EntityRecordValue | undefined {
  if (field.type === "BOOLEAN") {
    return value === true;
  }

  if (Array.isArray(value)) {
    return value;
  }

  const textValue = typeof value === "string" ? value.trim() : "";

  if (!textValue) {
    return null;
  }

  if (field.type === "INTEGER") {
    const parsed = Number.parseInt(textValue, 10);

    return Number.isNaN(parsed) ? textValue : parsed;
  }

  if (field.type === "DECIMAL" || field.type === "MONEY") {
    const parsed = Number.parseFloat(textValue);

    return Number.isNaN(parsed) ? textValue : parsed;
  }

  return textValue;
}

function isEmptyFormValue(value: string | boolean | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === "boolean") {
    return false;
  }

  return !value?.trim();
}

function areFormValuesEqual(left: string | boolean | string[] | undefined, right: string | boolean | string[] | undefined) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
  }

  return left === right;
}

function readRelationId(value: unknown) {
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string") {
    return value.id;
  }

  return null;
}

function readFieldErrors(details: unknown): RecordFormErrors {
  if (!details || typeof details !== "object") {
    return {};
  }

  if ("fieldErrors" in details) {
    return normalizeFieldErrors(details.fieldErrors);
  }

  if ("fields" in details) {
    return normalizeFieldErrors(details.fields);
  }

  return normalizeFieldErrors(details);
}

function normalizeFieldErrors(value: unknown): RecordFormErrors {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce<RecordFormErrors>((errors, [key, message]) => {
    if (typeof message === "string") {
      errors[key] = message;
    } else if (Array.isArray(message) && typeof message[0] === "string") {
      errors[key] = message[0];
    }

    return errors;
  }, {});
}
