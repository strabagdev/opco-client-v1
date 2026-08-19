import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { composeDateTimeValue, splitDateTimeValue } from "@/lib/record-form";
import { stableTextInputStyle } from "@/lib/visual-stability";

type TemporalFieldInputProps = {
  onChange(value: string): void;
  required: boolean;
  value: string;
};

export function DateFieldInput({ onChange, required, value }: TemporalFieldInputProps) {
  return <TemporalWebInput onChange={onChange} required={required} type="date" value={value} />;
}

export function TimeFieldInput({ onChange, required, value }: TemporalFieldInputProps) {
  return <TemporalWebInput onChange={onChange} required={required} step={60} type="time" value={value} />;
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

export function getTemporalWebInputProps(type: "date" | "time") {
  return type === "time" ? { step: 60, type } : { type };
}

type TemporalWebInputProps = {
  onChange(value: string): void;
  required: boolean;
  step?: number;
  type: "date" | "time";
  value: string;
};

function TemporalWebInput({ onChange, required, step, type, value }: TemporalWebInputProps) {
  return (
    <View style={styles.webInputRow}>
      <TextInput
        onChangeText={onChange}
        style={styles.input}
        value={value}
        {...getTemporalWebInputProps(type)}
        {...(step ? { step } : {})}
      />
      {!required && value ? (
        <Pressable onPress={() => onChange("")} style={styles.clearButton}>
          <Text style={styles.clearText}>Limpiar</Text>
        </Pressable>
      ) : null}
    </View>
  );
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
