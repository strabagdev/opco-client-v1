import { createClientRequestId } from "./client-request-id";
import {
  EntityField,
  EntityRecord,
  EntityRecordPagination,
  EntityRecordValue,
  OpcoApi,
  OpcoNetworkError,
} from "./opco-api";

export type RecordSyncStatus = "synced" | "pending_create" | "pending_update" | "syncing" | "failed" | "conflict";

export type CachedEntityRecord = EntityRecord & {
  conflictRemoteDisplayName?: string | null;
  conflictRemoteUpdatedAt?: string | null;
  conflictRemoteValues?: Record<string, EntityRecordValue> | null;
  localId: string;
  remoteUpdatedAt: string | null;
  serverId: string | null;
  syncErrorCode?: string | null;
  syncErrorMessage?: string | null;
  syncStatus: RecordSyncStatus;
};

export type PendingOperationType = "CREATE" | "UPDATE";

export type PendingOperation = {
  attempts: number;
  clientRequestId: string;
  contractId: string;
  createdAt: string;
  entityTypeId: string;
  id: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  localRecordId: string;
  operation: PendingOperationType;
  ownerKey: string;
  payload: OfflineRecordPayload;
  serverRecordId: string | null;
  updatedAt: string;
};

export type OfflineRecordPayload = {
  clientRequestId?: string;
  values: Record<string, EntityRecordValue>;
};

export type CachedRecordsResult = {
  fromCache: boolean;
  offline: boolean;
  pagination: EntityRecordPagination;
  records: CachedEntityRecord[];
};

export type RecordsSyncSummary = {
  conflictCount: number;
  failedCount: number;
  pendingCount: number;
  syncingCount: number;
};

export type OfflineRecordStore = {
  countPendingOperations(ownerKey: string): Promise<number>;
  createLocalRecord(input: CreateLocalRecordInput): Promise<CachedEntityRecord>;
  getCachedRecord(input: RecordIdentityInput): Promise<CachedEntityRecord | null>;
  getRecordsSyncSummary(input: RecordsSyncSummaryInput): Promise<RecordsSyncSummary>;
  listCachedRecords(input: ListCachedRecordsInput): Promise<CachedRecordsResult>;
  listProblemRecords(input: ListProblemRecordsInput): Promise<CachedEntityRecord[]>;
  reconcileRemoteRecordsSnapshot(input: ReconcileRemoteRecordsSnapshotInput): Promise<void>;
  retryFailedRecord(input: RetryFailedRecordInput): Promise<CachedEntityRecord>;
  resolveRecordConflictWithLocal(input: ResolveRecordConflictInput & { api: Pick<OpcoApi, "getEntityRecord">; token: string }): Promise<CachedEntityRecord>;
  resolveRecordConflictWithRemote(input: ResolveRecordConflictInput & { api: Pick<OpcoApi, "getEntityRecord">; token: string }): Promise<CachedEntityRecord>;
  updateLocalRecord(input: UpdateLocalRecordInput): Promise<CachedEntityRecord>;
  upsertRemoteRecords(input: UpsertRemoteRecordsInput): Promise<void>;
};

const FULL_REFRESH_PAGE_SIZE = 100;
const FULL_REFRESH_MAX_PAGES = 1_000;

type BaseScopedInput = {
  contractId: string;
  entityTypeId: string;
  ownerKey: string;
};

export type ListCachedRecordsInput = BaseScopedInput & {
  page?: number;
  pageSize?: number;
  search?: string;
};

export type ListProblemRecordsInput = BaseScopedInput;

export type RecordsSyncSummaryInput = {
  contractId: string;
  ownerKey: string;
};

export type RecordIdentityInput = BaseScopedInput & {
  recordId: string;
};

export type CreateLocalRecordInput = BaseScopedInput & {
  clientRequestId?: string;
  localId?: string;
  values: Record<string, EntityRecordValue>;
};

export type UpdateLocalRecordInput = BaseScopedInput & {
  recordId: string;
  values: Record<string, EntityRecordValue>;
};

export type ResolveRecordConflictInput = RecordIdentityInput;

export type RetryFailedRecordInput = RecordIdentityInput;

export type UpsertRemoteRecordsInput = BaseScopedInput & {
  cachedAt?: string;
  records: EntityRecord[];
};

export type ReconcileRemoteRecordsSnapshotInput = UpsertRemoteRecordsInput;

export type LoadRecordsParams = BaseScopedInput & {
  api: Pick<OpcoApi, "getEntityRecords">;
  page?: number;
  pageSize?: number;
  search?: string;
  store: OfflineRecordStore;
  token: string;
};

export async function loadRecordsWithOfflineCache({
  api,
  contractId,
  entityTypeId,
  ownerKey,
  page = 1,
  pageSize = 25,
  search,
  store,
  token,
}: LoadRecordsParams): Promise<CachedRecordsResult> {
  try {
    const remote = await api.getEntityRecords(token, contractId, entityTypeId, {
      page,
      pageSize,
      search,
    });

    await store.upsertRemoteRecords({
      contractId,
      entityTypeId,
      ownerKey,
      records: remote.records,
    });

    return store.listCachedRecords({
      contractId,
      entityTypeId,
      ownerKey,
      page,
      pageSize,
      search,
    });
  } catch (error) {
    if (isNetworkLikeError(error)) {
      const cached = await store.listCachedRecords({
        contractId,
        entityTypeId,
        ownerKey,
        page,
        pageSize,
        search,
      });

      return {
        ...cached,
        fromCache: true,
        offline: true,
      };
    }

    throw error;
  }
}

export type RefreshEntityRecordsCacheParams = BaseScopedInput & {
  api: Pick<OpcoApi, "getEntityRecords">;
  pageSize?: number;
  resultPageSize?: number;
  store: Pick<OfflineRecordStore, "listCachedRecords" | "reconcileRemoteRecordsSnapshot">;
  token: string;
};

export async function refreshEntityRecordsCache({
  api,
  contractId,
  entityTypeId,
  ownerKey,
  pageSize = FULL_REFRESH_PAGE_SIZE,
  resultPageSize = 25,
  store,
  token,
}: RefreshEntityRecordsCacheParams): Promise<CachedRecordsResult> {
  try {
    const records: EntityRecord[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const remote = await api.getEntityRecords(token, contractId, entityTypeId, {
        page,
        pageSize,
      });

      records.push(...remote.records);
      totalPages = Math.max(1, remote.pagination.totalPages);

      if (page >= FULL_REFRESH_MAX_PAGES && page < totalPages) {
        throw new Error("Opco devolvio demasiadas paginas de registros para refrescar el cache local.");
      }

      page += 1;
    } while (page <= totalPages);

    await store.reconcileRemoteRecordsSnapshot({
      contractId,
      entityTypeId,
      ownerKey,
      records,
    });

    const cached = await store.listCachedRecords({
      contractId,
      entityTypeId,
      ownerKey,
      page: 1,
      pageSize: resultPageSize,
    });

    return {
      ...cached,
      fromCache: false,
      offline: false,
    };
  } catch (error) {
    if (isNetworkLikeError(error)) {
      const cached = await store.listCachedRecords({
        contractId,
        entityTypeId,
        ownerKey,
        page: 1,
        pageSize: resultPageSize,
      });

      return {
        ...cached,
        fromCache: true,
        offline: true,
      };
    }

    throw error;
  }
}

export type LoadRecordParams = BaseScopedInput & {
  api: Pick<OpcoApi, "getEntityRecord">;
  recordId: string;
  store: Pick<OfflineRecordStore, "getCachedRecord" | "upsertRemoteRecords">;
  token: string;
};

export async function loadRecordWithOfflineCache({
  api,
  contractId,
  entityTypeId,
  ownerKey,
  recordId,
  store,
  token,
}: LoadRecordParams): Promise<{ fromCache: boolean; offline: boolean; record: CachedEntityRecord | null }> {
  try {
    const remote = await api.getEntityRecord(token, contractId, entityTypeId, recordId);

    await store.upsertRemoteRecords({
      contractId,
      entityTypeId,
      ownerKey,
      records: [remote.record],
    });

    return {
      fromCache: false,
      offline: false,
      record: await store.getCachedRecord({ contractId, entityTypeId, ownerKey, recordId }),
    };
  } catch (error) {
    if (isNetworkLikeError(error)) {
      return {
        fromCache: true,
        offline: true,
        record: await store.getCachedRecord({ contractId, entityTypeId, ownerKey, recordId }),
      };
    }

    const cached = await store.getCachedRecord({ contractId, entityTypeId, ownerKey, recordId });

    if (cached && cached.syncStatus !== "synced") {
      return {
        fromCache: true,
        offline: false,
        record: cached,
      };
    }

    throw error;
  }
}

export type SaveRecordParams = BaseScopedInput & {
  mode: "create" | "edit";
  recordId?: string;
  store: Pick<OfflineRecordStore, "createLocalRecord" | "updateLocalRecord">;
  values: Record<string, EntityRecordValue>;
};

export async function saveRecordLocally({
  contractId,
  entityTypeId,
  mode,
  ownerKey,
  recordId,
  store,
  values,
}: SaveRecordParams) {
  if (mode === "create") {
    return store.createLocalRecord({
      clientRequestId: createClientRequestId(),
      contractId,
      entityTypeId,
      ownerKey,
      values,
    });
  }

  if (!recordId) {
    throw new Error("No se encontro el registro a editar.");
  }

  return store.updateLocalRecord({
    contractId,
    entityTypeId,
    ownerKey,
    recordId,
    values,
  });
}

export type ConflictDifference = {
  fieldKey: string;
  label: string;
  localValue: EntityRecordValue | undefined;
  remoteValue: EntityRecordValue | undefined;
};

export function getConflictDifferences(
  fields: EntityField[],
  record: Pick<CachedEntityRecord, "conflictRemoteValues" | "values">,
) {
  const remoteValues = record.conflictRemoteValues ?? {};
  const keys = new Set([...Object.keys(record.values), ...Object.keys(remoteValues)]);
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  const differences: ConflictDifference[] = [];

  for (const key of keys) {
    const localValue = record.values[key];
    const remoteValue = remoteValues[key];

    if (JSON.stringify(localValue) === JSON.stringify(remoteValue)) {
      continue;
    }

    differences.push({
      fieldKey: key,
      label: fieldsByKey.get(key)?.name ?? "Campo",
      localValue,
      remoteValue,
    });
  }

  return differences.sort((a, b) => {
    const aOrder = fields.find((field) => field.key === a.fieldKey)?.order ?? Number.MAX_SAFE_INTEGER;
    const bOrder = fields.find((field) => field.key === b.fieldKey)?.order ?? Number.MAX_SAFE_INTEGER;

    return aOrder - bOrder || a.label.localeCompare(b.label);
  });
}

export function createLocalRecordId() {
  return `local_${createClientRequestId()}`;
}

export function buildLocalDisplayName(values: Record<string, EntityRecordValue>) {
  const firstValue = Object.values(values).find((value) => {
    if (value === null || value === undefined) {
      return false;
    }

    if (typeof value === "string") {
      return value.trim().length > 0;
    }

    return typeof value === "number" || typeof value === "boolean";
  });

  return firstValue === undefined || firstValue === null ? "Registro sin nombre" : String(firstValue);
}

function isNetworkLikeError(error: unknown) {
  return error instanceof OpcoNetworkError || !(error instanceof Error && "code" in error);
}
