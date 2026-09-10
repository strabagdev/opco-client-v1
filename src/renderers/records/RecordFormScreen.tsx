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
import { CachedEntityRecord, loadRecordWithOfflineCache, loadRecordsWithOfflineCache, saveRecordLocally } from "@/lib/offline-records";
import { EntityDefinition, RecordsAppView } from "@/lib/opco-api";
import { stableSubmitButtonStyle } from "@/lib/visual-stability";
import {
  buildChangedSubmitValues,
  buildInitialFormValues,
  buildSubmitValues,
  extractApiFieldErrors,
  getRelationTargetEntityTypeId,
  getUnknownRelationValueErrors,
  getWritableFields,
  RecordRelationOption,
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

type RelationOptionsState = {
  error: string | null;
  isLoaded: boolean;
  isLoading: boolean;
  options: RecordRelationOption[];
  targetEntityTypeId: string | null;
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
  const [relationOptionsByField, setRelationOptionsByField] = useState<Record<string, RelationOptionsState>>({});
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

  useEffect(() => {
    let isMounted = true;

    async function loadRelationOptions() {
      if (!definition || !token || !selectedContractId || !ownerKey) {
        setRelationOptionsByField({});
        return;
      }

      const relationFields = getWritableFields(definition)
        .filter((field) => field.type === "RELATION")
        .map((field) => ({
          field,
          targetEntityTypeId: getRelationTargetEntityTypeId(field),
        }));

      if (relationFields.length === 0) {
        setRelationOptionsByField({});
        return;
      }

      setRelationOptionsByField(Object.fromEntries(
        relationFields.map(({ field, targetEntityTypeId }) => [
          field.key,
          {
            error: targetEntityTypeId ? null : "Este campo de relacion no tiene un catalogo configurado.",
            isLoaded: false,
            isLoading: Boolean(targetEntityTypeId),
            options: [],
            targetEntityTypeId,
          },
        ]),
      ));

      await Promise.all(relationFields.map(async ({ field, targetEntityTypeId }) => {
        if (!targetEntityTypeId) {
          return;
        }

        try {
          const result = await loadRecordsWithOfflineCache({
            api,
            contractId: selectedContractId,
            direction: "asc",
            entityTypeId: targetEntityTypeId,
            ownerKey,
            page: 1,
            pageSize: 100,
            sort: "displayName",
            store: definitionCache,
            token,
          });
          const options = result.records.map((record) => ({
            displayName: record.displayName || record.id,
            id: record.id,
          }));

          if (isMounted) {
            setRelationOptionsByField((current) => ({
              ...current,
              [field.key]: {
                error: null,
                isLoaded: true,
                isLoading: false,
                options,
                targetEntityTypeId,
              },
            }));
          }
        } catch {
          if (isMounted) {
            setRelationOptionsByField((current) => ({
              ...current,
              [field.key]: {
                error: "No pudimos cargar el catalogo de registros relacionados.",
                isLoaded: false,
                isLoading: false,
                options: [],
                targetEntityTypeId,
              },
            }));
          }
        }
      }));
    }

    void loadRelationOptions();

    return () => {
      isMounted = false;
    };
  }, [api, definition, definitionCache, ownerKey, selectedContractId, token]);

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

    const requiredErrors = {
      ...validateFormFields(fields, values),
      ...getRelationCatalogAvailabilityErrors(fields, values, relationOptionsByField),
      ...getUnknownRelationValueErrors(fields, values, relationOptionsByField),
    };

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
        fields,
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
              relationOptions={relationOptionsByField[field.key]?.options}
              relationOptionsError={relationOptionsByField[field.key]?.error}
              relationOptionsLoading={
                relationOptionsByField[field.key]?.isLoading ??
                (field.type === "RELATION" && Boolean(getRelationTargetEntityTypeId(field)))
              }
              relationTargetEntityTypeId={
                relationOptionsByField[field.key]?.targetEntityTypeId ?? getRelationTargetEntityTypeId(field)
              }
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

function getRelationCatalogAvailabilityErrors(
  fields: ReturnType<typeof getWritableFields>,
  values: RecordFormValues,
  relationOptionsByField: Record<string, RelationOptionsState>,
) {
  return fields.reduce<RecordFormErrors>((errors, field) => {
    if (field.type !== "RELATION") {
      return errors;
    }

    const selected = values[field.key];
    const hasSelectedValue = Array.isArray(selected)
      ? selected.length > 0
      : typeof selected === "string" && selected.trim().length > 0;

    if (!hasSelectedValue) {
      return errors;
    }

    const state = relationOptionsByField[field.key];

    if (!state?.targetEntityTypeId) {
      errors[field.key] = "Este campo de relacion no tiene un catalogo configurado.";
      return errors;
    }

    if (state.isLoading || !state.isLoaded) {
      errors[field.key] = state.error ?? "No pudimos cargar el catalogo de registros relacionados.";
    }

    return errors;
  }, {});
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
