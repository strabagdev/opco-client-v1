import { useId, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { composeDateTimeValue, splitDateTimeValue } from "../../lib/record-form";
import { metrics, space, typography } from "../../theme/tokens";
import { colors, focusStyle } from "../../theme/paint";
import { controlFrame, controlText, webFieldStyle } from "../../theme/control-presentation";
import { logicalDatePickerValue, temporalSelectionAllowed, type TemporalFieldInputProps } from "./temporal-input.types";

export function DateFieldInput(props: TemporalFieldInputProps) {
  return <TemporalWebInput {...props} value={logicalDatePickerValue(props.value)} type="date" />;
}

export function MonthFieldInput(props: TemporalFieldInputProps) {
  return <TemporalWebInput {...props} type="month" />;
}

export function TimeFieldInput(props: TemporalFieldInputProps) {
  return <TemporalWebInput {...props} step={60} type="time" />;
}

export function DateTimeFieldInput({ onChange, required, value, label, disabled, controlId, labelledBy, describedBy, invalid }: TemporalFieldInputProps) {
  const partLabelId = useId();
  const [draft, setParts] = useState(() => ({ source: value, ...splitDateTimeValue(value) }));
  const { date, time } = draft.source === value ? draft : splitDateTimeValue(value);

  function updatePart(nextPart: "date" | "time", nextValue: string) {
    const nextParts = {
      date,
      time,
      [nextPart]: nextValue,
    };

    const composedValue = composeDateTimeValue(nextParts.date, nextParts.time);
    setParts({ source: composedValue, ...nextParts });
    onChange(composedValue);
  }

  function clear() {
    setParts({ source: "", date: "", time: "" });
    onChange("");
  }

  return (
    <View style={styles.dateTimeGroup}>
      <View style={styles.dateTimePart}>
        <Text nativeID={`${partLabelId}-date`} style={styles.subLabel}>Fecha</Text>
        <DateFieldInput labelledBy={[labelledBy, `${partLabelId}-date`].filter(Boolean).join(" ")} controlId={controlId ? `${controlId}-date` : undefined} describedBy={describedBy} invalid={invalid} label={label ? `${label}: fecha` : "Fecha"} disabled={disabled} onChange={(nextValue) => updatePart("date", nextValue)} required={required} value={date} />
      </View>
      <View style={styles.dateTimePart}>
        <Text nativeID={`${partLabelId}-time`} style={styles.subLabel}>Hora</Text>
        <TimeFieldInput labelledBy={[labelledBy, `${partLabelId}-time`].filter(Boolean).join(" ")} controlId={controlId ? `${controlId}-time` : undefined} describedBy={describedBy} invalid={invalid} label={label ? `${label}: hora` : "Hora"} disabled={disabled} onChange={(nextValue) => updatePart("time", nextValue)} required={required} value={time} />
      </View>
      {!required && (date || time || value) ? (
        <ClearButton accessibilityRole="button" accessibilityLabel={`Limpiar ${label ?? "fecha y hora"}`} disabled={disabled} onPress={clear} style={styles.clearButton}>
          <Text style={[styles.clearText, disabled && styles.disabledText]}>Limpiar</Text>
        </ClearButton>
      ) : null}
    </View>
  );
}

export function getTemporalWebInputProps(type: "date" | "time") {
  return type === "time" ? { step: 60, type } : { type };
}

type TemporalWebInputProps = TemporalFieldInputProps & { step?: number; type: "date" | "time" | "month" };

function TemporalWebInput({ onChange, required, step, type, value, label, disabled, min, max, controlId, labelledBy, describedBy, invalid }: TemporalWebInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.webInputRow}>
      <input id={controlId} aria-labelledby={labelledBy} aria-describedby={describedBy} aria-invalid={invalid} aria-label={label ?? (type === "time" ? "Hora" : type === "month" ? "Mes" : "Fecha")}
        type={type} value={value} required={required} disabled={disabled} min={min} max={max} step={step}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChange={event => { const next = event.target.value; if (temporalSelectionAllowed(next, { required, min, max })) onChange(next); else event.currentTarget.value = value; }}
        style={webFieldStyle(disabled, invalid, focused)} />
      {!required && value ? (
        <ClearButton accessibilityRole="button" accessibilityLabel={`Limpiar ${label ?? (type === "time" ? "hora" : "fecha")}`} disabled={disabled} onPress={() => onChange("")} style={styles.clearButton}>
          <Text style={[styles.clearText, disabled && styles.disabledText]}>Limpiar</Text>
        </ClearButton>
      ) : null}
    </View>
  );
}

function ClearButton(props: React.ComponentProps<typeof Pressable>) {
  const [focused, setFocused] = useState(false);
  return <Pressable {...props} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={[styles.clearButton, focused && focusStyle, props.disabled && styles.disabled]} />;
}

const styles = StyleSheet.create({
  clearButton: { ...controlFrame, alignItems: "center", alignSelf: "flex-start", borderColor: colors.controlBorder, backgroundColor: colors.surface, justifyContent: "center" },
  clearText: { color: colors.onSecondary, ...typography.label },
  disabled: { backgroundColor: colors.disabled, borderColor: colors.disabledBorder }, disabledText: { color: colors.onDisabled },
  dateTimeGroup: { gap: space.md }, dateTimePart: { gap: space.sm },
  input: { ...controlFrame, ...controlText, borderColor: colors.controlBorder, color: colors.text },
  subLabel: { color: colors.textSecondary, ...typography.meta, fontWeight: "600", textTransform: "uppercase" },
  webInputRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: space.sm, minHeight: metrics.controlMinHeight },
});
