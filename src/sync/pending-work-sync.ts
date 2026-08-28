import { OpcoApi } from "../lib/opco-api";
import { StateUpdateSyncTrigger } from "../lib/state-update-offline";
import { RecordsSyncStore, syncPendingRecordsOnce } from "./records-sync";
import { StateUpdateSyncStore, syncPendingStateUpdatesOnce } from "./state-update-sync";

type StateUpdateSyncRun = {
  completedAt: string;
  operationsSelected: number;
  result: Awaited<ReturnType<typeof syncPendingStateUpdatesOnce>>;
  startedAt: string;
} | null;

type SyncPendingWorkInput = {
  api: Pick<OpcoApi, "createEntityRecord" | "getEntityRecord" | "updateEntityRecord">;
  ownerKey: string;
  recordsStore: RecordsSyncStore;
  stateUpdateStore?: StateUpdateSyncStore;
  syncStateUpdates(input: {
    ownerKey: string;
    store?: StateUpdateSyncStore;
    token: string;
    trigger: StateUpdateSyncTrigger;
  }): Promise<StateUpdateSyncRun>;
  token: string;
  trigger: StateUpdateSyncTrigger;
};

export type SyncPendingWorkResult = {
  records: Awaited<ReturnType<typeof syncPendingRecordsOnce>>;
  stateUpdate: StateUpdateSyncRun;
};

export async function syncPendingWork({
  api,
  ownerKey,
  recordsStore,
  stateUpdateStore,
  syncStateUpdates,
  token,
  trigger,
}: SyncPendingWorkInput): Promise<SyncPendingWorkResult> {
  const records = await syncPendingRecordsOnce({
    api,
    ownerKey,
    store: recordsStore,
    token,
  });
  const stateUpdate = await syncStateUpdates({
    ownerKey,
    store: stateUpdateStore,
    token,
    trigger,
  });

  return {
    records,
    stateUpdate,
  };
}
