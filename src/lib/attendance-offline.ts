import {
  AttendanceContextValues,
  AttendanceItem,
  AttendanceLatestItem,
  AttendanceStatusOption,
  AttendanceWorkflowConfig,
  EntityRecordValue,
  StateUpdateField,
  StateUpdateItem,
  StateUpdateLatestItem,
} from "./opco-api";
import { CachedStateUpdateRecord } from "./state-update-offline";

export type AttendanceSyncStatus = "synced" | "pending" | "syncing" | "failed" | "conflict";

export type CachedAttendanceRecord = {
  attempts?: number;
  conflictRemoteStatusLabel?: string | null;
  conflictRemoteStatusOptionId?: string | null;
  conflictRemoteUpdatedAt?: string | null;
  date: string;
  contextValues?: Record<string, EntityRecordValue>;
  expectedUpdatedAt?: string | null;
  localRecordId: string;
  observation?: string | null;
  person: {
    displayName: string;
    id: string;
  };
  statusLabel?: string | null;
  statusOptionId: string | null;
  syncErrorCode?: string | null;
  syncErrorMessage?: string | null;
  syncStatus: AttendanceSyncStatus;
  updatedAt?: string | null;
};

export function getAttendanceStatusLabel(statuses: AttendanceStatusOption[], statusOptionId: string) {
  return statuses.find((status) => status.optionId === statusOptionId)?.label ?? null;
}

export function attendanceStateFields(
  statuses: AttendanceStatusOption[],
  config: Pick<AttendanceWorkflowConfig, "defaultCheckInOptionId" | "statusFieldId">,
  statusField?: Pick<StateUpdateField, "fieldId" | "label" | "name"> | null,
): StateUpdateField[] {
  const defaultOptionId = config.defaultCheckInOptionId ?? statuses.find((status) => status.isDefaultCheckIn)?.optionId;

  return [{
    defaultOptionId,
    fieldId: config.statusFieldId,
    label: statusField?.label || statusField?.name || "Estado",
    options: statuses.map((status, index) => ({
      label: status.label,
      optionId: status.optionId,
      order: index,
    })),
    required: true,
  }];
}

export function attendanceStatusesFromStateFields(
  stateFields: StateUpdateField[],
  statusFieldId: string,
  defaultCheckInOptionId?: string,
): AttendanceStatusOption[] {
  const statusField = stateFields.find((field) => field.fieldId === statusFieldId) ?? stateFields[0];

  if (!statusField) {
    return [];
  }

  const defaultOptionId = defaultCheckInOptionId ?? statusField.defaultOptionId;

  return statusField.options.map((option) => ({
    isDefaultCheckIn: defaultOptionId ? option.optionId === defaultOptionId : false,
    label: option.label,
    optionId: option.optionId,
  }));
}

export function stateUpdateItemToAttendanceItem(
  item: StateUpdateItem,
  statusFieldId: string,
  observationFieldId?: string,
): AttendanceItem {
  const status = item.current?.stateValues.find((value) => value.fieldId === statusFieldId);

  return {
    attendance: item.current
      ? {
          observation: readObservation(item.current.extraValues, observationFieldId),
          contextValues: readContextValues(item.current.extraValues, observationFieldId),
          recordId: item.current.recordId,
          statusLabel: status?.label ?? null,
          statusOptionId: status?.optionId ?? null,
          updatedAt: item.current.updatedAt,
        }
      : null,
    person: item.subject,
  };
}

export function stateUpdateLatestToAttendanceLatest(
  item: StateUpdateLatestItem,
  statusFieldId: string,
): AttendanceLatestItem {
  const status = item.stateValues?.find((value) => value.fieldId === statusFieldId);

  return {
    attendanceRecordId: item.recordId,
    person: item.subject,
    statusLabel: status?.label ?? null,
    statusOptionId: status?.optionId ?? null,
    updatedAt: item.updatedAt,
  };
}

export function stateUpdateConflictToAttendanceRecord(
  record: CachedStateUpdateRecord,
  statusFieldId: string,
  observationFieldId?: string,
): CachedAttendanceRecord {
  const status = record.stateValues.find((value) => value.fieldId === statusFieldId);
  const remoteStatus = record.conflictRemoteStateValues?.find((value) => value.fieldId === statusFieldId);

  return {
    attempts: record.attempts,
    conflictRemoteStatusLabel: remoteStatus?.label ?? null,
    conflictRemoteStatusOptionId: remoteStatus?.optionId ?? null,
    conflictRemoteUpdatedAt: record.conflictRemoteUpdatedAt,
    date: record.date ?? "",
    expectedUpdatedAt: record.expectedUpdatedAt,
    localRecordId: record.localRecordId,
    observation: readObservation(record.extraValues, observationFieldId),
    contextValues: record.extraValues,
    person: record.subject,
    statusLabel: status?.label ?? null,
    statusOptionId: status?.optionId ?? null,
    syncErrorCode: record.syncErrorCode,
    syncErrorMessage: record.syncErrorMessage,
    syncStatus: record.syncStatus,
    updatedAt: record.updatedAt,
  };
}

function readObservation(extraValues: Record<string, EntityRecordValue> | undefined, observationFieldId?: string) {
  if (!extraValues) {
    return null;
  }

  if (observationFieldId) {
    const value = extraValues[observationFieldId];
    return typeof value === "string" ? value : null;
  }

  const firstText = Object.values(extraValues).find((value) => typeof value === "string");

  return typeof firstText === "string" ? firstText : null;
}

function readContextValues(extraValues: Record<string, EntityRecordValue> | undefined, observationFieldId?: string) {
  if (!extraValues) {
    return undefined;
  }

  const contextValues = Object.fromEntries(Object.entries(extraValues)
    .filter(([fieldId]) => fieldId !== observationFieldId)
    .filter(([, value]) =>
      value === null ||
      typeof value === "string" ||
      (Boolean(value) && typeof value === "object" && !Array.isArray(value) && "optionId" in value),
    )) as AttendanceContextValues;

  return Object.keys(contextValues).length > 0 ? contextValues : undefined;
}
