import {useState} from "react";
import { type ThemeColors } from "../theme/tokens";
import { colors } from "../theme/paint";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FormGrid } from "./form-layout";
export type ReadValue = { text: string; status: "value" | "empty" | "unavailable"; detail?: string; detailCollapsed?: boolean };
export type ReadField = { key: string; label: string; fullWidth: boolean; values: ReadValue[] };

/** Read-only cells. Callers own field eligibility, labels, data, navigation and coverage. */
export function ReadFieldList({ fields, compact = false }: { fields: ReadField[]; compact?: boolean }) {
  const cell = (field: ReadField) => <View style={[s.field, compact && s.compactCell]}>
    <Text style={s.label}>{field.label}</Text>
    {field.values.map((value, index) => <View key={index} style={s.valueGroup}>
      <Text selectable style={[s.value, compact && s.compactValue, value.status !== "value" && s.unavailable]}>{value.text}</Text>
      {value.detail ? value.detailCollapsed ? <ReadValueDetail detail={value.detail} collapsed/> : <Text selectable style={s.detail}>{value.detail}</Text> : null}
    </View>)}
  </View>;
  return compact ? <View style={s.compact}>{fields.map(field => <View key={field.key} style={[s.compactField, field.fullWidth && s.full]}>{cell(field)}</View>)}</View>
    : <FormGrid appearance="plain" slots={fields.map(field => ({ key: field.key, fullWidth: field.fullWidth, content: cell(field) }))} />;
}

export function createReadFieldS(p: ThemeColors = colors) {
  return StyleSheet.create({
  field: { gap: 6, minWidth: 0 },
  compactCell: { gap: 3 },
  label: { color: p.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  value: { color: p.text, fontSize: 16, lineHeight: 22, minWidth: 0, flexShrink: 1 },
  compactValue: { fontSize: 15, lineHeight: 21 },
  valueGroup: { gap: 2, minWidth: 0 },
  detail: { color: p.textSecondary, fontSize: 12, lineHeight: 18, minWidth: 0 },
  unavailable: { color: p.textSecondary },
  compact: { flexDirection: "row", flexWrap: "wrap", rowGap: 10, columnGap: 16, minWidth: 0 },
  compactField: { flexBasis: 210, flexGrow: 1, minWidth: 0 },
  full: { flexBasis: "100%" },
});
}
const s = createReadFieldS();

export function ReadValueDetail({detail,collapsed=false}:{detail:string;collapsed?:boolean}) {
  const[open,setOpen]=useState(!collapsed);
  return <View>{collapsed?<Pressable accessibilityRole="button" accessibilityState={{expanded:open}} onPress={()=>setOpen(!open)} style={{minHeight:44,justifyContent:"center"}}><Text style={s.detail}>{open?"Ocultar detalle de captura":"Ver detalle de captura"}</Text></Pressable>:null}{open?<Text selectable style={s.detail}>{detail}</Text>:null}</View>;
}
