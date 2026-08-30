import { OpcoApi } from "../lib/opco-api";
import { StateUpdateSyncTrigger } from "../lib/state-update-offline";
import { RecordsSyncStore, syncPendingRecordsOnce } from "./records-sync";
import { StateUpdateSyncStore, syncPendingStateUpdatesOnce } from "./state-update-sync";

type StateUpdateSyncRun = {
  completedAt: string;
  operationsSelected: number;
  result: Awaited<ReturnType<typeof syncPendingStateUpdatesOnce>>;
  startedAt: string;
  syncRunId: string;
} | null;

type SyncPendingWorkInput = {
  api: Pick<OpcoApi, "createEntityRecord" | "getEntityRecord" | "updateEntityRecord">;
  onPhase?(event: SyncPendingWorkPhaseEvent): void | Promise<void>;
  ownerKey: string;
  recordsStore: RecordsSyncStore;
  stateUpdateStore?: StateUpdateSyncStore;
  syncStateUpdates(input: {
    ownerKey: string;
    store?: StateUpdateSyncStore;
    syncRunId: string;
    token: string;
    trigger: StateUpdateSyncTrigger;
  }): Promise<StateUpdateSyncRun>;
  token: string;
  trigger: StateUpdateSyncTrigger;
  syncRunId?: string;
};

export type SyncPendingWorkPhaseEvent =
  | {
      completedAt?: string;
      failedAt?: string;
      phase: "records";
      result: "completed" | "failed" | "started";
      recordsOperationsCompleted?: number;
      recordsOperationsFailed?: number;
      startedAt?: string;
    }
  | {
      completedAt?: string;
      failedAt?: string;
      phase: "state-update";
      result: "completed" | "failed" | "started";
      startedAt?: string;
      stateUpdateOperationsSelected?: number;
    };

export type SyncPendingWorkResult = {
  records: Awaited<ReturnType<typeof syncPendingRecordsOnce>>;
  stateUpdate: StateUpdateSyncRun;
};

export async function syncPendingWork({
  api,
  onPhase,
  ownerKey,
  recordsStore,
  stateUpdateStore,
  syncStateUpdates,
  token,
  trigger,
  syncRunId = createSyncRunId(),
}: SyncPendingWorkInput): Promise<SyncPendingWorkResult> {
  safeRecordPendingWorkPhase(onPhase, {
    phase: "records",
    result: "started",
    startedAt: new Date().toISOString(),
  });

  let records;
  try {
    records = await syncPendingRecordsOnce({
      api,
      ownerKey,
      store: recordsStore,
      token,
    });
  } catch (error) {
    safeRecordPendingWorkPhase(onPhase, {
      failedAt: new Date().toISOString(),
      phase: "records",
      result: "failed",
    });
    throw error;
  }

  safeRecordPendingWorkPhase(onPhase, {
    completedAt: new Date().toISOString(),
    phase: "records",
    recordsOperationsCompleted: records.completed,
    recordsOperationsFailed: records.conflicts + records.failed + records.retriable,
    result: "completed",
  });

  safeRecordPendingWorkPhase(onPhase, {
    phase: "state-update",
    result: "started",
    startedAt: new Date().toISOString(),
  });

  let stateUpdate;
  try {
    stateUpdate = await syncStateUpdates({
      ownerKey,
      store: stateUpdateStore,
      syncRunId,
      token,
      trigger,
    });
  } catch (error) {
    safeRecordPendingWorkPhase(onPhase, {
      failedAt: new Date().toISOString(),
      phase: "state-update",
      result: "failed",
    });
    throw error;
  }

  safeRecordPendingWorkPhase(onPhase, {
    completedAt: new Date().toISOString(),
    phase: "state-update",
    result: "completed",
    stateUpdateOperationsSelected: stateUpdate?.operationsSelected ?? 0,
  });

  return {
    records,
    stateUpdate,
  };
}

export function createSyncRunId() {
  return `sync_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeRecordPendingWorkPhase(
  onPhase: SyncPendingWorkInput["onPhase"],
  event: SyncPendingWorkPhaseEvent,
) {
  try {
    void Promise.resolve(onPhase?.(event)).catch(() => undefined);
  } catch {
    // Diagnostics are best-effort and must not change pending sync behavior.
  }
}
