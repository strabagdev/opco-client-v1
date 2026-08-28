import {
  EntityRecordValue,
  StateUpdateBatchResult,
  StateUpdateCurrentFieldValue,
  StateUpdateField,
  StateUpdateItem,
  StateUpdateLatestItem,
} from "./opco-api";
import { createClientRequestId } from "./client-request-id";
import { CachedEntityRecord, PendingOperation } from "./offline-records";
import { ConnectivityStatus } from "./connectivity";

export const STATE_UPDATE_OPERATION = "STATE_UPDATE";
export const STATE_UPDATE_COMPATIBLE_WORKFLOW_KEYS = ["state-update", "attendance"] as const;

export type StateUpdateCompatibleWorkflowKey = typeof STATE_UPDATE_COMPATIBLE_WORKFLOW_KEYS[number];

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

export function resolveStateUpdateSyncTelemetryResult({
  operationsFailed,
  operationsSelected,
  reconciledAfterTimeout,
}: {
  operationsFailed: number;
  operationsSelected: number;
  reconciledAfterTimeout: boolean;
}): StateUpdateSyncTelemetryResult {
  if (operationsSelected === 0) {
    return "noop";
  }

  if (operationsFailed > 0) {
    return operationsFailed === operationsSelected ? "failed" : "partial_failure";
  }

  return reconciledAfterTimeout ? "reconciled_success" : "success";
}

export function mergeStateUpdateSyncDiagnosticsTelemetry({
  completedAt,
  current,
  currentConnectivityStatus,
  operationsAttempted,
  operationsCompleted,
  operationsFailed,
  operationsSelected,
  reconciledAfterTimeout,
  startedAt,
  trigger,
}: {
  completedAt: string;
  current: StateUpdateSyncDiagnosticsTelemetry;
  currentConnectivityStatus: ConnectivityStatus;
  operationsAttempted: number;
  operationsCompleted: number;
  operationsFailed: number;
  operationsSelected: number;
  reconciledAfterTimeout: boolean;
  startedAt: string;
  trigger: StateUpdateSyncTrigger;
}): StateUpdateSyncDiagnosticsTelemetry {
  const currentConnectivity = {
    status: currentConnectivityStatus,
    updatedAt: completedAt,
  };

  if (operationsSelected === 0 && current.lastStateUpdateSync) {
    return {
      ...current,
      currentConnectivity,
    };
  }

  return {
    ...current,
    currentConnectivity,
    lastStateUpdateSync: {
      completedAt,
      operationsAttempted,
      operationsCompleted,
      operationsFailed,
      operationsSelected,
      reconciledAfterTimeout,
      result: resolveStateUpdateSyncTelemetryResult({
        operationsFailed,
        operationsSelected,
        reconciledAfterTimeout,
      }),
      startedAt,
      trigger,
    },
  };
}

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
  complete?: boolean;
  items: StateUpdateItem[];
};

export type StateUpdateSnapshotReconcileResult = {
  staleSyncedRemoved: number;
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
  upsertStateUpdateSnapshot(input: UpsertStateUpdateSnapshotInput): Promise<StateUpdateSnapshotReconcileResult>;
};

export function workflowTelemetryScopeId(appViewId: string) {
  return `workflow:${appViewId}`;
}

export function isStateUpdateCompatibleWorkflow(workflowKey: unknown): workflowKey is StateUpdateCompatibleWorkflowKey {
  return typeof workflowKey === "string" && STATE_UPDATE_COMPATIBLE_WORKFLOW_KEYS.includes(workflowKey as StateUpdateCompatibleWorkflowKey);
}

export function createStateUpdateClientRequestId() {
  return createClientRequestId();
}

export function resolveStateUpdateClientRequestId({
  existingClientRequestId,
  existingPayload,
  nextPayload,
}: {
  existingClientRequestId?: string | null;
  existingPayload?: OfflineStateUpdatePayload | null;
  nextPayload: OfflineStateUpdatePayload;
}) {
  if (existingClientRequestId && existingPayload && stateUpdateIntentsEqual(existingPayload, nextPayload)) {
    return existingClientRequestId;
  }

  return createStateUpdateClientRequestId();
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
  if (!record.updatedAt) {
    return {
      current: null,
      subject: record.subject,
    };
  }

  return {
    current: {
      extraValues: record.extraValues,
      recordId: record.localRecordId,
      stateValues: record.stateValues,
      updatedAt: record.updatedAt,
    },
    subject: record.subject,
  };
}

export function stateUpdateRemoteItemMatchesPayload(
  item: StateUpdateItem,
  payload: OfflineStateUpdatePayload,
) {
  if (!item.current || item.subject.id !== payload.subjectRecordId) {
    return false;
  }

  const remoteStateValues = normalizeStateUpdateCurrentStateValues(item.current);
  const remoteExtraValues = item.current.extraValues ?? {};

  return stateUpdateRequestedStatesMatch(remoteStateValues, payload.stateValues) &&
    stateUpdateRequestedExtrasMatch(remoteExtraValues, payload.extraValues);
}

export function stateUpdateIntentsEqual(
  previous: OfflineStateUpdatePayload,
  next: OfflineStateUpdatePayload,
) {
  return JSON.stringify(normalizeStateUpdateIntent(previous)) === JSON.stringify(normalizeStateUpdateIntent(next));
}

export function normalizeStateUpdateIntent(payload: OfflineStateUpdatePayload) {
  return {
    appViewId: payload.appViewId,
    date: payload.date ?? null,
    expectedUpdatedAt: payload.expectedUpdatedAt ?? null,
    extraValues: normalizeStateUpdateExtraValues(payload.extraValues),
    historyMode: payload.historyMode,
    overwrite: payload.overwrite === true,
    stateValues: normalizeStateUpdateStateValues(payload.stateValues),
    subjectRecordId: payload.subjectRecordId,
    uniqueness: payload.uniqueness,
  };
}

export function isValidStateUpdateRemoteUpdatedAt(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return false;
  }

  const parsed = Date.parse(value);

  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function stateUpdateRequestedStatesMatch(
  remoteStateValues: StateUpdateCurrentFieldValue[],
  requestedStateValues: OfflineStateUpdatePayload["stateValues"],
) {
  return requestedStateValues.every((requested) =>
    remoteStateValues.some((remote) =>
      remote.fieldId === requested.fieldId &&
      remote.optionId === requested.optionId,
    ),
  );
}

function stateUpdateRequestedExtrasMatch(
  remoteExtraValues: Record<string, EntityRecordValue>,
  requestedExtraValues?: Record<string, EntityRecordValue>,
) {
  if (!requestedExtraValues) {
    return true;
  }

  return Object.entries(requestedExtraValues).every(([fieldId, requested]) =>
    JSON.stringify(normalizeStateUpdateValue(remoteExtraValues[fieldId])) === JSON.stringify(normalizeStateUpdateValue(requested)),
  );
}

function normalizeStateUpdateStateValues(stateValues: OfflineStateUpdatePayload["stateValues"]) {
  return (Array.isArray(stateValues) ? stateValues : [])
    .map((value) => ({
      fieldId: value.fieldId,
      optionId: value.optionId,
    }))
    .sort((first, second) => first.fieldId.localeCompare(second.fieldId));
}

function normalizeStateUpdateExtraValues(extraValues?: Record<string, EntityRecordValue>) {
  if (!extraValues) {
    return [];
  }

  return Object.entries(extraValues)
    .map(([fieldId, value]) => [fieldId, normalizeStateUpdateValue(value)] as const)
    .sort(([first], [second]) => first.localeCompare(second));
}

function normalizeStateUpdateValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? Number(value) : value;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeStateUpdateValue);
  }

  if ("id" in value && typeof (value as { id?: unknown }).id === "string") {
    return { id: (value as { id: string }).id };
  }

  const normalizedEntries: [string, unknown][] = Object.entries(value as Record<string, unknown>)
    .map(([key, nested]) => [key, normalizeStateUpdateValue(nested)]);

  return Object.fromEntries(normalizedEntries.sort(([first], [second]) => first.localeCompare(second)));
}

function normalizeStateUpdateCurrentStateValues(current: NonNullable<StateUpdateItem["current"]>): StateUpdateCurrentFieldValue[] {
  if (Array.isArray(current.stateValues)) {
    return current.stateValues;
  }

  const states = (current as unknown as { states?: unknown }).states;

  if (!states || typeof states !== "object" || Array.isArray(states)) {
    return [];
  }

  return Object.entries(states).map(([fieldId, rawValue]) => {
    const value = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? rawValue as { label?: unknown; optionId?: unknown }
      : {};

    return {
      fieldId,
      label: typeof value.label === "string" ? value.label : null,
      optionId: typeof value.optionId === "string" ? value.optionId : null,
    };
  });
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
