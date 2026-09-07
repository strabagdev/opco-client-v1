import { formatRecordValue } from "../../lib/entity-record-display";
import { EntityDefinition, EntityField, EntityRecord, EntityRecordsQuery, RecordsAppViewConfig } from "../../lib/opco-api";

export type RecordsSubviewTab = "records" | "status";

export type StatusSubviewRow = {
  date?: string;
  id: string;
  name: string;
  state: string;
};

export function hasStatusSubview(config: RecordsAppViewConfig) {
  return config.statusSubview?.template === "versioning" && Boolean(config.statusSubview.stateFieldId);
}

export function buildStatusSubviewQuery({
  config,
  page,
  pageSize,
  search,
}: {
  config: RecordsAppViewConfig;
  page: number;
  pageSize: number;
  search?: string;
}): EntityRecordsQuery {
  const statusSubview = config.statusSubview;

  if (!statusSubview || statusSubview.template !== "versioning") {
    return { page, pageSize, search };
  }

  return {
    direction: statusSubview.dateFieldId ? "desc" : undefined,
    fieldIdHasValue: statusSubview.stateFieldId,
    page,
    pageSize,
    search,
    sort: statusSubview.dateFieldId ? `fieldId:${statusSubview.dateFieldId}` : undefined,
  };
}

export function buildStatusSubviewRows({
  definition,
  records,
  statusSubview,
}: {
  definition: EntityDefinition;
  records: EntityRecord[];
  statusSubview: NonNullable<RecordsAppViewConfig["statusSubview"]>;
}): StatusSubviewRow[] {
  const stateField = fieldById(definition, statusSubview.stateFieldId);
  const dateField = statusSubview.dateFieldId ? fieldById(definition, statusSubview.dateFieldId) : null;

  if (!stateField) {
    return [];
  }

  return records
    .map((record) => {
      const state = formatRecordValue(record.values[stateField.key], stateField);

      if (!state) {
        return null;
      }

      const date = dateField ? formatRecordValue(record.values[dateField.key], dateField) : undefined;

      return {
        ...(dateField ? { date } : {}),
        id: record.id,
        name: record.displayName || "Registro sin nombre",
        state,
      };
    })
    .filter((row): row is StatusSubviewRow => Boolean(row));
}

export function statusSubviewFields(definition: EntityDefinition, config: RecordsAppViewConfig) {
  const stateField = config.statusSubview ? fieldById(definition, config.statusSubview.stateFieldId) : null;
  const dateField = config.statusSubview?.dateFieldId ? fieldById(definition, config.statusSubview.dateFieldId) : null;

  return { dateField, stateField };
}

function fieldById(definition: EntityDefinition, fieldId: string): EntityField | null {
  return definition.fields.find((field) => field.id === fieldId && field.active !== false) ?? null;
}
