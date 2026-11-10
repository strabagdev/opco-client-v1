import { metrics, radii, space, typography } from "../theme/tokens";
import { colors, focusStyle } from "../theme/paint";
import { webFieldStyle } from "../theme/control-presentation";
import type { FieldAccessibility } from "./field-accessibility";
import { useId, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type GestureResponderEvent } from "react-native";

export type CompactOption = { value: string; label: string; disabled?: boolean };
export type CompactSelectProps = FieldAccessibility & {
  /** Opt-in indicator layout; other consumers retain inline composition. */
  indicatorPlacement?: "inline" | "end";
  label: string;
  options: CompactOption[];
  value: string | string[];
  onChange(value: string | string[]): void;
  required?: boolean;
  multiple?: boolean;
  disabled?: boolean;
};

/** Presentation only: callers retain ownership of option IDs/values and selection state. */
export function changeCompactSelection(current: string[], next: string, multiple: boolean, required: boolean) {
  if (!multiple) return next;
  if (current.includes(next)) return required && current.length === 1 ? current : current.filter(value => value !== next);
  return [...current, next];
}

export function CompactSelect({ indicatorPlacement = "inline", label, options, value, onChange, required = false, multiple = false, disabled = false, controlId, labelledBy, describedBy, invalid }: CompactSelectProps) {
  const summaryId = `${useId()}-selection`;
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const viewport = useWindowDimensions();
  const [anchor, setAnchor] = useState({ x: 20, y: 20, width: 320 });
  const trigger = useRef<View>(null);
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  const known = new Set(options.map(option => option.value));
  // Keep a selected unavailable value visible; never silently choose a replacement.
  const choices = [...options, ...selected.filter(item => !known.has(item)).map(item => ({ value: item, label: "Selección no disponible", disabled: true }))];
  const summary = selected.length ? choices.filter(option => selected.includes(option.value)).map(option => option.label).join(", ") : "Seleccionar…";
  const close = () => { setOpen(false); if (Platform.OS === "web") (trigger.current as unknown as HTMLElement | null)?.focus(); };
  if (Platform.OS === "web" && !multiple) {
    return <select id={controlId} aria-labelledby={labelledBy} aria-describedby={describedBy} aria-invalid={invalid} aria-label={label} required={required} disabled={disabled} value={typeof value === "string" ? value : value[0] ?? ""}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={event => { const next = event.target.value; if ((!next && required) || (next && !choices.some(option => option.value === next && !option.disabled))) { event.currentTarget.value = typeof value === "string" ? value : value[0] ?? ""; return; } onChange(next); }}
      style={{ ...webFieldStyle(disabled, invalid, focused), paddingRight: space.xl }}>
      <option value="" disabled={required}>{required ? "Seleccionar…" : "Sin selección"}</option>
      {choices.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}{option.disabled ? " (no disponible)" : ""}</option>)}
    </select>;
  }
  return <View style={styles.wrapper}>
    <Pressable nativeID={controlId} aria-labelledby={labelledBy} {...(Platform.OS === "web" ? { "aria-describedby": [summaryId, describedBy].filter(Boolean).join(" "), "aria-invalid": invalid, "aria-required": required } : {})} ref={trigger} {...(Platform.OS === "web" ? { "aria-expanded": open && !disabled, "aria-haspopup": "dialog" as const } : {})} accessibilityRole="button" accessibilityLabel={`${label}: ${summary}`} accessibilityState={{ disabled, expanded: open && !disabled }} disabled={disabled}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={() => { trigger.current?.measureInWindow((x, y, width, height) => setAnchor({ x: Math.max(12, Math.min(x, viewport.width - Math.min(width, viewport.width - 24) - 12)), y: y + height + 4 + 340 <= viewport.height ? y + height + 4 : Math.max(12, y - 340), width: Math.min(width, viewport.width - 24) })); setOpen(true); }}
      style={[styles.control, indicatorPlacement === "end" && styles.endIndicatorControl, focused && styles.focus, invalid && styles.invalid, disabled && styles.disabled]}>
      {indicatorPlacement === "end" ? <>
        <Text nativeID={summaryId} style={[styles.text, disabled && styles.disabledText, styles.selectionSummary]}>{summary}</Text>
        <Text accessible={false} aria-hidden style={[styles.text, disabled && styles.disabledText, styles.indicator]}>▾</Text>
      </> : <Text style={styles.text}><Text nativeID={summaryId}>{summary}</Text> ▾</Text>}
    </Pressable>
    <Modal visible={open && !disabled} transparent animationType="none" onRequestClose={close}>
      <View style={[styles.backdrop, Platform.OS === "web" && { justifyContent: "flex-start", alignItems: "flex-start", padding: 0 } ]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Cerrar ${label}`} onPress={close} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[styles.menu, Platform.OS === "web" && { position: "absolute", left: anchor.x, top: anchor.y, width: anchor.width, maxHeight: Math.min(340, viewport.height - 24) } ]}>
          <Text accessibilityRole="header" style={styles.title}>{label}</Text>
          <ScrollView style={styles.options}>
            {choices.map(option => <FocusOption key={option.value} {...(Platform.OS === "web" ? { "aria-checked": selected.includes(option.value) } : {})} accessibilityRole={multiple ? "checkbox" : "radio"}
              accessibilityLabel={option.label} accessibilityState={{ checked: selected.includes(option.value), disabled: option.disabled && !selected.includes(option.value) }} disabled={option.disabled && !selected.includes(option.value)}
              onPress={() => { onChange(changeCompactSelection(selected, option.value, multiple, required)); if (!multiple) close(); }}
              selected={selected.includes(option.value)}>
              <Text style={[styles.text, selected.includes(option.value) && styles.selectedText, option.disabled && !selected.includes(option.value) && styles.disabledText]}>{selected.includes(option.value) ? "✓ " : ""}{option.label}{option.disabled ? " (no disponible)" : ""}</Text>
            </FocusOption>)}
          </ScrollView>
          {!required && selected.length > 0 ? <FocusOption accessibilityRole="button" accessibilityLabel={`Limpiar ${label}`} onPress={() => { onChange(multiple ? [] : ""); close(); }} ><Text style={styles.text}>Limpiar selección</Text></FocusOption> : null}
          <FocusOption accessibilityRole="button" onPress={close}><Text style={styles.text}>Cerrar</Text></FocusOption>
        </View>
      </View>
    </Modal>
  </View>;
}
export function activateCompactCheckboxFromKeyboard(event: { key: string; repeat?: boolean; preventDefault(): void; stopPropagation(): void }, disabled: boolean, activate: () => void) {
  if (disabled || event.repeat || (event.key !== " " && event.key !== "Spacebar")) return false;
  event.preventDefault(); event.stopPropagation(); activate(); return true;
}

function FocusOption({ selected, ...props }: React.ComponentProps<typeof Pressable> & { selected?: boolean }) {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const keyboard = Platform.OS === "web" && props.accessibilityRole === "checkbox" ? {
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => activateCompactCheckboxFromKeyboard(event, props.disabled === true,
      () => props.onPress?.(event as unknown as GestureResponderEvent)),
  } : {};
  return <Pressable {...props} {...keyboard} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={({ pressed }) => [styles.option, hovered && !selected && !props.disabled && styles.hover, selected && styles.selected, pressed && !props.disabled && styles.pressed, props.disabled && styles.disabled, focused && styles.focus]} />;
}
const styles = StyleSheet.create({
  endIndicatorControl: { flexDirection: "row", alignItems: "center", gap: space.md },
  selectionSummary: { flex: 1, minWidth: 0 }, indicator: { flexShrink: 0 },
  wrapper: { minWidth: 0, width: "100%" }, control: { borderColor: colors.controlBorder, borderWidth: 1, borderRadius: radii.control, minHeight: metrics.controlMinHeight, paddingVertical: space.sm, paddingHorizontal: space.md, justifyContent: "center", backgroundColor: colors.surface },
  focus: focusStyle, invalid: { borderColor: colors.danger }, disabled: { backgroundColor: colors.disabled, borderColor: colors.disabledBorder }, disabledText: { color: colors.onDisabled },
  text: { color: colors.text, ...typography.control },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "center", alignItems: "center", padding: space.field },
  menu: { width: "100%", maxWidth: 480, maxHeight: "85%", backgroundColor: colors.surfaceRaised, borderRadius: radii.section, padding: space.md, gap: space.sm },
  options: { flexShrink: 1 }, title: { color: colors.text, ...typography.section, padding: space.sm },
  option: { minHeight: metrics.controlMinHeight, justifyContent: "center", padding: space.md, borderRadius: radii.control },
  hover: { backgroundColor: colors.secondaryHover }, pressed: { backgroundColor: colors.secondaryPressed },
  selected: { backgroundColor: colors.selection }, selectedText: { color: colors.onSelection },
});
