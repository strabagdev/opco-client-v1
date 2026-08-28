import { createClientRequestId } from "./client-request-id";
import {
  EntityField,
  EntityRecord,
  EntityRecordPagination,
  EntityRecordValue,
  OpcoApi,
  OpcoApiError,
  OpcoNetworkError,
} from "./opco-api";
import { classifySyncTelemetryError, SyncTelemetryStore } from "./sync-telemetry";

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

export type PendingOperationType = "CREATE" | "UPDATE" | "STATE_UPDATE";

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
  payload: OfflineRecordPayload | Record<string, unknown>;
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

export type RecordCacheStatusCounts = {
  conflict: number;
  failed: number;
  pendingCreate: number;
  pendingUpdate: number;
  synced: number;
  total: number;
};

export type RecordsScopeFingerprint = {
  contract: string;
  entity: string;
  owner: string;
  scope: string;
};

export type RecordsReconcileDiagnostics = {
  afterReconcile: RecordCacheStatusCounts;
  afterUpsert: RecordCacheStatusCounts;
  reconcileScope: RecordsScopeFingerprint;
  writeScope: RecordsScopeFingerprint;
};

export type RecordsRefreshDiagnostics = {
  afterReconcile?: RecordCacheStatusCounts;
  afterUpsert?: RecordCacheStatusCounts;
  beforeRefresh?: RecordCacheStatusCounts;
  beforeRender?: RecordCacheStatusCounts;
  lastHttpStatus: number | null;
  pages: { count: number; page: number; pageSize: number }[];
  recordsFetched: number;
  readScope?: RecordsScopeFingerprint;
  reconcileScope?: RecordsScopeFingerprint;
  remoteTotal: number | null;
  totalPages: number | null;
  writeScope?: RecordsScopeFingerprint;
};

export type RecordOutboxConsistencyIssueCode =
  | "ORPHANED_LOCAL_INTENT"
  | "ORPHANED_OUTBOX"
  | "INCONSISTENT_COMPLETION";

export type RecordOutboxConsistencyIssue = {
  code: RecordOutboxConsistencyIssueCode;
  contract: string;
  entity: string;
  localRecord: string;
  operation: "CREATE" | "UPDATE" | "none";
  operationId: string | null;
  owner: string;
  syncStatus: RecordSyncStatus | "missing-record";
};

export type RecordOutboxConsistency = {
  ok: boolean;
  issueCounts: Record<RecordOutboxConsistencyIssueCode, number>;
  issues: RecordOutboxConsistencyIssue[];
  scope: RecordsScopeFingerprint;
};

export type OfflineRecordStore = {
  countPendingOperations(ownerKey: string): Promise<number>;
  createLocalRecord(input: CreateLocalRecordInput): Promise<CachedEntityRecord>;
  getCachedRecord(input: RecordIdentityInput): Promise<CachedEntityRecord | null>;
  getRecordCacheStatusCounts(input: BaseScopedInput): Promise<RecordCacheStatusCounts>;
  getRecordOutboxConsistency(input: BaseScopedInput): Promise<RecordOutboxConsistency>;
  getRecordsSyncSummary(input: RecordsSyncSummaryInput): Promise<RecordsSyncSummary>;
  listCachedRecords(input: ListCachedRecordsInput): Promise<CachedRecordsResult>;
  listProblemRecords(input: ListProblemRecordsInput): Promise<CachedEntityRecord[]>;
  reconcileRemoteRecordsSnapshot(input: ReconcileRemoteRecordsSnapshotInput): Promise<RecordsReconcileDiagnostics | void>;
  retryFailedRecord(input: RetryFailedRecordInput): Promise<CachedEntityRecord>;
  resolveRecordConflictWithLocal(input: ResolveRecordConflictInput & { api: Pick<OpcoApi, "getEntityRecord">; token: string }): Promise<CachedEntityRecord>;
  resolveRecordConflictWithRemote(input: ResolveRecordConflictInput & { api: Pick<OpcoApi, "getEntityRecord">; token: string }): Promise<CachedEntityRecord>;
  updateLocalRecord(input: UpdateLocalRecordInput): Promise<CachedEntityRecord>;
  upsertRemoteRecords(input: UpsertRemoteRecordsInput): Promise<void>;
} & Partial<Pick<SyncTelemetryStore, "getSyncTelemetry" | "markSyncError" | "markSyncPhase" | "markSyncPhaseCompleted">>;

const FULL_REFRESH_PAGE_SIZE = 100;
const FULL_REFRESH_MAX_PAGES = 1_000;

class RecordsRefreshInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordsRefreshInvariantError";
  }
}

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
  onDiagnostics?: (diagnostics: RecordsRefreshDiagnostics) => void;
  pageSize?: number;
  resultPageSize?: number;
  store: Pick<OfflineRecordStore, "listCachedRecords" | "reconcileRemoteRecordsSnapshot"> &
    Partial<Pick<OfflineRecordStore, "getRecordCacheStatusCounts">> &
    Partial<Pick<SyncTelemetryStore, "markSyncError" | "markSyncPhase" | "markSyncPhaseCompleted">>;
  suppressNetworkTelemetry?: boolean;
  token: string;
};

export async function refreshEntityRecordsCache({
  api,
  contractId,
  entityTypeId,
  ownerKey,
  onDiagnostics,
  pageSize = FULL_REFRESH_PAGE_SIZE,
  resultPageSize = 25,
  store,
  suppressNetworkTelemetry = false,
  token,
}: RefreshEntityRecordsCacheParams): Promise<CachedRecordsResult> {
  let currentTelemetryPhase: "refreshing" | "reconciling" = "refreshing";
  const diagnostics: RecordsRefreshDiagnostics = {
    lastHttpStatus: null,
    pages: [],
    recordsFetched: 0,
    readScope: fingerprintRecordsScope({ contractId, entityTypeId, ownerKey }),
    reconcileScope: fingerprintRecordsScope({ contractId, entityTypeId, ownerKey }),
    remoteTotal: null,
    totalPages: null,
    writeScope: fingerprintRecordsScope({ contractId, entityTypeId, ownerKey }),
  };

  diagnostics.beforeRefresh = await store.getRecordCacheStatusCounts?.({ contractId, entityTypeId, ownerKey });

  if (!suppressNetworkTelemetry) {
    await store.markSyncPhase?.({
      attemptedAt: new Date().toISOString(),
      contractId,
      entityTypeId,
      ownerKey,
      phase: "refreshing",
    });
  }

  try {
    const records: EntityRecord[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const remote = await api.getEntityRecords(token, contractId, entityTypeId, {
        page,
        pageSize,
      });

      diagnostics.lastHttpStatus = 200;
      diagnostics.pages.push({ count: remote.records.length, page, pageSize });
      diagnostics.recordsFetched += remote.records.length;
      diagnostics.remoteTotal = remote.pagination.total;
      diagnostics.totalPages = remote.pagination.totalPages;
      records.push(...remote.records);
      totalPages = Math.max(1, remote.pagination.totalPages);

      if (page >= FULL_REFRESH_MAX_PAGES && page < totalPages) {
        throw new Error("Opco devolvio demasiadas paginas de registros para refrescar el cache local.");
      }

      page += 1;
    } while (page <= totalPages);

    if (!suppressNetworkTelemetry) {
      await store.markSyncPhaseCompleted?.({
        contractId,
        entityTypeId,
        ownerKey,
        phase: "refreshing",
      });
      await store.markSyncPhase?.({
        contractId,
        entityTypeId,
        ownerKey,
        phase: "reconciling",
      });
    }
    currentTelemetryPhase = "reconciling";
    const reconcileDiagnostics = await store.reconcileRemoteRecordsSnapshot({
      contractId,
      entityTypeId,
      ownerKey,
      records,
    });
    diagnostics.afterUpsert = reconcileDiagnostics?.afterUpsert;
    diagnostics.afterReconcile = reconcileDiagnostics?.afterReconcile ?? await store.getRecordCacheStatusCounts?.({ contractId, entityTypeId, ownerKey });
    diagnostics.writeScope = reconcileDiagnostics?.writeScope ?? diagnostics.writeScope;
    diagnostics.reconcileScope = reconcileDiagnostics?.reconcileScope ?? diagnostics.reconcileScope;
    onDiagnostics?.(diagnostics);
    if ((diagnostics.remoteTotal ?? 0) > 0 && (diagnostics.recordsFetched > 0 || records.length > 0) && diagnostics.afterReconcile?.synced === 0) {
      throw new RecordsRefreshInvariantError("El refresco remoto devolvio registros, pero el cache local quedo sin registros sincronizados.");
    }
    if (!suppressNetworkTelemetry) {
      await store.markSyncPhaseCompleted?.({
        contractId,
        entityTypeId,
        ownerKey,
        phase: "reconciling",
      });
    }

    const cached = await store.listCachedRecords({
      contractId,
      entityTypeId,
      ownerKey,
      page: 1,
      pageSize: resultPageSize,
    });
    diagnostics.beforeRender = await store.getRecordCacheStatusCounts?.({ contractId, entityTypeId, ownerKey });
    onDiagnostics?.(diagnostics);

    return {
      ...cached,
      fromCache: false,
      offline: false,
    };
  } catch (error) {
    if (error instanceof RecordsRefreshInvariantError) {
      onDiagnostics?.(diagnostics);
      await store.markSyncError?.({
        code: "SQLITE",
        contractId,
        entityTypeId,
        ownerKey,
        phase: currentTelemetryPhase,
      });
      throw error;
    }

    if (error instanceof OpcoApiError) {
      diagnostics.lastHttpStatus = error.status;
    }
    onDiagnostics?.(diagnostics);
    if (!(suppressNetworkTelemetry && isNetworkLikeError(error))) {
      await store.markSyncError?.({
        code: classifySyncTelemetryError(error),
        contractId,
        entityTypeId,
        ownerKey,
        phase: currentTelemetryPhase,
      });
    }

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

export function fingerprintRecordsScope({ contractId, entityTypeId, ownerKey }: BaseScopedInput): RecordsScopeFingerprint {
  return {
    contract: fingerprintValue(contractId),
    entity: fingerprintValue(entityTypeId),
    owner: fingerprintValue(ownerKey),
    scope: fingerprintValue(`${ownerKey}\u001f${contractId}\u001f${entityTypeId}`),
  };
}

function fingerprintValue(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
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
