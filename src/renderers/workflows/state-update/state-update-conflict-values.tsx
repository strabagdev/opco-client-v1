import { type ThemeColors } from "../../../theme/tokens";
import { colors } from "../../../theme/paint";
import { StyleSheet, Text, View } from "react-native";
import type { EntityField, StateUpdateField } from "@/lib/opco-api";
import type { StateUpdateExtraValuesFormat } from "@/lib/state-update-extras";
import type { StateUpdateConflictRow } from "./state-update-workflow-logic";
import { presentStateUpdateConflictRows, type ConflictDisplayItem } from "./state-update-conflict-presentation";

export function StateUpdateConflictValues({ rows, fields, extraFields, serverFormat, localFormat, persisted = false }: {
  rows: StateUpdateConflictRow[]; fields: StateUpdateField[]; extraFields: EntityField[];
  serverFormat?: StateUpdateExtraValuesFormat; localFormat?: StateUpdateExtraValuesFormat; persisted?: boolean;
}) {
  const values = presentStateUpdateConflictRows(rows, fields, extraFields, { server: serverFormat, local: localFormat });
  return <View style={s.rows}>
    {values.length ? <Text style={s.hint}>{persisted ? "Guardado en este dispositivo" : "Edición local por confirmar"}</Text> : null}
    {values.map((row, index) => <View key={`${row.fieldId}:${index}`} style={s.row}>
    <Text style={s.field}>{row.label}</Text>
    <View style={s.versions}>
      <Version label="En el servidor" items={row.server} />
      <Version label="Tu cambio propuesto" items={row.local} />
    </View>
  </View>)}</View>;
}

function Version({ label, items }: { label: string; items: ConflictDisplayItem[] }) {
  return <View style={s.version}>
    <Text style={s.provenance}>{label}</Text>
    {items.map((item, index) => <View key={index} style={s.item}>
      <Text selectable style={s.value}>{item.label}</Text>
      {item.detail ? <Text selectable style={s.hint}>{item.detail}</Text> : null}
    </View>)}
  </View>;
}

export function createConflictValuesS(p: ThemeColors = colors) {
  return StyleSheet.create({
  rows: { gap: 12 },
  row: { gap: 8, borderBottomWidth: 1, borderBottomColor: p.border, paddingBottom: 12, minWidth: 0 },
  field: { color: p.text, fontSize: 15, fontWeight: "700" },
  versions: { flexDirection: "row", flexWrap: "wrap", gap: 12, minWidth: 0 },
  version: { flexGrow: 1, flexBasis: 235, minWidth: 0, gap: 4 },
  provenance: { color: p.textSecondary, fontSize: 13, fontWeight: "700" },
  hint: { color: p.textSecondary, fontSize: 12, lineHeight: 18 },
  item: { gap: 2, minWidth: 0 },
  value: { color: p.text, fontSize: 15, lineHeight: 21, flexShrink: 1 },
});
}
const s = createConflictValuesS();
