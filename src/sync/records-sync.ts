import { CachedEntityRecord, PendingOperation } from "../lib/offline-records";
import { EntityRecord, OpcoApi, OpcoApiError, OpcoNetworkError } from "../lib/opco-api";

export type RecordsSyncStore = {
  completePendingOperation(operation: PendingOperation, record: EntityRecord): Promise<void>;
  failPendingOperation(operation: PendingOperation, code: string, message: string): Promise<void>;
  listPendingOperations(ownerKey: string): Promise<PendingOperation[]>;
  markPendingOperationSyncing(operationId: string): Promise<void>;
  retryPendingOperation(operation: PendingOperation, code: string, message: string): Promise<void>;
};

export type RecordsSyncResult = {
  completed: number;
  failed: number;
  retriable: number;
};

let syncPromise: Promise<RecordsSyncResult> | null = null;

export function syncPendingRecordsOnce(params: {
  api: Pick<OpcoApi, "createEntityRecord" | "updateEntityRecord">;
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
  api: Pick<OpcoApi, "createEntityRecord" | "updateEntityRecord">;
  ownerKey: string;
  store: RecordsSyncStore;
  token: string;
}): Promise<RecordsSyncResult> {
  const operations = await store.listPendingOperations(ownerKey);
  const result = {
    completed: 0,
    failed: 0,
    retriable: 0,
  };

  for (const operation of operations) {
    await store.markPendingOperationSyncing(operation.id);

    try {
      const response =
        operation.operation === "CREATE"
          ? await api.createEntityRecord(token, operation.contractId, operation.entityTypeId, {
              clientRequestId: operation.clientRequestId,
              values: operation.payload.values,
            })
          : await syncUpdate({ api, operation, token });

      await store.completePendingOperation(operation, response.record);
      result.completed += 1;
    } catch (error) {
      const classification = classifySyncError(error);

      if (classification.action === "retry") {
        await store.retryPendingOperation(operation, classification.code, classification.message);
        result.retriable += 1;
        continue;
      }

      await store.failPendingOperation(operation, classification.code, classification.message);
      result.failed += 1;
    }
  }

  return result;
}

async function syncUpdate({
  api,
  operation,
  token,
}: {
  api: Pick<OpcoApi, "updateEntityRecord">;
  operation: PendingOperation;
  token: string;
}): Promise<{ record: EntityRecord }> {
  if (!operation.serverRecordId) {
    throw new OpcoApiError("No se puede sincronizar UPDATE sin server_id.", "MISSING_SERVER_RECORD_ID", 400);
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

  return null;
}

function classifySyncError(error: unknown): { action: "failed" | "retry"; code: string; message: string } {
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
