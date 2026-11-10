import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { space, typography } from "../theme/tokens";
import { colors as p } from "../theme/paint";

type Props = {
  label: string;
  labelId: string;
  required?: boolean;
  description?: string;
  descriptionId?: string;
  error?: string;
  errorId: string;
  disabled?: boolean;
  children: ReactNode;
};

/** Receives existing accessibility IDs. Control values, focus and events remain caller-owned. */
export function FieldFrame({ label, labelId, required, description, descriptionId, error, errorId, disabled = false, children }: Props) {
  const [focused, setFocused] = useState(false);
  return <View testID="field-frame" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={s.frame}>
    <Text nativeID={labelId} style={[s.label, disabled && s.disabled, focused && !disabled && s.focused, !!error && s.invalid]}>{label}{required ? " (obligatorio)" : ""}</Text>
    {description ? <Text nativeID={descriptionId} style={s.description}>{description}</Text> : null}
    {children}
    {error ? <Text nativeID={errorId} accessibilityRole="alert" style={s.error}>{error}</Text> : null}
  </View>;
}
const s = StyleSheet.create({
  frame: { gap: space.sm, minWidth: 0 },
  label: { color: p.text, ...typography.label },
  description: { color: p.textSecondary, ...typography.table },
  focused: { color: p.primary }, invalid: { color: p.danger },
  error: { color: p.danger, ...typography.table }, disabled: { color: p.textSecondary },
});
