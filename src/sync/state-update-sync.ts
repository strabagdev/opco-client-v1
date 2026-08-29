import { isLocalDatabaseUnavailableError } from "../lib/local-db-recovery";
import { PendingOperation } from "../lib/offline-records";
import { OpcoApi, OpcoApiError, OpcoNetworkError, StateUpdateBatchResult } from "../lib/opco-api";
import {
  OfflineStateUpdatePayload,
  STATE_UPDATE_OPERATION,
  stateUpdateRequestDiagnosticsFromNetwork,
  stateUpdateRemoteItemMatchesPayload,
  workflowTelemetryScopeId,
} from "../lib/state-update-offline";
import { classifySyncTelemetryError, SyncTelemetryStore } from "../lib/sync-telemetry";

export type StateUpdateSyncStore = {
  completeStateUpdateOperation(operation: PendingOperation, result: Extract<StateUpdateBatchResult, { result: "CREATED" | "UNCHANGED" | "UPDATED" }>): Promise<void>;
  failStateUpdateOperation(operation: PendingOperation, code: string, message: string): Promise<void>;
  listPendingStateUpdateOperations(ownerKey: string): Promise<PendingOperation[]>;
  markStateUpdateOperationConflict(operation: PendingOperation, result: Extract<StateUpdateBatchResult, { result: "CONFLICT" }>): Promise<void>;
  markStateUpdateOperationSyncing(operationId: string): Promise<void>;
  retryStateUpdateOperation(operation: PendingOperation, code: string, message: string): Promise<void>;
} & Partial<Pick<SyncTelemetryStore, "markSyncError" | "markSyncPhase" | "markSyncPhaseCompleted">>;

export type StateUpdateSyncResult = {
  completed: number;
  conflicts: number;
  failed: number;
  lastRequestDiagnostics: ReturnType<typeof stateUpdateRequestDiagnosticsFromNetwork>;
  operationsAttempted: number;
  operationsSelected: number;
  reconciledAfterTimeout: boolean;
  retriable: number;
  timeoutOccurred: boolean;
};

let syncPromise: Promise<StateUpdateSyncResult> | null = null;

export function syncPendingStateUpdatesOnce(params: {
  api: Pick<OpcoApi, "saveStateUpdateWorkflow"> & Partial<Pick<OpcoApi, "getStateUpdateWorkflow">>;
  ownerKey: string;
  store: StateUpdateSyncStore;
  syncRunId?: string | null;
  token: string;
}) {
  if (!syncPromise) {
    syncPromise = runSync(params).finally(() => {
      syncPromise = null;
    });
  }

  return syncPromise;
}

async function runSync({
  api,
  ownerKey,
  store,
  syncRunId = null,
  token,
}: {
  api: Pick<OpcoApi, "saveStateUpdateWorkflow"> & Partial<Pick<OpcoApi, "getStateUpdateWorkflow">>;
  ownerKey: string;
  store: StateUpdateSyncStore;
  syncRunId?: string | null;
  token: string;
}) {
  const operations = await store.listPendingStateUpdateOperations(ownerKey);
  const scopes = uniqueStateUpdateScopes(operations);
  const scopesWithErrors = new Set<string>();
  const result: StateUpdateSyncResult = {
    completed: 0,
    conflicts: 0,
    failed: 0,
    lastRequestDiagnostics: null,
    operationsAttempted: 0,
    operationsSelected: operations.filter((operation) => operation.operation === STATE_UPDATE_OPERATION).length,
    reconciledAfterTimeout: false,
    retriable: 0,
    timeoutOccurred: false,
  };

  await Promise.all(scopes.map((scope) =>
    store.markSyncPhase?.({
      attemptedAt: new Date().toISOString(),
      contractId: scope.contractId,
      entityTypeId: workflowTelemetryScopeId(scope.appViewId),
      ownerKey,
      phase: "pushing",
    }).catch(() => undefined),
  ));

  for (const operation of operations) {
    const payload = operation.payload as OfflineStateUpdatePayload;

    try {
      if (operation.operation !== STATE_UPDATE_OPERATION) {
        continue;
      }

      await store.markStateUpdateOperationSyncing(operation.id);
      result.operationsAttempted += 1;

      const response = await api.saveStateUpdateWorkflow(token, operation.contractId, payload.appViewId, {
        clientRequestId: operation.clientRequestId,
        date: payload.date,
        expectedUpdatedAt: payload.expectedUpdatedAt ?? undefined,
        extraValues: payload.extraValues,
        overwrite: payload.overwrite,
        stateValues: payload.stateValues.map((value) => ({
          fieldId: value.fieldId,
          optionId: value.optionId,
        })),
        subjectRecordId: payload.subjectRecordId,
      }, {
        diagnosticSyncRunId: syncRunId,
      });
      const operationResult = response.results[0];

      if (!operationResult) {
        throw new OpcoApiError("Opco no devolvio resultado para cambio de estado.", "STATE_UPDATE_EMPTY_RESULT", 500);
      }

      if (operationResult.result === "CONFLICT") {
        await store.markStateUpdateOperationConflict(operation, operationResult);
        scopesWithErrors.add(stateUpdateScopeKey(payload, operation.contractId));
        await markStateUpdateSyncError(store, ownerKey, operation.contractId, payload.appViewId, "CONFLICT");
        result.conflicts += 1;
        continue;
      }

      if (operationResult.result === "ERROR") {
        await store.failStateUpdateOperation(operation, operationResult.code, operationResult.message);
        scopesWithErrors.add(stateUpdateScopeKey(payload, operation.contractId));
        await markStateUpdateSyncError(store, ownerKey, operation.contractId, payload.appViewId, "VALIDATION");
        result.failed += 1;
        continue;
      }

      await store.completeStateUpdateOperation(operation, operationResult);
      result.completed += 1;
    } catch (error) {
      const classification = classifyStateUpdateSyncError(error);
      const requestDiagnostics = error instanceof OpcoNetworkError
        ? stateUpdateRequestDiagnosticsFromNetwork(error.diagnostics)
        : null;

      if (requestDiagnostics) {
        result.lastRequestDiagnostics = requestDiagnostics;
        result.timeoutOccurred = requestDiagnostics.abortControllerTriggered === true;
      }

      if (shouldAttemptRemoteStateUpdateReconcile(error, classification, payload)) {
        const reconciled = await completeOperationIfRemoteStateMatches({
          api,
          operation,
          payload,
          store,
          syncRunId,
          token,
        });

        if (reconciled) {
          result.completed += 1;
          result.reconciledAfterTimeout = true;
          continue;
        }
      }

      scopesWithErrors.add(stateUpdateScopeKey(payload, operation.contractId));
      await markStateUpdateSyncError(
        store,
        ownerKey,
        operation.contractId,
        payload.appViewId,
        classifySyncTelemetryError(error),
      );

      if (classification.action === "retry") {
        await store.retryStateUpdateOperation(operation, classification.code, classification.message);
        result.retriable += 1;
        continue;
      }

      await store.failStateUpdateOperation(operation, classification.code, classification.message);
      result.failed += 1;
    }
  }

  await Promise.all(scopes.filter((scope) => !scopesWithErrors.has(stateUpdateScopeKey(scope, scope.contractId))).map((scope) =>
    store.markSyncPhaseCompleted?.({
      contractId: scope.contractId,
      entityTypeId: workflowTelemetryScopeId(scope.appViewId),
      ownerKey,
      phase: "pushing",
    }).catch(() => undefined),
  ));

  return result;
}

async function completeOperationIfRemoteStateMatches({
  api,
  operation,
  payload,
  store,
  syncRunId,
  token,
}: {
  api: Pick<OpcoApi, "saveStateUpdateWorkflow"> & Partial<Pick<OpcoApi, "getStateUpdateWorkflow">>;
  operation: PendingOperation;
  payload: OfflineStateUpdatePayload;
  store: StateUpdateSyncStore;
  syncRunId: string | null;
  token: string;
}) {
  if (!api.getStateUpdateWorkflow) {
    return false;
  }

  try {
    const response = await api.getStateUpdateWorkflow(token, operation.contractId, payload.appViewId, {
      date: payload.date,
      subjectRecordId: payload.subjectRecordId,
    }, {
      diagnosticSyncRunId: syncRunId,
    });
    const item = response.items.find((candidate) => candidate.subject.id === payload.subjectRecordId);

    if (!item?.current || !stateUpdateRemoteItemMatchesPayload(item, payload)) {
      return false;
    }

    await store.completeStateUpdateOperation(operation, {
      recordId: item.current.recordId,
      result: "UNCHANGED",
      subjectRecordId: payload.subjectRecordId,
      updatedAt: item.current.updatedAt,
    });

    return true;
  } catch {
    return false;
  }
}

function shouldAttemptRemoteStateUpdateReconcile(
  error: unknown,
  classification: ReturnType<typeof classifyStateUpdateSyncError>,
  payload: OfflineStateUpdatePayload,
) {
  if (payload.historyMode === "append" || payload.uniqueness === "none") {
    return false;
  }

  return (classification.action === "retry" && error instanceof OpcoNetworkError) ||
    (error instanceof OpcoApiError && error.code === "IDEMPOTENCY_RESULT_UNAVAILABLE");
}

function classifyStateUpdateSyncError(error: unknown): { action: "fail" | "retry"; code: string; message: string } {
  if (error instanceof OpcoApiError && error.code === "IDEMPOTENCY_KEY_REUSED") {
    return {
      action: "fail",
      code: error.code,
      message: "La clave de idempotencia ya fue usada con otra intencion. Requiere revision manual.",
    };
  }

  if (error instanceof OpcoApiError && error.code === "IDEMPOTENCY_RESULT_UNAVAILABLE") {
    return {
      action: "fail",
      code: error.code,
      message: "Opco no pudo reponer el resultado guardado. Requiere recuperacion manual.",
    };
  }

  if (error instanceof OpcoNetworkError || isLocalDatabaseUnavailableError(error)) {
    return {
      action: "retry",
      code: error instanceof Error ? error.name : "NETWORK",
      message: "Se reintentara cuando vuelva la conexion.",
    };
  }

  if (error instanceof OpcoApiError && error.status >= 500) {
    return {
      action: "retry",
      code: error.code,
      message: error.message,
    };
  }

  return {
    action: "fail",
    code: error instanceof OpcoApiError ? error.code : "STATE_UPDATE_SYNC_ERROR",
    message: error instanceof Error ? error.message : "No fue posible sincronizar el cambio de estado.",
  };
}

async function markStateUpdateSyncError(
  store: StateUpdateSyncStore,
  ownerKey: string,
  contractId: string,
  appViewId: string,
  code: Parameters<NonNullable<SyncTelemetryStore["markSyncError"]>>[0]["code"],
) {
  try {
    await store.markSyncError?.({
      code,
      contractId,
      entityTypeId: workflowTelemetryScopeId(appViewId),
      ownerKey,
      phase: "pushing",
    });
  } catch {
    // Telemetry never owns the operation lifecycle.
  }
}

function uniqueStateUpdateScopes(operations: PendingOperation[]) {
  const scopes = new Map<string, { appViewId: string; contractId: string }>();

  for (const operation of operations) {
    const payload = operation.payload as OfflineStateUpdatePayload;

    scopes.set(stateUpdateScopeKey(payload, operation.contractId), {
      appViewId: payload.appViewId,
      contractId: operation.contractId,
    });
  }

  return [...scopes.values()];
}

function stateUpdateScopeKey(scope: { appViewId: string }, contractId: string) {
  return `${contractId}:${scope.appViewId}`;
}
