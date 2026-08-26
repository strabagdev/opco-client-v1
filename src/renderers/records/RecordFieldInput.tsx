import { Text, TextInput, Pressable, StyleSheet, View } from "react-native";

import { stableTextInputStyle } from "@/lib/visual-stability";
import { EntityField } from "@/lib/opco-api";
import { isFieldUnsupported } from "@/lib/record-form";

import { DateFieldInput, DateTimeFieldInput, TimeFieldInput } from "./temporal-input";

type FieldInputProps = {
  error?: string;
  field: EntityField;
  onChange(value: string | boolean | string[]): void;
  value: string | boolean | string[] | undefined;
};

export function RecordFieldInput({ error, field, onChange, value }: FieldInputProps) {
  if (isFieldUnsupported(field)) {
    return (
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{field.name}</Text>
        <Text style={styles.unsupported}>Este tipo de campo todavia no se puede editar: {field.type}.</Text>
      </View>
    );
  }

  if (field.type === "BOOLEAN") {
    const selected = value === true;

    return (
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{field.name}</Text>
        <Pressable
          onPress={() => onChange(!selected)}
          style={[styles.optionButton, selected && styles.optionButtonSelected]}
        >
          <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{selected ? "Si" : "No"}</Text>
        </Pressable>
        <FieldError error={error} />
      </View>
    );
  }

  if (field.type === "SELECT" || field.type === "MULTISELECT") {
    const selectedValues = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
    const isMultiple = field.type === "MULTISELECT";

    return (
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{field.name}</Text>
        <View style={styles.optionList}>
          {(field.options ?? [])
            .filter((option) => option.active !== false)
            .sort((a, b) => a.order - b.order)
            .map((option) => {
              const selected = selectedValues.includes(option.value);

              return (
                <Pressable
                  key={option.id}
                  onPress={() => {
                    if (isMultiple) {
                      onChange(
                        selected
                          ? selectedValues.filter((item) => item !== option.value)
                          : [...selectedValues, option.value],
                      );
                    } else {
                      onChange(selected ? "" : option.value);
                    }
                  }}
                  style={[styles.optionButton, selected && styles.optionButtonSelected]}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
                </Pressable>
              );
            })}
        </View>
        <FieldError error={error} />
      </View>
    );
  }

  const textValue = Array.isArray(value) ? value.join(", ") : typeof value === "boolean" ? "" : value ?? "";

  if (field.type === "DATE" || field.type === "TIME" || field.type === "DATETIME") {
    return (
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{field.name}</Text>
        {field.type === "DATE" ? (
          <DateFieldInput onChange={onChange} required={field.required} value={textValue} />
        ) : null}
        {field.type === "TIME" ? (
          <TimeFieldInput onChange={onChange} required={field.required} value={textValue} />
        ) : null}
        {field.type === "DATETIME" ? (
          <DateTimeFieldInput onChange={onChange} required={field.required} value={textValue} />
        ) : null}
        <FieldError error={error} />
      </View>
    );
  }

  const multiline = field.type === "TEXTAREA";

  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{field.name}</Text>
      <TextInput
        autoCapitalize="none"
        keyboardType={getKeyboardType(field.type)}
        multiline={multiline}
        onChangeText={(nextValue) => {
          if (field.type === "RELATION" && field.multiple) {
            onChange(
              nextValue
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean),
            );
            return;
          }

          onChange(nextValue);
        }}
        placeholder={getPlaceholder(field)}
        style={[styles.input, multiline && styles.textarea]}
        value={textValue}
      />
      {field.type === "RELATION" ? <Text style={styles.help}>Ingresa el id del registro relacionado.</Text> : null}
      <FieldError error={error} />
    </View>
  );
}

function FieldError({ error }: { error?: string }) {
  return error ? <Text style={styles.fieldError}>{error}</Text> : null;
}

function getKeyboardType(fieldType: EntityField["type"]) {
  if (fieldType === "INTEGER" || fieldType === "DECIMAL" || fieldType === "MONEY") {
    return "numeric";
  }

  return "default";
}

function getPlaceholder(field: EntityField) {
  if (field.type === "RELATION" && field.multiple) {
    return "ids separados por coma";
  }

  return field.required ? "Obligatorio" : "";
}

const styles = StyleSheet.create({
  fieldError: {
    color: "#b42318",
    fontSize: 14,
    lineHeight: 20,
    minHeight: 20,
  },
  fieldGroup: {
    backgroundColor: "#ffffff",
    borderColor: "#d4dddf",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  help: {
    color: "#587078",
    lineHeight: 20,
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
  label: {
    color: "#17363c",
    fontSize: 15,
    fontWeight: "800",
  },
  optionButton: {
    borderColor: "#b8c7ca",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionButtonSelected: {
    backgroundColor: "#135d66",
    borderColor: "#135d66",
  },
  optionList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionText: {
    color: "#17363c",
    fontSize: 16,
    fontWeight: "700",
  },
  optionTextSelected: {
    color: "#ffffff",
  },
  textarea: {
    minHeight: 110,
    paddingTop: 12,
    textAlignVertical: "top",
  },
  unsupported: {
    color: "#587078",
    lineHeight: 20,
  },
});
