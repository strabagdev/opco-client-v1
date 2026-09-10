import { useMemo, useState } from "react";
import { Text, TextInput, Pressable, StyleSheet, View } from "react-native";

import { stableTextInputStyle } from "@/lib/visual-stability";
import { EntityField } from "@/lib/opco-api";
import { isFieldUnsupported, isRelationFieldMultiple, RecordRelationOption } from "@/lib/record-form";

import { DateFieldInput, DateTimeFieldInput, TimeFieldInput } from "./temporal-input";

type FieldInputProps = {
  error?: string;
  field: EntityField;
  onChange(value: string | boolean | string[]): void;
  relationOptions?: RecordRelationOption[];
  relationOptionsError?: string | null;
  relationOptionsLoading?: boolean;
  relationTargetEntityTypeId?: string | null;
  value: string | boolean | string[] | undefined;
};

export function RecordFieldInput({
  error,
  field,
  onChange,
  relationOptions = [],
  relationOptionsError = null,
  relationOptionsLoading = false,
  relationTargetEntityTypeId = null,
  value,
}: FieldInputProps) {
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

  if (field.type === "RELATION") {
    return (
      <RelationFieldInput
        error={error}
        field={field}
        onChange={onChange}
        options={relationOptions}
        optionsError={relationOptionsError}
        optionsLoading={relationOptionsLoading}
        targetEntityTypeId={relationTargetEntityTypeId}
        value={value}
      />
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
          onChange(nextValue);
        }}
        placeholder={getPlaceholder(field)}
        style={[styles.input, multiline && styles.textarea]}
        value={textValue}
      />
      <FieldError error={error} />
    </View>
  );
}

function RelationFieldInput({
  error,
  field,
  onChange,
  options,
  optionsError,
  optionsLoading,
  targetEntityTypeId,
  value,
}: {
  error?: string;
  field: EntityField;
  onChange(value: string | boolean | string[]): void;
  options: RecordRelationOption[];
  optionsError: string | null;
  optionsLoading: boolean;
  targetEntityTypeId: string | null;
  value: string | boolean | string[] | undefined;
}) {
  const [search, setSearch] = useState("");
  const isMultiple = isRelationFieldMultiple(field);
  const selectedValues = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
  const optionIds = useMemo(() => new Set(options.map((option) => option.id)), [options]);
  const unknownValues = selectedValues.filter((item) => !optionIds.has(item));
  const normalizedSearch = search.trim().toLocaleLowerCase("es-CL");
  const filteredOptions = useMemo(
    () =>
      normalizedSearch
        ? options.filter((option) =>
            option.displayName.toLocaleLowerCase("es-CL").includes(normalizedSearch) ||
            option.id.toLocaleLowerCase("es-CL").includes(normalizedSearch)
          )
        : options,
    [normalizedSearch, options],
  );

  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{field.name}</Text>
      {targetEntityTypeId ? (
        <>
          <TextInput
            autoCapitalize="none"
            onChangeText={setSearch}
            placeholder="Buscar en catalogo"
            style={styles.input}
            value={search}
          />
          {optionsLoading ? <Text style={styles.help}>Cargando catalogo...</Text> : null}
          {optionsError ? <Text style={styles.fieldError}>{optionsError}</Text> : null}
          {unknownValues.length > 0 ? (
            <Text style={styles.fieldError}>
              El valor guardado no corresponde a un registro disponible del catalogo. Selecciona un registro valido para conservar el cambio y reintentar.
            </Text>
          ) : null}
          {!optionsLoading && !optionsError && options.length === 0 ? (
            <Text style={styles.fieldError}>No hay registros disponibles en el catalogo para seleccionar.</Text>
          ) : null}
          <View style={styles.optionList}>
            {filteredOptions.map((option) => {
              const selected = selectedValues.includes(option.id);

              return (
                <Pressable
                  key={option.id}
                  onPress={() => {
                    if (isMultiple) {
                      onChange(
                        selected
                          ? selectedValues.filter((item) => item !== option.id)
                          : [...selectedValues.filter((item) => optionIds.has(item)), option.id],
                      );
                    } else {
                      onChange(selected ? "" : option.id);
                    }
                  }}
                  style={[styles.optionButton, selected && styles.optionButtonSelected]}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.displayName}</Text>
                </Pressable>
              );
            })}
          </View>
          {selectedValues.length > 0 ? (
            <Pressable
              onPress={() => onChange(isMultiple ? [] : "")}
              style={styles.clearButton}
            >
              <Text style={styles.clearButtonText}>Limpiar seleccion</Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <Text style={styles.fieldError}>Este campo de relacion no tiene un catalogo configurado.</Text>
      )}
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
  clearButton: {
    alignSelf: "flex-start",
    borderColor: "#b8c7ca",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  clearButtonText: {
    color: "#17363c",
    fontSize: 14,
    fontWeight: "800",
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
