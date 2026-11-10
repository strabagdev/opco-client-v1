import type { EntityRecordValue, PanelDataset, PanelField, PanelModuleConfig } from "../../lib/opco-api";
import type { ReadValue } from "../../components/read-field-list";
import type { PanelTableModel } from "./panel-renderer-logic";

/** Additional paint only. The query model, ordering, metrics and snapshots stay untouched. */
export function panelReadRows(module: PanelModuleConfig, dataset: PanelDataset, table: PanelTableModel) {
  const fields = new Map(dataset.schema.fields.map(field => [field.id, field]));
  const records = new Map(dataset.rows.map(row => [row.id, row]));
  return table.rows.map(row => ({ id: row.id, cells: table.columns.map((column, index) => {
    const field = fields.get(column.fieldId);
    const raw = records.get(row.id)?.values[column.fieldId];
    const policy = module.visualization.type === "TABLE"
      ? module.visualization.config.columns?.find(item => item.fieldId === column.fieldId)?.valueDisplay : undefined;
    return field ? panelReadValue(field, raw, row.values[index], policy === "INTERNAL_VALUE")
      : [{ text: "Dato no disponible", status: "unavailable" as const }];
  }) }));
}

function panelReadValue(field: PanelField, raw: EntityRecordValue | undefined, formatted: string, internal: boolean): ReadValue[] {
  if (raw === undefined) return [{ text: "Dato no disponible en esta consulta", status: "unavailable" }];
  if (raw === null || raw === "" || (Array.isArray(raw) && !raw.length)) return [{ text: "Sin valor", status: "empty" }];
  if (field.type === "BOOLEAN" && typeof raw === "boolean") return [{ text: raw ? "Sí" : "No", status: "value" }];
  if (field.type === "RELATION") return (Array.isArray(raw) ? raw : [raw]).map(value => {
    const ref = value && typeof value === "object" && !Array.isArray(value) ? value as { id?: unknown; displayName?: unknown } : null;
    const label = typeof ref?.displayName === "string" && ref.displayName.trim() ? ref.displayName : null;
    const id = typeof value === "string" ? value : typeof ref?.id === "string" ? ref.id : null;
    return label ? { text: label, status: "value" } : { text: "Referencia sin etiqueta disponible", status: "unavailable", ...(id ? { detail: `Identificador: ${id}` } : {}) };
  });
  if (!internal && (field.type === "SELECT" || field.type === "MULTISELECT")) return (Array.isArray(raw) ? raw : [raw]).map(value => {
    // Preserve the consultation formatter's historical value/optionId precedence.
    const option = field.options?.find(item => item.value === value || item.id === value);
    return option ? { text: option.label, status: "value" } : { text: "Opción sin etiqueta disponible", status: "unavailable", ...(typeof value === "string" || typeof value === "number" ? { detail: `Valor: ${value}` } : {}) };
  });
  return [{ text: formatted, status: "value" }];
}
