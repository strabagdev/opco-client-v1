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
import {
  attendanceStateFields,
  attendanceStatusesFromStateFields,
  CachedAttendanceRecord,
  getAttendanceStatusLabel,
  stateUpdateConflictToAttendanceRecord,
  stateUpdateItemToAttendanceItem,
  stateUpdateLatestToAttendanceLatest,
} from "@/lib/attendance-offline";
import { createClientRequestId } from "@/lib/client-request-id";
import { useConnectivityStatus } from "@/lib/connectivity";
import { refreshEntityRecordsCache } from "@/lib/offline-records";
import {
  AttendanceBatchEntry,
  AttendanceBatchResult,
  AttendanceItem,
  AttendanceLatestItem,
  AttendanceResponse,
  AttendanceStatusOption,
  AttendanceWorkflowConfig,
  StateUpdateBatchResult,
  WorkflowAppView,
} from "@/lib/opco-api";
import {
  ATTENDANCE_SEARCH_DEBOUNCE_MS,
  attendanceResponseToStateUpdateItems,
  firstBlockingAttendanceResult,
  formatDisplayDate,
  formatLocalDateInput,
  hasSuccessfulAttendanceResult,
  isAttendanceRemoteSnapshotComplete,
  mergeAttendanceStatuses,
  normalizeAttendanceSearch,
  shouldSearchAttendancePeople,
  shiftLocalDate,
  splitStatusButtons,
} from "@/renderers/workflows/attendance/attendance-workflow-logic";
import { AppViewRendererProps } from "@/renderers/types";
import { useSession } from "@/state/session";
import { shouldHandleStateUpdateRefresh } from "@/state/state-update-refresh";

type ConflictState = Extract<AttendanceBatchResult, { result: "CONFLICT" }> & {
  personName: string;
};

export function AttendanceWorkflow({ appView }: AppViewRendererProps<WorkflowAppView & { config: AttendanceWorkflowConfig }>) {
  const {
    api,
    context,
    definitionCache,
    ownerKey,
    refreshRecordsSyncSummary,
    selectedContractId,
    stateUpdateReconnectRefreshKey,
    status,
    syncPendingRecords,
    token,
  } = useSession();
  const connectivityStatus = useConnectivityStatus();
  const [date, setDate] = useState(formatLocalDateInput(new Date()));
  const [searchText, setSearchText] = useState("");
  const [items, setItems] = useState<AttendanceItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<AttendanceItem | null>(null);
  const [statuses, setStatuses] = useState<AttendanceStatusOption[]>([]);
  const [latest, setLatest] = useState<AttendanceLatestItem[]>([]);
  const [totalRegistered, setTotalRegistered] = useState(0);
  const [observationExpanded, setObservationExpanded] = useState(false);
  const [observation, setObservation] = useState("");
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [localConflicts, setLocalConflicts] = useState<CachedAttendanceRecord[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const requestSequenceRef = useRef(0);
  const stateUpdateRefreshKeyRef = useRef(stateUpdateReconnectRefreshKey);
  const supportsObservation = Boolean(appView.config.observationFieldId);
  const isOnline = connectivityStatus === "online";
  const normalizedSearch = normalizeAttendanceSearch(searchText);
  const { defaultStatus, otherStatuses } = useMemo(() => splitStatusButtons(statuses), [statuses]);
  const isContractBootstrapPending = !context || (!selectedContractId && context.contracts.length === 1);

  const applyAttendanceResponse = useCallback((response: {
    latest: AttendanceLatestItem[];
    statuses: AttendanceStatusOption[];
    summary: { totalRegistered: number };
  }) => {
    setStatuses((current) => mergeAttendanceStatuses(current, response.statuses));

    setLatest(response.latest);
    setTotalRegistered(response.summary.totalRegistered);
  }, []);

  const refreshLocalDayState = useCallback(async () => {
    if (!ownerKey || !selectedContractId) {
      return;
    }

    const [summary, localLatest, conflicts] = await Promise.all([
      definitionCache.getStateUpdateSummary({
        appViewId: appView.id,
        contractId: selectedContractId,
        date,
        ownerKey,
        targetEntityTypeId: appView.config.targetEntityTypeId,
      }),
      definitionCache.listStateUpdateLatest({
        appViewId: appView.id,
        contractId: selectedContractId,
        date,
        ownerKey,
        targetEntityTypeId: appView.config.targetEntityTypeId,
      }),
      definitionCache.listStateUpdateConflicts({
        appViewId: appView.id,
        contractId: selectedContractId,
        date,
        ownerKey,
        targetEntityTypeId: appView.config.targetEntityTypeId,
      }),
    ]);

    setLatest(localLatest.map((item) => stateUpdateLatestToAttendanceLatest(item, appView.config.statusFieldId)));
    setTotalRegistered(summary.totalRegistered);
    setPendingCount(summary.pendingCount + summary.failedCount + summary.conflictCount + summary.syncingCount);
    setLocalConflicts(conflicts.map((record) => stateUpdateConflictToAttendanceRecord(record, appView.config.statusFieldId)));
    return summary.pendingCount + summary.failedCount + summary.conflictCount + summary.syncingCount;
  }, [appView.config.statusFieldId, appView.config.targetEntityTypeId, appView.id, date, definitionCache, ownerKey, selectedContractId]);

  const refreshLocalSyncIndicators = useCallback(async () => {
    if (!ownerKey || !selectedContractId) {
      return;
    }

    const [summary, conflicts] = await Promise.all([
      definitionCache.getStateUpdateSummary({
        appViewId: appView.id,
        contractId: selectedContractId,
        date,
        ownerKey,
        targetEntityTypeId: appView.config.targetEntityTypeId,
      }),
      definitionCache.listStateUpdateConflicts({
        appViewId: appView.id,
        contractId: selectedContractId,
        date,
        ownerKey,
        targetEntityTypeId: appView.config.targetEntityTypeId,
      }),
    ]);

    const unresolvedCount = summary.pendingCount + summary.failedCount + summary.conflictCount + summary.syncingCount;

    setPendingCount(unresolvedCount);
    setLocalConflicts(conflicts.map((record) => stateUpdateConflictToAttendanceRecord(record, appView.config.statusFieldId)));
    return unresolvedCount;
  }, [appView.config.statusFieldId, appView.config.targetEntityTypeId, appView.id, date, definitionCache, ownerKey, selectedContractId]);

  const cacheAttendanceOnlineResponse = useCallback(async (response: AttendanceResponse, options: { complete?: boolean } = {}) => {
    if (!ownerKey || !selectedContractId) {
      return;
    }

    const syncedAt = new Date().toISOString();
    const sourceDefinition = await api.getEntityDefinition(token!, selectedContractId, response.sourceEntityType.id);

    await definitionCache.upsertEntityDefinition(selectedContractId, response.sourceEntityType.id, sourceDefinition.entity, syncedAt);
    await refreshEntityRecordsCache({
      api,
      contractId: selectedContractId,
      entityTypeId: response.sourceEntityType.id,
      ownerKey,
      store: definitionCache,
      token: token!,
    });
    await definitionCache.upsertStateUpdateSnapshot({
      appViewId: appView.id,
      contractId: selectedContractId,
      complete: options.complete === true,
      date: response.date,
      items: attendanceResponseToStateUpdateItems(response, appView.config),
      ownerKey,
      targetEntityTypeId: response.targetEntityType.id,
    });
  }, [api, appView.config, appView.id, definitionCache, ownerKey, selectedContractId, token]);

  const cacheAttendanceOnlineResponseInBackground = useCallback((response: AttendanceResponse, options: { complete?: boolean } = {}) => {
    void cacheAttendanceOnlineResponse(response, options).catch(() => undefined);
  }, [cacheAttendanceOnlineResponse]);

  const applyDayState = useCallback(async (response: AttendanceResponse) => {
    applyAttendanceResponse(response);
    await refreshLocalSyncIndicators();
  }, [applyAttendanceResponse, refreshLocalSyncIndicators]);

  const clearPersonFlow = useCallback(() => {
    setSearchText("");
    setItems([]);
    setSelectedItem(null);
    setObservation("");
    setObservationExpanded(false);
    setConflict(null);
  }, []);

  const loadDay = useCallback(async () => {
    if (!token || !selectedContractId) {
      setError((status === "authenticated" || status === "offline") && !isContractBootstrapPending ? "Selecciona un contrato antes de abrir asistencia." : null);
      setIsLoading(isContractBootstrapPending);
      return;
    }

    const requestId = ++requestSequenceRef.current;

    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await api.getAttendanceWorkflow(token, selectedContractId, appView.id, { date });

      if (requestId !== requestSequenceRef.current) {
        return;
      }

      await applyDayState(response);
      await cacheAttendanceOnlineResponse(response, { complete: isAttendanceRemoteSnapshotComplete(response) });
      setItems([]);
    } catch (nextError) {
      if (requestId === requestSequenceRef.current) {
        setError(nextError instanceof Error ? nextError.message : "No fue posible cargar asistencia.");
      }
    } finally {
      if (requestId === requestSequenceRef.current) {
        setIsLoading(false);
      }
    }
  }, [api, appView.id, applyDayState, cacheAttendanceOnlineResponse, date, isContractBootstrapPending, selectedContractId, status, token]);

  const refreshAfterStateUpdateSync = useCallback(async () => {
    if (!ownerKey || !selectedContractId) {
      return;
    }

    if (!isOnline || !token) {
      await refreshLocalDayState();
      return;
    }

    const requestId = ++requestSequenceRef.current;

    try {
      const response = await api.getAttendanceWorkflow(token, selectedContractId, appView.id, { date });

      if (requestId !== requestSequenceRef.current) {
        return;
      }

      await applyDayState(response);
      await cacheAttendanceOnlineResponse(response, { complete: isAttendanceRemoteSnapshotComplete(response) });
      setError(null);
    } catch {
      if (requestId === requestSequenceRef.current) {
        const unresolvedCount = await refreshLocalDayState();

        if (unresolvedCount === 0) {
          setError(null);
        }
      }
    }
  }, [
    api,
    appView.id,
    applyDayState,
    cacheAttendanceOnlineResponse,
    date,
    isOnline,
    ownerKey,
    refreshLocalDayState,
    selectedContractId,
    token,
  ]);

  useEffect(() => {
    const previousKey = stateUpdateRefreshKeyRef.current;

    stateUpdateRefreshKeyRef.current = stateUpdateReconnectRefreshKey;

    if (!shouldHandleStateUpdateRefresh({
      currentKey: stateUpdateReconnectRefreshKey,
      previousKey,
    })) {
      return;
    }

    void refreshAfterStateUpdateSync();
  }, [refreshAfterStateUpdateSync, stateUpdateReconnectRefreshKey]);

  const searchPeople = useCallback(async (search: string) => {
    if (!selectedContractId || !ownerKey) {
      return;
    }

    const requestId = ++requestSequenceRef.current;

    setIsSearching(true);
    setError(null);

    try {
      if (!isOnline) {
        const localItems = await definitionCache.searchStateUpdateSubjects({
          appViewId: appView.id,
          contractId: selectedContractId,
          date,
          ownerKey,
          search,
          sourceEntityTypeId: appView.config.sourceEntityTypeId,
          targetEntityTypeId: appView.config.targetEntityTypeId,
        });

        if (requestId !== requestSequenceRef.current) {
          return;
        }

        setItems(localItems.map((item) => stateUpdateItemToAttendanceItem(item, appView.config.statusFieldId)));
        await refreshLocalDayState();
        return;
      }

      if (!token) {
        return;
      }

      const response = await api.getAttendanceWorkflow(token, selectedContractId, appView.id, { date, search });

      if (requestId !== requestSequenceRef.current) {
        return;
      }

      await applyDayState(response);
      cacheAttendanceOnlineResponseInBackground(response, { complete: false });
      setItems(response.items);
    } catch (nextError) {
      if (requestId === requestSequenceRef.current) {
        setError(nextError instanceof Error ? nextError.message : "No fue posible buscar personas.");
      }
    } finally {
      if (requestId === requestSequenceRef.current) {
        setIsSearching(false);
      }
    }
  }, [
    api,
    appView.config.sourceEntityTypeId,
    appView.config.statusFieldId,
    appView.config.targetEntityTypeId,
    appView.id,
    applyDayState,
    cacheAttendanceOnlineResponseInBackground,
    date,
    definitionCache,
    isOnline,
    ownerKey,
    refreshLocalDayState,
    selectedContractId,
    token,
  ]);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      if (!token || !selectedContractId) {
        setError((status === "authenticated" || status === "offline") && !isContractBootstrapPending ? "Selecciona un contrato antes de abrir asistencia." : null);
        setIsLoading(isContractBootstrapPending);
        return;
      }

      if (connectivityStatus !== "online") {
        if (ownerKey) {
          const prepared = await definitionCache.getAppViewDefinition(ownerKey, selectedContractId, appView.id);
          const sourceDefinition = await definitionCache.getEntityDefinition(selectedContractId, appView.config.sourceEntityTypeId);
          const sourceTelemetry = await definitionCache.getSyncTelemetry({
            contractId: selectedContractId,
            entityTypeId: appView.config.sourceEntityTypeId,
            ownerKey,
          });
          const sourceHydrated = hasSuccessfulHydration(sourceTelemetry);

          if (prepared?.definition.kind === "attendance") {
            setStatuses(prepared.definition.statuses);
          }

          if (prepared?.definition.kind === "state-update") {
            setStatuses(attendanceStatusesFromStateFields(
              prepared.definition.stateFields,
              appView.config.statusFieldId,
              appView.config.defaultCheckInOptionId,
            ));
          }

          if (!prepared || prepared.status !== "ready" || !sourceDefinition || !sourceHydrated) {
            setError("Abre Registro de Asistencia con conexion para preparar su uso sin conexion.");
          } else {
            setError(null);
          }

          await refreshLocalDayState();
        }

        setItems([]);
        setIsLoading(false);
        return;
      }

      const requestId = ++requestSequenceRef.current;

      setIsLoading(true);
      setError(null);
      setSuccessMessage(null);

      try {
        const response = await api.getAttendanceWorkflow(token, selectedContractId, appView.id, { date });

        if (!isMounted || requestId !== requestSequenceRef.current) {
          return;
        }

        await applyDayState(response);
        await cacheAttendanceOnlineResponse(response, { complete: isAttendanceRemoteSnapshotComplete(response) });
        setItems([]);
      } catch (nextError) {
        if (isMounted && requestId === requestSequenceRef.current) {
          setError(nextError instanceof Error ? nextError.message : "No fue posible cargar asistencia.");
        }
      } finally {
        if (isMounted && requestId === requestSequenceRef.current) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      isMounted = false;
    };
  }, [
    api,
    appView.config.defaultCheckInOptionId,
    appView.config.sourceEntityTypeId,
    appView.config.statusFieldId,
    appView.id,
    applyDayState,
    cacheAttendanceOnlineResponse,
    connectivityStatus,
    date,
    definitionCache,
    isContractBootstrapPending,
    ownerKey,
    refreshLocalDayState,
    selectedContractId,
    status,
    token,
  ]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (!shouldSearchAttendancePeople(searchText)) {
        setItems([]);
        setIsSearching(false);
        return;
      }

      void searchPeople(normalizeAttendanceSearch(searchText));
    }, ATTENDANCE_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [searchPeople, searchText]);

  async function selectPerson(item: AttendanceItem) {
    setSelectedItem(item);
    setObservation(item.attendance?.observation ?? "");
    setObservationExpanded(false);
    setConflict(null);
    setError(null);
    setSuccessMessage(null);

    if (!isOnline) {
      return;
    }

    if (!token || !selectedContractId) {
      return;
    }

    const requestId = ++requestSequenceRef.current;

    try {
      const response = await api.getAttendanceWorkflow(token, selectedContractId, appView.id, {
        date,
        personRecordId: item.person.id,
      });

      if (requestId !== requestSequenceRef.current) {
        return;
      }

      applyAttendanceResponse(response);
      setSelectedItem(response.items[0] ?? item);
      setObservation(response.items[0]?.attendance?.observation ?? "");
    } catch (nextError) {
      if (requestId === requestSequenceRef.current) {
        setError(nextError instanceof Error ? nextError.message : "No fue posible cargar la persona.");
      }
    }
  }

  async function saveStatus(status: AttendanceStatusOption) {
    if (!selectedContractId || !selectedItem || isSaving) {
      return;
    }

    await saveEntry({
      observation: supportsObservation ? observation : undefined,
      personRecordId: selectedItem.person.id,
      statusOptionId: status.optionId,
    });
  }

  async function confirmConflict() {
    if (!conflict || isSaving) {
      return;
    }

    await saveEntry({
      expectedUpdatedAt: conflict.existing.updatedAt,
      observation: supportsObservation ? observation : undefined,
      overwrite: true,
      personRecordId: conflict.personRecordId,
      statusOptionId: conflict.requested.statusOptionId,
    });
  }

  async function saveEntry(entry: AttendanceBatchEntry) {
    if (!selectedContractId || !selectedItem || !ownerKey) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (!isOnline) {
        await definitionCache.saveStateUpdateLocally({
          appViewId: appView.id,
          contractId: selectedContractId,
          date,
          expectedUpdatedAt: selectedItem.attendance?.updatedAt ?? null,
          extraValues: appView.config.observationFieldId && entry.observation !== undefined
            ? { [appView.config.observationFieldId]: entry.observation }
            : undefined,
          historyMode: "update-current",
          overwrite: entry.overwrite,
          ownerKey,
          stateFields: attendanceStateFields(statuses, appView.config),
          stateValues: [{ fieldId: appView.config.statusFieldId, optionId: entry.statusOptionId }],
          subjectDisplayName: selectedItem.person.displayName,
          subjectRecordId: selectedItem.person.id,
          targetEntityTypeId: appView.config.targetEntityTypeId,
          uniqueness: "subject-date",
        });
        clearPersonFlow();
        await refreshLocalDayState();
        await refreshRecordsSyncSummary();
        setSuccessMessage("Guardado en este dispositivo.");
        return;
      }

      if (!token) {
        return;
      }

      const response = await api.saveStateUpdateWorkflow(token, selectedContractId, appView.id, {
        clientRequestId: createClientRequestId(),
        date,
        ...attendanceEntryToStateUpdateEntry(entry, appView.config),
      });
      const attendanceResults = response.results.map((result) =>
        stateUpdateResultToAttendanceResult(result, appView.config.statusFieldId, statuses),
      );
      const blockingResult = firstBlockingAttendanceResult(attendanceResults);

      if (blockingResult?.result === "ERROR") {
        setError(blockingResult.message);
        return;
      }

      if (blockingResult?.result === "CONFLICT") {
        setConflict({ ...blockingResult, personName: selectedItem.person.displayName });
        return;
      }

      if (hasSuccessfulAttendanceResult(attendanceResults)) {
        const message = successLabel(attendanceResults[0]);

        clearPersonFlow();
        await loadDay();
        await refreshRecordsSyncSummary();
        setSuccessMessage(message);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No fue posible registrar asistencia.");
    } finally {
      setIsSaving(false);
    }
  }

  function cancelConflict() {
    setConflict(null);
    setError(null);
  }

  async function handleUseLocalConflictChange(record: CachedAttendanceRecord) {
    if (!ownerKey || !selectedContractId || !record.statusOptionId || isSaving) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await definitionCache.saveStateUpdateLocally({
        appViewId: appView.id,
        contractId: selectedContractId,
        date,
        expectedUpdatedAt: record.conflictRemoteUpdatedAt,
        extraValues: appView.config.observationFieldId && record.observation !== undefined
          ? { [appView.config.observationFieldId]: record.observation }
          : undefined,
        historyMode: "update-current",
        overwrite: true,
        ownerKey,
        stateFields: attendanceStateFields(statuses, appView.config),
        stateValues: [{ fieldId: appView.config.statusFieldId, optionId: record.statusOptionId }],
        subjectDisplayName: record.person.displayName,
        subjectRecordId: record.person.id,
        targetEntityTypeId: appView.config.targetEntityTypeId,
        uniqueness: "subject-date",
      });

      if (isOnline) {
        await syncPendingRecords();
      }

      await refreshLocalDayState();
      await refreshRecordsSyncSummary();
      setSuccessMessage(isOnline ? "Cambio enviado a Opco." : "Guardado en este dispositivo.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No fue posible resolver el conflicto.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUseRemoteConflictChange(record: CachedAttendanceRecord) {
    if (!ownerKey || !selectedContractId || isSaving) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await definitionCache.discardStateUpdateLocalChange({
        appViewId: appView.id,
        contractId: selectedContractId,
        date,
        ownerKey,
        subjectRecordId: record.person.id,
        targetEntityTypeId: appView.config.targetEntityTypeId,
      });
      await refreshLocalDayState();
      await refreshRecordsSyncSummary();
      setSuccessMessage("Se uso el estado de Opco.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No fue posible resolver el conflicto.");
    } finally {
      setIsSaving(false);
    }
  }

  function changeDate(amount: number) {
    clearPersonFlow();
    setDate((current) => shiftLocalDate(current, amount));
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <AppIcon icon={appView.icon} size={26} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>Registro de Asistencia</Text>
          <Text style={styles.meta}>{appView.name}</Text>
          <Text style={styles.meta}>{formatDisplayDate(date)}</Text>
        </View>
      </View>

      <View style={styles.dateBar}>
        <Pressable onPress={() => changeDate(-1)} style={styles.dateButton}>
          <Text style={styles.dateButtonText}>Anterior</Text>
        </Pressable>
        <Text style={styles.dateLabel}>{date}</Text>
        <Pressable onPress={() => changeDate(1)} style={styles.dateButton}>
          <Text style={styles.dateButtonText}>Siguiente</Text>
        </Pressable>
      </View>

      <View style={styles.summaryBar}>
        <Text style={styles.summaryLabel}>Registrados hoy</Text>
        <Text style={styles.summaryValue}>{totalRegistered}</Text>
      </View>

      {connectivityStatus !== "online" ? (
        <Text style={styles.offline}>Sin conexion. Los registros se guardan en este dispositivo.</Text>
      ) : null}
      {pendingCount > 0 ? (
        <Text style={styles.offline}>{pendingCount} registros por sincronizar</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {successMessage ? <Text style={styles.success}>{successMessage}</Text> : null}

      {localConflicts.length > 0 ? (
        <View style={styles.latestBlock}>
          <Text style={styles.sectionTitle}>Conflictos por resolver</Text>
          {localConflicts.map((record) => (
            <View key={record.localRecordId} style={styles.latestRow}>
              <View style={styles.personText}>
                <Text style={styles.personName}>{record.person.displayName}</Text>
                <Text style={styles.statusMeta}>Registraste sin conexion: {record.statusLabel ?? "Sin estado"}</Text>
                <Text style={styles.statusMeta}>En Opco existe: {record.conflictRemoteStatusLabel ?? "Sin estado"}</Text>
              </View>
              <View style={styles.conflictActions}>
                <Pressable disabled={isSaving} onPress={() => void handleUseLocalConflictChange(record)} style={styles.smallPrimaryButton}>
                  <Text style={styles.smallPrimaryText}>Usar mi cambio</Text>
                </Pressable>
                <Pressable disabled={isSaving} onPress={() => void handleUseRemoteConflictChange(record)} style={styles.smallSecondaryButton}>
                  <Text style={styles.smallSecondaryText}>Usar Opco</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
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
          placeholder="Buscar persona"
          style={styles.searchInput}
          value={searchText}
        />
        {isSearching ? <ActivityIndicator size="small" /> : null}
      </View>

      {isLoading ? <ActivityIndicator /> : null}

      {connectivityStatus !== "online" && statuses.length > 0 ? (
        <View style={styles.statusGrid}>
          {statuses.map((status) => (
            <View key={status.optionId} style={styles.offlineStatusPill}>
              <Text style={styles.secondaryStatusText}>{status.label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {!selectedItem && normalizedSearch ? (
        <View style={styles.list}>
          {!isSearching && items.length === 0 ? <Text style={styles.empty}>Sin resultados.</Text> : null}
          {items.map((item) => (
            <Pressable key={item.person.id} onPress={() => void selectPerson(item)} style={styles.personRow}>
              <View style={styles.personText}>
                <Text style={styles.personName}>{item.person.displayName}</Text>
                <Text style={styles.statusMeta}>{item.attendance?.statusLabel ?? "Sin registrar"}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {selectedItem ? (
        <View style={styles.checkInPanel}>
          <View style={styles.personText}>
            <Text style={styles.panelName}>{selectedItem.person.displayName}</Text>
            <Text style={styles.statusMeta}>Actual: {selectedItem.attendance?.statusLabel ?? "Sin registrar"}</Text>
          </View>

          {supportsObservation ? (
            <View style={styles.observationBlock}>
              <Pressable
                onPress={() => setObservationExpanded((current) => !current)}
                style={styles.observationToggle}
              >
                <Text style={styles.observationToggleText}>
                  {observationExpanded ? "Ocultar observacion" : "Agregar observacion"}
                </Text>
              </Pressable>
              {observationExpanded ? (
                <TextInput
                  multiline
                  onChangeText={setObservation}
                  placeholder="Observacion"
                  style={styles.observationInput}
                  value={observation}
                />
              ) : null}
            </View>
          ) : null}

          {defaultStatus ? (
            <Pressable
              disabled={isSaving}
              onPress={() => void saveStatus(defaultStatus)}
              style={[styles.primaryStatusButton, isSaving && styles.disabledButton]}
            >
              {isSaving ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.primaryStatusText}>Registrar {defaultStatus.label}</Text>
              )}
            </Pressable>
          ) : (
            <Text style={styles.error}>No hay estados de asistencia configurados.</Text>
          )}

          {otherStatuses.length > 0 ? (
            <View style={styles.statusGrid}>
              {otherStatuses.map((status) => (
                <Pressable
                  disabled={isSaving}
                  key={status.optionId}
                  onPress={() => void saveStatus(status)}
                  style={[styles.secondaryStatusButton, isSaving && styles.disabledButton]}
                >
                  <Text style={styles.secondaryStatusText}>{status.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {!normalizedSearch && !selectedItem ? <LatestAttendanceList latest={latest} /> : null}

      <ConflictModal
        conflict={conflict}
        isSaving={isSaving}
        onCancel={cancelConflict}
        onConfirm={confirmConflict}
      />
    </ScrollView>
  );
}

function LatestAttendanceList({ latest }: { latest: AttendanceLatestItem[] }) {
  return (
    <View style={styles.latestBlock}>
      <Text style={styles.sectionTitle}>Ultimos registros</Text>
      {latest.length === 0 ? <Text style={styles.empty}>Sin registros para esta fecha.</Text> : null}
      {latest.map((item) => (
        <View key={item.attendanceRecordId} style={styles.latestRow}>
          <View style={styles.personText}>
            <Text style={styles.personName}>{item.person.displayName}</Text>
            <Text style={styles.statusMeta}>{item.statusLabel ?? "Sin estado"}</Text>
          </View>
          {item.updatedAt ? <Text style={styles.latestTime}>{formatLocalTime(item.updatedAt)}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function ConflictModal({
  conflict,
  isSaving,
  onCancel,
  onConfirm,
}: {
  conflict: ConflictState | null;
  isSaving: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={Boolean(conflict)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalPanel}>
          <Text style={styles.modalTitle}>{conflict?.personName ?? "Persona"}</Text>
          <Text style={styles.modalMessage}>Ya existe una asistencia distinta para esta fecha.</Text>
          <View style={styles.conflictRows}>
            <Text style={styles.conflictText}>Actual: {conflict?.existing.statusLabel ?? "Sin estado"}</Text>
            <Text style={styles.conflictText}>Solicitado: {conflict?.requested.statusLabel ?? ""}</Text>
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

function successLabel(result: AttendanceBatchResult | undefined) {
  if (!result) {
    return "Asistencia registrada.";
  }

  if (result.result === "UNCHANGED") {
    return "Asistencia ya estaba registrada.";
  }

  if (result.result === "UPDATED") {
    return "Asistencia actualizada.";
  }

  return "Asistencia registrada.";
}

function attendanceEntryToStateUpdateEntry(entry: AttendanceBatchEntry, config: AttendanceWorkflowConfig) {
  return {
    expectedUpdatedAt: entry.expectedUpdatedAt,
    extraValues: config.observationFieldId && entry.observation !== undefined
      ? { [config.observationFieldId]: entry.observation }
      : undefined,
    overwrite: entry.overwrite,
    stateValues: [{ fieldId: config.statusFieldId, optionId: entry.statusOptionId }],
    subjectRecordId: entry.personRecordId,
  };
}

function stateUpdateResultToAttendanceResult(
  result: StateUpdateBatchResult,
  statusFieldId: string,
  statuses: AttendanceStatusOption[],
): AttendanceBatchResult {
  if (result.result === "ERROR") {
    return {
      code: result.code,
      message: result.message,
      personRecordId: result.subjectRecordId,
      result: "ERROR",
    };
  }

  if (result.result === "CONFLICT") {
    const existingStatus = result.existing.stateValues.find((value) => value.fieldId === statusFieldId);
    const requestedStatus = result.requested.stateValues.find((value) => value.fieldId === statusFieldId);

    return {
      existing: {
        recordId: result.existing.recordId,
        statusLabel: existingStatus?.label ?? getAttendanceStatusLabel(statuses, existingStatus?.optionId ?? ""),
        statusOptionId: existingStatus?.optionId ?? null,
        updatedAt: result.existing.updatedAt,
      },
      personRecordId: result.subjectRecordId,
      requested: {
        statusLabel: requestedStatus?.label ?? getAttendanceStatusLabel(statuses, requestedStatus?.optionId ?? "") ?? "",
        statusOptionId: requestedStatus?.optionId ?? "",
      },
      result: "CONFLICT",
    };
  }

  return {
    personRecordId: result.subjectRecordId,
    recordId: result.recordId,
    result: result.result,
  };
}

function formatLocalTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  checkInPanel: {
    backgroundColor: "#ffffff",
    borderColor: "#d7e4e7",
    borderRadius: 8,
    borderWidth: 1,
    gap: 14,
    padding: 14,
  },
  conflictRows: {
    gap: 6,
  },
  conflictActions: {
    gap: 8,
    minWidth: 132,
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
    minHeight: 42,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  dateButtonText: {
    color: "#135d66",
    fontWeight: "800",
  },
  dateLabel: {
    color: "#0f3036",
    fontWeight: "800",
  },
  disabledButton: {
    opacity: 0.55,
  },
  empty: {
    color: "#587078",
    lineHeight: 20,
  },
  error: {
    color: "#b42318",
    lineHeight: 20,
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
    minHeight: 44,
    justifyContent: "center",
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
    minHeight: 44,
    justifyContent: "center",
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
  observationBlock: {
    gap: 8,
  },
  observationInput: {
    backgroundColor: "#f8fbfb",
    borderColor: "#d7e4e7",
    borderRadius: 8,
    borderWidth: 1,
    color: "#0f3036",
    minHeight: 72,
    padding: 10,
    textAlignVertical: "top",
  },
  observationToggle: {
    alignSelf: "flex-start",
    minHeight: 32,
    justifyContent: "center",
  },
  observationToggleText: {
    color: "#135d66",
    fontWeight: "800",
  },
  offline: {
    backgroundColor: "#fff7ed",
    borderColor: "#fed7aa",
    borderRadius: 8,
    borderWidth: 1,
    color: "#9a3412",
    lineHeight: 20,
    padding: 10,
  },
  panelName: {
    color: "#0f3036",
    fontSize: 19,
    fontWeight: "800",
  },
  personName: {
    color: "#0f3036",
    fontSize: 16,
    fontWeight: "800",
  },
  personRow: {
    backgroundColor: "#ffffff",
    borderColor: "#d7e4e7",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  offlineStatusPill: {
    backgroundColor: "#ffffff",
    borderColor: "#c8d2d5",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  personText: {
    flex: 1,
    gap: 4,
  },
  primaryStatusButton: {
    alignItems: "center",
    backgroundColor: "#135d66",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  primaryStatusText: {
    color: "#ffffff",
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
    borderColor: "#b7cdd2",
    borderRadius: 8,
    borderWidth: 1,
    color: "#0f3036",
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  secondaryStatusButton: {
    alignItems: "center",
    borderColor: "#b7cdd2",
    borderRadius: 8,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 112,
    paddingHorizontal: 12,
  },
  secondaryStatusText: {
    color: "#135d66",
    fontWeight: "800",
  },
  smallPrimaryButton: {
    alignItems: "center",
    backgroundColor: "#135d66",
    borderRadius: 8,
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  smallPrimaryText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  smallSecondaryButton: {
    alignItems: "center",
    backgroundColor: "#eef4f4",
    borderRadius: 8,
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  smallSecondaryText: {
    color: "#135d66",
    fontWeight: "800",
  },
  sectionTitle: {
    color: "#0f3036",
    fontSize: 16,
    fontWeight: "800",
  },
  statusGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statusMeta: {
    color: "#587078",
  },
  success: {
    color: "#067647",
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
    padding: 12,
  },
  summaryLabel: {
    color: "#587078",
    fontWeight: "700",
  },
  summaryValue: {
    color: "#0f3036",
    fontSize: 22,
    fontWeight: "800",
  },
  title: {
    color: "#0f3036",
    fontSize: 24,
    fontWeight: "800",
  },
});
