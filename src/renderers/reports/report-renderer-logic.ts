import { EntityField, EntityRecordValue, ReportResponse, ReportSelectValueDisplay } from "@/lib/opco-api";

import { monthDays } from "./report-time-filter";

export type ReportTableModel = {
  columns: EntityField[];
  rows: {
    id: string;
    values: string[];
  }[];
};

export type ReportMatrixModel = {
  columns: {
    key: string;
    label: string;
  }[];
  rows: {
    id: string;
    label: string;
    summary: string | null;
    values: Record<string, string>;
  }[];
};

export function buildReportTableModel(report: ReportResponse): ReportTableModel | null {
  if (report.config.presentationMode !== "TABLE") {
    return null;
  }

  const fieldsById = fieldMap(report.fields);
  const columns = report.config.table.visibleFieldIds
    .map((fieldId) => fieldsById.get(fieldId))
    .filter((field): field is EntityField => Boolean(field));

  if (columns.length === 0) {
    return null;
  }

  return {
    columns,
    rows: report.records.map((record) => ({
      id: record.id,
      values: columns.map((field) =>
        displayRecordValue(field, record.values[field.key], report.config.valueDisplay?.[field.id]),
      ),
    })),
  };
}

export function buildReportMatrixModel(report: ReportResponse): ReportMatrixModel | null {
  if (report.config.presentationMode !== "MATRIX") {
    return null;
  }

  const fieldsById = fieldMap(report.fields);
  const rowField = fieldsById.get(report.config.matrix.rowFieldId);
  const columnField = fieldsById.get(report.config.matrix.columnFieldId);
  const valueField = fieldsById.get(report.config.matrix.valueFieldId);
  const summaryField = report.config.matrix.summaryFieldId
    ? fieldsById.get(report.config.matrix.summaryFieldId)
    : null;

  if (!rowField || !columnField || !valueField) {
    return null;
  }

  const columns = new Map<string, { key: string; label: string }>();
  const rows = new Map<string, { id: string; label: string; values: Map<string, Set<string>>; summary: Map<string, number> }>();

  for (const record of report.records) {
    const rowKey = stableValueKey(record.values[rowField.key]);
    const rowLabel =
      displayRecordValue(rowField, record.values[rowField.key], report.config.valueDisplay?.[rowField.id]) ||
      record.displayName;
    const columnKey = stableValueKey(record.values[columnField.key]);
    const columnLabel = columnField.id === report.config.dateFieldId
      ? dayLabel(
        displayRecordValue(columnField, record.values[columnField.key], report.config.valueDisplay?.[columnField.id]),
      )
      : displayRecordValue(columnField, record.values[columnField.key], report.config.valueDisplay?.[columnField.id]);
    const value = displayRecordValue(valueField, record.values[valueField.key], report.config.valueDisplay?.[valueField.id]);

    if (!rowKey || !columnKey) {
      continue;
    }

    columns.set(columnKey, { key: columnKey, label: columnLabel || columnKey });

    const row = rows.get(rowKey) ?? {
      id: rowKey,
      label: rowLabel || rowKey,
      summary: new Map<string, number>(),
      values: new Map<string, Set<string>>(),
    };
    const cell = row.values.get(columnKey) ?? new Set<string>();

    if (value) {
      cell.add(value);
    }

    row.values.set(columnKey, cell);

    if (summaryField) {
      const summaryValue = displayRecordValue(summaryField, record.values[summaryField.key], report.config.valueDisplay?.[summaryField.id]);

      if (summaryValue) {
        row.summary.set(summaryValue, (row.summary.get(summaryValue) ?? 0) + 1);
      }
    }

    rows.set(rowKey, row);
  }

  const matrixColumns = report.config.matrix.columnFieldId === report.config.dateFieldId &&
    report.config.timeFilter?.mode === "MONTH"
    ? monthDays(report.from.slice(0, 7))
    : Array.from(columns.values()).sort((left, right) => left.key.localeCompare(right.key, undefined, { numeric: true }));

  return {
    columns: matrixColumns,
    rows: Array.from(rows.values())
      .sort((left, right) => left.label.localeCompare(right.label))
      .map((row) => ({
        id: row.id,
        label: row.label,
        summary: summaryField ? formatSummary(row.summary) : null,
        values: Object.fromEntries(Array.from(row.values.entries()).map(([key, values]) => [key, Array.from(values).join(", ")])),
      })),
  };
}

export function displayRecordValue(
  field: EntityField,
  value: EntityRecordValue | undefined,
  selectValueDisplay: ReportSelectValueDisplay = "LABEL",
): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (field.type === "RELATION") {
    if (Array.isArray(value)) {
      return value.map(relationLabel).filter(Boolean).join(", ");
    }

    return relationLabel(value);
  }

  if (field.type === "SELECT") {
    const option = field.options?.find((item) => item.value === value || item.id === value);
    if (selectValueDisplay === "INTERNAL_VALUE") {
      return option?.value || option?.label || String(value);
    }
    return option?.label ?? String(value);
  }

  if (field.type === "MULTISELECT" && Array.isArray(value)) {
    return value.map((item) => {
      const option = field.options?.find((option) => option.value === item || option.id === item);
      if (selectValueDisplay === "INTERNAL_VALUE") {
        return option?.value || option?.label || String(item);
      }
      return option?.label ?? String(item);
    }).join(", ");
  }

  if (Array.isArray(value)) {
    return value.map(String).join(", ");
  }

  if (typeof value === "object") {
    return relationLabel(value) || JSON.stringify(value);
  }

  return String(value);
}

function fieldMap(fields: EntityField[]) {
  return new Map(fields.map((field) => [field.id, field]));
}

function relationLabel(value: unknown) {
  return value && typeof value === "object" && "displayName" in value
    ? String(value.displayName)
    : "";
}

function stableValueKey(value: EntityRecordValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (Array.isArray(value)) return value.map((item) => stableValueKey(item as EntityRecordValue)).join("|");
    if ("id" in value) return String(value.id);
    if ("displayName" in value) return String(value.displayName);
  }
  return String(value);
}

function dayLabel(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? match[3] : value;
}

function formatSummary(summary: Map<string, number>) {
  return Array.from(summary.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, count]) => `${label}: ${count}`)
    .join(" ");
}
