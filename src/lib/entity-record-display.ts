import { EntityDefinition, EntityField, EntityRecord, EntityRecordValue } from "./opco-api";

const FALLBACK_LIST_FIELDS = 4;

export type RecordListItem = {
  href: string;
  id: string;
  title: string;
  fields: {
    key: string;
    label: string;
    value: string;
  }[];
};

export type RecordDetailField = {
  key: string;
  label: string;
  value: string;
};

export function getPrimaryDisplayField(definition: EntityDefinition) {
  return getActiveFields(definition).find((field) => getFieldDisplayConfig(field).primary === true) ?? null;
}

export function getRecordListFields(definition: EntityDefinition) {
  const activeFields = getActiveFields(definition);
  const primaryField = getPrimaryDisplayField(definition);
  const configuredFields = activeFields.filter((field) => {
    const display = getFieldDisplayConfig(field);

    return display.showInList === true && field.id !== primaryField?.id;
  });

  if (configuredFields.length > 0) {
    return configuredFields;
  }

  return activeFields
    .filter((field) => field.id !== primaryField?.id)
    .filter(isUsefulFallbackField)
    .slice(0, FALLBACK_LIST_FIELDS);
}

export function buildRecordListItem({
  definition,
  record,
}: {
  definition: EntityDefinition;
  record: EntityRecord;
}): RecordListItem {
  return {
    fields: getRecordListFields(definition)
      .map((field) => ({
        key: field.key,
        label: field.name,
        value: formatRecordValue(record.values[field.key], field),
      }))
      .filter((item) => item.value !== ""),
    href: buildEntityRecordHref(definition.id, record.id),
    id: record.id,
    title: record.displayName || "Registro sin nombre",
  };
}

export function getRecordDetailFields(definition: EntityDefinition, record: EntityRecord): RecordDetailField[] {
  return getActiveFields(definition)
    .map((field) => ({
      key: field.key,
      label: field.name,
      value: formatRecordValue(record.values[field.key], field),
    }))
    .filter((item) => item.value !== "");
}

export function buildEntityRecordHref(entityTypeId: string, recordId: string) {
  return `/entity/${encodeURIComponent(entityTypeId)}/record/${encodeURIComponent(recordId)}`;
}

export function formatRecordValue(value: EntityRecordValue | undefined, field?: EntityField): string {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "boolean") {
    return value ? "Si" : "No";
  }

  if (typeof value === "number" || typeof value === "string") {
    if (field?.type === "SELECT") {
      return getOptionLabel(field, value) ?? String(value);
    }

    if (field?.type === "DATE") {
      return formatDateOnly(String(value));
    }

    if (field?.type === "DATETIME") {
      return formatDateTime(String(value));
    }

    return String(value);
  }

  if (Array.isArray(value)) {
    if (field?.type === "MULTISELECT") {
      return value
        .map((item) => getOptionLabel(field, item) ?? String(item))
        .filter(Boolean)
        .join(", ");
    }

    return value.map(formatRecordValueItem).filter(Boolean).join(", ");
  }

  return formatRecordValueItem(value);
}

function getActiveFields(definition: EntityDefinition) {
  return [...definition.fields]
    .filter((field) => field.active !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function getFieldDisplayConfig(field: EntityField) {
  const display = field.config?.display;

  return display && typeof display === "object" && !Array.isArray(display)
    ? (display as { primary?: boolean; showInList?: boolean })
    : {};
}

function isUsefulFallbackField(field: EntityField) {
  return field.type !== "FILE" && field.type !== "IMAGE" && field.type !== "TEXTAREA";
}

function getOptionLabel(field: EntityField, value: unknown) {
  const option = field.options?.find((item) => item.value === value);

  return option?.label;
}

function formatRecordValueItem(value: unknown): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return formatRecordValue(value as EntityRecordValue);
  }

  if (typeof value === "object" && "displayName" in value && typeof value.displayName === "string") {
    return value.displayName;
  }

  return JSON.stringify(value);
}

function formatDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return value;
  }

  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("es-CL", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
