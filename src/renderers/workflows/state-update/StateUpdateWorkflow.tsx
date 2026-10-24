import { buildStateUpdateExtraForm, buildStateUpdateExtraSubmit, unavailableStateUpdateExtraInput } from "@/lib/state-update-extras";
import { CompactSelect } from "@/components/compact-select";
import { DateFieldInput, DateTimeFieldInput, TimeFieldInput } from "@/renderers/records/temporal-input";
import { compositeIdentityKey, selectCompositeIdentity, parseCompositeContextValues, compositeConfirmationKey, hasVerifiedCompositeAbsence } from "@/lib/state-update-identity";
import { StateUpdateFormGrid, StateUpdateReadRows } from "./state-update-presentation";
import { APP_SHELL_WIDE_BREAKPOINT } from "@/lib/app-shell-layout";
import { desktopStyleColors, desktopPalette } from "@/lib/desktop-presentation";
import { useContextPreparation } from "./use-context-preparation";
import { useLocalSearchParams, useRouter } from "expo-router";
import { attentionDate } from "@/lib/sync-attention";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { AppIcon } from "@/components/app-icon";
import { ReadLoadingState } from "@/components/read-loading-indicator";
import { buildStateUpdateCoverageScope, hasSuccessfulHydration } from "@/lib/app-view-definitions-cache";
import { createClientRequestId } from "@/lib/client-request-id";
import {
  buildInitialFormValues,
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
  buildEffectiveStateSnapshot,
  buildStateUpdateLatestRows,
  buildStateUpdateConflictRows,
  currentStateValue,
  compositeContextInstruction,
  defaultStateValues,
  firstBlockingStateUpdateResult,
  formValueFromStateValue,
  formatLocalDateInput,
  formatStateValueLabel,
  hasSuccessfulStateUpdateResult,
  isStateUpdateVisualRequestCurrent,
  mergeStateUpdateLatestUpdates,
  mergeStateUpdateResponseWithLocalConflicts,
  normalizeStateUpdateSearch,
  resolveStateUpdateOfflineHistoryState,
  shouldSearchStateUpdateSubjects,
  STATE_UPDATE_SEARCH_DEBOUNCE_MS,
  StateUpdateFormValues,
  stateFieldType,
  stateUpdateLatestMatchesSearch,
  stateUpdateConflictLatestItem,
  stateUpdateResolutionFeedback,
  stateUpdateOfflineHistoryMessage,
  StateUpdateOfflineHistoryState,
} from "@/renderers/workflows/state-update/state-update-workflow-logic";
import { AppViewRendererProps } from "@/renderers/types";
import { useExperienceOpeningTelemetry } from "@/renderers/experience-opening";
import { useExperienceActivityReporter } from "@/renderers/use-experience-activity";
import { useSession } from "@/state/session";
import { shouldHandleStateUpdateRefresh } from "@/state/state-update-refresh";
import { normalizeStateUpdateLogicalDate, type CachedStateUpdateRecord, type StateUpdateVisibleErrorResolution } from "@/lib/state-update-offline";
import { reportWriteFeedback } from "@/lib/write-feedback";
import {
  createStateUpdateVisibleErrorDiagnostics,
  hideStateUpdateTimeoutAfterConfirmedSync,
  resolveStateUpdateOperationFeedback,
  shouldRenderStateUpdateInlineFeedback,
  shouldShowStateUpdateVisibleErrorDiagnostics,
  stateUpdateLoadErrorMessage,
  stateUpdateRefreshErrorMessage,
  stateUpdateStaleCacheMessage,
  StateUpdateVisibleErrorDiagnostics,
  StateUpdateVisibleErrorOperation,
} from "./state-update-operation-feedback";

type ConflictState = Extract<StateUpdateBatchResult, { result: "CONFLICT" }> & {
  confirmationKey?: string;
  durableRecord?: CachedStateUpdateRecord;
  subjectName: string;
};

type StateValues = StateUpdateFormValues;
const STATE_UPDATE_LATEST_PAGE_SIZE = 20;

export function StateUpdateWorkflow({ appView }: AppViewRendererProps<WorkflowAppView & { config: StateUpdateWorkflowConfig }>) {
  const styles = useStateUpdateStyles();
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
    syncPendingRecords,
    token,
  } = useSession();
  const attentionParams = useLocalSearchParams<{ attentionDate?: string; attentionRecordId?: string; reportDate?: string; reportContext?: string }>();
  const router = useRouter();
  const compositeMode = (typeof appView.config.uniqueness === "object" ? appView.config.uniqueness.mode : appView.config.uniqueness) === "subject-date-fields";
  const targetDate = attentionDate(compositeMode ? attentionParams.reportDate ?? attentionParams.attentionDate : attentionParams.attentionDate);
  const [dateSelection, setDateSelection] = useState({ routeDate: targetDate, value: targetDate ?? (compositeMode ? "" : formatLocalDateInput(new Date())) });
  const date = dateSelection.routeDate === targetDate ? dateSelection.value : targetDate ?? dateSelection.value;
  const [searchText, setSearchText] = useState("");
  const [response, setResponse] = useState<StateUpdateResponse | null>(null);
  const [contextSelection, setContextSelection] = useState({ route: attentionParams.reportContext, value: parseCompositeContextValues(attentionParams.reportContext) });
  const identityValues = contextSelection.route === attentionParams.reportContext ? contextSelection.value : parseCompositeContextValues(attentionParams.reportContext);
  function setIdentityValues(next: (current: Record<string,string>) => Record<string,string>) {
    const value = next(identityValues);
    setContextSelection({route: attentionParams.reportContext, value});
    router.setParams({reportContext: JSON.stringify(value)});
  }
  const selectedIdentityJson = JSON.stringify(response?.appView.id === appView.id ? selectCompositeIdentity(response?.identityDefinition, response?.identityFields, identityValues) : undefined);
  const identity = useMemo(() => selectedIdentityJson ? JSON.parse(selectedIdentityJson) as import("@/lib/opco-api").CompositeStateIdentity : undefined, [selectedIdentityJson]);
  const identityKey = compositeIdentityKey(identity);
  const contextReady = !compositeMode || Boolean(identity && attentionDate(date));
  const preparationSourceId = response?.sourceEntityType.id;
  const preparationTargetId = response?.targetEntityType.id;
  const preparationDateFieldId = response?.dateFieldId;
  const preparationUniqueness = response?.uniqueness;
  const preparationHistoryMode = response?.historyMode;
  const preparationInput = useMemo(() => compositeMode && contextReady && identity && preparationSourceId && preparationTargetId && token && ownerKey && selectedContractId
    ? { api, token, store: definitionCache, scope: { identity, ownerKey, contractId: selectedContractId,
        appViewId: appView.id, sourceEntityTypeId: preparationSourceId, targetEntityTypeId: preparationTargetId,
        date, dateFieldId: preparationDateFieldId, uniqueness: preparationUniqueness, historyMode: preparationHistoryMode } }
    : null, [compositeMode, contextReady, identity, preparationSourceId, preparationTargetId,
      preparationDateFieldId, preparationUniqueness, preparationHistoryMode, api, token, ownerKey, selectedContractId, appView.id, date, definitionCache]);
  const contextPreparation = useContextPreparation({ input: preparationInput, connectivityStatus,
    canPrepare: !isAuthSessionRestoring && !isOperationalCoreReadinessChecking && !isPendingWorkSyncing,
    refreshKey: stateUpdateReconnectRefreshKey });
  const isPreparingContext = contextPreparation.isPreparing;
  const [verifiedOfflineAbsences, setVerifiedOfflineAbsences] = useState<{scope:string;ids:string[]}>({scope:"",ids:[]});
  const [confirmContextExit, setConfirmContextExit] = useState(false);
  const [items, setItems] = useState<StateUpdateItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<StateUpdateItem | null>(null);
  const [latestPage, setLatestPage] = useState(1);
  const [stateValues, setStateValues] = useState<StateValues>({});
  const [extraValues, setExtraValues] = useState<RecordFormValues>({});
  const [extraErrors, setExtraErrors] = useState<RecordFormErrors>({});
  const [extraReadIssues, setExtraReadIssues] = useState<RecordFormErrors>({});
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [durableConflicts, setDurableConflicts] = useState<CachedStateUpdateRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [resolutionFeedback, setResolutionFeedback] = useState<(ReturnType<typeof stateUpdateResolutionFeedback> & { scope: string }) | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [visibleErrorDiagnostics, setVisibleErrorDiagnostics] =
    useState<StateUpdateVisibleErrorDiagnostics | null>(null);
  const [readRequests, setReadRequests] = useState<Record<string, number>>({});
  const contextDefinitionLoads = useRef(new Map<string, Promise<StateUpdateResponse>>());
  const readScope = JSON.stringify([ownerKey, selectedContractId, appView.id, date, ...(compositeMode ? [identityKey] : [])]);
  const activeReadCount = (readRequests[readScope] ?? 0) + Number(isPreparingContext);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [offlineHistoryState, setOfflineHistoryState] = useState<StateUpdateOfflineHistoryState>(null);
  const requestSequenceRef = useRef(0);
  const resolutionScope = JSON.stringify([ownerKey, selectedContractId, appView.id, appView.config.targetEntityTypeId, date, ...(compositeMode ? [identityKey] : [])]);
  const resolutionScopeRef = useRef(resolutionScope);
  useLayoutEffect(() => { resolutionScopeRef.current = resolutionScope; }, [resolutionScope]);
  const resolutionInFlightRef = useRef(false);
  const resolutionMountedRef = useRef(false);
  useLayoutEffect(() => {
    resolutionMountedRef.current = true;
    return () => { resolutionMountedRef.current = false; };
  }, []);
  const stateUpdateRefreshKeyRef = useRef(stateUpdateReconnectRefreshKey);
  const isOnline = connectivityStatus === "online";
  const visibleResponse = response && response.appView.id === appView.id && (!compositeMode || (contextReady && compositeIdentityKey(response.identityContext) === identityKey)) && (!response.date || normalizeStateUpdateLogicalDate(response.date) === date) ? response : null;
  const showVisibleErrorDiagnostics = shouldShowStateUpdateVisibleErrorDiagnostics();
  const currentStateUpdateSyncRunId =
    stateUpdateReconnectDiagnostics.lastStateUpdateActivity?.syncRunId ??
    stateUpdateReconnectDiagnostics.lastStateUpdateSync?.syncRunId ??
    null;

  const hasDate = Boolean(visibleResponse?.dateFieldId ?? appView.config.dateFieldId);
  const normalizedSearch = normalizeStateUpdateSearch(searchText);
  const submitLabel = visibleResponse?.historyMode === "update-current" ? "Actualizar estado" : "Registrar cambio";
  const latest = visibleResponse?.latest ?? [];
  const latestPagination = visibleResponse?.latestPagination;
  const unresolvedCount = visibleResponse
    ? readSummaryCount(visibleResponse, "pendingCount") +
      readSummaryCount(visibleResponse, "failedCount") +
      readSummaryCount(visibleResponse, "conflictCount") +
      readSummaryCount(visibleResponse, "syncingCount")
    : 0;
  const visibleError = hideStateUpdateTimeoutAfterConfirmedSync({
    error,
    lastSync: stateUpdateReconnectDiagnostics.lastStateUpdateSync,
    pendingCount: unresolvedCount,
  }) ? null : error;
  const operationFeedback = resolveStateUpdateOperationFeedback({
    connectivityStatus,
    hasConflict: Boolean(conflict || readSummaryCount(visibleResponse, "conflictCount") > 0),
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
  const experienceErrorCode = contextPreparation.error ? "STATE_UPDATE_CONTEXT_PREPARATION_FAILED" : refreshError
    ? "STATE_UPDATE_REFRESH_FAILED"
    : error && !visibleResponse
      ? "STATE_UPDATE_ACTIVITY_FAILED"
      : null;
  const stateUpdateCoverage = useMemo(() => {
    if (!ownerKey || !selectedContractId || !visibleResponse || visibleResponse.appView.id !== appView.id) return null;
    return {
      scope: buildStateUpdateCoverageScope({
        appViewId: appView.id,
        identity,
        contractId: selectedContractId,
        ownerKey,
        date,
      }, {
        dateFieldId: visibleResponse.dateFieldId,
        historyMode: visibleResponse.historyMode,
        uniqueness: visibleResponse.uniqueness,
        targetEntityTypeId: visibleResponse.targetEntityType.id,
      }),
      sourceEntityTypeId: visibleResponse.sourceEntityType.id,
    };
  }, [appView.id, date, identity, ownerKey, selectedContractId, visibleResponse]);
  useExperienceActivityReporter(appView, {
    stateUpdateCoverage,
    activeCount: Math.max(activeReadCount, Number(isLoading) + Number(isSearching)) + Number(isLoadingMore) + Number(isSaving),
    readCount: activeReadCount + Number(!isOnline && isLoading && !isLoadingMore),
    readMode: visibleResponse ? "refresh" : "initial",
    errorCode: experienceErrorCode,
    result: experienceErrorCode ? "error" : !isLoading && !isSearching && !isLoadingMore && !isSaving ? "success" : null,
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
  }, [definitionCache, ownerKey, setVisibleErrorDiagnostics]);

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
  }, [currentStateUpdateSyncRunId, definitionCache, ownerKey, setVisibleErrorDiagnostics]);

  const recordedPreparationError = useRef<unknown>(null);
  useEffect(() => {
    if (!contextPreparation.error || recordedPreparationError.current === contextPreparation.error) return;
    recordedPreparationError.current = contextPreparation.error;
    recordVisibleError({ error: contextPreparation.error, operation: "refresh", resolution: "refresh_failed" });
  }, [contextPreparation.error, recordVisibleError]);

  const loadOfflineWorkflow = useCallback(async (query: { appendLatest?: boolean; fallbackReason?: "network-load"; page?: number; requestId?: number; search?: string; subjectRecordId?: string } = {}) => {
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
    if (compositeMode && !contextReady) {
      setResponse({ appView: { id: appView.id, name: appView.name, slug: appView.slug }, date, dateFieldId: definition.dateFieldId,
        identityFields: definition.identityFields, identityDefinition: definition.identityDefinition, identityContext: null, contextRequired: true,
        extraFields: definition.extraFields, stateFields: definition.stateFields, subjectFieldId: definition.subjectFieldId,
        historyMode: definition.historyMode, uniqueness: definition.uniqueness, items: [], latest: [],
        sourceEntityType: { id: definition.sourceEntityTypeId, name: definition.sourceEntityTypeName ?? "Registros" }, targetEntityType: { id: definition.targetEntityTypeId, name: definition.targetEntityTypeName ?? "Registros" } });
      setItems([]);return true;
    }

    const sourceTelemetry = await definitionCache.getSyncTelemetry({
      contractId: selectedContractId,
      entityTypeId: definition.sourceEntityTypeId,
      ownerKey,
    });
    const sourceHydrated = hasSuccessfulHydration(sourceTelemetry);

    const scope = buildStateUpdateCoverageScope({
      appViewId: appView.id,
      identity,
      contractId: selectedContractId,
      date,
      ownerKey,
    }, definition);
    const latestPageToLoad = query.page ?? 1;
    const [summary, latestResult, localConflicts, storedCoverage, currentCoverage] = await Promise.all([
      definitionCache.getStateUpdateSummary(scope),
      definitionCache.listStateUpdateLatest({
        ...scope,
        page: latestPageToLoad,
        pageSize: STATE_UPDATE_LATEST_PAGE_SIZE,
        search: query.search,
      }),
      definitionCache.listStateUpdateConflicts(scope),
      definitionCache.getStateUpdateSnapshotCoverage(scope),
      compositeMode ? definitionCache.getStateUpdateCurrentCoverage({...scope,sourceEntityTypeId:definition.sourceEntityTypeId}) : null,
    ]);
    const effectiveCoverage = resolveStateUpdateOfflineHistoryState({
      cachedRecordCount: Math.max(latestResult.items.length, summary.totalRegistered),
      storedCoverage: storedCoverage?.status,
    });
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

    if (!isStateUpdateVisualRequestCurrent(requestSequenceRef.current, query.requestId)) {
      return false;
    }

    if (compositeMode) setVerifiedOfflineAbsences({scope:readScope,ids:Object.entries(currentCoverage?.subjects ?? {}).filter(([,authority])=>hasVerifiedCompositeAbsence(authority)).map(([id])=>id)});
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
      identityFields: definition.identityFields, identityDefinition: definition.identityDefinition, identityContext: identity,
      extraFields: definition.extraFields,
      historyMode: definition.historyMode,
      items: nextItems,
      latest: latestResult.items,
      latestPagination: latestResult.pagination,
      sourceEntityType: {
        id: definition.sourceEntityTypeId,
        name: definition.sourceEntityTypeName ?? "Registros",
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
        name: definition.targetEntityTypeName ?? "Actualizaciones",
      },
      uniqueness: definition.uniqueness,
    };
    const visibleLocalConflicts = filterStateUpdateConflictsForQuery(localConflicts, query);
    const nextVisibleResponse = mergeStateUpdateResponseWithLocalConflicts(nextResponse, visibleLocalConflicts);
    setResponse((current) => query.appendLatest && current
      ? {
          ...nextVisibleResponse,
          latest: mergeStateUpdateLatestUpdates(current.latest ?? [], nextVisibleResponse.latest ?? []),
        }
      : nextVisibleResponse);
    setDurableConflicts(visibleLocalConflicts);
    setItems(nextItems);
    setLatestPage(latestPageToLoad);
    setOfflineHistoryState(effectiveCoverage);

    const hasCachedWorkflowData = sourceHydrated || (nextResponse.latest ?? []).length > 0 || summary.totalRegistered > 0;

    if (!hasCachedWorkflowData) {
      setError(query.fallbackReason === "network-load"
        ? "No fue posible cargar la información. Reintentar"
        : "Abre este workflow con conexion para preparar sus datos sin conexion.");
      return false;
    } else if (visibleLocalConflicts.length > 0) {
      setError(`${visibleLocalConflicts.length} conflictos por resolver.`);
    }

    return true;
  }, [identity, contextReady, compositeMode, appView.id, appView.name, appView.slug, date, definitionCache, ownerKey, selectedContractId, setError, setItems, setDurableConflicts, setLatestPage, setOfflineHistoryState, readScope, setVerifiedOfflineAbsences]);

  const loadWorkflow = useCallback(async (query: { appendLatest?: boolean; operation?: StateUpdateVisibleErrorOperation; page?: number; search?: string; subjectRecordId?: string } = {}) => {
    if (!token || !selectedContractId) {
      setError("Selecciona un contrato antes de abrir este workflow.");
      setIsLoading(false);
      return;
    }

    const activityScope = JSON.stringify([ownerKey, selectedContractId, appView.id, date, ...(compositeMode ? [identityKey] : [])]);
    if (!query.appendLatest) setReadRequests(current => ({ ...current, [activityScope]: (current[activityScope] ?? 0) + 1 }));
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
        await loadOfflineWorkflow({ ...query, requestId });
        return;
      }

      const queryInput = {
        date: hasDate && date && contextReady ? date : undefined,
        identity: contextReady ? identity : undefined,
        page: latestPageToLoad,
        pageSize: STATE_UPDATE_LATEST_PAGE_SIZE,
        search: contextReady ? query.search : undefined,
        subjectRecordId: contextReady ? query.subjectRecordId : undefined,
      };
      const definitionKey = JSON.stringify([ownerKey, selectedContractId, appView.id, appView.config]);
      let definitionLoad = compositeMode && !contextReady ? contextDefinitionLoads.current.get(definitionKey) : undefined;
      if (!definitionLoad) {
        definitionLoad = api.getStateUpdateWorkflow(token, selectedContractId, appView.id, queryInput);
        if (compositeMode && !contextReady) {
          contextDefinitionLoads.current.set(definitionKey, definitionLoad);
          void definitionLoad.catch(() => contextDefinitionLoads.current.delete(definitionKey));
        }
      }
      const nextResponse = await definitionLoad;

      if (!isStateUpdateVisualRequestCurrent(requestSequenceRef.current, requestId)) {
        return;
      }

      if (nextResponse.uniqueness === "subject-date-fields" && nextResponse.contextRequired) {
        setResponse(nextResponse);setItems([]);
        if (ownerKey) await definitionCache.upsertAppViewDefinition({ appViewId: appView.id, appViewType: "WORKFLOW", workflowKey: "state-update", ownerKey, contractId: selectedContractId,
          status: "ready", lastPreparedAt: new Date().toISOString(), definition: { appView, kind: "state-update", sourceEntityTypeId: nextResponse.sourceEntityType.id,
            sourceEntityTypeName: nextResponse.sourceEntityType.name, targetEntityTypeId: nextResponse.targetEntityType.id, targetEntityTypeName: nextResponse.targetEntityType.name,
            dateFieldId: nextResponse.dateFieldId, subjectFieldId: nextResponse.subjectFieldId, stateFields: nextResponse.stateFields, extraFields: nextResponse.extraFields,
            identityFields: nextResponse.identityFields, identityDefinition: nextResponse.identityDefinition, historyMode: nextResponse.historyMode, uniqueness: nextResponse.uniqueness } });
        return;
      }
      const localConflicts = ownerKey
        ? await definitionCache.listStateUpdateConflicts({
            appViewId: appView.id,
            identity,
            contractId: selectedContractId,
            date: normalizeStateUpdateLogicalDate(nextResponse.date),
            ownerKey,
            targetEntityTypeId: nextResponse.targetEntityType.id,
          })
        : [];

      if (!isStateUpdateVisualRequestCurrent(requestSequenceRef.current, requestId)) {
        return;
      }

      const visibleLocalConflicts = filterStateUpdateConflictsForQuery(localConflicts, query);
      const nextVisibleResponse = mergeStateUpdateResponseWithLocalConflicts(nextResponse, visibleLocalConflicts);

      setResponse((current) => query.appendLatest && current
        ? {
            ...nextVisibleResponse,
            latest: mergeStateUpdateLatestUpdates(current.latest ?? [], nextVisibleResponse.latest ?? []),
          }
        : nextVisibleResponse);
      setDurableConflicts(visibleLocalConflicts);
      setItems(nextVisibleResponse.items);
      setLatestPage(latestPageToLoad);
      setOfflineHistoryState(null);
      setRefreshError(null);
      clearVisibleError();
      if (ownerKey) {
        const pagination = nextResponse.latestPagination ?? {
          hasMore: false,
          page: latestPageToLoad,
          pageSize: Math.max(1, nextResponse.latest?.length ?? 0),
          total: nextResponse.latest?.length ?? 0,
        };
        const snapshotResult = await definitionCache.upsertStateUpdateSnapshot({
          appViewId: appView.id,
          identity,
          complete: !query.search && !query.subjectRecordId && pagination.page === 1 && !pagination.hasMore,
          expectedRemoteEventCount: pagination.page === 1 && !pagination.hasMore ? pagination.total : undefined,
          contractId: selectedContractId,
          date: normalizeStateUpdateLogicalDate(nextResponse.date),
          dateFieldId: nextResponse.dateFieldId,
          historyMode: nextResponse.historyMode,
          uniqueness: nextResponse.uniqueness,
          projectionDefinition: {
            sourceEntityTypeId: nextResponse.sourceEntityType.id, subjectFieldId: nextResponse.subjectFieldId,
            identityFields: nextResponse.identityFields, identityDefinition: nextResponse.identityDefinition,
            dateFieldId: nextResponse.dateFieldId, stateFields: nextResponse.stateFields, extraFields: nextResponse.extraFields,
          },
          items: nextResponse.items,
          latest: nextResponse.latest ?? [],
          ownerKey,
          targetEntityTypeId: nextResponse.targetEntityType.id,
        });
        if (!query.search && !query.subjectRecordId) {
          await definitionCache.markStateUpdateSnapshotCoverage({
            dateFieldId: nextResponse.dateFieldId,
            historyMode: nextResponse.historyMode,
            uniqueness: nextResponse.uniqueness,
            snapshotResult,
            appViewId: appView.id,
            identity,
            contractId: selectedContractId,
            date: normalizeStateUpdateLogicalDate(nextResponse.date),
            ownerKey,
            pagination,
            targetEntityTypeId: nextResponse.targetEntityType.id,
          });
        }
      }
    } catch (nextError) {
      if (isStateUpdateVisualRequestCurrent(requestSequenceRef.current, requestId)) {
        recordVisibleError({
          error: nextError,
          operation,
          resolution: operation === "refresh" ? "refresh_failed" : "unresolved",
        });

        if (isOnline && nextError instanceof OpcoNetworkError && isStateUpdateReadOperation(operation)) {
          const loadedFromCache = await loadOfflineWorkflow({ ...query, fallbackReason: "network-load", requestId });

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
      if (!query.appendLatest) setReadRequests(current => {
        const next = { ...current };
        if ((next[activityScope] ?? 0) <= 1) delete next[activityScope];
        else next[activityScope] -= 1;
        return next;
      });
      if (isStateUpdateVisualRequestCurrent(requestSequenceRef.current, requestId)) {
        setIsLoading(false);
        setIsSearching(false);
        setIsLoadingMore(false);
      }
    }
  }, [api, appView, identity, identityKey, contextReady, compositeMode, clearVisibleError, connectivityStatus, date, definitionCache, hasDate, isOnline, loadOfflineWorkflow, ownerKey, recordVisibleError, selectedContractId, token, setDurableConflicts, setError, setIsLoading, setIsLoadingMore, setIsSearching, setItems, setLatestPage, setOfflineHistoryState, setReadRequests, setRefreshError, setResponse]);

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

  function setDate(next: string | ((current: string) => string)) {
    const value = typeof next === "function" ? next(date) : next;
    if (compositeMode && value === date) return;
    setDateSelection({ routeDate: targetDate, value });
    if (compositeMode) {
      requestSequenceRef.current += 1;
      setItems([]);setSelectedItem(null);setConflict(null);setDurableConflicts([]);
      setSuccessMessage(null);setError(null);setRefreshError(null);setResolutionFeedback(null);
      router.setParams({ reportDate: value });
    }
  }

  function clearEditor() {
    setItems([]);
    setSelectedItem(null);
    setStateValues(response ? defaultStateValues(response.stateFields) : {});
    setExtraValues(extraDefinition ? buildInitialFormValues(extraDefinition) : {});
    setExtraReadIssues({});
    setExtraErrors({});
    setConflict(null);
  }

  function unavailableCompositeAbsence(item: StateUpdateItem) {
    return compositeMode && !isOnline && !item.current && (verifiedOfflineAbsences.scope !== readScope || !verifiedOfflineAbsences.ids.includes(item.subject.id));
  }
  async function selectSubject(item: StateUpdateItem) {
    if (unavailableCompositeAbsence(item)) { setError("Prepara este contexto con conexión antes de crear un reporte sin conexión.");return; }
    setSelectedItem(item);
    setConflict(null);
    setError(null);
    setRefreshError(null);
    setSuccessMessage(null);
    setResolutionFeedback(null);
    setStateValues(initialStateValues(response, item));
    const extras = extraDefinition ? buildStateUpdateExtraForm(extraDefinition, item.current?.extraValues, item.current?.extraValuesFormat) : { values: {}, issues: {} };
    setExtraValues(extras.values);
    setExtraReadIssues(extras.issues);
    setExtraErrors(extras.issues);

    await loadWorkflow({ operation: "source-load", subjectRecordId: item.subject.id });
  }

  function setExtraValue(key: string, value: string | boolean | string[]) {
    setExtraValues((current) => ({ ...current, [key]: value }));
    setExtraReadIssues(current => { const next = { ...current }; delete next[key]; return next; });
    setExtraErrors((current) => {
      const next = { ...current };
      delete next[key];

      return next;
    });
  }

  async function saveSelected(overwrite = false, expectedUpdatedAt?: string) {
    if (!response || !selectedItem || !selectedContractId || isSaving || !contextReady) {
      return;
    }

    const stateSnapshot = buildEffectiveStateSnapshot({
      currentStateValues: selectedItem.current?.stateValues,
      fields: response.stateFields,
      formValues: stateValues,
    });
    const nextExtraErrors = { ...validateFormFields(response.extraFields, extraValues), ...extraReadIssues };

    if (stateSnapshot.error || Object.keys(nextExtraErrors).length > 0) {
      setExtraErrors(nextExtraErrors);
      setError(stateSnapshot.error);
      return;
    }

    if (!stateSnapshot.hasChanges && response.extraFields.length === 0) {
      setError("No hay cambios para guardar.");
      return;
    }

    const selectedScope = resolutionScope;
    if (compositeMode && selectedItem.current && !overwrite) {
      const cached = ownerKey ? await definitionCache.getCachedRecord({ ownerKey, contractId: selectedContractId, entityTypeId: response.targetEntityType.id, recordId: selectedItem.current.recordId }) : null;
      if (resolutionScopeRef.current !== selectedScope || !resolutionMountedRef.current) return;
      if (!cached || cached.serverId) {
        setConflict({ confirmationKey: compositeConfirmationKey(selectedScope, selectedItem.subject.id, selectedItem.current.updatedAt, stateSnapshot.stateValues, buildStateUpdateExtraSubmit(response.extraFields, extraValues)), result: "CONFLICT", subjectRecordId: selectedItem.subject.id, subjectName: selectedItem.subject.displayName,
          existing: selectedItem.current, requested: { extraValuesFormat: "field-value", stateValues: stateSnapshot.stateValues.map(v => ({ ...v, label: null, optionId: v.optionId ?? null })), extraValues: buildStateUpdateExtraSubmit(response.extraFields, extraValues) } });
        return;
      }
    }
    const savingScope = resolutionScope;
    const entry: StateUpdateEntry = {
      identity,
      expectedUpdatedAt,
      extraValues: buildStateUpdateExtraSubmit(response.extraFields, extraValues),
      overwrite,
      stateValues: stateSnapshot.stateValues,
      subjectRecordId: selectedItem.subject.id,
    };

    setIsSaving(true);
    setError(null);
    setRefreshError(null);
    setSuccessMessage(null);
    setResolutionFeedback(null);

    try {
      if (!isOnline || compositeMode) {
        if (!ownerKey) {
          return;
        }

        const localRecord = await definitionCache.saveStateUpdateLocally({
          appViewId: appView.id,
          identity,
          contractId: selectedContractId,
          date: hasDate ? date : undefined,
          expectedUpdatedAt: expectedUpdatedAt ?? selectedItem.current?.updatedAt ?? null,
          preserveIdenticalConfirmedIntent: compositeMode,
          extraValues: buildStateUpdateExtraSubmit(response.extraFields, extraValues),
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
        if (compositeMode && resolutionScopeRef.current !== savingScope) return;
        reportWriteFeedback({ appViewId: appView.id, appViewTitle: appView.name, contractId: selectedContractId, kind: "local-saved", ownerKey });
        insertSavedLatestItem({
          recordId: localRecord.localRecordId,
          stateValues: stateSnapshot.stateValues,
          subject: selectedItem.subject,
          updatedAt: new Date().toISOString(),
        });
        clearVisibleError();
        clearEditor();
        await refreshRecordsSyncSummary();
        if (compositeMode && isOnline) {
          await syncPendingRecords();
          await loadWorkflow({ operation: "refresh", subjectRecordId: localRecord.subject.id });
          await refreshRecordsSyncSummary();
        }
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
        if (ownerKey) {
          reportWriteFeedback({ appViewId: appView.id, appViewTitle: appView.name, contractId: selectedContractId, kind: "server-confirmed", ownerKey });
        }
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
        extraValues: buildStateUpdateExtraSubmit(current.extraFields, extraValues),
        extraValuesFormat: "field-value",
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

    if (conflict.durableRecord) {
      await handleUseLocalConflictChange(conflict.durableRecord);
      return;
    }

    if (compositeMode && (!selectedItem || !response || conflict.confirmationKey !== compositeConfirmationKey(resolutionScope, selectedItem.subject.id, selectedItem.current?.updatedAt ?? "", buildEffectiveStateSnapshot({currentStateValues:selectedItem.current?.stateValues,fields:response.stateFields,formValues:stateValues}).stateValues, buildStateUpdateExtraSubmit(response.extraFields,extraValues)))) {
      setConflict(null);setError("El contexto o el cambio mostrado cambió. Revisa y confirma nuevamente.");return;
    }
    await saveSelected(true, conflict.existing.updatedAt);
  }

  function openDurableConflict(record: CachedStateUpdateRecord) {
    setConflict(stateUpdateDurableConflictState(record));
    setError(null);
    setSuccessMessage(null);
    setResolutionFeedback(null);
  }

  async function handleUseLocalConflictChange(record: CachedStateUpdateRecord) {
    if (!ownerKey || !selectedContractId || !response || isSaving || resolutionInFlightRef.current) {
      return;
    }

    resolutionInFlightRef.current = true;
    const selectedScope = resolutionScope;
    const isCurrent = () => resolutionMountedRef.current && resolutionScopeRef.current === selectedScope;
    requestSequenceRef.current += 1;
    setIsSaving(true);
    setError(null);
    setRefreshError(null);
    setSuccessMessage(null);
    setResolutionFeedback(null);

    try {
      const saved = await definitionCache.resolveStateUpdateConflictWithLocal({
        conflictIdentity: record.conflictIdentity ?? "",
        appViewId: appView.id,
        identity,
        contractId: selectedContractId,
        date: hasDate ? date : undefined,
        expectedUpdatedAt: record.conflictRemoteUpdatedAt,
        extraValues: record.extraValues,
        historyMode: response.historyMode,
        localRecordId: record.localRecordId,
        overwrite: true,
        ownerKey,
        stateFields: response.stateFields,
        stateValues: record.stateValues,
        subjectDisplayName: record.subject.displayName,
        subjectRecordId: record.subject.id,
        targetEntityTypeId: response.targetEntityType.id,
        uniqueness: response.uniqueness,
      });

      let syncError: unknown;
      if (isOnline) {
        try { await syncPendingRecords(); } catch (error) { syncError = error; }
      }
      if (!isCurrent()) return;
      await loadWorkflow({ operation: "refresh" });
      if (!isCurrent()) return;
      await refreshRecordsSyncSummary();
      if (!isCurrent()) return;
      const outcome = await definitionCache.getStateUpdateResolutionOutcome({
        appViewId: appView.id, contractId: selectedContractId, identity, ownerKey,
        targetEntityTypeId: response.targetEntityType.id, date: hasDate ? date : undefined,
        localRecordId: saved.localRecordId, clientRequestId: saved.clientRequestId!,
      });
      if (!isCurrent()) return;
      setConflict(null);
      setResolutionFeedback({ ...stateUpdateResolutionFeedback(outcome), scope: selectedScope });
      if (outcome === "confirmed" || outcome === "pending") {
        setSuccessMessage(outcome === "confirmed" ? "Cambio confirmado por Opco." : "Cambio guardado; envio pendiente.");
        reportWriteFeedback({ appViewId: appView.id, appViewTitle: appView.name, contractId: selectedContractId,
          kind: outcome === "confirmed" ? "server-confirmed" : "local-saved", ownerKey });
      } else {
        setError(outcome === "conflict" ? "Opco devolvio un nuevo conflicto. Revisa ambas versiones." :
          outcome === "failed" ? "El envio del cambio fallo. La intencion se conserva." :
            "La intencion seleccionada cambio durante la resolucion. Revisa el estado actual.");
      }
      if (syncError) recordVisibleError({ error: syncError, operation: "sync" });
    } catch (nextError) {
      if (!isCurrent()) return;
      setError(nextError instanceof Error ? nextError.message : "No fue posible resolver el conflicto.");
      recordVisibleError({ error: nextError, operation: "sync" });
    } finally {
      resolutionInFlightRef.current = false;
      setIsSaving(false);
    }
  }

  async function handleUseRemoteConflictChange(record: CachedStateUpdateRecord) {
    if (!ownerKey || !selectedContractId || !response || isSaving || resolutionInFlightRef.current) {
      return;
    }

    resolutionInFlightRef.current = true;
    const selectedScope = resolutionScope;
    const isCurrent = () => resolutionMountedRef.current && resolutionScopeRef.current === selectedScope;
    requestSequenceRef.current += 1;
    setIsSaving(true);
    setError(null);
    setRefreshError(null);
    setSuccessMessage(null);
    setResolutionFeedback(null);

    try {
      await definitionCache.discardStateUpdateLocalChange({
        localRecordId: record.localRecordId,
        conflictIdentity: record.conflictIdentity ?? "",
        appViewId: appView.id,
        identity,
        contractId: selectedContractId,
        date: hasDate ? date : undefined,
        ownerKey,
        subjectRecordId: record.subject.id,
        targetEntityTypeId: response.targetEntityType.id,
      });
      if (!isCurrent()) return;
      await refreshRecordsSyncSummary();
      if (!isCurrent()) return;
      setConflict(null);
      setResolutionFeedback({ ...stateUpdateResolutionFeedback("local"), scope: selectedScope });
      setSuccessMessage("Resolucion local guardada con el estado de Opco.");
      await loadWorkflow({ operation: "refresh" });
    } catch (nextError) {
      if (!isCurrent()) return;
      setError(nextError instanceof Error ? nextError.message : "No fue posible resolver el conflicto.");
      recordVisibleError({ error: nextError, operation: "sync" });
    } finally {
      resolutionInFlightRef.current = false;
      setIsSaving(false);
    }
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

  useExperienceOpeningTelemetry(appView, useMemo(() => ({
    errorCode: error && !isLoading ? "STATE_UPDATE_LOAD_FAILED" : null,
    firstUseful: Boolean(visibleResponse) && !isLoading,
    processedCount: (visibleResponse?.items.length ?? 0) + (visibleResponse?.latest?.length ?? 0),
    ready: !isLoading,
    result: isLoading ? "in_progress" as const : error && !visibleResponse ? "error" as const : "completed" as const,
    shownCount: (visibleResponse?.items.length ?? 0) + (visibleResponse?.latest?.length ?? 0),
    source: connectivityStatus === "offline" ? "local" as const : "remote" as const,
  }), [connectivityStatus, error, isLoading, visibleResponse]));

  return (
    <ScrollView testID="state-update-workflow" contentContainerStyle={styles.content} style={styles.screen}>
      {Platform.OS === "web" ? <style>{`@media (min-width: ${APP_SHELL_WIDE_BREAKPOINT}px) {
        [data-testid="state-update-workflow"] input:focus-visible,
        [data-testid="state-update-workflow"] textarea:focus-visible,
        [data-testid="state-update-workflow"] select:focus-visible,
        [data-testid="state-update-workflow"] [role="button"]:focus-visible,
        [data-testid="state-update-modal"] [role="button"]:focus-visible { outline: 3px solid #315DA8; outline-offset: 2px; }
      }`}</style> : null}
      <View style={styles.header}>
        <View style={styles.icon}>
          <AppIcon icon={appView.icon} size={26} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{appView.name}</Text>
          <Text style={styles.meta}>{visibleResponse?.targetEntityType.name ?? "Workflow"}</Text>
        </View>
      </View>

      {!isSaving && resolutionFeedback?.scope === resolutionScope && resolutionFeedback.message !== operationFeedback.message ? (
        <Text style={resolutionFeedback.outcome === "conflict" || resolutionFeedback.outcome === "failed" || resolutionFeedback.outcome === "superseded"
          ? styles.error : resolutionFeedback.outcome === "pending" ? styles.offline : styles.success}>
          {resolutionFeedback.message}
        </Text>
      ) : null}
      {operationFeedback.message && shouldRenderStateUpdateInlineFeedback(operationFeedback.phase) ? (
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

      {durableConflicts.length > 0 && visibleResponse ? (
        <DurableConflictList
          conflicts={[...durableConflicts].sort((a, b) => Number(b.localRecordId === attentionParams.attentionRecordId) - Number(a.localRecordId === attentionParams.attentionRecordId))}
          extraFields={visibleResponse.extraFields}
          fields={visibleResponse.stateFields}
          isSaving={isSaving}
          onUseLocal={openDurableConflict}
          onUseRemote={(record) => void handleUseRemoteConflictChange(record)}
        />
      ) : null}

      {compositeMode ? <View style={styles.contextPanel}>
        <Text style={styles.label}>Contexto del reporte</Text>
        <View style={styles.contextFields}><View style={styles.contextDate}><Text style={styles.label}>Fecha operacional</Text><DateFieldInput label="Fecha operacional" required disabled={!!selectedItem || isSaving} value={date} onChange={setDate} /></View>
        {response?.identityFields?.map(field => <View key={field.fieldId} style={styles.contextField}>
          <Text style={styles.label}>{field.label}</Text>
          <CompactSelect label={field.label} required disabled={!!selectedItem || isSaving} value={identityValues[field.fieldId] ?? ""}
            options={field.options.map(option => ({ value: option.optionId, label: option.label, disabled: option.active === false }))}
            onChange={value => { const optionId = String(value); if(identityValues[field.fieldId]===optionId)return;requestSequenceRef.current++;setIdentityValues(v=>({...v,[field.fieldId]:optionId}));setItems([]);setConflict(null);setSuccessMessage(null); }} />
        </View>)}</View>
        {!contextReady ? <Text>{compositeContextInstruction(date, response?.identityFields ?? [], identityValues)}</Text> : null}
        {contextReady && contextPreparation.phase === "ready" ? <Text>Copia del contexto actualizada para uso sin conexión.</Text> : null}
        {contextReady && contextPreparation.phase === "partial" ? <Text>Preparación parcial: faltan sujetos o reportes por verificar. Puedes reintentar.</Text> : null}
        {contextPreparation.error ? <Text style={styles.error}>{stateUpdateRefreshErrorMessage(contextPreparation.error)}</Text> : null}
        {contextReady && contextPreparation.phase === "failed" && contextPreparation.coverage ? <Text>La actualización falló. Se conservan los datos guardados; su cobertura no acredita que estén actualizados.</Text> : null}
        {contextReady && !isOnline ? <Text>{contextPreparation.coverage?.status === "complete"
          ? "Sin conexión. Contexto verificado disponible; el historial puede estar incompleto."
          : "Sin conexión. Disponibilidad del contexto no verificada por completo; sólo se muestran los datos guardados."}</Text> : null}
        {contextReady && isOnline && (contextPreparation.phase === "failed" || contextPreparation.phase === "partial") ? <Pressable accessibilityRole="button" disabled={isPreparingContext || !!selectedItem} onPress={()=>void contextPreparation.prepare()} style={styles.secondaryButton}><Text style={styles.secondaryText}>Reintentar</Text></Pressable> : null}
      </View> : null}
      <View style={styles.searchBlock}>
        <TextInput
          autoCapitalize="words"
          onChangeText={(value) => {
            setSearchText(value);
            requestSequenceRef.current += 1;
            setItems([]);
            setIsSearching(Boolean(normalizeStateUpdateSearch(value)));
            setSelectedItem(null);
            setConflict(null);
            setSuccessMessage(null);
            setResolutionFeedback(null);
          }}
          editable={contextReady}
          placeholder="Buscar"
          style={styles.searchInput}
          value={searchText}
        />
      </View>


      {(isLoading || isSearching) && !(visibleResponse && (!normalizedSearch || items.length > 0)) ? <ReadLoadingState mode="initial" /> : null}
      {!selectedItem && normalizedSearch ? (
        <View style={styles.list}>
          {!isSearching && items.length === 0 ? <Text style={styles.empty}>Sin resultados.</Text> : null}
          <StateUpdateReadRows fullFieldIds={(response?.stateFields ?? []).filter(field => ["TEXT", "TEXTAREA"].includes(stateFieldType(field))).map(field => field.fieldId)} rows={items.map(item => ({ key: item.subject.id, name: item.subject.displayName,
            compactText: unavailableCompositeAbsence(item) ? "Reporte no verificado sin conexión" : formatCurrentState(response, item) ?? "Sin estado",
            fallback: unavailableCompositeAbsence(item) ? "Reporte no verificado sin conexión" : "Sin estado",
            values: unavailableCompositeAbsence(item) || !item.current ? [] : (response?.stateFields ?? []).flatMap(field => {
              const value = formatStateValueLabel(field, currentStateValue(item.current?.stateValues ?? [], field.fieldId));
              return value ? [{ fieldId: field.fieldId, label: field.label, value }] : [];
            }), onPress: () => void selectSubject(item),
          }))} />
        </View>
      ) : null}

      {selectedItem && visibleResponse ? (
        <View style={styles.editorPanel}>
          <View style={styles.subjectText}>
            <Text style={styles.panelName}>{selectedItem.subject.displayName}</Text>
            <Text style={styles.statusMeta}>Actual: {formatCurrentState(visibleResponse, selectedItem) ?? "Sin estado"}</Text>
          </View>

          <StateUpdateFormGrid slots={[
            ...(hasDate && !compositeMode ? [{ key: "report-date", content: <View style={styles.fieldGroup}>
              <Text style={styles.label}>{visibleResponse.dateField?.name ?? "Campo de fecha"}</Text>
              <DateFieldInput label={visibleResponse.dateField?.name ?? "Campo de fecha"} required value={date} onChange={setDate} />
            </View> }] : []),
            ...visibleResponse.stateFields.map(field => ({ key: `state:${field.fieldId}`, full: ["TEXT", "TEXTAREA"].includes(stateFieldType(field)), content:
              <StateFieldInput field={field} onChange={(value) => {
                setStateValues((current) => ({ ...current, [field.fieldId]: value }));
                setError(null);
              }} value={stateValues[field.fieldId]} /> })),
            ...visibleResponse.extraFields.map(field => ({ key: `extra:${field.id}`, full: ["TEXT", "TEXTAREA"].includes(field.type), content:
              <RecordFieldInput error={extraErrors[field.key] ?? (field.type === "SELECT" && !field.options ? "Opciones no disponibles sin una definición actualizada con conexión." : undefined)} field={field}
                onChange={(value) => setExtraValue(field.key, value)} value={field.type === "SELECT" && extraReadIssues[field.key] ? unavailableStateUpdateExtraInput(field, extraValues[field.key]) : extraValues[field.key]} /> })),
          ]} />
          <View style={styles.formActions}>
          <Pressable
            disabled={isSaving}
            onPress={() => void saveSelected()}
            style={[styles.primaryButton, isSaving && styles.disabledButton]}
          >
            {isSaving ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryText}>{submitLabel}</Text>}
          </Pressable>
          {compositeMode ? <Pressable accessibilityRole="button" disabled={isSaving} onPress={()=>setConfirmContextExit(true)} style={styles.secondaryButton}><Text style={styles.secondaryText}>Volver a buscar</Text></Pressable> : null}
          </View>
        </View>
      ) : null}

      {!selectedItem ? (
        <LatestList
          isLoadingMore={isLoadingMore}
          latest={latest}
          onLoadMore={loadMoreLatest}
          pagination={latestPagination}
          response={visibleResponse}
          state={offlineHistoryState}
          readFailed={Boolean(visibleError && !visibleResponse)}
        />
      ) : null}

      <Modal visible={confirmContextExit} transparent onRequestClose={()=>setConfirmContextExit(false)}><View testID="state-update-modal" style={styles.modalBackdrop}><View style={styles.modalPanel}>
        <Text style={styles.title}>¿Descartar el borrador sin guardar?</Text><Text>Los cambios ya guardados y pendientes se conservan.</Text>
        <Pressable accessibilityRole="button" onPress={()=>setConfirmContextExit(false)} style={styles.secondaryButton}><Text>Continuar editando</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={()=>{clearEditor();setConfirmContextExit(false);}} style={styles.secondaryButton}><Text>Volver a buscar</Text></Pressable>
      </View></View></Modal>
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

function filterStateUpdateConflictsForQuery(
  conflicts: CachedStateUpdateRecord[],
  query: { search?: string; subjectRecordId?: string },
) {
  return conflicts.filter((record) => {
    if (query.subjectRecordId && record.subject.id !== query.subjectRecordId) {
      return false;
    }

    return !query.search || stateUpdateLatestMatchesSearch(stateUpdateConflictLatestItem(record), query.search);
  });
}

function stateUpdateDurableConflictState(record: CachedStateUpdateRecord): ConflictState {
  return {
    durableRecord: record,
    existing: {
      extraValues: record.conflictRemoteExtraValues,
      extraValuesFormat: record.conflictRemoteExtraValuesFormat,
      recordId: record.localRecordId,
      stateValues: record.conflictRemoteStateValues ?? [],
      updatedAt: record.conflictRemoteUpdatedAt ?? "",
    },
    requested: {
      extraValues: record.extraValues,
      extraValuesFormat: record.extraValuesFormat,
      stateValues: record.stateValues,
    },
    result: "CONFLICT",
    subjectName: record.subject.displayName,
    subjectRecordId: record.subject.id,
  };
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
  state,
  readFailed,
}: {
  isLoadingMore: boolean;
  latest: StateUpdateLatestItem[];
  onLoadMore(): void;
  pagination: StateUpdateResponse["latestPagination"] | undefined;
  response: StateUpdateResponse | null;
  state: StateUpdateOfflineHistoryState;
  readFailed: boolean;
}) {
  const styles = useStateUpdateStyles();
  const statusMessage = stateUpdateOfflineHistoryMessage({
    coverage: state,
    hasItems: latest.length > 0,
    readFailed,
  });

  return (
    <View style={styles.latestBlock}>
      <Text style={styles.sectionTitle}>Últimas actualizaciones</Text>
      {statusMessage ? <Text style={state === "partial" || state === "absent" ? styles.offline : styles.empty}>{statusMessage}</Text> : null}
      {state === null && latest.length === 0 && !readFailed ? <Text style={styles.empty}>Sin actualizaciones</Text> : null}
      <StateUpdateReadRows fullFieldIds={[...(response?.stateFields ?? []).filter(field => ["TEXT", "TEXTAREA"].includes(stateFieldType(field))).map(field => field.fieldId), ...(response?.extraFields ?? []).filter(field => ["TEXT", "TEXTAREA"].includes(field.type)).map(field => field.id)]} rows={latest.map(item => ({ key: item.recordId, name: item.subject.displayName, values: buildStateUpdateLatestRows(response, item) }))} />
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
  const styles = useStateUpdateStyles();
  const type = stateFieldType(field);

  if (type === "SELECT") {
    return (
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{field.label}</Text>
        <CompactSelect label={field.label} required={field.required} value={typeof value === "string" ? value : ""}
          options={field.options.map(option => ({ value: option.optionId, label: option.label, disabled: option.active === false }))}
          onChange={value => onChange(String(value))} />
      </View>
    );
  }

  if (type === "DATE" || type === "TIME" || type === "DATETIME") {
    const Input = type === "DATE" ? DateFieldInput : type === "TIME" ? TimeFieldInput : DateTimeFieldInput;
    return <View style={styles.fieldGroup}><Text style={styles.label}>{field.label}</Text>
      <Input label={field.label} required={field.required} value={typeof value === "string" ? value : ""} onChange={onChange} />
    </View>;
  }

  if (type === "BOOLEAN") {
    const selected = value === true;

    return (
      <View style={styles.fieldGroup}>
        <Text style={styles.label}>{field.label}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`${field.label}: ${selected ? "Si" : "No"}`}
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
        accessibilityLabel={field.label}
        autoCapitalize="none"
        keyboardType={type === "INTEGER" || type === "DECIMAL" || type === "MONEY" ? "numeric" : "default"}
        onChangeText={onChange}
        placeholder={field.required ? "Obligatorio" : ""}
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
  const styles = useStateUpdateStyles();
  const rows = conflict ? buildStateUpdateConflictRows(conflict, fields, extraFields) : [];

  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={Boolean(conflict)}>
      <View testID="state-update-modal" style={styles.modalBackdrop}>
        <View style={styles.modalPanel}>
          <Text style={styles.modalTitle}>{conflict?.subjectName ?? "Registro"}</Text>
          <Text style={styles.modalMessage}>Opco tiene un estado distinto para este registro.</Text>
          <ScrollView style={styles.conflictScroll} contentContainerStyle={styles.conflictRows}>
            {rows.map((row) => (
              <View key={`${row.fieldType ?? "field"}:${row.fieldId}`} style={styles.conflictRow}>
                <Text style={styles.conflictLabel}>{row.label}</Text>
                <Text style={styles.conflictText}>Actual: {row.existing ?? "Sin estado"}</Text>
                <Text style={styles.conflictText}>Solicitado: {row.requested ?? "Sin estado"}</Text>
              </View>
            ))}
          </ScrollView>
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

function DurableConflictList({
  conflicts,
  extraFields,
  fields,
  isSaving,
  onUseLocal,
  onUseRemote,
}: {
  conflicts: CachedStateUpdateRecord[];
  extraFields: EntityDefinition["fields"];
  fields: StateUpdateField[];
  isSaving: boolean;
  onUseLocal(record: CachedStateUpdateRecord): void;
  onUseRemote(record: CachedStateUpdateRecord): void;
}) {
  const styles = useStateUpdateStyles();
  return (
    <View style={styles.conflictList}>
      <Text style={styles.sectionTitle}>Conflictos por resolver</Text>
      {conflicts.map((record) => {
        const rows = buildStateUpdateConflictRows(stateUpdateDurableConflictState(record), fields, extraFields);

        return (
          <View key={record.localRecordId} style={styles.conflictListRow}>
            <Text style={styles.subjectName}>{record.subject.displayName}</Text>
            {rows.map((row) => (
              <View key={`${record.localRecordId}:${row.fieldType ?? "field"}:${row.fieldId}`}>
                <Text style={styles.conflictLabel}>{row.label}</Text>
                <Text style={styles.statusMeta}>En Opco: {row.existing ?? "Sin estado"}</Text>
                <Text style={styles.statusMeta}>Tu cambio: {row.requested ?? "Sin estado"}</Text>
              </View>
            ))}
            <View style={styles.conflictActions}>
              <Pressable accessibilityRole="button" disabled={isSaving} onPress={() => onUseLocal(record)} style={styles.smallPrimaryButton}>
                <Text style={styles.smallPrimaryText}>Usar mi cambio</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={isSaving} onPress={() => onUseRemote(record)} style={styles.smallSecondaryButton}>
                <Text style={styles.smallSecondaryText}>Usar Opco</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const baseStyles = StyleSheet.create({
  contextPanel: { gap: 12 },
  contextFields: { gap: 12 },
  contextDate: { gap: 8 },
  contextField: { gap: 8 },
  formActions: { gap: 12 },
  conflictScroll: { flexShrink: 1 },
  conflictActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
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
  conflictList: {
    gap: 10,
  },
  conflictListRow: {
    backgroundColor: "#ffffff",
    borderColor: "#d7a72f",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12,
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
    maxHeight: "90%",
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
  smallPrimaryButton: {
    alignItems: "center",
    backgroundColor: "#135d66",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  smallPrimaryText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  smallSecondaryButton: {
    alignItems: "center",
    backgroundColor: "#eef4f4",
    borderColor: "#b8c7ca",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  smallSecondaryText: {
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


const desktopStyles = StyleSheet.create({
  ...desktopStyleColors(baseStyles),
  content: { ...baseStyles.content, padding: 24, gap: 20 },
  headerText: { ...baseStyles.headerText, minWidth: 0 },
  contextPanel: { gap: 12, maxWidth: 1000, width: "100%", backgroundColor: desktopPalette.surface, borderColor: desktopPalette.border, borderWidth: 1, borderRadius: 8, padding: 16 },
  contextFields: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: 16 },
  contextDate: { gap: 8, flexBasis: 210, flexGrow: 0, flexShrink: 1, maxWidth: "100%", minWidth: 0 },
  contextField: { gap: 8, flexBasis: 200, flexGrow: 1, maxWidth: 280, minWidth: 0 },
  searchBlock: { ...baseStyles.searchBlock, width: "100%", maxWidth: 560 },
  searchInput: { ...baseStyles.searchInput, borderColor: desktopPalette.controlBorder, color: desktopPalette.text, minWidth: 0 },
  editorPanel: { ...baseStyles.editorPanel, borderColor: desktopPalette.border, padding: 20, width: "100%", maxWidth: 900 },
  fieldGroup: { gap: 8, minWidth: 0 },
  formActions: { flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "flex-start" },
  primaryButton: { ...baseStyles.primaryButton, backgroundColor: desktopPalette.primary, alignSelf: "flex-start", minWidth: 160 },
  secondaryButton: { ...baseStyles.secondaryButton, borderColor: desktopPalette.controlBorder, alignSelf: "flex-start", paddingVertical: 10 },
  input: { ...baseStyles.input, borderColor: desktopPalette.controlBorder, color: desktopPalette.text, minWidth: 0 },
  list: { gap: 0 },
  optionButton: { ...baseStyles.optionButton, alignSelf: "flex-start" },
  modalPanel: { ...baseStyles.modalPanel, maxWidth: 620, maxHeight: "90%" },
  modalActions: { ...baseStyles.modalActions, flexWrap: "wrap" },
  conflictListRow: { ...baseStyles.conflictListRow, gap: 12 },
});
function useStateUpdateStyles() {
  return useWindowDimensions().width >= APP_SHELL_WIDE_BREAKPOINT ? desktopStyles : baseStyles;
}
