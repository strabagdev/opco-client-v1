import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { metrics, space, typography } from "../../theme/tokens";
import { colors } from "../../theme/paint";
import { controlFrame } from "../../theme/control-presentation";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import {
  composeDateTimeValue,
  datePickerValueFromDate,
  datePickerValueFromTime,
  formatDateInputValue,
  formatTimeInputValue,
  splitDateTimeValue,
} from "../../lib/record-form";

import { logicalDatePickerValue, temporalSelectionAllowed, type TemporalFieldInputProps } from "./temporal-input.types";

export function DateFieldInput({ onChange, required, value, label, disabled, min, max }: TemporalFieldInputProps) {
  return (
    <NativePickerInput
      clearLabel="Limpiar fecha"
      label={label ?? "Fecha"} disabled={disabled} min={min} max={max}
      displayValue={formatHumanDate(logicalDatePickerValue(value))}
      mode="date"
      onChange={(date) => { const next = formatDateInputValue(date); if (temporalSelectionAllowed(next, { required, min, max })) onChange(next); }}
      onClear={() => onChange("")}
      pickerValue={datePickerValueFromDate(logicalDatePickerValue(value))}
      required={required}
    />
  );
}

export function MonthFieldInput(props: TemporalFieldInputProps) {
  return <DateFieldInput {...props} label={props.label ?? "Mes"} value={props.value ? `${props.value}-01` : ""} onChange={value => props.onChange(value.slice(0, 7))} />;
}

export function TimeFieldInput({ onChange, required, value, label, disabled }: TemporalFieldInputProps) {
  return (
    <NativePickerInput
      clearLabel="Limpiar hora" label={label ?? "Hora"} disabled={disabled}
      displayValue={value || "Seleccionar hora"}
      mode="time"
      onChange={(date) => onChange(formatTimeInputValue(date))}
      onClear={() => onChange("")}
      pickerValue={datePickerValueFromTime(value)}
      required={required}
    />
  );
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
        <Pressable accessibilityRole="button" accessibilityLabel={`Limpiar ${label ?? "fecha y hora"}`} disabled={disabled} onPress={clear} style={[styles.clearButton, disabled && styles.disabled]}>
          <Text style={[styles.clearText, disabled && styles.disabledText]}>Limpiar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type NativePickerInputProps = {
  clearLabel: string;
  label?: string; disabled?: boolean; min?: string; max?: string;
  displayValue: string;
  mode: "date" | "time";
  onChange(date: Date): void;
  onClear(): void;
  pickerValue: Date;
  required: boolean;
};

function NativePickerInput({
  clearLabel,
  label, disabled, min, max,
  displayValue,
  mode,
  onChange,
  onClear,
  pickerValue,
  required,
}: NativePickerInputProps) {
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);

  function handlePickerChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (Platform.OS === "android") {
      setShowAndroidPicker(false);
    }

    if (disabled || event.type === "dismissed" || !selectedDate) {
      return;
    }

    onChange(selectedDate);
  }

  const picker = (
    <DateTimePicker
      accessibilityLabel={label}
      disabled={disabled}
      minimumDate={min ? datePickerValueFromDate(min) : undefined}
      maximumDate={max ? datePickerValueFromDate(max) : undefined}
      display={Platform.OS === "ios" ? "compact" : "default"}
      mode={mode}
      onChange={handlePickerChange}
      value={pickerValue}
    />
  );

  if (Platform.OS === "ios") {
    return (
      <View style={styles.nativeRow}>
        <View style={[styles.iosPicker, disabled && styles.disabled]}>{picker}</View>
        {!required && displayValue !== "Seleccionar fecha" && displayValue !== "Seleccionar hora" ? (
          <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={clearLabel} onPress={onClear} style={[styles.clearButton, disabled && styles.disabled]}>
            <Text style={[styles.clearText, disabled && styles.disabledText]}>Limpiar</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.nativeRow}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={() => setShowAndroidPicker(true)} style={[styles.nativeButton, disabled && styles.disabled]}>
        <Text style={[styles.nativeButtonText, disabled && styles.disabledText]}>{displayValue}</Text>
      </Pressable>
      {!required && displayValue !== "Seleccionar fecha" && displayValue !== "Seleccionar hora" ? (
        <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={clearLabel} onPress={onClear} style={[styles.clearButton, disabled && styles.disabled]}>
          <Text style={[styles.clearText, disabled && styles.disabledText]}>Limpiar</Text>
        </Pressable>
      ) : null}
      {showAndroidPicker ? picker : null}
    </View>
  );
}

function formatHumanDate(value: string) {
  const date = datePickerValueFromDate(value);

  if (!value) {
    return "Seleccionar fecha";
  }

  return date.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const styles = StyleSheet.create({
  clearButton: { ...controlFrame, alignItems: "center", alignSelf: "flex-start", borderColor: colors.controlBorder, backgroundColor: colors.surface, justifyContent: "center" },
  clearText: { color: colors.onSecondary, ...typography.label },
  dateTimeGroup: { gap: space.md }, dateTimePart: { gap: space.sm },
  disabled: { backgroundColor: colors.disabled, borderColor: colors.disabledBorder }, disabledText: { color: colors.onDisabled },
  iosPicker: { justifyContent: "center", minHeight: metrics.controlMinHeight },
  nativeButton: { ...controlFrame, borderColor: colors.controlBorder, backgroundColor: colors.surface, justifyContent: "center", minWidth: 180 },
  nativeButtonText: { color: colors.text, ...typography.control },
  nativeRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: space.sm, minHeight: metrics.controlMinHeight },
  subLabel: { color: colors.textSecondary, ...typography.meta, fontWeight: "600", textTransform: "uppercase" },
});
