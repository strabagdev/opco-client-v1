import {useExtraRelations} from "../workflows/state-update/use-extra-relations";
import { type ThemeColors } from "../../theme/tokens";
import { colors } from "../../theme/paint";
import { FormActions, FormAction } from "@/components/form-actions";
import { FormLayout, FormGrid } from "@/components/form-layout";
import { ReadLoadingState } from "@/components/read-loading-indicator";
import { useExperienceActivityReporter } from "@/renderers/use-experience-activity";
import { router } from "expo-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { buildAppViewRecordHref } from "@/lib/app-views";
import { revisionCanonical } from "@/lib/revision-receipts";
import { getEntityDefinitionWithCache } from "@/lib/definition-cache";
import { CachedEntityRecord, loadRecordWithOfflineCache, requireEditableRecord, saveRecordLocally } from "@/lib/offline-records";
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
  const authGeneration=api.getAuthSessionGeneration();

  const [definition, setDefinition] = useState<EntityDefinition | null>(null);
  const [record, setRecord] = useState<CachedEntityRecord | null>(null);
  const [initialValues, setInitialValues] = useState<RecordFormValues>({});
  const [values, setValues] = useState<RecordFormValues>({});
  const [fieldErrors, setFieldErrors] = useState<RecordFormErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [uniqueNotice, setUniqueNotice] = useState<string | null>(null);
  const [checkingUniqueFieldKey, setCheckingUniqueFieldKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [loadedFormScope,setLoadedFormScope]=useState<string|null>(null);
  const requestedFormScope=JSON.stringify([ownerKey,selectedContractId,entityTypeId,appView.id,mode,recordId,authGeneration,retryCount]);
  const requestedFormScopeRef=useRef<string|null>(null);
  const connectivityAtLoadRef=useRef(connectivityStatus);
  useLayoutEffect(() => { connectivityAtLoadRef.current = connectivityStatus; }, [connectivityStatus]);
  useLayoutEffect(() => {
    requestedFormScopeRef.current = requestedFormScope;
    return () => { requestedFormScopeRef.current = null; };
  }, [requestedFormScope]);
  const formReady=Boolean(definition&&loadedFormScope===requestedFormScope);
  const latestValuesRef = useRef(values);
  const loadedFormRef = useRef({ scope: loadedFormScope, definition });
  useLayoutEffect(() => { loadedFormRef.current = { scope: loadedFormScope, definition }; }, [loadedFormScope, definition]);

  const fields = useMemo(() => (definition ? getWritableFields(definition) : []), [definition]);
  const formScope=JSON.stringify([ownerKey,selectedContractId,appView.id,entityTypeId,mode,recordId,authGeneration,definition]);
  const relationCatalogs=useExtraRelations({api,store:definitionCache,token,ownerKey,contractId:selectedContractId,appView,authGeneration,
    fields,online:connectivityStatus==="online",scope:formScope,identity:"record",
    selected:Object.fromEntries(fields.filter(f=>f.type==="RELATION").map(f=>[f.id,Array.isArray(values[f.key])?values[f.key] as string[]:typeof values[f.key]==="string"&&values[f.key]?[values[f.key] as string]:[]]))});
  const relationOptionsByField:Record<string,RelationOptionsState>=Object.fromEntries(fields.filter(f=>f.type==="RELATION").map(field=>{
    const catalog=relationCatalogs.catalogs[field.id];return[field.key,{options:catalog?.options??[],error:catalog?.error??null,isLoaded:catalog?.loaded??false,isLoading:catalog?.loading??true,targetEntityTypeId:getRelationTargetEntityTypeId(field)}];
  }));
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
    const current = () => isMounted && api.isAuthSessionCurrent(authGeneration) && requestedFormScopeRef.current === requestedFormScope;

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

      if (!current()) return;
      const previous = loadedFormRef.current;
      const revalidating = Boolean(previous.definition && previous.scope === requestedFormScope);
      if (!revalidating) {
        setIsSubmitting(false);
        setFieldErrors({});
      }
      setIsLoading(true);
      setError(null);

      try {
        const definitionResult = await getEntityDefinitionWithCache({
          api,
          cache: definitionCache,
          contractId: selectedContractId,
          entityTypeId,
          token,
        });
        if (!current()) return;
        // A credential refresh rechecks metadata, not the user's unsaved values
        // or editing baseline/version. Explicit retry has a different form scope.
        if (revalidating && revisionCanonical(definitionResult.definition) === revisionCanonical(previous.definition)) return;
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
                knownOffline: connectivityAtLoadRef.current === "offline",
                isActive: current,
              })
            : null;
        if (!current()) return;
        if (mode === "edit") requireEditableRecord(recordResult?.record ?? null, { ownerKey, contractId: selectedContractId, entityTypeId, recordId });
        const nextValues = buildInitialFormValues(definitionResult.definition, recordResult?.record?.values);

        if (current()) {
          setLoadedFormScope(requestedFormScope);
          setDefinition(definitionResult.definition);
          setRecord(recordResult?.record ?? null);
          setInitialValues(nextValues);
          setValues(nextValues);
          if (revalidating) setError("La definición del formulario cambió. Se cargó la versión actual; revisa los campos antes de guardar.");
        }
      } catch (nextError) {
        if (current()) {
          setError(nextError instanceof Error ? nextError.message : "No fue posible cargar el formulario.");
        }
      } finally {
        if (current()) {
          setIsLoading(false);
        }
      }
    }

    void loadForm();

    return () => {
      isMounted = false;
    };
  }, [api, definitionCache, entityTypeId, mode, ownerKey, recordId, retryCount, selectedContractId, token, authGeneration, requestedFormScope]);


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

    const current=()=>api.isAuthSessionCurrent(authGeneration)&&requestedFormScopeRef.current===requestedFormScope;
    const capturedValue = values[fieldKey];

    if (mode === "edit" && JSON.stringify(capturedValue) === JSON.stringify(initialValues[fieldKey])) {
      return;
    }

    setCheckingUniqueFieldKey(fieldKey);
    setUniqueNotice(null);

    try {
      const result = await validateUniqueValues({ [fieldKey]: capturedValue });

      if (!current() || !isUniqueValidationResultCurrent(latestValuesRef.current[fieldKey], capturedValue)) {
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
      if(current())setCheckingUniqueFieldKey(null);
    }
  }

  async function handleSubmit() {
    const current=()=>api.isAuthSessionCurrent(authGeneration)&&requestedFormScopeRef.current===requestedFormScope;
    if (!current() || !formReady || isLoading || isSubmitting) {
      return;
    }

    if (!definition || !token || !selectedContractId || !ownerKey) {
      return;
    }

    if (localDatabaseStorageState.status !== "ready") {
      setError("No pudimos acceder a los datos locales. Reintenta desde la pantalla de almacenamiento.");
      return;
    }

    if(mode==="edit"){
      try{requireEditableRecord(record,{ownerKey,contractId:selectedContractId,entityTypeId,recordId});}
      catch(reason){setError(reason instanceof Error?reason.message:"No está disponible el registro seleccionado.");return;}
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
      if (!current()) return;

      if (uniqueResult.status === "conflict") {
        setFieldErrors(uniqueConflictsToFieldErrors(uniqueResult));
        setError("Corrige los campos unicos antes de guardar.");
        return;
      }

      if (uniqueResult.status === "inconclusive") {
        setUniqueNotice(uniqueValidationNotice(uniqueResult));
      }

      if(!current())return;
      if(mode==="edit"){
        const selected=await definitionCache.getCachedRecord({ownerKey,contractId:selectedContractId,entityTypeId,recordId:recordId!});
        if(!current())return;
        requireEditableRecord(selected,{ownerKey,contractId:selectedContractId,entityTypeId,recordId});
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

      if(!current())return;
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
      if(!current())return;
      const nextFieldErrors = extractApiFieldErrors(nextError);

      if (Object.keys(nextFieldErrors).length > 0) {
        setFieldErrors(nextFieldErrors);
      }

      setError(nextError instanceof Error ? nextError.message : "No fue posible guardar el registro.");
    } finally {
      if(current())setIsSubmitting(false);
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

      {isLoading && !formReady ? <ReadLoadingState mode="initial" /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {uniqueNotice ? <Text style={styles.notice}>{uniqueNotice}</Text> : null}
      {relationCatalogs.dependencyNotice ? <Text style={styles.notice}>{relationCatalogs.dependencyNotice}</Text> : null}
      {error && !formReady ? (
        <FormAction label="Reintentar" onPress={() => setRetryCount((count) => count + 1)} />
      ) : null}

      {formReady ? (
        <FormGrid slots={fields.map((field) => ({
          key: field.key, fullWidth: field.type === "TEXTAREA" || field.type === "DATETIME", content: (
            <RecordFieldInput
              presentation="form"
              error={fieldErrors[field.key]}
              field={field}
              key={field.key}
              onChange={(value) => setFieldValue(field.key, value)}
              onBlur={() => validateUniqueFieldOnBlur(field.key)}
              onRelationSearch={field.type==="RELATION"?search=>relationCatalogs.search(field.id,search):undefined}
              onRelationLoadMore={relationCatalogs.catalogs[field.id]?.hasMore?()=>relationCatalogs.more(field.id):undefined}
              relationOptionsNoticeHandled={Boolean(relationCatalogs.dependencyNotice)}
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

      {formReady ? (
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
