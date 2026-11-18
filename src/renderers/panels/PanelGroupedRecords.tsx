import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { ReadFieldList } from "../../components/read-field-list";
import type { PanelDataset, PanelModuleConfig } from "../../lib/opco-api";
import { colors } from "../../theme/paint";
import { panelReadRows } from "./panel-read-presentation";
import { buildPanelTableModel, displayPanelValue } from "./panel-renderer-logic";

/** Presentation of server-complete relation groups; no local Attendance/outbox overlay. */
export function panelGroupedRows(module: PanelModuleConfig, dataset: PanelDataset) {
  const table = buildPanelTableModel(module, dataset);
  if (!dataset.grouping || !table) return [];
  const rows = new Map(panelReadRows(module, dataset, table).map(row => [row.id, row]));
  return dataset.grouping.groups.map(group => {
    const first = dataset.rows.find(row => row.id === group.recordIds[0]);
    const label = (fieldId: string | undefined) => {
      const field = dataset.schema.fields.find(field => field.id === fieldId);
      return field && first ? displayPanelValue(field, first.values[field.id]) : "";
    };
    const complete = group.recordIds.length === group.count && new Set(group.recordIds).size === group.count
      && group.recordIds.every(id => rows.has(id));
    return { ...group, title: label(dataset.grouping!.primaryFieldId) || group.displayName,
      subtitle: label(dataset.grouping!.secondaryFieldId), complete,
      records: group.recordIds.flatMap(id => {
        const row = rows.get(id);
        return row ? [{ id, fields: table.columns.map((column, index) => ({
          key: column.fieldId, label: column.name, fullWidth: false, values: row.cells[index],
        })) }] : [];
      }) };
  });
}

export function PanelGroupedRecords({ module, dataset }: { module: PanelModuleConfig; dataset: PanelDataset }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return <View style={s.list}>
    <Text style={s.scope}>{dataset.grouping?.totalRecords ?? 0} registros · {dataset.pagination.total} grupos en la consulta completa</Text>
    {panelGroupedRows(module, dataset).map(group => <View key={group.key} style={s.group}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${group.title}${group.subtitle ? ` · ${group.subtitle}` : ""} · ${group.count} registros`}
        {...(Platform.OS === "web" ? { "aria-expanded": Boolean(expanded[group.key]) } : {})}
        accessibilityState={{ expanded: Boolean(expanded[group.key]) }} style={s.heading}
        onPress={() => setExpanded(current => ({ ...current, [group.key]: !current[group.key] }))}>
        <View style={s.identity}><Text style={s.title}>{group.title}</Text>{group.subtitle ? <Text style={s.name}>{group.subtitle}</Text> : null}</View>
        <Text style={s.count}>{group.count} {group.count === 1 ? "registro" : "registros"}</Text>
        <Text style={s.action}>{expanded[group.key] ? "Ocultar detalle" : "Ver detalle"}</Text>
      </Pressable>
      {expanded[group.key] ? <View style={s.details}>
        {!group.complete ? <Text style={s.incomplete}>Detalle incompleto en esta consulta. Actualiza para obtener el grupo completo.</Text> : null}
        {group.records.map(record => <View key={record.id} style={s.record}><ReadFieldList fields={record.fields} compact /></View>)}
      </View> : null}
    </View>)}
  </View>;
}
const s = StyleSheet.create({
  list: { gap: 8, minWidth: 0 },
  scope: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  group: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface, minWidth: 0 },
  heading: { flexDirection: "row", flexWrap: "wrap", gap: 10, alignItems: "center", padding: 12, minHeight: 44, minWidth: 0 },
  identity: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 0, gap: 2 },
  title: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: "700", flexShrink: 1 },
  name: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  count: { color: colors.text, fontSize: 14, lineHeight: 20 },
  action: { color: colors.primary, fontSize: 14, lineHeight: 20, fontWeight: "600" },
  details: { paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  record: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 10, paddingBottom: 4 },
  incomplete: { color: colors.warning, fontSize: 14, lineHeight: 20 },
});
