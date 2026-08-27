import {
  EntityRecordValue,
  StateUpdateBatchResult,
  StateUpdateCurrentFieldValue,
  StateUpdateField,
  StateUpdateItem,
  StateUpdateLatestItem,
} from "./opco-api";
import { CachedEntityRecord, PendingOperation } from "./offline-records";
import { ConnectivityStatus } from "./connectivity";

export const STATE_UPDATE_OPERATION = "STATE_UPDATE";

export type StateUpdateSyncStatus = "synced" | "pending" | "syncing" | "failed" | "conflict";

export type OfflineStateUpdatePayload = {
  appViewId: string;
  clientRequestId: string;
  date?: string;
  expectedUpdatedAt?: string | null;
  extraValues?: Record<string, EntityRecordValue>;
  historyMode: "append" | "update-current";
  overwrite?: boolean;
  stateValues: {
    fieldId: string;
    label?: string | null;
    optionId: string | null;
  }[];
  subjectDisplayName: string;
  subjectRecordId: string;
  uniqueness: "none" | "subject" | "subject-date";
};

export type OfflineStateUpdateValues = {
  appViewId: string;
  date?: string;
  expectedUpdatedAt?: string | null;
  extraValues?: Record<string, EntityRecordValue>;
  stateValues: StateUpdateCurrentFieldValue[];
  subjectDisplayName: string;
  subjectRecordId: string;
};

export type CachedStateUpdateRecord = {
  attempts?: number;
  conflictRemoteStateValues?: StateUpdateCurrentFieldValue[];
  conflictRemoteUpdatedAt?: string | null;
  date?: string;
  expectedUpdatedAt?: string | null;
  extraValues?: Record<string, EntityRecordValue>;
  localRecordId: string;
  stateValues: StateUpdateCurrentFieldValue[];
  subject: {
    displayName: string;
    id: string;
  };
  syncErrorCode?: string | null;
  syncErrorMessage?: string | null;
  syncStatus: StateUpdateSyncStatus;
  updatedAt?: string | null;
};

export type StateUpdateSummary = {
  conflictCount: number;
  failedCount: number;
  pendingCount: number;
  syncingCount: number;
  totalRegistered: number;
};

export type StateUpdateOutboxDiagnosticsOperation = {
  appViewFingerprint: string;
  appViewResolved: boolean;
  clientRequestId: string;
  config: {
    definitionKind: string;
    extraFieldsCount: number;
    matchingStateValuesCount: number;
    missingStateValuesCount: number;
    sourceTargetConfigured: boolean;
    stateFieldsCount: number;
    statusOptionResolved: boolean | "no-state-values";
    workflowKey: string | null;
  };
  contractFingerprint: string;
  date: string | null;
  extraValuesCount: number;
  lastBackendErrorCode: string | null;
  lastErrorCode: string | null;
  lastErrorPhase: string | null;
  lastHttpStatus: number | null;
  operationType: string;
  payloadSchema: "current" | "legacy-batch" | "legacy-wire-states" | "unknown";
  manualRetryToken: string | null;
  manualRetryable: boolean;
  retryable: boolean;
  retryCount: number;
  stateValuesCount: number;
  subjectFingerprint: string;
  syncStatus: string;
  updatedAt: string;
};

export type StateUpdateLocalRecordDiagnostics = {
  appViewFingerprint: string;
  appViewResolved: boolean;
  contractFingerprint: string;
  date: string | null;
  hasPendingOperation: boolean;
  lastErrorCode: string | null;
  localRecordFingerprint: string;
  remoteRecordExists: boolean;
  recoveryState: "OK" | "PENDING_WITH_OUTBOX" | "REMOTE_SNAPSHOT_REPAIRABLE" | "ORPHANED_LOCAL_CHANGE";
  stateValuesCount: number;
  subjectFingerprint: string;
  syncStatus: string;
  updatedAt: string;
  workflowKey: string | null;
};

export type StateUpdateOutboxDiagnostics = {
  localRecords: StateUpdateLocalRecordDiagnostics[];
  operations: StateUpdateOutboxDiagnosticsOperation[];
  summary: {
    attendanceDerivedPendingCount: number;
    conflict: number;
    eligibleForAutoSync: number;
    failed: number;
    localConflict: number;
    localFailed: number;
    localPendingCreate: number;
    localPendingUpdate: number;
    localSynced: number;
    localSyncing: number;
    localTotal: number;
    orphanedLocalChange: number;
    remoteSnapshotRepairable: number;
    pendingCreate: number;
    pendingUpdate: number;
    stateUpdateTotalLocal: number;
    syncing: number;
  };
  consistency: "OK" | "MISMATCH";
};

export type StateUpdateSyncTrigger =
  | "reconnect"
  | "unknown-to-online"
  | "manual-retry"
  | "startup-with-pending"
  | "foreground/resume"
  | "other";

export type StateUpdateSyncTelemetryResult =
  | "failed"
  | "noop"
  | "partial_failure"
  | "reconciled_success"
  | "success";

export type StateUpdateLastReconnectTelemetry = {
  detected: boolean;
  detectedAt: string | null;
  previousConnectivityStatus: ConnectivityStatus | null;
  resultingConnectivityStatus: ConnectivityStatus | null;
};

export type StateUpdateLastSyncTelemetry = {
  completedAt: string | null;
  operationsAttempted: number;
  operationsCompleted: number;
  operationsFailed: number;
  operationsSelected: number;
  reconciledAfterTimeout: boolean;
  result: StateUpdateSyncTelemetryResult;
  startedAt: string;
  trigger: StateUpdateSyncTrigger;
};

export type StateUpdateSyncDiagnosticsTelemetry = {
  currentConnectivity: {
    status: ConnectivityStatus;
    updatedAt: string | null;
  };
  lastReconnect: StateUpdateLastReconnectTelemetry;
  lastStateUpdateSync: StateUpdateLastSyncTelemetry | null;
};

export type StateUpdateScope = {
  appViewId: string;
  contractId: string;
  date?: string;
  ownerKey: string;
  targetEntityTypeId: string;
};

export type SaveStateUpdateLocallyInput = StateUpdateScope & {
  expectedUpdatedAt?: string | null;
  extraValues?: Record<string, EntityRecordValue>;
  historyMode: "append" | "update-current";
  overwrite?: boolean;
  stateFields: StateUpdateField[];
  stateValues: {
    fieldId: string;
    optionId: string | null;
  }[];
  subjectDisplayName: string;
  subjectRecordId: string;
  uniqueness: "none" | "subject" | "subject-date";
};

export type SearchStateUpdateSubjectsInput = StateUpdateScope & {
  search: string;
  sourceEntityTypeId: string;
};

export type UpsertStateUpdateSnapshotInput = StateUpdateScope & {
  items: StateUpdateItem[];
};

export type StateUpdateOfflineStore = {
  completeStateUpdateOperation(operation: PendingOperation, result: Extract<StateUpdateBatchResult, { result: "CREATED" | "UNCHANGED" | "UPDATED" }>): Promise<void>;
  discardStateUpdateLocalChange(input: StateUpdateScope & { subjectRecordId: string }): Promise<void>;
  failStateUpdateOperation(operation: PendingOperation, code: string, message: string): Promise<void>;
  getStateUpdateSummary(input: StateUpdateScope): Promise<StateUpdateSummary>;
  getStateUpdateOutboxDiagnostics(ownerKey: string): Promise<StateUpdateOutboxDiagnostics>;
  getStateUpdateSyncDiagnosticsTelemetry(ownerKey: string): Promise<StateUpdateSyncDiagnosticsTelemetry | null>;
  listPendingStateUpdateOperations(ownerKey: string): Promise<PendingOperation[]>;
  listStateUpdateConflicts(input: StateUpdateScope): Promise<CachedStateUpdateRecord[]>;
  listStateUpdateLatest(input: StateUpdateScope & { limit?: number }): Promise<StateUpdateLatestItem[]>;
  markStateUpdateOperationConflict(operation: PendingOperation, result: Extract<StateUpdateBatchResult, { result: "CONFLICT" }>): Promise<void>;
  markStateUpdateOperationSyncing(operationId: string): Promise<void>;
  retryFailedStateUpdateOperations(input: { ownerKey: string; manualRetryToken?: string | null }): Promise<number>;
  retryStateUpdateOperation(operation: PendingOperation, code: string, message: string): Promise<void>;
  saveStateUpdateLocally(input: SaveStateUpdateLocallyInput): Promise<CachedStateUpdateRecord>;
  setStateUpdateSyncDiagnosticsTelemetry(ownerKey: string, telemetry: StateUpdateSyncDiagnosticsTelemetry): Promise<void>;
  searchStateUpdateSubjects(input: SearchStateUpdateSubjectsInput): Promise<StateUpdateItem[]>;
  upsertStateUpdateSnapshot(input: UpsertStateUpdateSnapshotInput): Promise<void>;
};

export function workflowTelemetryScopeId(appViewId: string) {
  return `workflow:${appViewId}`;
}

export function createStateUpdateLocalRecordId(input: {
  appViewId: string;
  date?: string;
  historyMode: "append" | "update-current";
  subjectRecordId: string;
  uniqueness: "none" | "subject" | "subject-date";
}) {
  if (input.historyMode === "append" || input.uniqueness === "none") {
    return `state_update_${encodeStableId(input.appViewId)}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  const datePart = input.uniqueness === "subject-date" ? input.date ?? "no-date" : "current";

  return `state_update_${encodeStableId(input.appViewId)}_${encodeStableId(datePart)}_${encodeStableId(input.subjectRecordId)}`;
}

export function stateUpdateResultLocalRecordId(input: {
  appViewId: string;
  date?: string;
  historyMode: "append" | "update-current";
  subjectRecordId: string;
  uniqueness: "none" | "subject" | "subject-date";
}) {
  return createStateUpdateLocalRecordId(input);
}

export function normalizeStateUpdateRecord(record: CachedEntityRecord): CachedStateUpdateRecord {
  const values = record.values as Record<string, EntityRecordValue> as OfflineStateUpdateValues;
  const conflictValues = record.conflictRemoteValues as Partial<OfflineStateUpdateValues> | null;

  return {
    conflictRemoteStateValues: conflictValues?.stateValues,
    conflictRemoteUpdatedAt: record.conflictRemoteUpdatedAt,
    date: values.date,
    expectedUpdatedAt: values.expectedUpdatedAt,
    extraValues: values.extraValues,
    localRecordId: record.localId,
    stateValues: values.stateValues,
    subject: {
      displayName: values.subjectDisplayName,
      id: values.subjectRecordId,
    },
    syncErrorCode: record.syncErrorCode,
    syncErrorMessage: record.syncErrorMessage,
    syncStatus: mapRecordStatusToStateUpdate(record.syncStatus),
    updatedAt: record.remoteUpdatedAt ?? record.updatedAt,
  };
}

export function buildOfflineStateValues(
  stateFields: StateUpdateField[],
  stateValues: { fieldId: string; optionId: string | null }[],
): StateUpdateCurrentFieldValue[] {
  return stateValues.map((value) => {
    const field = stateFields.find((item) => item.fieldId === value.fieldId);
    const option = field?.options.find((item) => item.optionId === value.optionId);

    return {
      fieldId: value.fieldId,
      label: option?.label ?? null,
      optionId: value.optionId,
    };
  });
}

export function stateUpdateRecordToItem(record: CachedStateUpdateRecord): StateUpdateItem {
  return {
    current: {
      extraValues: record.extraValues,
      recordId: record.localRecordId,
      stateValues: record.stateValues,
      updatedAt: record.updatedAt ?? new Date().toISOString(),
    },
    subject: record.subject,
  };
}

function mapRecordStatusToStateUpdate(syncStatus: CachedEntityRecord["syncStatus"]): StateUpdateSyncStatus {
  if (syncStatus === "pending_create" || syncStatus === "pending_update") {
    return "pending";
  }

  if (syncStatus === "syncing") {
    return "syncing";
  }

  if (syncStatus === "failed") {
    return "failed";
  }

  if (syncStatus === "conflict") {
    return "conflict";
  }

  return "synced";
}

function encodeStableId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
