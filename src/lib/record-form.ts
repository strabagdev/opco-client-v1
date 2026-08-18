import { EntityDefinition, EntityField, EntityRecordValue, OpcoApiError } from "./opco-api";

export type RecordFormValues = Record<string, string | boolean | string[]>;

export type RecordFormErrors = Record<string, string>;

export const WRITABLE_FIELD_TYPES = new Set([
  "BOOLEAN",
  "DATE",
  "DATETIME",
  "DECIMAL",
  "EMAIL",
  "INTEGER",
  "MONEY",
  "MULTISELECT",
  "PHONE",
  "RELATION",
  "SELECT",
  "TEXT",
  "TEXTAREA",
  "TIME",
  "URL",
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

export function validateFormFields(fields: EntityField[], values: RecordFormValues): RecordFormErrors {
  const errors = validateRequiredFields(fields, values);

  fields.forEach((field) => {
    if (isFieldUnsupported(field) || errors[field.key]) {
      return;
    }

    const value = values[field.key];

    if (typeof value !== "string" || !value.trim()) {
      return;
    }

    if (field.type === "DATE" && !isValidDateValue(value.trim())) {
      errors[field.key] = "Ingresa una fecha valida.";
    }

    if (field.type === "TIME" && !isValidTimeValue(value.trim())) {
      errors[field.key] = "Ingresa una hora valida en formato HH:mm.";
    }

    if (field.type === "DATETIME" && !isValidDateTimeValue(value.trim())) {
      errors[field.key] = "Ingresa una fecha y hora validas.";
    }
  });

  return errors;
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

  if (field.type === "TIME") {
    return textValue;
  }

  return textValue;
}

export function isValidTimeValue(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);

  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function isValidDateValue(value: string) {
  const parts = parseDateParts(value);

  if (!parts) {
    return false;
  }

  const date = new Date(parts.year, parts.month - 1, parts.day);

  return (
    date.getFullYear() === parts.year &&
    date.getMonth() === parts.month - 1 &&
    date.getDate() === parts.day
  );
}

export function isValidDateTimeValue(value: string) {
  return !Number.isNaN(new Date(value).getTime());
}

export function composeDateTimeValue(dateValue: string, timeValue: string) {
  const dateParts = parseDateParts(dateValue);
  const timeParts = parseTimeParts(timeValue);

  if (!dateParts || !timeParts || !isValidDateValue(dateValue) || !isValidTimeValue(timeValue)) {
    return "";
  }

  return new Date(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hours,
    timeParts.minutes,
    0,
    0,
  ).toISOString();
}

export function splitDateTimeValue(value: string | undefined) {
  if (!value) {
    return { date: "", time: "" };
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return { date: "", time: "" };
  }

  return {
    date: formatDateInputValue(date),
    time: formatTimeInputValue(date),
  };
}

export function formatDateInputValue(date: Date) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function formatTimeInputValue(date: Date) {
  return [String(date.getHours()).padStart(2, "0"), String(date.getMinutes()).padStart(2, "0")].join(":");
}

export function datePickerValueFromDate(value: string | undefined) {
  const parts = value ? parseDateParts(value) : null;

  if (!parts || !isValidDateValue(value ?? "")) {
    return new Date();
  }

  return new Date(parts.year, parts.month - 1, parts.day, 12, 0, 0, 0);
}

export function datePickerValueFromTime(value: string | undefined) {
  const parts = value ? parseTimeParts(value) : null;
  const date = new Date();

  date.setSeconds(0, 0);

  if (!parts) {
    return date;
  }

  date.setHours(parts.hours, parts.minutes, 0, 0);

  return date;
}

export function datePickerValueFromDateTime(value: string | undefined, mode: "date" | "time") {
  if (value && isValidDateTimeValue(value)) {
    return new Date(value);
  }

  if (mode === "time") {
    return datePickerValueFromTime(undefined);
  }

  return datePickerValueFromDate(undefined);
}

function parseDateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  return {
    day: Number.parseInt(match[3], 10),
    month: Number.parseInt(match[2], 10),
    year: Number.parseInt(match[1], 10),
  };
}

function parseTimeParts(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  return {
    hours: Number.parseInt(match[1], 10),
    minutes: Number.parseInt(match[2], 10),
  };
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
