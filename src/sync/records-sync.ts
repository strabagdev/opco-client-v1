import { CachedEntityRecord, PendingOperation } from "../lib/offline-records";
import { isLocalDatabaseUnavailableError } from "../lib/local-db-recovery";
import { EntityRecord, OpcoApi, OpcoApiError, OpcoNetworkError } from "../lib/opco-api";
import { classifySyncTelemetryError, SyncErrorCode, SyncErrorPhase, SyncPhase, SyncTelemetryStore } from "../lib/sync-telemetry";

export type RecordsSyncStore = {
  completePendingOperation(operation: PendingOperation, record: EntityRecord): Promise<void>;
  failPendingOperation(operation: PendingOperation, code: string, message: string): Promise<void>;
  listPendingOperations(ownerKey: string): Promise<PendingOperation[]>;
  markPendingOperationConflict(operation: PendingOperation, remoteRecord: EntityRecord, code: string, message: string): Promise<void>;
  markPendingOperationSyncing(operationId: string): Promise<void>;
  readRecordRemoteUpdatedAt(operation: PendingOperation): Promise<string | null>;
  retryPendingOperation(operation: PendingOperation, code: string, message: string): Promise<void>;
} & Partial<Pick<SyncTelemetryStore, "markSyncError" | "markSyncPhase" | "markSyncPhaseCompleted">>;

export type RecordsSyncResult = {
  completed: number;
  conflicts: number;
  failed: number;
  retriable: number;
};

let syncPromise: Promise<RecordsSyncResult> | null = null;

export function syncPendingRecordsOnce(params: {
  api: Pick<OpcoApi, "createEntityRecord" | "getEntityRecord" | "updateEntityRecord">;
  ownerKey: string;
  store: RecordsSyncStore;
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
  token,
}: {
  api: Pick<OpcoApi, "createEntityRecord" | "getEntityRecord" | "updateEntityRecord">;
  ownerKey: string;
  store: RecordsSyncStore;
  token: string;
}): Promise<RecordsSyncResult> {
  const operations = await store.listPendingOperations(ownerKey);
  const scopes = uniqueOperationScopes(operations);
  const scopesWithErrors = new Set<string>();
  const result = {
    completed: 0,
    conflicts: 0,
    failed: 0,
    retriable: 0,
  };

  await Promise.all(
    scopes.map((scope) =>
      safeMarkSyncPhase(store, {
        attemptedAt: new Date().toISOString(),
        contractId: scope.contractId,
        entityTypeId: scope.entityTypeId,
        ownerKey,
        phase: "pushing",
      }),
    ),
  );

  for (const operation of operations) {
    try {
      await store.markPendingOperationSyncing(operation.id);

      const response =
        operation.operation === "CREATE"
          ? await api.createEntityRecord(token, operation.contractId, operation.entityTypeId, {
              clientRequestId: operation.clientRequestId,
              values: operation.payload.values,
            })
          : await syncUpdate({ api, operation, store, token });

      await store.completePendingOperation(operation, response.record);
      result.completed += 1;
    } catch (error) {
      if (error instanceof RecordConflictDetected) {
        await store.markPendingOperationConflict(operation, error.remoteRecord, error.code, error.message);
        scopesWithErrors.add(operationScopeKey(operation));
        await safeMarkSyncError(store, {
          code: "CONFLICT",
          contractId: operation.contractId,
          entityTypeId: operation.entityTypeId,
          ownerKey: operation.ownerKey,
          phase: "pushing",
        });
        result.conflicts += 1;
        continue;
      }

      const classification = classifySyncError(error);
      scopesWithErrors.add(operationScopeKey(operation));
      await safeMarkSyncError(store, {
        code: classifySyncTelemetryError(error),
        contractId: operation.contractId,
        entityTypeId: operation.entityTypeId,
        ownerKey: operation.ownerKey,
        phase: "pushing",
      });

      if (classification.action === "retry") {
        await store.retryPendingOperation(operation, classification.code, classification.message);
        result.retriable += 1;
        continue;
      }

      await store.failPendingOperation(operation, classification.code, classification.message);
      result.failed += 1;
    }
  }

  await Promise.all(
    scopes.filter((scope) => !scopesWithErrors.has(operationScopeKey(scope))).map((scope) =>
      safeMarkSyncPhaseCompleted(store, {
        contractId: scope.contractId,
        entityTypeId: scope.entityTypeId,
        ownerKey,
        phase: "pushing",
      }),
    ),
  );

  return result;
}

async function safeMarkSyncPhase(
  store: RecordsSyncStore,
  input: { attemptedAt?: string; contractId: string; entityTypeId: string; ownerKey: string; phase: SyncPhase },
) {
  try {
    await store.markSyncPhase?.(input);
  } catch {
    // Telemetry writes must not create retry loops or drop pending work.
  }
}

async function safeMarkSyncPhaseCompleted(
  store: RecordsSyncStore,
  input: { completedAt?: string; contractId: string; entityTypeId: string; ownerKey: string; phase: SyncErrorPhase },
) {
  try {
    await store.markSyncPhaseCompleted?.(input);
  } catch {
    // A failed telemetry write cannot turn a sync cycle into a false success.
  }
}

async function safeMarkSyncError(
  store: RecordsSyncStore,
  input: { code: SyncErrorCode; contractId: string; entityTypeId: string; ownerKey: string; phase: SyncErrorPhase },
) {
  try {
    await store.markSyncError?.(input);
  } catch {
    // If SQLite itself is unavailable, the storage recovery state owns the visible error.
  }
}

function uniqueOperationScopes(operations: PendingOperation[]) {
  const scopes = new Map<string, { contractId: string; entityTypeId: string }>();

  for (const operation of operations) {
    scopes.set(operationScopeKey(operation), {
      contractId: operation.contractId,
      entityTypeId: operation.entityTypeId,
    });
  }

  return [...scopes.values()];
}

function operationScopeKey(scope: Pick<PendingOperation, "contractId" | "entityTypeId">) {
  return `${scope.contractId}:${scope.entityTypeId}`;
}

async function syncUpdate({
  api,
  operation,
  store,
  token,
}: {
  api: Pick<OpcoApi, "getEntityRecord" | "updateEntityRecord">;
  operation: PendingOperation;
  store: Pick<RecordsSyncStore, "readRecordRemoteUpdatedAt">;
  token: string;
}): Promise<{ record: EntityRecord }> {
  if (!operation.serverRecordId) {
    throw new OpcoApiError("No se puede sincronizar UPDATE sin server_id.", "MISSING_SERVER_RECORD_ID", 400);
  }

  const [baseRemoteUpdatedAt, remote] = await Promise.all([
    store.readRecordRemoteUpdatedAt(operation),
    api.getEntityRecord(token, operation.contractId, operation.entityTypeId, operation.serverRecordId),
  ]);

  if (!baseRemoteUpdatedAt || remote.record.updatedAt !== baseRemoteUpdatedAt) {
    throw new RecordConflictDetected(remote.record);
  }

  return api.updateEntityRecord(token, operation.contractId, operation.entityTypeId, operation.serverRecordId, {
    values: operation.payload.values,
  });
}

export function getRecordSyncLabel(record: Pick<CachedEntityRecord, "syncStatus">) {
  if (record.syncStatus === "pending_create" || record.syncStatus === "pending_update") {
    return "Pendiente";
  }

  if (record.syncStatus === "syncing") {
    return "Sincronizando";
  }

  if (record.syncStatus === "failed") {
    return "Error";
  }

  if (record.syncStatus === "conflict") {
    return "Conflicto";
  }

  return null;
}

export class RecordConflictDetected extends Error {
  code = "REMOTE_VERSION_CHANGED";

  constructor(public readonly remoteRecord: EntityRecord) {
    super("Este registro cambio en Opco mientras tenias modificaciones locales pendientes.");
    this.name = "RecordConflictDetected";
  }
}

function classifySyncError(error: unknown): { action: "failed" | "retry"; code: string; message: string } {
  if (isLocalDatabaseUnavailableError(error)) {
    return { action: "retry", code: "SQLITE_UNAVAILABLE", message: "No fue posible acceder a SQLite local." };
  }

  if (error instanceof OpcoNetworkError) {
    return { action: "retry", code: "NETWORK", message: error.message };
  }

  if (error instanceof OpcoApiError) {
    if (error.status >= 500) {
      return { action: "retry", code: error.code || "SERVER", message: error.message };
    }

    if (error.code === "TOKEN_EXPIRED") {
      return { action: "retry", code: error.code, message: error.message };
    }

    return { action: "failed", code: error.code, message: error.message };
  }

  return { action: "retry", code: "NETWORK", message: "No fue posible conectar con Opco." };
}
