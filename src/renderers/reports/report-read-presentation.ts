import type { EntityField, EntityRecordValue, ReportResponse } from "../../lib/opco-api";
import type { ReadValue } from "../../components/read-field-list";
import type { ReportTableModel } from "./report-renderer-logic";

/** Visual projection only: TABLE model, records and snapshots remain unchanged. */
export function reportReadRows(report: ReportResponse, table: ReportTableModel) {
  const records = new Map(report.records.map(record => [record.id, record]));
  return table.rows.map(row => ({ id: row.id, cells: table.columns.map((field, index) =>
    reportReadValue(field, records.get(row.id)?.values[field.key], row.values[index], report.config.valueDisplay?.[field.id] === "INTERNAL_VALUE"),
  ) }));
}

function reportReadValue(field: EntityField, raw: EntityRecordValue | undefined, formatted: string, internal: boolean): ReadValue[] {
  if (raw === undefined) return [{ text: "Dato no disponible en esta consulta", status: "unavailable" }];
  if (raw === null || raw === "" || (Array.isArray(raw) && !raw.length)) return [{ text: "Sin valor", status: "empty" }];
  if (field.type === "RELATION") return (Array.isArray(raw) ? raw : [raw]).map(value => {
    const ref = value && typeof value === "object" && !Array.isArray(value) ? value as { id?: unknown; displayName?: unknown } : null;
    const label = typeof ref?.displayName === "string" && ref.displayName.trim() ? ref.displayName : null;
    const id = typeof value === "string" ? value : typeof ref?.id === "string" ? ref.id : null;
    return label ? { text: label, status: "value" } : { text: "Referencia sin etiqueta disponible", status: "unavailable", ...(id ? { detail: `Identificador: ${id}` } : {}) };
  });
  if (!internal && (field.type === "SELECT" || field.type === "MULTISELECT")) return (Array.isArray(raw) ? raw : [raw]).map(value => {
    const option = field.options?.find(option => option.value === value || option.id === value);
    return option ? { text: option.label, status: "value" } : { text: "Opción sin etiqueta disponible", status: "unavailable", ...(typeof value === "string" || typeof value === "number" ? { detail: `Valor: ${value}` } : {}) };
  });
  // Preserve TABLE formatting, including INTERNAL_VALUE uppercase and DATE strings.
  return [{ text: formatted, status: "value" }];
}
