import { useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

export type CompactOption = { value: string; label: string; disabled?: boolean };
export type CompactSelectProps = {
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

export function CompactSelect({ label, options, value, onChange, required = false, multiple = false, disabled = false }: CompactSelectProps) {
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
    return <select aria-label={label} required={required} disabled={disabled} value={typeof value === "string" ? value : value[0] ?? ""}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={event => { const next = event.target.value; if ((!next && required) || (next && !choices.some(option => option.value === next && !option.disabled))) { event.currentTarget.value = typeof value === "string" ? value : value[0] ?? ""; return; } onChange(next); }}
      style={{ ...webControl, outline: focused ? "3px solid #315DA8" : undefined, outlineOffset: 2, opacity: disabled ? 0.6 : 1 }}>
      <option value="" disabled={required}>{required ? "Seleccionar…" : "Sin selección"}</option>
      {choices.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}{option.disabled ? " (no disponible)" : ""}</option>)}
    </select>;
  }
  return <View style={styles.wrapper}>
    <Pressable ref={trigger} {...(Platform.OS === "web" ? { "aria-expanded": open && !disabled, "aria-haspopup": "dialog" as const } : {})} accessibilityRole="button" accessibilityLabel={`${label}: ${summary}`} accessibilityState={{ disabled, expanded: open && !disabled }} disabled={disabled}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={() => { trigger.current?.measureInWindow((x, y, width, height) => setAnchor({ x: Math.max(12, Math.min(x, viewport.width - Math.min(width, viewport.width - 24) - 12)), y: y + height + 4 + 340 <= viewport.height ? y + height + 4 : Math.max(12, y - 340), width: Math.min(width, viewport.width - 24) })); setOpen(true); }}
      style={[styles.control, focused && styles.focus, disabled && styles.disabled]}>
      <Text style={styles.text}>{summary} ▾</Text>
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
              <Text style={styles.text}>{selected.includes(option.value) ? "✓ " : ""}{option.label}{option.disabled ? " (no disponible)" : ""}</Text>
            </FocusOption>)}
          </ScrollView>
          {!required && selected.length > 0 ? <FocusOption accessibilityRole="button" accessibilityLabel={`Limpiar ${label}`} onPress={() => { onChange(multiple ? [] : ""); close(); }} ><Text style={styles.text}>Limpiar selección</Text></FocusOption> : null}
          <FocusOption accessibilityRole="button" onPress={close}><Text style={styles.text}>Cerrar</Text></FocusOption>
        </View>
      </View>
    </Modal>
  </View>;
}
function FocusOption({ selected, ...props }: React.ComponentProps<typeof Pressable> & { selected?: boolean }) {
  const [focused, setFocused] = useState(false);
  return <Pressable {...props} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={[styles.option, selected && styles.selected, props.disabled && styles.disabled, focused && styles.focus]} />;
}
const webControl = { backgroundColor: "#fff", border: "1px solid #8795A8", borderRadius: 8, color: "#202B3A", fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif", fontSize: 16, minHeight: 44, padding: "8px 30px 8px 12px", width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box" as const };
const styles = StyleSheet.create({
  wrapper: { minWidth: 0, width: "100%" }, control: { borderColor: "#8795A8", borderWidth: 1, borderRadius: 8, minHeight: 44, padding: 10, justifyContent: "center", backgroundColor: "white" },
  focus: { borderColor: "#315DA8", borderWidth: 3 }, disabled: { opacity: 0.6 }, text: { color: "#202B3A", fontSize: 16 },
  backdrop: { flex: 1, backgroundColor: "rgba(24,38,58,0.25)", justifyContent: "center", alignItems: "center", padding: 20 },
  menu: { width: "100%", maxWidth: 480, maxHeight: "85%", backgroundColor: "white", borderRadius: 10, padding: 12, gap: 8 },
  options: { flexShrink: 1 }, title: { color: "#202B3A", fontSize: 17, fontWeight: "700", padding: 8 }, option: { minHeight: 44, justifyContent: "center", padding: 10, borderRadius: 6 }, selected: { backgroundColor: "#E8EFFA" },
});
