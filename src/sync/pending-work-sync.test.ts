import { describe, expect, it, vi } from "vitest";

import { PendingOperation } from "../lib/offline-records";
import { OpcoApiError, OpcoNetworkError } from "../lib/opco-api";
import { SyncErrorPhase, SyncTelemetry, SyncTelemetryScope } from "../lib/sync-telemetry";
import { RecordsSyncStore } from "./records-sync";
import { syncPendingWork } from "./pending-work-sync";

describe("pending work sync orchestration", () => {
  it("runs pending engines in RECORDS then STATE_UPDATE order for startup, reconnect, and manual triggers", async () => {
    for (const trigger of ["startup-with-pending", "reconnect", "manual-retry"] as const) {
      const order: string[] = [];
      const store = new EmptyRecordsStore(order);
      const syncStateUpdates = vi.fn(async () => {
        order.push("state-update");
        return null;
      });

      await syncPendingWork({
        api: emptyRecordsApi(),
        ownerKey: "org_1:user_1",
        recordsStore: store,
        syncStateUpdates,
        token: "token_1",
        trigger,
      });

      expect(order).toEqual(["records", "state-update"]);
      expect(syncStateUpdates).toHaveBeenCalledWith({
        ownerKey: "org_1:user_1",
        store: undefined,
        token: "token_1",
        trigger,
      });
    }
  });

  it("preserves current failure policy: a thrown RECORDS engine aborts STATE_UPDATE orchestration", async () => {
    const syncStateUpdates = vi.fn(async () => null);
    const store = new EmptyRecordsStore([]);

    store.listPendingOperations = vi.fn(async () => {
      throw new Error("sqlite unavailable");
    });

    await expect(syncPendingWork({
      api: emptyRecordsApi(),
      ownerKey: "org_1:user_1",
      recordsStore: store,
      syncStateUpdates,
      token: "token_1",
      trigger: "reconnect",
    })).rejects.toThrow("sqlite unavailable");
    expect(syncStateUpdates).not.toHaveBeenCalled();
  });

  it("continues to STATE_UPDATE when ordinary RECORDS operation failures are captured by the engine", async () => {
    const order: string[] = [];
    const store = new EmptyRecordsStore(order);
    const syncStateUpdates = vi.fn(async () => {
      order.push("state-update");
      return null;
    });

    store.operations = [operation()];

    const result = await syncPendingWork({
      api: {
        createEntityRecord: vi.fn(async () => {
          throw new OpcoNetworkError();
        }),
        getEntityRecord: vi.fn(),
        updateEntityRecord: vi.fn(),
      },
      ownerKey: "org_1:user_1",
      recordsStore: store,
      syncStateUpdates,
      token: "token_1",
      trigger: "reconnect",
    });

    expect(result.records.retriable).toBe(1);
    expect(order).toEqual(["records", "state-update"]);
    expect(syncStateUpdates).toHaveBeenCalledOnce();
  });

  it("returns the STATE_UPDATE telemetry wrapper result from global pending work sync", async () => {
    const stateUpdateRun = {
      completedAt: "2026-08-28T12:00:01.000Z",
      operationsSelected: 1,
      result: {
        completed: 1,
        conflicts: 0,
        failed: 0,
        lastRequestDiagnostics: null,
        operationsAttempted: 1,
        operationsSelected: 1,
        reconciledAfterTimeout: false,
        retriable: 0,
        timeoutOccurred: false,
      },
      startedAt: "2026-08-28T12:00:00.000Z",
    };
    const syncStateUpdates = vi.fn(async () => stateUpdateRun);

    const result = await syncPendingWork({
      api: emptyRecordsApi(),
      ownerKey: "org_1:user_1",
      recordsStore: new EmptyRecordsStore([]),
      syncStateUpdates,
      token: "token_1",
      trigger: "unknown-to-online",
    });

    expect(result.stateUpdate).toBe(stateUpdateRun);
    expect(syncStateUpdates).toHaveBeenCalledWith({
      ownerKey: "org_1:user_1",
      store: undefined,
      token: "token_1",
      trigger: "unknown-to-online",
    });
  });


  it("keeps repeated triggers delegated to engine single-flight instead of adding another queue", async () => {
    const order: string[] = [];
    const store = new EmptyRecordsStore(order);
    const syncStateUpdates = vi.fn(async () => {
      order.push("state-update");
      return null;
    });

    await Promise.all([
      syncPendingWork({
        api: emptyRecordsApi(),
        ownerKey: "org_1:user_1",
        recordsStore: store,
        syncStateUpdates,
        token: "token_1",
        trigger: "foreground/resume",
      }),
      syncPendingWork({
        api: emptyRecordsApi(),
        ownerKey: "org_1:user_1",
        recordsStore: store,
        syncStateUpdates,
        token: "token_1",
        trigger: "foreground/resume",
      }),
    ]);

    expect(order).toEqual(["records", "state-update", "state-update"]);
    expect(syncStateUpdates).toHaveBeenCalledTimes(2);
  });
});

function emptyRecordsApi() {
  return {
    createEntityRecord: vi.fn(async () => {
      throw new OpcoApiError("unexpected", "UNEXPECTED", 500);
    }),
    getEntityRecord: vi.fn(async () => {
      throw new OpcoApiError("unexpected", "UNEXPECTED", 500);
    }),
    updateEntityRecord: vi.fn(async () => {
      throw new OpcoApiError("unexpected", "UNEXPECTED", 500);
    }),
  };
}

class EmptyRecordsStore implements RecordsSyncStore {
  operations: PendingOperation[] = [];

  constructor(private order: string[]) {}

  async completePendingOperation() {}

  async failPendingOperation() {}

  async getSyncTelemetry(_scope: SyncTelemetryScope) {
    return null;
  }

  async listPendingOperations(_ownerKey: string): Promise<PendingOperation[]> {
    this.order.push("records");
    return this.operations;
  }

  async markPendingOperationConflict() {}

  async markPendingOperationSyncing() {}

  async markSyncError(input: SyncTelemetryScope & { code: SyncTelemetry["lastSyncErrorCode"]; phase: NonNullable<SyncTelemetry["lastSyncErrorPhase"]> }) {
    void input;
  }

  async markSyncPhase(input: SyncTelemetryScope & { phase: SyncTelemetry["syncPhase"] }) {
    void input;
  }

  async markSyncPhaseCompleted(input: SyncTelemetryScope & { completedAt?: string; phase: SyncErrorPhase }) {
    void input;
  }

  async readRecordRemoteUpdatedAt() {
    return null;
  }

  async retryPendingOperation() {}

}

function operation(): PendingOperation {
  return {
    attempts: 0,
    clientRequestId: "request_1",
    contractId: "contract_1",
    createdAt: "2026-08-28T00:00:00.000Z",
    entityTypeId: "entity_1",
    id: "operation_1",
    lastErrorCode: null,
    lastErrorMessage: null,
    localRecordId: "local_1",
    operation: "CREATE",
    ownerKey: "org_1:user_1",
    payload: { clientRequestId: "request_1", values: { name: "Local" } },
    serverRecordId: null,
    updatedAt: "2026-08-28T00:00:00.000Z",
  };
}
