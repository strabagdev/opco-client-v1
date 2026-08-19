import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import {
  composeDateTimeValue,
  datePickerValueFromDate,
  datePickerValueFromTime,
  formatDateInputValue,
  formatTimeInputValue,
  splitDateTimeValue,
} from "@/lib/record-form";

type TemporalFieldInputProps = {
  onChange(value: string): void;
  required: boolean;
  value: string;
};

export function DateFieldInput({ onChange, required, value }: TemporalFieldInputProps) {
  return (
    <NativePickerInput
      clearLabel="Limpiar fecha"
      displayValue={formatHumanDate(value)}
      mode="date"
      onChange={(date) => onChange(formatDateInputValue(date))}
      onClear={() => onChange("")}
      pickerValue={datePickerValueFromDate(value)}
      required={required}
    />
  );
}

export function TimeFieldInput({ onChange, required, value }: TemporalFieldInputProps) {
  return (
    <NativePickerInput
      clearLabel="Limpiar hora"
      displayValue={value || "Seleccionar hora"}
      mode="time"
      onChange={(date) => onChange(formatTimeInputValue(date))}
      onClear={() => onChange("")}
      pickerValue={datePickerValueFromTime(value)}
      required={required}
    />
  );
}

export function DateTimeFieldInput({ onChange, required, value }: TemporalFieldInputProps) {
  const [{ date, time }, setParts] = useState(() => splitDateTimeValue(value));

  function updatePart(nextPart: "date" | "time", nextValue: string) {
    const nextParts = {
      date,
      time,
      [nextPart]: nextValue,
    };

    setParts(nextParts);
    onChange(composeDateTimeValue(nextParts.date, nextParts.time));
  }

  function clear() {
    setParts({ date: "", time: "" });
    onChange("");
  }

  return (
    <View style={styles.dateTimeGroup}>
      <View style={styles.dateTimePart}>
        <Text style={styles.subLabel}>Fecha</Text>
        <DateFieldInput onChange={(nextValue) => updatePart("date", nextValue)} required={required} value={date} />
      </View>
      <View style={styles.dateTimePart}>
        <Text style={styles.subLabel}>Hora</Text>
        <TimeFieldInput onChange={(nextValue) => updatePart("time", nextValue)} required={required} value={time} />
      </View>
      {!required && (date || time || value) ? (
        <Pressable onPress={clear} style={styles.clearButton}>
          <Text style={styles.clearText}>Limpiar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type NativePickerInputProps = {
  clearLabel: string;
  displayValue: string;
  mode: "date" | "time";
  onChange(date: Date): void;
  onClear(): void;
  pickerValue: Date;
  required: boolean;
};

function NativePickerInput({
  clearLabel,
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

    if (event.type === "dismissed" || !selectedDate) {
      return;
    }

    onChange(selectedDate);
  }

  const picker = (
    <DateTimePicker
      display={Platform.OS === "ios" ? "compact" : "default"}
      mode={mode}
      onChange={handlePickerChange}
      value={pickerValue}
    />
  );

  if (Platform.OS === "ios") {
    return (
      <View style={styles.nativeRow}>
        <View style={styles.iosPicker}>{picker}</View>
        {!required && displayValue !== "Seleccionar fecha" && displayValue !== "Seleccionar hora" ? (
          <Pressable accessibilityLabel={clearLabel} onPress={onClear} style={styles.clearButton}>
            <Text style={styles.clearText}>Limpiar</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.nativeRow}>
      <Pressable onPress={() => setShowAndroidPicker(true)} style={styles.nativeButton}>
        <Text style={styles.nativeButtonText}>{displayValue}</Text>
      </Pressable>
      {!required && displayValue !== "Seleccionar fecha" && displayValue !== "Seleccionar hora" ? (
        <Pressable accessibilityLabel={clearLabel} onPress={onClear} style={styles.clearButton}>
          <Text style={styles.clearText}>Limpiar</Text>
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
  iosPicker: {
    justifyContent: "center",
    minHeight: 44,
  },
  nativeButton: {
    borderColor: "#c8d2d5",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 46,
    minWidth: 180,
    paddingHorizontal: 12,
  },
  nativeButtonText: {
    color: "#17363c",
    fontSize: 16,
    fontWeight: "700",
  },
  nativeRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    minHeight: 46,
  },
  subLabel: {
    color: "#587078",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
});
