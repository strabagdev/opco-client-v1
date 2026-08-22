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
import { createClientRequestId } from "@/lib/client-request-id";
import { useConnectivityStatus } from "@/lib/connectivity";
import {
  AttendanceBatchEntry,
  AttendanceBatchResult,
  AttendanceItem,
  AttendanceLatestItem,
  AttendanceStatusOption,
  AttendanceWorkflowConfig,
  WorkflowAppView,
} from "@/lib/opco-api";
import {
  ATTENDANCE_SEARCH_DEBOUNCE_MS,
  firstBlockingAttendanceResult,
  formatDisplayDate,
  formatLocalDateInput,
  hasSuccessfulAttendanceResult,
  normalizeAttendanceSearch,
  shouldSearchAttendancePeople,
  shiftLocalDate,
  splitStatusButtons,
} from "@/renderers/workflows/attendance/attendance-workflow-logic";
import { AppViewRendererProps } from "@/renderers/types";
import { useSession } from "@/state/session";

type ConflictState = Extract<AttendanceBatchResult, { result: "CONFLICT" }> & {
  personName: string;
};

export function AttendanceWorkflow({ appView }: AppViewRendererProps<WorkflowAppView & { config: AttendanceWorkflowConfig }>) {
  const { api, selectedContractId, token } = useSession();
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
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const requestSequenceRef = useRef(0);
  const supportsObservation = Boolean(appView.config.observationFieldId);
  const isOnline = connectivityStatus === "online";
  const normalizedSearch = normalizeAttendanceSearch(searchText);
  const { defaultStatus, otherStatuses } = useMemo(() => splitStatusButtons(statuses), [statuses]);

  const applyAttendanceResponse = useCallback((response: {
    latest: AttendanceLatestItem[];
    statuses: AttendanceStatusOption[];
    summary: { totalRegistered: number };
  }) => {
    setStatuses(response.statuses);
    setLatest(response.latest);
    setTotalRegistered(response.summary.totalRegistered);
  }, []);

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
      setError("Selecciona un contrato antes de abrir asistencia.");
      setIsLoading(false);
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

      applyAttendanceResponse(response);
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
  }, [api, appView.id, applyAttendanceResponse, date, selectedContractId, token]);

  const searchPeople = useCallback(async (search: string) => {
    if (!token || !selectedContractId) {
      return;
    }

    const requestId = ++requestSequenceRef.current;

    setIsSearching(true);
    setError(null);

    try {
      const response = await api.getAttendanceWorkflow(token, selectedContractId, appView.id, { date, search });

      if (requestId !== requestSequenceRef.current) {
        return;
      }

      applyAttendanceResponse(response);
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
  }, [api, appView.id, applyAttendanceResponse, date, selectedContractId, token]);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      if (!token || !selectedContractId) {
        setError("Selecciona un contrato antes de abrir asistencia.");
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

        applyAttendanceResponse(response);
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
  }, [api, appView.id, applyAttendanceResponse, date, selectedContractId, token]);

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
    if (!token || !selectedContractId || !selectedItem || isSaving || !isOnline) {
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
    if (!token || !selectedContractId || !selectedItem) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await api.saveAttendanceWorkflow(token, selectedContractId, appView.id, {
        clientRequestId: createClientRequestId(),
        date,
        entries: [entry],
      });
      const blockingResult = firstBlockingAttendanceResult(response.results);

      if (blockingResult?.result === "ERROR") {
        setError(blockingResult.message);
        return;
      }

      if (blockingResult?.result === "CONFLICT") {
        setConflict({ ...blockingResult, personName: selectedItem.person.displayName });
        return;
      }

      if (hasSuccessfulAttendanceResult(response.results)) {
        const message = successLabel(response.results[0]);

        clearPersonFlow();
        await loadDay();
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
        <Text style={styles.offline}>El registro de asistencia requiere conexion.</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {successMessage ? <Text style={styles.success}>{successMessage}</Text> : null}

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
              disabled={isSaving || !isOnline}
              onPress={() => void saveStatus(defaultStatus)}
              style={[styles.primaryStatusButton, (isSaving || !isOnline) && styles.disabledButton]}
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
                  disabled={isSaving || !isOnline}
                  key={status.optionId}
                  onPress={() => void saveStatus(status)}
                  style={[styles.secondaryStatusButton, (isSaving || !isOnline) && styles.disabledButton]}
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
