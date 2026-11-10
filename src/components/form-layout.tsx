import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { borderWidth, metrics, radii, space } from "../theme/tokens";
import { colors as p } from "../theme/paint";

/** Composition only. No conditional trees or data effects at responsive boundaries. */
export function FormLayout({ children }: { children: ReactNode }) {
  return <View style={s.layout}>{children}</View>;
}

export type FormSlot = { key: string; fullWidth?: boolean; content: ReactNode };

export function FormGrid({ slots, children, appearance = "section", maxColumns = 2 }: { slots: FormSlot[]; children?: ReactNode; appearance?: "section" | "plain"; maxColumns?: 2 | 3 }) {
  const [width, setWidth] = useState(0);
  const innerWidth = Math.max(0, width);
  const columns = maxColumns === 3 && innerWidth >= 820 ? 3 : innerWidth >= 600 ? 2 : 1;
  return <View style={[s.section, appearance === "plain" && s.plain]}>
    <View style={s.grid} onLayout={event => {
      const next = Math.floor(event.nativeEvent.layout.width);
      setWidth(current => current === next ? current : next);
    }}>
      {slots.map(slot => <View key={slot.key} style={{ minWidth: 0, width: columns > 1 && !slot.fullWidth ? (innerWidth - (columns - 1) * space.field) / columns : "100%" }}>{slot.content}</View>)}
    </View>
    {children}
  </View>;
}

const s = StyleSheet.create({
  layout: { width: "100%", maxWidth: metrics.formMaxWidth, minWidth: 0, alignSelf: "flex-start", gap: space.field },
  section: { backgroundColor: p.surface, borderColor: p.border, borderWidth: borderWidth.line, borderRadius: radii.section, padding: space.lg, gap: space.lg, minWidth: 0 },
  plain: { backgroundColor: "transparent", borderWidth: 0, padding: 0 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.field, minWidth: 0 },
});
