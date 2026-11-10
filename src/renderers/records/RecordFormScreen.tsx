import { type ThemeColors } from "../../theme/tokens";
import { colors } from "../../theme/paint";
import { FormActions, FormAction } from "@/components/form-actions";
import { FormLayout, FormGrid } from "@/components/form-layout";
import { ReadLoadingState } from "@/components/read-loading-indicator";
import { useExperienceActivityReporter } from "@/renderers/use-experience-activity";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { buildAppViewRecordHref } from "@/lib/app-views";
import { getEntityDefinitionWithCache } from "@/lib/definition-cache";
import { CachedEntityRecord, loadRecordWithOfflineCache, loadRecordsWithOfflineCache, saveRecordLocally } from "@/lib/offline-records";
import {
  getPreventiveUniqueFields,
  isUniqueValidationResultCurrent,
  validateUniqueFieldsBeforeSave,
  UniqueValidationResult,
} from "@/lib/offline-unique-validation";
import { EntityDefinition, EntityRecordValue, RecordsAppView } from "@/lib/opco-api";
import { reportWriteFeedback } from "@/lib/write-feedback";
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
  const { api, connectivityStatus, definitionCache, localDatabaseStorageState, ownerKey, selectedContractId, syncPendingRecords, token } =
    useSession();
  const [definition, setDefinition] = useState<EntityDefinition | null>(null);
  const [record, setRecord] = useState<CachedEntityRecord | null>(null);
  const [initialValues, setInitialValues] = useState<RecordFormValues>({});
  const [values, setValues] = useState<RecordFormValues>({});
  const [fieldErrors, setFieldErrors] = useState<RecordFormErrors>({});
  const [relationOptionsByField, setRelationOptionsByField] = useState<Record<string, RelationOptionsState>>({});
  const [error, setError] = useState<string | null>(null);
  const [uniqueNotice, setUniqueNotice] = useState<string | null>(null);
  const [checkingUniqueFieldKey, setCheckingUniqueFieldKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const latestValuesRef = useRef(values);

  const fields = useMemo(() => (definition ? getWritableFields(definition) : []), [definition]);
  const reading = Number(isLoading) + fields.filter(field => relationOptionsByField[field.key]?.isLoading).length + Number(Boolean(checkingUniqueFieldKey) && !isSubmitting);
  useExperienceActivityReporter(appView, {
    activeCount: reading + Number(isSubmitting), readCount: reading,
    readMode: definition ? "refresh" : "initial", errorCode: error ? "RECORDS_FORM_FAILED" : null,
    result: error ? "error" : reading === 0 && !isSubmitting ? "success" : null,
  });
  const operationLabel = mode === "create" ? "Crear registro" : `Editar ${record?.displayName ?? "registro"}`;

  useEffect(() => {
    latestValuesRef.current = values;
  }, [values]);

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
    setUniqueNotice(null);
  }

  async function validateUniqueValues(
    submitValues: Record<string, EntityRecordValue | undefined>,
  ): Promise<UniqueValidationResult> {
    if (!token || !selectedContractId || !ownerKey) {
      return { reason: "REMOTE_VALIDATION_FAILED", status: "inconclusive" };
    }

    return validateUniqueFieldsBeforeSave({
      api,
      connectivityStatus,
      contractId: selectedContractId,
      entityTypeId,
      fields,
      localRecordId: mode === "edit" ? recordId ?? record?.localId ?? null : null,
      ownerKey,
      serverRecordId: mode === "edit" ? record?.serverId ?? null : null,
      store: definitionCache,
      token,
      values: submitValues,
    });
  }

  async function validateUniqueFieldOnBlur(fieldKey: string) {
    const field = getPreventiveUniqueFields(fields).find((item) => item.key === fieldKey);

    if (!field || !token || !selectedContractId || !ownerKey || isSubmitting) {
      return;
    }

    const capturedValue = values[fieldKey];

    if (mode === "edit" && JSON.stringify(capturedValue) === JSON.stringify(initialValues[fieldKey])) {
      return;
    }

    setCheckingUniqueFieldKey(fieldKey);
    setUniqueNotice(null);

    try {
      const result = await validateUniqueValues({ [fieldKey]: capturedValue });

      if (!isUniqueValidationResultCurrent(latestValuesRef.current[fieldKey], capturedValue)) {
        return;
      }

      if (result.status === "conflict") {
        setFieldErrors((current) => ({
          ...current,
          [fieldKey]: result.conflicts[0]?.message ?? "Este valor ya existe en otro registro.",
        }));
        return;
      }

      if (result.status === "inconclusive") {
        setUniqueNotice(uniqueValidationNotice(result));
      }
    } finally {
      setCheckingUniqueFieldKey(null);
    }
  }

  async function handleSubmit() {
    if (isSubmitting) {
      return;
    }

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
    setUniqueNotice(null);

    try {
      const uniqueResult = await validateUniqueValues(submitValues);

      if (uniqueResult.status === "conflict") {
        setFieldErrors(uniqueConflictsToFieldErrors(uniqueResult));
        setError("Corrige los campos unicos antes de guardar.");
        return;
      }

      if (uniqueResult.status === "inconclusive") {
        setUniqueNotice(uniqueValidationNotice(uniqueResult));
      }

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

      reportWriteFeedback({
        appViewId: appView.id,
        appViewTitle: appView.name,
        contractId: selectedContractId,
        kind: "local-saved",
        ownerKey,
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
      <FormLayout>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>{appView.name}</Text>
        <Text style={styles.kicker}>{operationLabel}</Text>
        {definition ? <Text style={styles.meta}>{definition.name}</Text> : null}
      </View>

      {isLoading && !definition ? <ReadLoadingState mode="initial" /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {uniqueNotice ? <Text style={styles.notice}>{uniqueNotice}</Text> : null}
      {error && !definition ? (
        <FormAction label="Reintentar" onPress={() => setRetryCount((count) => count + 1)} />
      ) : null}

      {definition ? (
        <FormGrid slots={fields.map((field) => ({
          key: field.key, fullWidth: field.type === "TEXTAREA" || field.type === "DATETIME", content: (
            <RecordFieldInput
              presentation="form"
              error={fieldErrors[field.key]}
              field={field}
              key={field.key}
              onChange={(value) => setFieldValue(field.key, value)}
              onBlur={() => validateUniqueFieldOnBlur(field.key)}
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
          )
        }))}>
          {checkingUniqueFieldKey ? <Text style={styles.notice}>Comprobando valor unico...</Text> : null}
        </FormGrid>
      ) : null}

      {definition ? (
        <FormActions>
          <FormAction label="Volver" variant="secondary" onPress={() => router.back()} />
          <FormAction label="Guardar" busyLabel="Guardando" busy={isSubmitting} disabled={isSubmitting} onPress={handleSubmit} />
        </FormActions>
      ) : null}
      </FormLayout>
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

function uniqueConflictsToFieldErrors(result: Extract<UniqueValidationResult, { status: "conflict" }>) {
  return result.conflicts.reduce<RecordFormErrors>((errors, conflict) => {
    errors[conflict.fieldKey] = conflict.message;

    return errors;
  }, {});
}

function uniqueValidationNotice(result: Extract<UniqueValidationResult, { status: "inconclusive" }>) {
  if (result.reason === "NETWORK_UNAVAILABLE") {
    return "No pudimos confirmar unicidad con el servidor. El guardado local continuara y el servidor validara al sincronizar.";
  }

  if (result.reason === "LOCAL_CACHE_PARTIAL") {
    return "Validamos contra los registros disponibles localmente. El servidor confirmara unicidad al sincronizar.";
  }

  return "No pudimos completar la comprobacion preventiva. El servidor validara al sincronizar.";
}

export function createRecordFormStyles(p: ThemeColors = colors) {
  return StyleSheet.create({
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 36,
  },
  error: {
    color: p.danger,
    lineHeight: 20,
  },
  header: {
    gap: 4,
  },
  kicker: {
    color: p.textSecondary,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  meta: {
    color: p.textSecondary,
  },
  notice: {
    color: p.warning,
    lineHeight: 20,
  },
  screen: {
    backgroundColor: p.canvas,
    flex: 1,
  },
  title: {
    color: p.text,
    fontSize: 26,
    fontWeight: "800",
  },
});
}
const styles = createRecordFormStyles();
