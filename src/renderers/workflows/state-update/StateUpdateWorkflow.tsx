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
  OpcoNetworkError,
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
  buildEffectiveStateSnapshot,
  buildStateUpdateLatestRows,
  buildStateUpdateConflictRows,
  currentStateValue,
  defaultStateValues,
  firstBlockingStateUpdateResult,
  formValueFromStateValue,
  formatLocalDateInput,
  formatStateValueLabel,
  hasSuccessfulStateUpdateResult,
  mergeStateUpdateLatestUpdates,
  normalizeStateUpdateSearch,
  shouldSearchStateUpdateSubjects,
  STATE_UPDATE_SEARCH_DEBOUNCE_MS,
  StateUpdateFormValues,
  stateFieldType,
  stateUpdateSuccessLabel,
  stateUpdateLatestMatchesSearch,
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
  stateUpdateLoadErrorMessage,
  stateUpdateRefreshErrorMessage,
  stateUpdateStaleCacheMessage,
  StateUpdateVisibleErrorDiagnostics,
  StateUpdateVisibleErrorOperation,
} from "./state-update-operation-feedback";

type ConflictState = Extract<StateUpdateBatchResult, { result: "CONFLICT" }> & {
  subjectName: string;
};

type StateValues = StateUpdateFormValues;
const STATE_UPDATE_LATEST_PAGE_SIZE = 20;

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
  const [latestPage, setLatestPage] = useState(1);
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
  const [isLoadingMore, setIsLoadingMore] = useState(false);
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
  const latestPagination = response?.latestPagination;
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

  const loadOfflineWorkflow = useCallback(async (query: { appendLatest?: boolean; fallbackReason?: "network-load"; page?: number; search?: string; subjectRecordId?: string } = {}) => {
    if (!ownerKey || !selectedContractId) {
      setError("Selecciona un contrato antes de abrir este workflow.");
      return false;
    }

    const prepared = await definitionCache.getAppViewDefinition(ownerKey, selectedContractId, appView.id);

    if (prepared?.definition.kind !== "state-update") {
      setError(query.fallbackReason === "network-load"
        ? "No fue posible cargar la información. Reintentar"
        : "Abre este workflow con conexion para preparar su uso sin conexion.");
      setResponse(null);
      setItems([]);
      return false;
    }
    const definition = prepared.definition;

    const sourceTelemetry = await definitionCache.getSyncTelemetry({
      contractId: selectedContractId,
      entityTypeId: definition.sourceEntityTypeId,
      ownerKey,
    });
    const sourceHydrated = hasSuccessfulHydration(sourceTelemetry);

    const scope = {
      appViewId: appView.id,
      contractId: selectedContractId,
      date: definition.dateFieldId ? date : undefined,
      ownerKey,
      targetEntityTypeId: definition.targetEntityTypeId,
    };
    const latestPageToLoad = query.page ?? 1;
    const [summary, latestResult, localConflicts] = await Promise.all([
      definitionCache.getStateUpdateSummary(scope),
      definitionCache.listStateUpdateLatest({
        ...scope,
        page: latestPageToLoad,
        pageSize: STATE_UPDATE_LATEST_PAGE_SIZE,
        search: query.search,
      }),
      definitionCache.listStateUpdateConflicts(scope),
    ]);
    let nextItems: StateUpdateItem[] = [];

    if (sourceHydrated && query.search) {
      nextItems = await definitionCache.searchStateUpdateSubjects({
        ...scope,
        search: query.search,
        sourceEntityTypeId: definition.sourceEntityTypeId,
      });
    }

    if (sourceHydrated && query.subjectRecordId) {
      nextItems = await definitionCache.searchStateUpdateSubjects({
          ...scope,
          search: "",
          sourceEntityTypeId: definition.sourceEntityTypeId,
        })
        .then((results) => results.filter((item) => item.subject.id === query.subjectRecordId));
    }

    const nextResponse: StateUpdateResponse = {
      appView: {
        id: appView.id,
        name: appView.name,
        slug: appView.slug,
      },
      date: scope.date,
      dateField: definition.dateFieldId
        ? [...definition.stateFields.map((field) => ({
            id: field.fieldId,
            key: field.fieldId,
            name: field.label,
            options: [],
            order: 0,
            required: field.required,
            type: field.type ?? "DATE",
          })), ...definition.extraFields].find((field) => field.id === definition.dateFieldId) ?? null
        : null,
      dateFieldId: definition.dateFieldId,
      extraFields: definition.extraFields,
      historyMode: definition.historyMode,
      items: nextItems,
      latest: latestResult.items,
      latestPagination: latestResult.pagination,
      sourceEntityType: {
        id: definition.sourceEntityTypeId,
        name: definition.sourceEntityTypeId,
      },
      stateFields: definition.stateFields,
      subjectFieldId: definition.subjectFieldId,
      summary: {
        conflictCount: summary.conflictCount,
        failedCount: summary.failedCount,
        pendingCount: summary.pendingCount,
        syncingCount: summary.syncingCount,
        totalRegistered: summary.totalRegistered,
      },
      targetEntityType: {
        id: definition.targetEntityTypeId,
        name: definition.targetEntityTypeId,
      },
      uniqueness: definition.uniqueness,
    };
    setResponse((current) => query.appendLatest && current
      ? {
          ...nextResponse,
          latest: mergeStateUpdateLatestUpdates(current.latest ?? [], nextResponse.latest ?? []),
        }
      : nextResponse);
    setItems(nextItems);
    setLatestPage(latestPageToLoad);

    const hasCachedWorkflowData = sourceHydrated || (nextResponse.latest ?? []).length > 0 || summary.totalRegistered > 0;

    if (!hasCachedWorkflowData) {
      setError(query.fallbackReason === "network-load"
        ? "No fue posible cargar la información. Reintentar"
        : "Abre este workflow con conexion para preparar sus datos sin conexion.");
      return false;
    } else if (localConflicts.length > 0) {
      setError(`${localConflicts.length} conflictos por resolver.`);
    }

    return true;
  }, [appView.id, appView.name, appView.slug, date, definitionCache, ownerKey, selectedContractId]);

  const loadWorkflow = useCallback(async (query: { appendLatest?: boolean; operation?: StateUpdateVisibleErrorOperation; page?: number; search?: string; subjectRecordId?: string } = {}) => {
    if (!token || !selectedContractId) {
      setError("Selecciona un contrato antes de abrir este workflow.");
      setIsLoading(false);
      return;
    }

    const requestId = ++requestSequenceRef.current;
    const hasSearch = Boolean(query.search);
    const latestPageToLoad = query.page ?? 1;
    const operation = query.operation ?? (hasSearch ? "search" : query.subjectRecordId ? "source-load" : "load-workflow");

    if (hasSearch) {
      setIsSearching(true);
    } else {
      setIsLoading(true);
    }
    if (query.appendLatest) {
      setIsLoadingMore(true);
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
        page: latestPageToLoad,
        pageSize: STATE_UPDATE_LATEST_PAGE_SIZE,
        search: query.search,
        subjectRecordId: query.subjectRecordId,
      });

      if (requestId !== requestSequenceRef.current) {
        return;
      }

      setResponse((current) => query.appendLatest && current
        ? {
            ...nextResponse,
            latest: mergeStateUpdateLatestUpdates(current.latest ?? [], nextResponse.latest ?? []),
          }
        : nextResponse);
      setItems(nextResponse.items);
      setLatestPage(latestPageToLoad);
      setRefreshError(null);
      clearVisibleError();
      if (ownerKey) {
        await definitionCache.upsertStateUpdateSnapshot({
          appViewId: appView.id,
          contractId: selectedContractId,
          date: nextResponse.date,
          items: nextResponse.items,
          latest: nextResponse.latest ?? [],
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

        if (isOnline && nextError instanceof OpcoNetworkError && isStateUpdateReadOperation(operation)) {
          const loadedFromCache = await loadOfflineWorkflow({ ...query, fallbackReason: "network-load" });

          if (loadedFromCache) {
            setError(null);
            setRefreshError(stateUpdateStaleCacheMessage(nextError));
          } else {
            setError(stateUpdateLoadErrorMessage(nextError, connectivityStatus));
            setRefreshError(null);
          }
        } else if (operation === "refresh") {
          setRefreshError(stateUpdateRefreshErrorMessage(nextError));
        } else {
          setError(stateUpdateLoadErrorMessage(nextError, connectivityStatus));
        }
      }
    } finally {
      if (requestId === requestSequenceRef.current) {
        setIsLoading(false);
        setIsSearching(false);
        setIsLoadingMore(false);
      }
    }
  }, [api, appView.id, clearVisibleError, connectivityStatus, date, definitionCache, hasDate, isOnline, loadOfflineWorkflow, ownerKey, recordVisibleError, selectedContractId, token]);

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
        void loadWorkflow({ operation: "search", page: 1 });
        return;
      }

      void loadWorkflow({ operation: "search", page: 1, search: normalizeStateUpdateSearch(searchText) });
    }, STATE_UPDATE_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [loadWorkflow, searchText]);

  function clearEditor() {
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

    const stateSnapshot = buildEffectiveStateSnapshot({
      currentStateValues: selectedItem.current?.stateValues,
      fields: response.stateFields,
      formValues: stateValues,
    });
    const nextExtraErrors = validateFormFields(response.extraFields, extraValues);

    if (stateSnapshot.error || Object.keys(nextExtraErrors).length > 0) {
      setExtraErrors(nextExtraErrors);
      setError(stateSnapshot.error);
      return;
    }

    if (!stateSnapshot.hasChanges && response.extraFields.length === 0) {
      setError("No hay cambios para guardar.");
      return;
    }

    const entry: StateUpdateEntry = {
      expectedUpdatedAt,
      extraValues: buildSubmitValues(response.extraFields, extraValues),
      overwrite,
      stateValues: stateSnapshot.stateValues,
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

        const localRecord = await definitionCache.saveStateUpdateLocally({
          appViewId: appView.id,
          contractId: selectedContractId,
          date: hasDate ? date : undefined,
          expectedUpdatedAt: expectedUpdatedAt ?? selectedItem.current?.updatedAt ?? null,
          extraValues: buildSubmitValues(response.extraFields, extraValues),
          historyMode: response.historyMode,
          overwrite,
          ownerKey,
          stateFields: response.stateFields,
          stateValues: stateSnapshot.stateValues,
          subjectDisplayName: selectedItem.subject.displayName,
          subjectRecordId: selectedItem.subject.id,
          targetEntityTypeId: response.targetEntityType.id,
          uniqueness: response.uniqueness,
        });
        setSuccessMessage("Guardado en este dispositivo.");
        insertSavedLatestItem({
          recordId: localRecord.localRecordId,
          stateValues: stateSnapshot.stateValues,
          subject: selectedItem.subject,
          updatedAt: new Date().toISOString(),
        });
        clearVisibleError();
        clearEditor();
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
        const successfulResult = result.results.find((item): item is Extract<StateUpdateBatchResult, { result: "CREATED" | "UPDATED" | "UNCHANGED" }> =>
          item.result === "CREATED" || item.result === "UPDATED" || item.result === "UNCHANGED"
        );

        if (successfulResult) {
          insertSavedLatestItem({
            recordId: successfulResult.recordId,
            stateValues: stateSnapshot.stateValues,
            subject: selectedItem.subject,
            updatedAt: successfulResult.updatedAt,
          });
        }
        clearVisibleError();
        clearEditor();
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

  function insertSavedLatestItem({
    recordId,
    stateValues: savedStateValues,
    subject,
    updatedAt,
  }: {
    recordId: string;
    stateValues: StateUpdateEntry["stateValues"];
    subject: StateUpdateItem["subject"];
    updatedAt: string;
  }) {
    if (!stateUpdateLatestMatchesSearch({ recordId, stateValues: [], subject, updatedAt }, searchText)) {
      return;
    }

    setResponse((current) => {
      if (!current) {
        return current;
      }

      const item: StateUpdateLatestItem = {
        date: hasDate ? date : null,
        extraValues: buildSubmitValues(current.extraFields, extraValues),
        recordId,
        stateValues: savedStateValues.map((value) => {
          const field = current.stateFields.find((candidate) => candidate.fieldId === value.fieldId);
          const optionLabel = value.optionId && field
            ? field.options.find((option) => option.optionId === value.optionId)?.label ?? null
            : null;

          return {
            fieldId: value.fieldId,
            label: optionLabel,
            optionId: value.optionId ?? null,
            value: value.value,
          };
        }),
        subject,
        updatedAt,
      };
      const latest = mergeStateUpdateLatestUpdates([item], current.latest ?? []);
      const currentTotal = current.latestPagination?.total ?? latest.length;

      return {
        ...current,
        latest,
        latestPagination: current.latestPagination
          ? { ...current.latestPagination, total: Math.max(currentTotal, latest.length) }
          : { hasMore: false, page: 1, pageSize: STATE_UPDATE_LATEST_PAGE_SIZE, total: latest.length },
      };
    });
  }

  async function confirmConflict() {
    if (!conflict) {
      return;
    }

    await saveSelected(true, conflict.existing.updatedAt);
  }

  function loadMoreLatest() {
    if (isLoadingMore || !latestPagination?.hasMore) {
      return;
    }

    void loadWorkflow({
      appendLatest: true,
      operation: "refresh",
      page: latestPage + 1,
      search: shouldSearchStateUpdateSubjects(searchText) ? normalizeStateUpdateSearch(searchText) : undefined,
    });
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

      {operationFeedback.message ? (
        <Text style={operationFeedback.phase === "FAILED" || operationFeedback.phase === "UNRESOLVED_ERROR" ? styles.error : operationFeedback.phase === "SUCCESS" ? styles.success : styles.offline}>
          {operationFeedback.message}
        </Text>
      ) : null}
      {operationFeedback.phase === "FAILED" && visibleError ? (
        <Pressable onPress={() => void loadWorkflow()} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Reintentar</Text>
        </Pressable>
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
            {hasDate ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>{response.dateField?.name ?? "Campo de fecha"}</Text>
                <TextInput
                  autoCapitalize="none"
                  onChangeText={setDate}
                  placeholder="YYYY-MM-DD"
                  style={styles.input}
                  value={date}
                />
              </View>
            ) : null}
            {response.stateFields.map((field) => (
              <StateFieldInput
                field={field}
                key={field.fieldId}
                onChange={(value) => {
                  setStateValues((current) => ({ ...current, [field.fieldId]: value }));
                  setError(null);
                }}
                value={stateValues[field.fieldId]}
              />
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

      {!selectedItem ? (
        <LatestList
          isLoadingMore={isLoadingMore}
          latest={latest}
          onLoadMore={loadMoreLatest}
          pagination={latestPagination}
          response={response}
        />
      ) : null}

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

  (item.current?.stateValues ?? []).forEach((value) => {
    const field = response.stateFields.find((candidate) => candidate.fieldId === value.fieldId);

    if (field) {
      values[value.fieldId] = formValueFromStateValue(field, value);
    }
  });

  return values;
}

function formatCurrentState(response: StateUpdateResponse | null, item: StateUpdateItem) {
  if (!response || !item.current) {
    return null;
  }

  const labels = response.stateFields
    .map((field) => formatStateValueLabel(field, currentStateValue(item.current?.stateValues ?? [], field.fieldId)))
    .filter(Boolean);

  return labels.length > 0 ? labels.join(" · ") : null;
}

function readSummaryCount(response: StateUpdateResponse | null, key: string) {
  const value = response?.summary?.[key];

  return typeof value === "number" ? value : 0;
}

function isStateUpdateReadOperation(operation: StateUpdateVisibleErrorOperation) {
  return operation === "load-workflow" ||
    operation === "refresh" ||
    operation === "search" ||
    operation === "source-load";
}

function LatestList({
  isLoadingMore,
  latest,
  onLoadMore,
  pagination,
  response,
}: {
  isLoadingMore: boolean;
  latest: StateUpdateLatestItem[];
  onLoadMore(): void;
  pagination: StateUpdateResponse["latestPagination"] | undefined;
  response: StateUpdateResponse | null;
}) {
  return (
    <View style={styles.latestBlock}>
      <Text style={styles.sectionTitle}>Últimas actualizaciones</Text>
      {latest.length === 0 ? <Text style={styles.empty}>Sin actualizaciones</Text> : null}
      {latest.map((item) => (
        <View key={item.recordId} style={styles.latestRow}>
          <View style={styles.subjectText}>
            <Text style={styles.subjectName}>{item.subject.displayName}</Text>
            {buildStateUpdateLatestRows(response, item).map((row) => (
              <Text key={`${item.recordId}:${row.fieldId}`} style={styles.statusMeta}>
                {row.label}: {row.value}
              </Text>
            ))}
          </View>
        </View>
      ))}
      {pagination?.hasMore ? (
        <Pressable
          disabled={isLoadingMore}
          onPress={onLoadMore}
          style={[styles.secondaryButton, isLoadingMore && styles.disabledButton]}
        >
          {isLoadingMore ? <ActivityIndicator color="#135d66" /> : <Text style={styles.secondaryText}>Cargar más</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

function StateFieldInput({
  field,
  onChange,
  value,
}: {
  field: StateUpdateField;
  onChange(value: string | boolean): void;
  value: string | boolean | undefined;
}) {
  const type = stateFieldType(field);

  if (type === "SELECT") {
    return (
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{field.label}</Text>
        <View style={styles.optionList}>
          {activeStateOptions(field).map((option) => {
            const selected = value === option.optionId;

            return (
              <Pressable
                key={option.optionId}
                onPress={() => onChange(selected && !field.required ? "" : option.optionId)}
                style={[styles.optionButton, selected && styles.optionButtonSelected]}
              >
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  if (type === "BOOLEAN") {
    const selected = value === true;

    return (
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{field.label}</Text>
        <Pressable
          onPress={() => onChange(!selected)}
          style={[styles.optionButton, selected && styles.optionButtonSelected]}
        >
          <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{selected ? "Si" : "No"}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{field.label}</Text>
      <TextInput
        autoCapitalize="none"
        keyboardType={type === "INTEGER" || type === "DECIMAL" || type === "MONEY" ? "numeric" : "default"}
        onChangeText={onChange}
        placeholder={type === "DATE" ? "YYYY-MM-DD" : field.required ? "Obligatorio" : ""}
        style={styles.input}
        value={typeof value === "string" ? value : ""}
      />
    </View>
  );
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
  input: {
    borderColor: "#c8d2d5",
    borderRadius: 8,
    borderWidth: 1,
    color: "#17363c",
    ...stableTextInputStyle,
    minHeight: 46,
    paddingHorizontal: 12,
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
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#b8c7ca",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 14,
  },
  secondaryText: {
    color: "#135d66",
    fontWeight: "800",
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
  title: {
    color: "#0f3036",
    fontSize: 24,
    fontWeight: "800",
  },
});
