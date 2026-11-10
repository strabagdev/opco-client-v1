import { useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, type PressableProps } from "react-native";
import { borderWidth, metrics, radii, space, typography } from "../theme/tokens";
import { actionColors } from "../theme/control-presentation";
import { stableSubmitButtonStyle } from "../lib/visual-stability";

type Props = Pick<PressableProps, "onPress" | "disabled" | "accessibilityLabel"> & {
  label: string;
  busy?: boolean;
  busyLabel?: string;
  variant?: "primary" | "secondary";
};

/** Callers supply the exact handlers, disabled state and operation status. */
export function FormAction({ label, busy = false, busyLabel = label, variant = "primary", disabled, accessibilityLabel, onPress }: Props) {
  const primary = variant === "primary";
  const [hovered, setHovered] = useState(false);
  const paint = actionColors(primary, { disabled: Boolean(disabled) });
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? (busy ? busyLabel : label)}
    {...(Platform.OS === "web" ? { "aria-busy": busy } : {})}
    accessibilityState={{ disabled: Boolean(disabled), busy }} disabled={disabled} onPress={onPress}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={({ pressed }) => [s.button, actionColors(primary, { disabled: Boolean(disabled), pressed, hovered })]}>
    {busy ? <ActivityIndicator color={paint.color} /> : null}
    <Text style={[s.text, { color: paint.color }]}>{busy ? busyLabel : label}</Text>
  </Pressable>;
}
export function FormActions({ children }: { children: ReactNode }) {
  return <View style={s.actions}>{children}</View>;
}
const s = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", gap: space.md, minWidth: 0 },
  button: { ...stableSubmitButtonStyle, borderWidth: borderWidth.line, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, borderRadius: radii.control, paddingHorizontal: space.lg, paddingVertical: space.md, maxWidth: "100%", minWidth: metrics.actionMinWidth },
  text: { ...typography.control, fontWeight: "600", flexShrink: 1, textAlign: "center" },
});
