import { useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { APP_SHELL_WIDE_BREAKPOINT } from "../../../lib/app-shell-layout";
import { desktopPalette as p } from "../../../lib/desktop-presentation";
import type { StateUpdateLatestRow } from "./state-update-workflow-logic";

export type StateUpdateReadRow = {
  key: string;
  name: string;
  values: StateUpdateLatestRow[];
  compactText?: string;
  fallback?: string;
  onPress?: () => void;
};

/** Column identity is metadata identity, never its visible label or the record's value. */
export function stateUpdateReadColumns(rows: StateUpdateReadRow[]) {
  return [...new Set(rows.flatMap(row => row.values.map(value => value.fieldId)))];
}

/** Only layout state lives here. Children keep their keys, controlled values and handlers on resize. */
export function StateUpdateFormGrid({ slots }: { slots: { key: string; full?: boolean; content: ReactNode }[] }) {
  const desktop = useWindowDimensions().width >= APP_SHELL_WIDE_BREAKPOINT;
  const [width, setWidth] = useState(0);
  const pair = desktop && width >= 640;
  return <View style={[s.form, desktop && s.formWide]} onLayout={event => setWidth(Math.round(event.nativeEvent.layout.width))}>
    {slots.map(slot => <View key={slot.key} style={{ minWidth: 0, width: pair && !slot.full ? (width - 16) / 2 : "100%" }}>{slot.content}</View>)}
  </View>;
}

/** One reading projection. No data fetching, selection state or workflow policy. */
export function StateUpdateReadRows({ rows, fullFieldIds = [] }: { rows: StateUpdateReadRow[]; fullFieldIds?: string[] }) {
  const desktop = useWindowDimensions().width >= APP_SHELL_WIDE_BREAKPOINT;
  const [width, setWidth] = useState(0);
  const columns = stateUpdateReadColumns(rows);
  const nameWidth = Math.max(170, Math.min(280, width * .28));
  const detailWidth = Math.max(0, width - nameWidth - 48);
  const count = Math.max(1, Math.min(columns.filter(id => !fullFieldIds.includes(id)).length, Math.floor((detailWidth + 16) / 156)));
  const cellWidth = Math.max(0, (detailWidth - (count - 1) * 16) / count);
  return <View style={[s.list, desktop && s.listWide]} onLayout={event => setWidth(Math.round(event.nativeEvent.layout.width))}>
    {rows.map(row => <ReadRow key={row.key} row={row} desktop={desktop}>
      <View style={[s.nameBlock, desktop && { width: nameWidth, flexShrink: 0 }]}><Text style={[s.name, desktop && s.nameWide]}>{row.name}</Text>
        {!desktop && row.compactText !== undefined ? <Text style={s.value}>{row.compactText}</Text> : null}
      </View>
      {desktop || row.compactText === undefined ? <View style={[s.values, desktop && s.valuesWide]}>
        {desktop && row.values.length ? columns.map(id => {
          const value = row.values.find(value => value.fieldId === id);
          return <View key={id} style={{ width: fullFieldIds.includes(id) ? "100%" : cellWidth, minWidth: 0 }}>{value ? <><Text style={s.caption}>{value.label}</Text><Text style={s.valueWide}>{value.value}</Text></> : null}</View>;
        }) : row.values.map(value => <Text key={value.fieldId} style={s.value}>{value.label}: {value.value}</Text>)}
        {!row.values.length && row.fallback ? <Text style={desktop ? s.valueWide : s.value}>{row.fallback}</Text> : null}
      </View> : null}
    </ReadRow>)}
  </View>;
}

function ReadRow({ row, desktop, children }: { row: StateUpdateReadRow; desktop: boolean; children: ReactNode }) {
  const [focused, setFocused] = useState(false), [hovered, setHovered] = useState(false);
  const style = [s.row, desktop && s.rowWide];
  if (!row.onPress) return <View style={style}>{children}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={row.name} onPress={row.onPress}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={[...style, desktop && hovered && s.hover, focused && s.focus]}>{children}</Pressable>;
}

const s = StyleSheet.create({
  form: { gap: 12, minWidth: 0 }, formWide: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  list: { gap: 10, minWidth: 0 }, listWide: { gap: 0 },
  row: { backgroundColor: "#ffffff", borderColor: "#d7e4e7", borderRadius: 8, borderWidth: 1, padding: 14, gap: 3, minWidth: 0 },
  rowWide: { flexDirection: "row", alignItems: "flex-start", gap: 24, minHeight: 64, borderRadius: 0, borderWidth: 0, borderBottomWidth: 1, borderColor: p.border, paddingVertical: 14, paddingHorizontal: 12, backgroundColor: "transparent" },
  nameBlock: { gap: 3, minWidth: 0 }, name: { color: "#0f3036", fontSize: 16, fontWeight: "800" }, nameWide: { color: p.text },
  values: { gap: 3, minWidth: 0 }, valuesWide: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 16 },
  caption: { color: p.muted, fontSize: 12, lineHeight: 17, marginBottom: 3 },
  value: { color: "#587078", lineHeight: 20 }, valueWide: { color: p.text, lineHeight: 21 },
  hover: { backgroundColor: p.selection },
  focus: Platform.OS === "web" ? { outlineColor: p.primary, outlineWidth: 3, outlineStyle: "solid", outlineOffset: -3 } : { borderColor: p.primary, borderWidth: 2 },
});
