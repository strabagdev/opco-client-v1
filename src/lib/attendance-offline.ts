import {
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
  config: Pick<AttendanceWorkflowConfig, "statusFieldId">,
): StateUpdateField[] {
  return [{
    defaultOptionId: statuses.find((status) => status.isDefaultCheckIn)?.optionId,
    fieldId: config.statusFieldId,
    label: "Estado",
    options: statuses.map((status, index) => ({
      label: status.label,
      optionId: status.optionId,
      order: index,
    })),
    required: true,
  }];
}

export function stateUpdateItemToAttendanceItem(
  item: StateUpdateItem,
  statusFieldId: string,
): AttendanceItem {
  const status = item.current?.stateValues.find((value) => value.fieldId === statusFieldId);

  return {
    attendance: item.current
      ? {
          observation: readObservation(item.current.extraValues),
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
    observation: readObservation(record.extraValues),
    person: record.subject,
    statusLabel: status?.label ?? null,
    statusOptionId: status?.optionId ?? null,
    syncErrorCode: record.syncErrorCode,
    syncErrorMessage: record.syncErrorMessage,
    syncStatus: record.syncStatus,
    updatedAt: record.updatedAt,
  };
}

function readObservation(extraValues: Record<string, EntityRecordValue> | undefined) {
  if (!extraValues) {
    return null;
  }

  const firstText = Object.values(extraValues).find((value) => typeof value === "string");

  return typeof firstText === "string" ? firstText : null;
}
