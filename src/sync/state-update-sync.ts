import type { AppViewDefinitionCache } from "../lib/app-view-definitions-cache";
import {attendanceRepetitionMetadata,attendanceRepetitionPolicy} from "../lib/attendance-repetition";
import {workflowWriteMetadata,WorkflowWriteReviewError} from "../lib/workflow-write-contract";
import { StateUpdateScheduleReviewError, stateUpdateScheduleMetadata } from "../lib/state-update-schedule";
import { compositeIdentityKey } from "../lib/state-update-identity";
import { isLocalDatabaseUnavailableError } from "../lib/local-db-recovery";
import { PendingOperation } from "../lib/offline-records";
import { type AttendanceWorkflowConfig, OpcoApi, OpcoApiError, OpcoNetworkError, StateUpdateBatchResult } from "../lib/opco-api";
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
  failStateUpdateOperation(operation: PendingOperation, code: string, message: string, details?: unknown, httpStatus?: number | null): Promise<void>;
  listPendingStateUpdateOperations(ownerKey: string): Promise<PendingOperation[]>;
  markStateUpdateOperationConflict(operation: PendingOperation, result: Extract<StateUpdateBatchResult, { result: "CONFLICT" }>): Promise<void>;
  markStateUpdateOperationSyncing(operationId: string, expectedRequestId?: string): Promise<boolean | void>;
  retryStateUpdateOperation(operation: PendingOperation, code: string, message: string): Promise<void>;
} & Partial<Pick<AppViewDefinitionCache,"getAppViewDefinition">> & Partial<Pick<SyncTelemetryStore, "markSyncError" | "markSyncPhase" | "markSyncPhaseCompleted">>;

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

  // A retained command must not be reinterpreted by a Core that only understands one-per-day.
  // Share this authenticated compatibility read inside this run, never across owners or reconnects.
  const repetitionChecks=new Map<string,Promise<void>>();
  for (const operation of operations) {
    const payload = operation.payload as OfflineStateUpdatePayload;

    try {
      if (operation.operation !== STATE_UPDATE_OPERATION) {
        continue;
      }

      if (await store.markStateUpdateOperationSyncing(operation.id, operation.clientRequestId) === false) continue;
      result.operationsAttempted += 1;

      const prepared = await store.getAppViewDefinition?.(ownerKey,operation.contractId,payload.appViewId);
      const view = prepared?.definition.appView;
      const cachedConfig=view?.type==="WORKFLOW" ? view.config as AttendanceWorkflowConfig & {workflow?:string} : null;
      if(cachedConfig && (cachedConfig.workflowKey??cachedConfig.workflow)==="attendance" && attendanceRepetitionPolicy(cachedConfig)!==(payload.repetitionPolicy??"ONE_PER_DAY")) {
        throw new OpcoApiError("La política preparada cambió desde esta captura. Revisa la intención conservada; no se reinterpretó.","ATTENDANCE_POLICY_CHANGED",409);
      }
      if(payload.repetitionPolicy&&payload.repetitionPolicy!=="ONE_PER_DAY"){
        const key=JSON.stringify([operation.contractId,payload.appViewId,payload.date,payload.repetitionPolicy]);
        let compatible=repetitionChecks.get(key);
        if(!compatible){
          compatible=(async()=>{
            if(!api.getStateUpdateWorkflow)throw new OpcoApiError("No se pudo acreditar la política de este servidor. La intención se conserva.","ATTENDANCE_POLICY_UNVERIFIED",409);
            const read=await api.getStateUpdateWorkflow(token,operation.contractId,payload.appViewId,{date:payload.date,subjectRecordId:payload.subjectRecordId,pageSize:1},{diagnosticSyncRunId:syncRunId});
            if(read.appView.id!==payload.appViewId||read.date!==payload.date||read.repetitionPolicy!==payload.repetitionPolicy||read.historyMode!=="append"||read.uniqueness!=="subject-date")throw new OpcoApiError("El servidor o la definición no acreditan esta política. Revisa la intención conservada.","ATTENDANCE_POLICY_UNVERIFIED",409);
          })();repetitionChecks.set(key,compatible);
        }
        await compatible;
      }
      const response = await api.saveStateUpdateWorkflow(token, operation.contractId, payload.appViewId, {
        ...attendanceRepetitionMetadata(payload),
        ...workflowWriteMetadata(payload),
        ...stateUpdateScheduleMetadata(payload),
        identity: payload.identity,
        clientRequestId: operation.clientRequestId,
        date: payload.date,
        expectedUpdatedAt: payload.expectedUpdatedAt ?? undefined,
        extraValues: payload.extraValues,
        overwrite: payload.overwrite,
        stateValues: payload.stateValues.map((value) => ({
          fieldId: value.fieldId,
          label: value.label,
          optionId: value.optionId,
          value: value.value,
        })),
        subjectRecordId: payload.subjectRecordId,
      }, {
        diagnosticSyncRunId: syncRunId,
      });
      if (payload.identity && (response.appView.id !== payload.appViewId || compositeIdentityKey(response.identity) !== compositeIdentityKey(payload.identity))) throw new OpcoApiError("La respuesta no corresponde a la identidad enviada.", "STATE_UPDATE_IDENTITY_MISMATCH", 409);
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

      await store.failStateUpdateOperation(
        operation,
        classification.code,
        classification.message,
        error instanceof OpcoApiError ? error.details : undefined,
        error instanceof OpcoApiError ? error.status : null,
      );
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
      identity: payload.identity,
      subjectRecordId: payload.subjectRecordId,
    }, {
      diagnosticSyncRunId: syncRunId,
    });
    if (payload.identity && (compositeIdentityKey(response.identityContext) !== compositeIdentityKey(payload.identity) || response.date !== payload.date)) return false;
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
  if (payload.writeCommand || payload.historyMode === "append" || payload.uniqueness === "none") {
    return false;
  }

  return (classification.action === "retry" && error instanceof OpcoNetworkError) ||
    (error instanceof OpcoApiError && error.code === "IDEMPOTENCY_RESULT_UNAVAILABLE");
}

function classifyStateUpdateSyncError(error: unknown): { action: "fail" | "retry"; code: string; message: string } {
  if(error instanceof WorkflowWriteReviewError) return {action:"fail",code:error.code,message:error.message};
  if (error instanceof StateUpdateScheduleReviewError) {
    return { action: "fail", code: error.code, message: error.message };
  }
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
