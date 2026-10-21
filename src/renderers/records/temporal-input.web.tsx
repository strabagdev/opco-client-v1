import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { composeDateTimeValue, splitDateTimeValue } from "../../lib/record-form";
import { stableTextInputStyle } from "../../lib/visual-stability";
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

export function DateTimeFieldInput({ onChange, required, value, label, disabled }: TemporalFieldInputProps) {
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
        <Text style={styles.subLabel}>Fecha</Text>
        <DateFieldInput label={label ? `${label}: fecha` : "Fecha"} disabled={disabled} onChange={(nextValue) => updatePart("date", nextValue)} required={required} value={date} />
      </View>
      <View style={styles.dateTimePart}>
        <Text style={styles.subLabel}>Hora</Text>
        <TimeFieldInput label={label ? `${label}: hora` : "Hora"} disabled={disabled} onChange={(nextValue) => updatePart("time", nextValue)} required={required} value={time} />
      </View>
      {!required && (date || time || value) ? (
        <ClearButton accessibilityRole="button" accessibilityLabel={`Limpiar ${label ?? "fecha y hora"}`} disabled={disabled} onPress={clear} style={styles.clearButton}>
          <Text style={styles.clearText}>Limpiar</Text>
        </ClearButton>
      ) : null}
    </View>
  );
}

export function getTemporalWebInputProps(type: "date" | "time") {
  return type === "time" ? { step: 60, type } : { type };
}

type TemporalWebInputProps = TemporalFieldInputProps & { step?: number; type: "date" | "time" | "month" };

function TemporalWebInput({ onChange, required, step, type, value, label, disabled, min, max }: TemporalWebInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.webInputRow}>
      <input aria-label={label ?? (type === "time" ? "Hora" : type === "month" ? "Mes" : "Fecha")}
        type={type} value={value} required={required} disabled={disabled} min={min} max={max} step={step}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChange={event => { const next = event.target.value; if (temporalSelectionAllowed(next, { required, min, max })) onChange(next); else event.currentTarget.value = value; }}
        style={{ background: "white", border: "1px solid #8795A8", borderRadius: 8, color: "#202B3A", minHeight: 44, padding: "8px 12px", fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif", fontSize: 16, minWidth: 0, width: "100%", boxSizing: "border-box", opacity: disabled ? 0.6 : 1, outline: focused ? "3px solid #315DA8" : undefined, outlineOffset: 2 }} />
      {!required && value ? (
        <ClearButton accessibilityRole="button" accessibilityLabel={`Limpiar ${label ?? (type === "time" ? "hora" : "fecha")}`} disabled={disabled} onPress={() => onChange("")} style={styles.clearButton}>
          <Text style={styles.clearText}>Limpiar</Text>
        </ClearButton>
      ) : null}
    </View>
  );
}

function ClearButton(props: React.ComponentProps<typeof Pressable>) {
  const [focused, setFocused] = useState(false);
  return <Pressable {...props} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={[styles.clearButton, focused && { borderColor: "#315DA8", borderWidth: 3 }, props.disabled && { opacity: 0.6 }]} />;
}

const styles = StyleSheet.create({
  clearButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderColor: "#b8c7ca",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 12,
  },
  clearText: {
    color: "#17363c",
    fontSize: 15,
    fontWeight: "700",
  },
  dateTimeGroup: {
    gap: 10,
  },
  dateTimePart: {
    gap: 6,
  },
  input: {
    borderColor: "#c8d2d5",
    borderRadius: 8,
    borderWidth: 1,
    color: "#17363c",
    ...stableTextInputStyle,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  subLabel: {
    color: "#587078",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  webInputRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    minHeight: 46,
  },
});
