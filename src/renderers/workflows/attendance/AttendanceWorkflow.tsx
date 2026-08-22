import { useEffect, useMemo, useState } from "react";
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
import {
  AttendanceBatchEntry,
  AttendanceBatchResult,
  AttendanceItem,
  AttendanceStatus,
  AttendanceWorkflowConfig,
  WorkflowAppView,
} from "@/lib/opco-api";
import { AppViewRendererProps } from "@/renderers/types";
import { useSession } from "@/state/session";

type AttendanceDraft = {
  error: string | null;
  initialObservation: string | null;
  initialStatus: AttendanceStatus | null;
  observation: string | null;
  status: AttendanceStatus | null;
};

type ConflictState = Extract<AttendanceBatchResult, { result: "CONFLICT" }>;

const STATUS_OPTIONS: { label: string; value: AttendanceStatus }[] = [
  { label: "Presente", value: "PRESENTE" },
  { label: "Ausente", value: "AUSENTE" },
];

export function AttendanceWorkflow({ appView }: AppViewRendererProps<WorkflowAppView & { config: AttendanceWorkflowConfig }>) {
  const { api, selectedContractId, token } = useSession();
  const [date, setDate] = useState(formatLocalDateInput(new Date()));
  const [items, setItems] = useState<AttendanceItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, AttendanceDraft>>({});
  const [expandedObservationId, setExpandedObservationId] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const currentConflict = conflicts[0] ?? null;
  const supportsObservation = Boolean(appView.config.observationFieldId);
  const dirtyPersonIds = useMemo(
    () => Object.entries(drafts)
      .filter(([, draft]) => isDraftDirty(draft))
      .map(([personId]) => personId),
    [drafts],
  );
  const dirtyCount = dirtyPersonIds.length;

  useEffect(() => {
    let isMounted = true;

    async function load() {
      if (!token || !selectedContractId) {
        setError("Selecciona un contrato antes de abrir asistencia.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await api.getAttendanceWorkflow(token, selectedContractId, appView.id, date);

        if (!isMounted) {
          return;
        }

        applyRemoteItems(response.items, false);
      } catch (nextError) {
        if (isMounted) {
          setError(nextError instanceof Error ? nextError.message : "No fue posible cargar asistencia.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void load();

    return () => {
      isMounted = false;
    };
  }, [api, appView.id, date, selectedContractId, token]);

  function applyRemoteItems(nextItems: AttendanceItem[], preserveDirty: boolean) {
    if (!preserveDirty) {
      setConflicts([]);
      setExpandedObservationId(null);
    }

    setItems(nextItems);
    setDrafts((current) => {
      const nextDrafts: Record<string, AttendanceDraft> = {};

      nextItems.forEach((item) => {
        const currentDraft = current[item.person.id];
        const remoteStatus = item.attendance?.status ?? null;
        const remoteObservation = item.attendance?.observation ?? null;

        if (preserveDirty && currentDraft && isDraftDirty(currentDraft)) {
          nextDrafts[item.person.id] = {
            ...currentDraft,
            initialObservation: remoteObservation,
            initialStatus: remoteStatus,
          };
          return;
        }

        nextDrafts[item.person.id] = {
          error: null,
          initialObservation: remoteObservation,
          initialStatus: remoteStatus,
          observation: remoteObservation,
          status: remoteStatus,
        };
      });

      return nextDrafts;
    });
  }

  function updateStatus(personId: string, status: AttendanceStatus) {
    setDrafts((current) => ({
      ...current,
      [personId]: {
        ...current[personId],
        error: null,
        status,
      },
    }));
  }

  function updateObservation(personId: string, observation: string) {
    setDrafts((current) => ({
      ...current,
      [personId]: {
        ...current[personId],
        error: null,
        observation: observation.trim() ? observation : null,
      },
    }));
  }

  async function refreshPreservingDirty() {
    if (!token || !selectedContractId) {
      return;
    }

    const response = await api.getAttendanceWorkflow(token, selectedContractId, appView.id, date);

    applyRemoteItems(response.items, true);
  }

  async function saveDirtyAttendance() {
    if (!token || !selectedContractId || isSaving) {
      return;
    }

    const entries = dirtyPersonIds
      .map((personId) => buildEntry(personId, drafts[personId]))
      .filter((entry): entry is AttendanceBatchEntry => Boolean(entry));

    if (entries.length === 0) {
      setDrafts((current) => markMissingStatusErrors(current, dirtyPersonIds));
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await api.saveAttendanceWorkflow(token, selectedContractId, appView.id, {
        clientRequestId: createClientRequestId(),
        date,
        entries,
      });

      handleBatchResults(response.results);

      if (response.results.some((result) => result.result !== "ERROR" && result.result !== "CONFLICT")) {
        await refreshPreservingDirty();
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No fue posible guardar asistencia.");
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmConflict() {
    if (!token || !selectedContractId || !currentConflict || isSaving) {
      return;
    }

    const draft = drafts[currentConflict.personRecordId];
    const entry = buildEntry(currentConflict.personRecordId, draft);

    if (!entry) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await api.saveAttendanceWorkflow(token, selectedContractId, appView.id, {
        clientRequestId: createClientRequestId(),
        date,
        entries: [{
          ...entry,
          expectedUpdatedAt: currentConflict.existing.updatedAt,
          overwrite: true,
        }],
      });

      handleBatchResults(response.results);

      if (response.results.some((result) => result.result !== "ERROR" && result.result !== "CONFLICT")) {
        await refreshPreservingDirty();
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No fue posible confirmar el cambio.");
    } finally {
      setIsSaving(false);
    }
  }

  function cancelConflict() {
    if (!currentConflict) {
      return;
    }

    setDrafts((current) => ({
      ...current,
      [currentConflict.personRecordId]: {
        ...current[currentConflict.personRecordId],
        error: null,
        observation: null,
        status: currentConflict.existing.status,
      },
    }));
    setConflicts((current) => current.slice(1));
  }

  function handleBatchResults(results: AttendanceBatchResult[]) {
    const nextConflicts: ConflictState[] = [];

    setDrafts((current) => {
      const next = { ...current };

      results.forEach((result) => {
        const draft = next[result.personRecordId];

        if (!draft) {
          return;
        }

        if (result.result === "ERROR") {
          next[result.personRecordId] = {
            ...draft,
            error: result.message,
          };
          return;
        }

        if (result.result === "CONFLICT") {
          nextConflicts.push(result);
          next[result.personRecordId] = {
            ...draft,
            error: "Revisa el conflicto antes de guardar.",
          };
          return;
        }

        next[result.personRecordId] = {
          ...draft,
          error: null,
          initialObservation: draft.observation,
          initialStatus: draft.status,
        };
      });

      return next;
    });

    if (nextConflicts.length > 0) {
      setConflicts((current) => [...current.slice(1), ...nextConflicts]);
    } else {
      setConflicts((current) => current.slice(1));
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <AppIcon icon={appView.icon} size={26} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{appView.name}</Text>
          <Text style={styles.meta}>{formatDisplayDate(date)}</Text>
        </View>
      </View>

      <View style={styles.dateBar}>
        <Pressable onPress={() => setDate(shiftLocalDate(date, -1))} style={styles.dateButton}>
          <Text style={styles.dateButtonText}>Anterior</Text>
        </Pressable>
        <Text style={styles.dateLabel}>{date}</Text>
        <Pressable onPress={() => setDate(shiftLocalDate(date, 1))} style={styles.dateButton}>
          <Text style={styles.dateButtonText}>Siguiente</Text>
        </Pressable>
      </View>

      {dirtyCount > 0 ? <Text style={styles.changeCount}>{dirtyCount} cambios</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isLoading ? <ActivityIndicator /> : null}
      {!isLoading && items.length === 0 ? <Text style={styles.empty}>No hay personas para esta fecha.</Text> : null}

      <View style={styles.list}>
        {items.map((item) => {
          const draft = drafts[item.person.id];
          const selectedStatus = draft?.status ?? null;
          const isDirty = draft ? isDraftDirty(draft) : false;
          const observationExpanded = expandedObservationId === item.person.id;

          return (
            <View key={item.person.id} style={styles.item}>
              <View style={styles.itemHeader}>
                <View style={styles.personText}>
                  <Text style={styles.personName}>{item.person.displayName}</Text>
                  <Text style={[styles.statusMeta, isDirty && styles.statusMetaDirty]}>
                    {isDirty ? "Cambio pendiente" : selectedStatus ? statusLabel(selectedStatus) : "Sin marcar"}
                  </Text>
                </View>
              </View>

              <View style={styles.statusControls}>
                {STATUS_OPTIONS.map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() => updateStatus(item.person.id, option.value)}
                    style={[
                      styles.statusButton,
                      selectedStatus === option.value && styles.statusButtonSelected,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusButtonText,
                        selectedStatus === option.value && styles.statusButtonTextSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {supportsObservation ? (
                <View style={styles.observationBlock}>
                  <Pressable
                    onPress={() => setExpandedObservationId(observationExpanded ? null : item.person.id)}
                    style={styles.observationToggle}
                  >
                    <Text style={styles.observationToggleText}>Observación</Text>
                  </Pressable>
                  {observationExpanded ? (
                    <TextInput
                      multiline
                      onChangeText={(value) => updateObservation(item.person.id, value)}
                      placeholder="Agregar observación"
                      style={styles.observationInput}
                      value={draft?.observation ?? ""}
                    />
                  ) : null}
                </View>
              ) : null}

              {draft?.error ? <Text style={styles.itemError}>{draft.error}</Text> : null}
            </View>
          );
        })}
      </View>

      <Pressable
        disabled={isSaving || dirtyCount === 0 || Boolean(currentConflict)}
        onPress={saveDirtyAttendance}
        style={[styles.saveButton, (isSaving || dirtyCount === 0 || Boolean(currentConflict)) && styles.saveButtonDisabled]}
      >
        {isSaving ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.saveButtonText}>Guardar asistencia</Text>}
      </Pressable>

      <ConflictModal
        conflict={currentConflict}
        isSaving={isSaving}
        onCancel={cancelConflict}
        onConfirm={confirmConflict}
        personName={currentConflict ? personNameFor(items, currentConflict.personRecordId) : ""}
      />
    </ScrollView>
  );
}

function ConflictModal({
  conflict,
  isSaving,
  onCancel,
  onConfirm,
  personName,
}: {
  conflict: ConflictState | null;
  isSaving: boolean;
  onCancel(): void;
  onConfirm(): void;
  personName: string;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={Boolean(conflict)}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalPanel}>
          <Text style={styles.modalTitle}>{personName}</Text>
          <Text style={styles.modalMessage}>Ya existe una asistencia para esta fecha.</Text>
          <View style={styles.conflictRows}>
            <Text style={styles.conflictText}>Actual: {conflict?.existing.status ? statusLabel(conflict.existing.status) : "Sin marcar"}</Text>
            <Text style={styles.conflictText}>Quieres cambiar a: {conflict ? statusLabel(conflict.requestedStatus) : ""}</Text>
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

function buildEntry(personRecordId: string, draft: AttendanceDraft | undefined): AttendanceBatchEntry | null {
  if (!draft?.status || !isDraftDirty(draft)) {
    return null;
  }

  return {
    observation: draft.observation,
    personRecordId,
    status: draft.status,
  };
}

function markMissingStatusErrors(current: Record<string, AttendanceDraft>, personIds: string[]) {
  const next = { ...current };

  personIds.forEach((personId) => {
    const draft = next[personId];

    if (draft && !draft.status) {
      next[personId] = {
        ...draft,
        error: "Marca Presente o Ausente antes de guardar.",
      };
    }
  });

  return next;
}

function isDraftDirty(draft: AttendanceDraft) {
  return draft.status !== draft.initialStatus || (draft.observation ?? null) !== (draft.initialObservation ?? null);
}

function formatLocalDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function shiftLocalDate(value: string, amount: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  date.setDate(date.getDate() + amount);

  return formatLocalDateInput(date);
}

function formatDisplayDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function personNameFor(items: AttendanceItem[], personId: string) {
  return items.find((item) => item.person.id === personId)?.person.displayName ?? "Persona";
}

function statusLabel(status: AttendanceStatus) {
  return status === "PRESENTE" ? "Presente" : "Ausente";
}

const styles = StyleSheet.create({
  changeCount: {
    color: "#135d66",
    fontWeight: "800",
  },
  conflictRows: {
    gap: 6,
  },
  conflictText: {
    color: "#0f3036",
    fontSize: 15,
  },
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 36,
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
  item: {
    backgroundColor: "#ffffff",
    borderColor: "#d7e4e7",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 14,
  },
  itemError: {
    color: "#b42318",
    lineHeight: 19,
  },
  itemHeader: {
    flexDirection: "row",
  },
  list: {
    gap: 12,
  },
  meta: {
    color: "#587078",
    marginTop: 3,
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
  personName: {
    color: "#0f3036",
    fontSize: 17,
    fontWeight: "800",
  },
  personText: {
    flex: 1,
    gap: 4,
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: "#135d66",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  saveButtonDisabled: {
    opacity: 0.55,
  },
  saveButtonText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  screen: {
    backgroundColor: "#eef4f4",
    flex: 1,
  },
  statusButton: {
    alignItems: "center",
    borderColor: "#b7cdd2",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  statusButtonSelected: {
    backgroundColor: "#135d66",
    borderColor: "#135d66",
  },
  statusButtonText: {
    color: "#135d66",
    fontWeight: "800",
  },
  statusButtonTextSelected: {
    color: "#ffffff",
  },
  statusControls: {
    flexDirection: "row",
    gap: 10,
  },
  statusMeta: {
    color: "#587078",
  },
  statusMetaDirty: {
    color: "#9a3412",
    fontWeight: "800",
  },
  title: {
    color: "#0f3036",
    fontSize: 26,
    fontWeight: "800",
  },
});
