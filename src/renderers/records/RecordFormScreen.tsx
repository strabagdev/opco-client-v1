import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { buildAppViewRecordHref } from "@/lib/app-views";
import { getEntityDefinitionWithCache } from "@/lib/definition-cache";
import { CachedEntityRecord, loadRecordWithOfflineCache, saveRecordLocally } from "@/lib/offline-records";
import { EntityDefinition, RecordsAppView } from "@/lib/opco-api";
import { stableSubmitButtonStyle } from "@/lib/visual-stability";
import {
  buildChangedSubmitValues,
  buildInitialFormValues,
  buildSubmitValues,
  extractApiFieldErrors,
  getWritableFields,
  RecordFormErrors,
  RecordFormValues,
  validateFormFields,
} from "@/lib/record-form";
import { useSession } from "@/state/session";
import { RecordFieldInput } from "./RecordFieldInput";

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
  form: {
    gap: 12,
  },
  header: {
    gap: 4,
  },
  kicker: {
    color: "#587078",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  meta: {
    color: "#587078",
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
  title: {
    color: "#0f3036",
    fontSize: 26,
    fontWeight: "800",
  },
});
