import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { buildAppViewRecordHref } from "@/lib/app-views";
import { getEntityDefinitionWithCache } from "@/lib/definition-cache";
import { CachedEntityRecord, loadRecordWithOfflineCache, saveRecordLocally } from "@/lib/offline-records";
import { EntityDefinition, EntityField, RecordsAppView } from "@/lib/opco-api";
import { stableSubmitButtonStyle, stableTextInputStyle } from "@/lib/visual-stability";
import {
  buildChangedSubmitValues,
  buildInitialFormValues,
  buildSubmitValues,
  extractApiFieldErrors,
  getWritableFields,
  isFieldUnsupported,
  RecordFormErrors,
  RecordFormValues,
  validateFormFields,
} from "@/lib/record-form";
import { useSession } from "@/state/session";
import { DateFieldInput, DateTimeFieldInput, TimeFieldInput } from "./temporal-input";

type Props = {
  appView: RecordsAppView;
  mode: "create" | "edit";
  recordId?: string;
};

export function RecordFormScreen({ appView, mode, recordId }: Props) {
  const entityTypeId = appView.config.entityTypeId;
  const { api, definitionCache, localDatabaseStorageState, ownerKey, selectedContractId, syncPendingRecords, token } =
    useSession();
  const [definition, setDefinition] = useState<EntityDefinition | null>(null);
  const [record, setRecord] = useState<CachedEntityRecord | null>(null);
  const [initialValues, setInitialValues] = useState<RecordFormValues>({});
  const [values, setValues] = useState<RecordFormValues>({});
  const [fieldErrors, setFieldErrors] = useState<RecordFormErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const fields = useMemo(() => (definition ? getWritableFields(definition) : []), [definition]);
  const title = mode === "create" ? `Crear en ${appView.name}` : `Editar ${record?.displayName ?? "registro"}`;

  useEffect(() => {
    let isMounted = true;

    async function loadForm() {
      if (!token || !selectedContractId || !entityTypeId || !ownerKey) {
        setError("Selecciona un contrato antes de abrir el formulario.");
        setIsLoading(false);
        return;
      }

      if (mode === "edit" && !recordId) {
        setError("No se encontro el registro a editar.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      setFieldErrors({});

      try {
        const definitionResult = await getEntityDefinitionWithCache({
          api,
          cache: definitionCache,
          contractId: selectedContractId,
          entityTypeId,
          token,
        });
        const recordResult =
          mode === "edit" && recordId
            ? await loadRecordWithOfflineCache({
                api,
                contractId: selectedContractId,
                entityTypeId,
                ownerKey,
                recordId,
                store: definitionCache,
                token,
              })
            : null;
        const nextValues = buildInitialFormValues(definitionResult.definition, recordResult?.record?.values);

        if (isMounted) {
          setDefinition(definitionResult.definition);
          setRecord(recordResult?.record ?? null);
          setInitialValues(nextValues);
          setValues(nextValues);
        }
      } catch (nextError) {
        if (isMounted) {
          setError(nextError instanceof Error ? nextError.message : "No fue posible cargar el formulario.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadForm();

    return () => {
      isMounted = false;
    };
  }, [api, definitionCache, entityTypeId, mode, ownerKey, recordId, retryCount, selectedContractId, token]);

  function setFieldValue(key: string, value: string | boolean | string[]) {
    setValues((current) => ({
      ...current,
      [key]: value,
    }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[key];

      return next;
    });
  }

  async function handleSubmit() {
    if (!definition || !token || !selectedContractId || !ownerKey) {
      return;
    }

    if (localDatabaseStorageState.status !== "ready") {
      setError("No pudimos acceder a los datos locales. Reintenta desde la pantalla de almacenamiento.");
      return;
    }

    const requiredErrors = validateFormFields(fields, values);

    if (Object.keys(requiredErrors).length > 0) {
      setFieldErrors(requiredErrors);
      return;
    }

    const submitValues =
      mode === "edit" ? buildChangedSubmitValues(fields, initialValues, values) : buildSubmitValues(fields, values);

    if (mode === "edit" && Object.keys(submitValues).length === 0) {
      setError("No hay cambios para guardar.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      const localRecord = await saveRecordLocally({
        contractId: selectedContractId,
        entityTypeId,
        mode,
        ownerKey,
        recordId,
        store: definitionCache,
        values: submitValues,
      });

      void syncPendingRecords();
      router.replace(buildAppViewRecordHref(appView.id, localRecord.id));
    } catch (nextError) {
      const nextFieldErrors = extractApiFieldErrors(nextError);

      if (Object.keys(nextFieldErrors).length > 0) {
        setFieldErrors(nextFieldErrors);
      }

      setError(nextError instanceof Error ? nextError.message : "No fue posible guardar el registro.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.kicker}>{appView.name}</Text>
        <Text style={styles.title}>{title}</Text>
        {definition ? <Text style={styles.meta}>{definition.name}</Text> : null}
      </View>

      {isLoading ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {error && !definition ? (
        <Pressable onPress={() => setRetryCount((count) => count + 1)} style={styles.primaryButton}>
          <Text style={styles.primaryText}>Reintentar</Text>
        </Pressable>
      ) : null}

      {definition ? (
        <View style={styles.form}>
          {fields.map((field) => (
            <RecordFieldInput
              error={fieldErrors[field.key]}
              field={field}
              key={field.key}
              onChange={(value) => setFieldValue(field.key, value)}
              value={values[field.key]}
            />
          ))}
        </View>
      ) : null}

      {definition ? (
        <View style={styles.actions}>
          <Pressable onPress={() => router.back()} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>Volver</Text>
          </Pressable>
          <Pressable disabled={isSubmitting} onPress={handleSubmit} style={styles.primaryButton}>
            {isSubmitting ? (
              <View style={styles.buttonContent}>
                <ActivityIndicator color="#ffffff" />
                <Text style={styles.primaryText}>Guardando</Text>
              </View>
            ) : (
              <Text style={styles.primaryText}>Guardar</Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

type FieldInputProps = {
  error?: string;
  field: EntityField;
  onChange(value: string | boolean | string[]): void;
  value: string | boolean | string[] | undefined;
};

function RecordFieldInput({ error, field, onChange, value }: FieldInputProps) {
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
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  buttonContent: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 36,
  },
  error: {
    color: "#b42318",
    lineHeight: 20,
  },
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
  form: {
    gap: 12,
  },
  header: {
    gap: 4,
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
  kicker: {
    color: "#587078",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  label: {
    color: "#17363c",
    fontSize: 15,
    fontWeight: "800",
  },
  meta: {
    color: "#587078",
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
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#135d66",
    borderRadius: 8,
    justifyContent: "center",
    ...stableSubmitButtonStyle,
    paddingHorizontal: 16,
  },
  primaryText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
  },
  screen: {
    backgroundColor: "#eef4f4",
    flex: 1,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: "#b8c7ca",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  secondaryText: {
    color: "#17363c",
    fontSize: 16,
    fontWeight: "800",
  },
  textarea: {
    minHeight: 110,
    paddingTop: 12,
    textAlignVertical: "top",
  },
  title: {
    color: "#0f3036",
    fontSize: 26,
    fontWeight: "800",
  },
  unsupported: {
    color: "#587078",
    lineHeight: 20,
  },
});
