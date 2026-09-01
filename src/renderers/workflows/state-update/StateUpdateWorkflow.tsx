import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AppIcon } from "@/components/app-icon";
import { hasSuccessfulHydration } from "@/lib/app-view-definitions-cache";
import { createClientRequestId } from "@/lib/client-request-id";
import {
  buildInitialFormValues,
  buildSubmitValues,
  RecordFormErrors,
  RecordFormValues,
  validateFormFields,
} from "@/lib/record-form";
import { stableSubmitButtonStyle, stableTextInputStyle } from "@/lib/visual-stability";
import {
  EntityDefinition,
  StateUpdateBatchResult,
  StateUpdateEntry,
  StateUpdateField,
  StateUpdateItem,
  StateUpdateLatestItem,
  StateUpdateResponse,
  StateUpdateWorkflowConfig,
  WorkflowAppView,
} from "@/lib/opco-api";
import { RecordFieldInput } from "@/renderers/records/RecordFieldInput";
import {
  activeStateOptions,
  buildStateUpdateConflictRows,
  currentStateValue,
  defaultStateValues,
  firstBlockingStateUpdateResult,
  formatLocalDateInput,
  hasSuccessfulStateUpdateResult,
  normalizeStateUpdateSearch,
  shiftLocalDate,
  shouldSearchStateUpdateSubjects,
  STATE_UPDATE_SEARCH_DEBOUNCE_MS,
  stateUpdateSuccessLabel,
} from "@/renderers/workflows/state-update/state-update-workflow-logic";
import { AppViewRendererProps } from "@/renderers/types";
import { useSession } from "@/state/session";
import { shouldHandleStateUpdateRefresh } from "@/state/state-update-refresh";
import type { StateUpdateVisibleErrorResolution } from "@/lib/state-update-offline";
import {
  createStateUpdateVisibleErrorDiagnostics,
  hideStateUpdateTimeoutAfterConfirmedSync,
  resolveStateUpdateOperationFeedback,
  shouldShowStateUpdateVisibleErrorDiagnostics,
  stateUpdateRefreshErrorMessage,
  StateUpdateVisibleErrorDiagnostics,
  StateUpdateVisibleErrorOperation,
} from "./state-update-operation-feedback";

type ConflictState = Extract<StateUpdateBatchResult, { result: "CONFLICT" }> & {
  subjectName: string;
};

type StateValues = Record<string, string>;

export function StateUpdateWorkflow({ appView }: AppViewRendererProps<WorkflowAppView & { config: StateUpdateWorkflowConfig }>) {
  const {
    api,
    connectivityStatus,
    definitionCache,
    isAuthSessionRestoring,
    isOperationalCoreReadinessChecking,
    isPendingWorkSyncing,
    ownerKey,
    refreshRecordsSyncSummary,
    selectedContractId,
    stateUpdateReconnectDiagnostics,
    stateUpdateReconnectRefreshKey,
    token,
  } = useSession();
  const [date, setDate] = useState(formatLocalDateInput(new Date()));
  const [searchText, setSearchText] = useState("");
  const [response, setResponse] = useState<StateUpdateResponse | null>(null);
  const [items, setItems] = useState<StateUpdateItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<StateUpdateItem | null>(null);
  const [stateValues, setStateValues] = useState<StateValues>({});
  const [extraValues, setExtraValues] = useState<RecordFormValues>({});
  const [extraErrors, setExtraErrors] = useState<RecordFormErrors>({});
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [visibleErrorDiagnostics, setVisibleErrorDiagnostics] =
    useState<StateUpdateVisibleErrorDiagnostics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const requestSequenceRef = useRef(0);
  const stateUpdateRefreshKeyRef = useRef(stateUpdateReconnectRefreshKey);
  const isOnline = connectivityStatus === "online";
  const showVisibleErrorDiagnostics = shouldShowStateUpdateVisibleErrorDiagnostics();
  const currentStateUpdateSyncRunId =
    stateUpdateReconnectDiagnostics.lastStateUpdateActivity?.syncRunId ??
    stateUpdateReconnectDiagnostics.lastStateUpdateSync?.syncRunId ??
    null;

  const hasDate = Boolean(response?.dateFieldId ?? appView.config.dateFieldId);
  const normalizedSearch = normalizeStateUpdateSearch(searchText);
  const submitLabel = response?.historyMode === "update-current" ? "Actualizar estado" : "Registrar cambio";
  const latest = response?.latest ?? [];
  const totalRegistered = readTotalRegistered(response);
  const unresolvedCount = response
    ? readSummaryCount(response, "pendingCount") +
      readSummaryCount(response, "failedCount") +
      readSummaryCount(response, "conflictCount") +
      readSummaryCount(response, "syncingCount")
    : 0;
  const visibleError = hideStateUpdateTimeoutAfterConfirmedSync({
    error,
    lastSync: stateUpdateReconnectDiagnostics.lastStateUpdateSync,
    pendingCount: unresolvedCount,
  }) ? null : error;
  const operationFeedback = resolveStateUpdateOperationFeedback({
    connectivityStatus,
    hasConflict: Boolean(conflict || readSummaryCount(response, "conflictCount") > 0),
    isAuthSessionRestoring,
    isReadinessChecking: isOperationalCoreReadinessChecking,
    isSaving,
    isSyncing: isPendingWorkSyncing,
    lastActivity: stateUpdateReconnectDiagnostics.lastStateUpdateActivity,
    lastSync: stateUpdateReconnectDiagnostics.lastStateUpdateSync,
    pendingCount: unresolvedCount,
    successMessage,
    visibleError,
  });
  const extraDefinition = useMemo<EntityDefinition | null>(() => {
    if (!response) {
      return null;
    }

    return {
      active: true,
      fields: response.extraFields,
      icon: null,
      id: response.targetEntityType.id,
      name: response.targetEntityType.name,
      slug: response.targetEntityType.id,
    };
  }, [response]);

  const clearVisibleError = useCallback((resolution: StateUpdateVisibleErrorResolution = "cleared_after_success") => {
    setVisibleErrorDiagnostics(null);

    if (ownerKey) {
      void definitionCache.resolveStateUpdateVisibleErrorEvent(ownerKey, resolution).catch(() => undefined);
    }
  }, [definitionCache, ownerKey]);

  const recordVisibleError = useCallback(({
    error: nextError,
    operation,
    resolution = "unresolved",
  }: {
    error: unknown;
    operation: StateUpdateVisibleErrorOperation;
    resolution?: StateUpdateVisibleErrorResolution;
  }) => {
    const event = createStateUpdateVisibleErrorDiagnostics({
      error: nextError,
      operation,
      resolution,
      syncRunId: operation === "refresh" || operation === "sync" ? currentStateUpdateSyncRunId : null,
    });

    setVisibleErrorDiagnostics(event);

    if (ownerKey) {
      void definitionCache.recordStateUpdateVisibleErrorEvent(ownerKey, event).catch(() => undefined);
    }
  }, [currentStateUpdateSyncRunId, definitionCache, ownerKey]);

  const loadOfflineWorkflow = useCallback(async (query: { search?: string; subjectRecordId?: string } = {}) => {
    if (!ownerKey || !selectedContractId) {
      setError("Selecciona un contrato antes de abrir este workflow.");
      return;
    }

    const prepared = await definitionCache.getAppViewDefinition(ownerKey, selectedContractId, appView.id);

    if (prepared?.definition.kind !== "state-update") {
      setError("Abre este workflow con conexion para preparar su uso sin conexion.");
      setResponse(null);
      setItems([]);
      return;
    }

    const sourceTelemetry = await definitionCache.getSyncTelemetry({
      contractId: selectedContractId,
      entityTypeId: prepared.definition.sourceEntityTypeId,
      ownerKey,
    });
    const sourceHydrated = hasSuccessfulHydration(sourceTelemetry);

    const scope = {
      appViewId: appView.id,
      contractId: selectedContractId,
      date: prepared.definition.dateFieldId ? date : undefined,
      ownerKey,
      targetEntityTypeId: prepared.definition.targetEntityTypeId,
    };
    const [summary, latestItems, localConflicts] = await Promise.all([
      definitionCache.getStateUpdateSummary(scope),
      definitionCache.listStateUpdateLatest(scope),
      definitionCache.listStateUpdateConflicts(scope),
    ]);
    let nextItems: StateUpdateItem[] = [];

    if (sourceHydrated && query.search) {
      nextItems = await definitionCache.searchStateUpdateSubjects({
        ...scope,
        search: query.search,
        sourceEntityTypeId: prepared.definition.sourceEntityTypeId,
      });
    }

    if (sourceHydrated && query.subjectRecordId) {
      nextItems = await definitionCache.searchStateUpdateSubjects({
          ...scope,
          search: "",
          sourceEntityTypeId: prepared.definition.sourceEntityTypeId,
        })
        .then((results) => results.filter((item) => item.subject.id === query.subjectRecordId));
    }

    setResponse({
      appView: {
        id: appView.id,
        name: appView.name,
        slug: appView.slug,
      },
      date: scope.date,
      dateFieldId: prepared.definition.dateFieldId,
      extraFields: prepared.definition.extraFields,
      historyMode: prepared.definition.historyMode,
      items: nextItems,
      latest: latestItems,
      sourceEntityType: {
        id: prepared.definition.sourceEntityTypeId,
        name: prepared.definition.sourceEntityTypeId,
      },
      stateFields: prepared.definition.stateFields,
      subjectFieldId: prepared.definition.subjectFieldId,
      summary: {
        conflictCount: summary.conflictCount,
        failedCount: summary.failedCount,
        pendingCount: summary.pendingCount,
        syncingCount: summary.syncingCount,
        totalRegistered: summary.totalRegistered,
      },
      targetEntityType: {
        id: prepared.definition.targetEntityTypeId,
        name: prepared.definition.targetEntityTypeId,
      },
      uniqueness: prepared.definition.uniqueness,
    });
    setItems(nextItems);

    if (!sourceHydrated) {
      setError("Abre este workflow con conexion para preparar sus datos sin conexion.");
    } else if (localConflicts.length > 0) {
      setError(`${localConflicts.length} conflictos por resolver.`);
    }
  }, [appView.id, appView.name, appView.slug, date, definitionCache, ownerKey, selectedContractId]);

  const loadWorkflow = useCallback(async (query: { operation?: StateUpdateVisibleErrorOperation; search?: string; subjectRecordId?: string } = {}) => {
    if (!token || !selectedContractId) {
      setError("Selecciona un contrato antes de abrir este workflow.");
      setIsLoading(false);
      return;
    }

    const requestId = ++requestSequenceRef.current;
    const hasSearch = Boolean(query.search);
    const operation = query.operation ?? (hasSearch ? "search" : query.subjectRecordId ? "source-load" : "load-workflow");

    if (hasSearch) {
      setIsSearching(true);
    } else {
      setIsLoading(true);
    }

    if (operation === "refresh") {
      setRefreshError(null);
    } else {
      setError(null);
      setRefreshError(null);
    }

    try {
      if (!isOnline) {
        await loadOfflineWorkflow(query);
        return;
      }

      const nextResponse = await api.getStateUpdateWorkflow(token, selectedContractId, appView.id, {
        date: hasDate ? date : undefined,
        search: query.search,
        subjectRecordId: query.subjectRecordId,
      });

      if (requestId !== requestSequenceRef.current) {
        return;
      }

      setResponse(nextResponse);
      setItems(nextResponse.items);
      setRefreshError(null);
      clearVisibleError();
      if (ownerKey) {
        await definitionCache.upsertStateUpdateSnapshot({
          appViewId: appView.id,
          contractId: selectedContractId,
          date: nextResponse.date,
          items: nextResponse.items,
          ownerKey,
          targetEntityTypeId: nextResponse.targetEntityType.id,
        });
      }
    } catch (nextError) {
      if (requestId === requestSequenceRef.current) {
        recordVisibleError({
          error: nextError,
          operation,
          resolution: operation === "refresh" ? "refresh_failed" : "unresolved",
        });

        if (operation === "refresh") {
          setRefreshError(stateUpdateRefreshErrorMessage(nextError));
        } else {
          setError(nextError instanceof Error ? nextError.message : "No fue posible cargar el workflow.");
        }
      }
    } finally {
      if (requestId === requestSequenceRef.current) {
        setIsLoading(false);
        setIsSearching(false);
      }
    }
  }, [api, appView.id, clearVisibleError, date, definitionCache, hasDate, isOnline, loadOfflineWorkflow, ownerKey, recordVisibleError, selectedContractId, token]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void loadWorkflow();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [loadWorkflow]);

  useEffect(() => {
    const previousKey = stateUpdateRefreshKeyRef.current;

    stateUpdateRefreshKeyRef.current = stateUpdateReconnectRefreshKey;

    if (!shouldHandleStateUpdateRefresh({
      currentKey: stateUpdateReconnectRefreshKey,
      previousKey,
    })) {
      return;
    }

    const timeoutId = setTimeout(() => {
      if (shouldSearchStateUpdateSubjects(searchText)) {
        void loadWorkflow({ operation: "refresh", search: normalizeStateUpdateSearch(searchText) });
        return;
      }

      void loadWorkflow({ operation: "refresh" });
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [loadWorkflow, searchText, stateUpdateReconnectRefreshKey]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (!shouldSearchStateUpdateSubjects(searchText)) {
        setItems([]);
        setIsSearching(false);
        return;
      }

      void loadWorkflow({ operation: "search", search: normalizeStateUpdateSearch(searchText) });
    }, STATE_UPDATE_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [loadWorkflow, searchText]);

  function clearSubjectFlow() {
    setSearchText("");
    setItems([]);
    setSelectedItem(null);
    setStateValues(response ? defaultStateValues(response.stateFields) : {});
    setExtraValues(extraDefinition ? buildInitialFormValues(extraDefinition) : {});
    setExtraErrors({});
    setConflict(null);
  }

  async function selectSubject(item: StateUpdateItem) {
    setSelectedItem(item);
    setConflict(null);
    setError(null);
    setRefreshError(null);
    setSuccessMessage(null);
    setStateValues(initialStateValues(response, item));
    setExtraValues(extraDefinition ? buildInitialFormValues(extraDefinition, item.current?.extraValues) : {});
    setExtraErrors({});

    await loadWorkflow({ operation: "source-load", subjectRecordId: item.subject.id });
  }

  function setExtraValue(key: string, value: string | boolean | string[]) {
    setExtraValues((current) => ({ ...current, [key]: value }));
    setExtraErrors((current) => {
      const next = { ...current };
      delete next[key];

      return next;
    });
  }

  async function saveSelected(overwrite = false, expectedUpdatedAt?: string) {
    if (!response || !selectedItem || !selectedContractId || isSaving) {
      return;
    }

    const stateErrors = validateStateFields(response.stateFields, stateValues);
    const nextExtraErrors = validateFormFields(response.extraFields, extraValues);

    if (stateErrors || Object.keys(nextExtraErrors).length > 0) {
      setExtraErrors(nextExtraErrors);
      setError(stateErrors);
      return;
    }

    const changedStateValues = buildChangedStateValues(response.stateFields, stateValues, selectedItem);

    if (changedStateValues.length === 0 && response.extraFields.length === 0) {
      setError("No hay cambios para guardar.");
      return;
    }

    const entry: StateUpdateEntry = {
      expectedUpdatedAt,
      extraValues: buildSubmitValues(response.extraFields, extraValues),
      overwrite,
      stateValues: changedStateValues,
      subjectRecordId: selectedItem.subject.id,
    };

    setIsSaving(true);
    setError(null);
    setRefreshError(null);
    setSuccessMessage(null);

    try {
      if (!isOnline) {
        if (!ownerKey) {
          return;
        }

        await definitionCache.saveStateUpdateLocally({
          appViewId: appView.id,
          contractId: selectedContractId,
          date: hasDate ? date : undefined,
          expectedUpdatedAt: expectedUpdatedAt ?? selectedItem.current?.updatedAt ?? null,
          extraValues: buildSubmitValues(response.extraFields, extraValues),
          historyMode: response.historyMode,
          overwrite,
          ownerKey,
          stateFields: response.stateFields,
          stateValues: changedStateValues,
          subjectDisplayName: selectedItem.subject.displayName,
          subjectRecordId: selectedItem.subject.id,
          targetEntityTypeId: response.targetEntityType.id,
          uniqueness: response.uniqueness,
        });
        setSuccessMessage("Guardado en este dispositivo.");
        clearVisibleError();
        clearSubjectFlow();
        await loadWorkflow({ operation: "load-workflow" });
        await refreshRecordsSyncSummary();
        return;
      }

      if (!token) {
        return;
      }

      const result = await api.saveStateUpdateWorkflow(token, selectedContractId, appView.id, {
        clientRequestId: createClientRequestId(),
        date: hasDate ? date : undefined,
        ...entry,
      });
      const blockingResult = firstBlockingStateUpdateResult(result.results);

      if (blockingResult?.result === "ERROR") {
        setError(blockingResult.message);
        return;
      }

      if (blockingResult?.result === "CONFLICT") {
        setConflict({ ...blockingResult, subjectName: selectedItem.subject.displayName });
        return;
      }

      if (hasSuccessfulStateUpdateResult(result.results)) {
        setSuccessMessage(stateUpdateSuccessLabel(result.results[0], "Estado actualizado.", "Cambio registrado."));
        clearVisibleError();
        clearSubjectFlow();
        await loadWorkflow({ operation: "refresh" });
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No fue posible guardar el cambio.");
      recordVisibleError({
        error: nextError,
        operation: "save",
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmConflict() {
    if (!conflict) {
      return;
    }

    await saveSelected(true, conflict.existing.updatedAt);
  }

  function changeDate(amount: number) {
    clearSubjectFlow();
    setDate((current) => shiftLocalDate(current, amount));
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <AppIcon icon={appView.icon} size={26} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{appView.name}</Text>
          <Text style={styles.meta}>{response?.targetEntityType.name ?? "Workflow"}</Text>
        </View>
      </View>

      {hasDate ? (
        <View style={styles.dateBar}>
          <Pressable onPress={() => changeDate(-1)} style={styles.dateButton}>
            <Text style={styles.dateButtonText}>Anterior</Text>
          </Pressable>
          <Text style={styles.dateLabel}>{date}</Text>
          <Pressable onPress={() => changeDate(1)} style={styles.dateButton}>
            <Text style={styles.dateButtonText}>Siguiente</Text>
          </Pressable>
        </View>
      ) : null}

      {totalRegistered !== null ? (
        <View style={styles.summaryBar}>
          <Text style={styles.summaryLabel}>Registrados</Text>
          <Text style={styles.summaryValue}>{totalRegistered}</Text>
        </View>
      ) : null}

      {operationFeedback.message ? (
        <Text style={operationFeedback.phase === "FAILED" || operationFeedback.phase === "UNRESOLVED_ERROR" ? styles.error : operationFeedback.phase === "SUCCESS" ? styles.success : styles.offline}>
          {operationFeedback.message}
        </Text>
      ) : null}
      {refreshError ? <Text style={styles.offline}>{refreshError}</Text> : null}
      {showVisibleErrorDiagnostics && visibleErrorDiagnostics ? (
        <Text style={styles.diagnostic}>
          Visible UI error source: {visibleErrorDiagnostics.operation} {visibleErrorDiagnostics.method ?? "unknown"} {visibleErrorDiagnostics.pathTemplate ?? "unknown"} timeout={String(visibleErrorDiagnostics.timeoutOccurred)} status={visibleErrorDiagnostics.httpStatus ?? "none"} durationMs={visibleErrorDiagnostics.durationMs ?? "none"} run={visibleErrorDiagnostics.syncRunId ?? "none"} code={visibleErrorDiagnostics.errorCode}
        </Text>
      ) : null}

      <View style={styles.searchBlock}>
        <TextInput
          autoCapitalize="words"
          onChangeText={(value) => {
            setSearchText(value);
            setSelectedItem(null);
            setConflict(null);
            setSuccessMessage(null);
          }}
          placeholder="Buscar"
          style={styles.searchInput}
          value={searchText}
        />
        {isSearching ? <ActivityIndicator size="small" /> : null}
      </View>

      {isLoading ? <ActivityIndicator /> : null}

      {!selectedItem && normalizedSearch ? (
        <View style={styles.list}>
          {!isSearching && items.length === 0 ? <Text style={styles.empty}>Sin resultados.</Text> : null}
          {items.map((item) => (
            <Pressable key={item.subject.id} onPress={() => void selectSubject(item)} style={styles.subjectRow}>
              <View style={styles.subjectText}>
                <Text style={styles.subjectName}>{item.subject.displayName}</Text>
                <Text style={styles.statusMeta}>{formatCurrentState(response, item) ?? "Sin estado"}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {selectedItem && response ? (
        <View style={styles.editorPanel}>
          <View style={styles.subjectText}>
            <Text style={styles.panelName}>{selectedItem.subject.displayName}</Text>
            <Text style={styles.statusMeta}>Actual: {formatCurrentState(response, selectedItem) ?? "Sin estado"}</Text>
          </View>

          <View style={styles.form}>
            {response.stateFields.map((field) => (
              <View key={field.fieldId} style={styles.fieldGroup}>
                <Text style={styles.label}>{field.label}</Text>
                <View style={styles.optionList}>
                  {activeStateOptions(field).map((option) => {
                    const selected = stateValues[field.fieldId] === option.optionId;

                    return (
                      <Pressable
                        key={option.optionId}
                        onPress={() => {
                          setStateValues((current) => ({
                            ...current,
                            [field.fieldId]: selected && !field.required ? "" : option.optionId,
                          }));
                          setError(null);
                        }}
                        style={[styles.optionButton, selected && styles.optionButtonSelected]}
                      >
                        <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}

            {response.extraFields.map((field) => (
              <RecordFieldInput
                error={extraErrors[field.key]}
                field={field}
                key={field.id}
                onChange={(value) => setExtraValue(field.key, value)}
                value={extraValues[field.key]}
              />
            ))}
          </View>

          <Pressable
            disabled={isSaving}
            onPress={() => void saveSelected()}
            style={[styles.primaryButton, isSaving && styles.disabledButton]}
          >
            {isSaving ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryText}>{submitLabel}</Text>}
          </Pressable>
        </View>
      ) : null}

      {!normalizedSearch && !selectedItem ? <LatestList latest={latest} response={response} /> : null}

      <ConflictModal
        conflict={conflict}
        extraFields={response?.extraFields ?? []}
        fields={response?.stateFields ?? []}
        isSaving={isSaving}
        onCancel={() => setConflict(null)}
        onConfirm={confirmConflict}
      />
    </ScrollView>
  );
}

function initialStateValues(response: StateUpdateResponse | null, item: StateUpdateItem) {
  if (!response) {
    return {};
  }

  const values = defaultStateValues(response.stateFields);

  item.current?.stateValues.forEach((value) => {
    values[value.fieldId] = value.optionId ?? "";
  });

  return values;
}

function validateStateFields(fields: StateUpdateField[], values: StateValues) {
  const missing = fields.find((field) => field.required && !values[field.fieldId]);

  return missing ? `${missing.label} es obligatorio.` : null;
}

function buildChangedStateValues(fields: StateUpdateField[], values: StateValues, item: StateUpdateItem) {
  return fields
    .map((field) => {
      const optionId = values[field.fieldId] || null;
      const current = currentStateValue(item.current?.stateValues ?? [], field.fieldId);

      if (optionId === (current?.optionId ?? null)) {
        return null;
      }

      return { fieldId: field.fieldId, optionId };
    })
    .filter((value): value is { fieldId: string; optionId: string | null } => Boolean(value));
}

function formatCurrentState(response: StateUpdateResponse | null, item: StateUpdateItem) {
  if (!response || !item.current) {
    return null;
  }

  const labels = response.stateFields
    .map((field) => currentStateValue(item.current?.stateValues ?? [], field.fieldId)?.label)
    .filter(Boolean);

  return labels.length > 0 ? labels.join(" · ") : null;
}

function readTotalRegistered(response: StateUpdateResponse | null) {
  const value = response?.summary?.totalRegistered;

  return typeof value === "number" ? value : null;
}

function readSummaryCount(response: StateUpdateResponse | null, key: string) {
  const value = response?.summary?.[key];

  return typeof value === "number" ? value : 0;
}

function LatestList({ latest, response }: { latest: StateUpdateLatestItem[]; response: StateUpdateResponse | null }) {
  return (
    <View style={styles.latestBlock}>
      <Text style={styles.sectionTitle}>Ultimos cambios</Text>
      {latest.length === 0 ? <Text style={styles.empty}>Sin cambios recientes.</Text> : null}
      {latest.map((item) => (
        <View key={item.recordId} style={styles.latestRow}>
          <View style={styles.subjectText}>
            <Text style={styles.subjectName}>{item.subject.displayName}</Text>
            <Text style={styles.statusMeta}>{formatLatestState(response, item) ?? "Sin estado"}</Text>
          </View>
          {item.updatedAt ? <Text style={styles.latestTime}>{formatLocalTime(item.updatedAt)}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function formatLatestState(response: StateUpdateResponse | null, item: StateUpdateLatestItem) {
  if (!response || !item.stateValues) {
    return null;
  }

  const labels = response.stateFields
    .map((field) => item.stateValues?.find((value) => value.fieldId === field.fieldId)?.label)
    .filter(Boolean);

  return labels.length > 0 ? labels.join(" · ") : null;
}

function ConflictModal({
  conflict,
  extraFields,
  fields,
  isSaving,
  onCancel,
  onConfirm,
}: {
  conflict: ConflictState | null;
  extraFields: EntityDefinition["fields"];
  fields: StateUpdateField[];
  isSaving: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const rows = conflict ? buildStateUpdateConflictRows(conflict, fields, extraFields) : [];

  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={Boolean(conflict)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalPanel}>
          <Text style={styles.modalTitle}>{conflict?.subjectName ?? "Registro"}</Text>
          <Text style={styles.modalMessage}>Opco tiene un estado distinto para este registro.</Text>
          <View style={styles.conflictRows}>
            {rows.map((row) => (
              <View key={`${row.fieldType ?? "field"}:${row.fieldId}`} style={styles.conflictRow}>
                <Text style={styles.conflictLabel}>{row.label}</Text>
                <Text style={styles.conflictText}>Actual: {row.existing ?? "Sin estado"}</Text>
                <Text style={styles.conflictText}>Solicitado: {row.requested ?? "Sin estado"}</Text>
              </View>
            ))}
          </View>
          <View style={styles.modalActions}>
            <Pressable disabled={isSaving} onPress={onCancel} style={styles.modalSecondaryButton}>
              <Text style={styles.modalSecondaryText}>Cancelar</Text>
            </Pressable>
            <Pressable disabled={isSaving} onPress={onConfirm} style={styles.modalPrimaryButton}>
              <Text style={styles.modalPrimaryText}>Confirmar cambio</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function formatLocalTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  conflictLabel: {
    color: "#0f3036",
    fontWeight: "800",
  },
  conflictRow: {
    gap: 4,
  },
  conflictRows: {
    gap: 10,
  },
  conflictText: {
    color: "#0f3036",
    fontSize: 15,
  },
  content: {
    gap: 14,
    padding: 18,
    paddingBottom: 32,
  },
  dateBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  dateButton: {
    alignItems: "center",
    backgroundColor: "#e4f1f2",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 12,
  },
  dateButtonText: {
    color: "#135d66",
    fontWeight: "800",
  },
  dateLabel: {
    color: "#0f3036",
    fontWeight: "800",
  },
  diagnostic: {
    color: "#587078",
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 16,
  },
  disabledButton: {
    opacity: 0.55,
  },
  editorPanel: {
    backgroundColor: "#ffffff",
    borderColor: "#d7e4e7",
    borderRadius: 8,
    borderWidth: 1,
    gap: 14,
    padding: 14,
  },
  empty: {
    color: "#587078",
    lineHeight: 20,
  },
  error: {
    color: "#b42318",
    lineHeight: 20,
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
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
  },
  headerText: {
    flex: 1,
  },
  icon: {
    alignItems: "center",
    backgroundColor: "#e4f1f2",
    borderRadius: 8,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  label: {
    color: "#17363c",
    fontSize: 15,
    fontWeight: "800",
  },
  latestBlock: {
    gap: 10,
  },
  latestRow: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#d7e4e7",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    padding: 12,
  },
  latestTime: {
    color: "#587078",
    fontWeight: "700",
  },
  list: {
    gap: 10,
  },
  meta: {
    color: "#587078",
    marginTop: 2,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
  },
  modalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(15, 48, 54, 0.45)",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  modalMessage: {
    color: "#587078",
    lineHeight: 20,
  },
  modalPanel: {
    backgroundColor: "#ffffff",
    borderRadius: 8,
    gap: 16,
    maxWidth: 420,
    padding: 18,
    width: "100%",
  },
  modalPrimaryButton: {
    alignItems: "center",
    backgroundColor: "#135d66",
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
  },
  modalPrimaryText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  modalSecondaryButton: {
    alignItems: "center",
    backgroundColor: "#eef4f4",
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 12,
  },
  modalSecondaryText: {
    color: "#135d66",
    fontWeight: "800",
  },
  modalTitle: {
    color: "#0f3036",
    fontSize: 20,
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
  offline: {
    color: "#5b4a00",
    fontWeight: "700",
    lineHeight: 20,
  },
  panelName: {
    color: "#0f3036",
    fontSize: 20,
    fontWeight: "800",
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
  searchBlock: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  searchInput: {
    backgroundColor: "#ffffff",
    borderColor: "#c8d2d5",
    borderRadius: 8,
    borderWidth: 1,
    color: "#17363c",
    flex: 1,
    ...stableTextInputStyle,
    minHeight: 46,
    paddingHorizontal: 12,
  },
  sectionTitle: {
    color: "#0f3036",
    fontSize: 17,
    fontWeight: "800",
  },
  statusMeta: {
    color: "#587078",
    lineHeight: 20,
  },
  subjectName: {
    color: "#0f3036",
    fontSize: 16,
    fontWeight: "800",
  },
  subjectRow: {
    backgroundColor: "#ffffff",
    borderColor: "#d7e4e7",
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  subjectText: {
    flex: 1,
    gap: 3,
  },
  success: {
    color: "#087443",
    lineHeight: 20,
  },
  summaryBar: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#d7e4e7",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14,
  },
  summaryLabel: {
    color: "#587078",
    fontWeight: "700",
  },
  summaryValue: {
    color: "#0f3036",
    fontSize: 22,
    fontWeight: "900",
  },
  title: {
    color: "#0f3036",
    fontSize: 24,
    fontWeight: "800",
  },
});
