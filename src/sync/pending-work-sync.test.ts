import { describe, expect, it, vi } from "vitest";

import { PendingOperation } from "../lib/offline-records";
import { OpcoApiError, OpcoNetworkError } from "../lib/opco-api";
import { OfflineStateUpdatePayload, STATE_UPDATE_OPERATION } from "../lib/state-update-offline";
import { SyncErrorCode, SyncErrorPhase, SyncPhase, SyncTelemetry, SyncTelemetryScope, emptySyncTelemetry } from "../lib/sync-telemetry";
import { RecordsSyncStore } from "./records-sync";
import { syncPendingWork } from "./pending-work-sync";
import { StateUpdateSyncStore, syncPendingStateUpdatesOnce } from "./state-update-sync";

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
        syncRunId: expect.stringMatching(/^sync_/),
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

  it("emits RECORDS and STATE_UPDATE phase diagnostics without changing engine order", async () => {
    const phases: string[] = [];
    const syncStateUpdates = vi.fn(async (input: { syncRunId: string }) => ({
      completedAt: "2026-08-29T10:00:01.000Z",
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
      startedAt: "2026-08-29T10:00:00.000Z",
      syncRunId: input.syncRunId,
    }));

    await syncPendingWork({
      api: emptyRecordsApi(),
      onPhase(event) {
        phases.push(`${event.phase}:${event.result}`);
      },
      ownerKey: "org_1:user_1",
      recordsStore: new EmptyRecordsStore([]),
      syncRunId: "sync_phase_1",
      syncStateUpdates,
      token: "token_1",
      trigger: "reconnect",
    });

    expect(phases).toEqual([
      "records:started",
      "records:completed",
      "state-update:started",
      "state-update:completed",
    ]);
  });

  it("reports a RECORDS throw before STATE_UPDATE without invoking STATE_UPDATE", async () => {
    const phases: string[] = [];
    const syncStateUpdates = vi.fn(async () => null);
    const store = new EmptyRecordsStore([]);

    store.listPendingOperations = vi.fn(async () => {
      throw new Error("sqlite unavailable");
    });

    await expect(syncPendingWork({
      api: emptyRecordsApi(),
      onPhase(event) {
        phases.push(`${event.phase}:${event.result}`);
      },
      ownerKey: "org_1:user_1",
      recordsStore: store,
      syncRunId: "sync_phase_records_failed",
      syncStateUpdates,
      token: "token_1",
      trigger: "reconnect",
    })).rejects.toThrow("sqlite unavailable");

    expect(phases).toEqual(["records:started", "records:failed"]);
    expect(syncStateUpdates).not.toHaveBeenCalled();
  });

  it("reports selected STATE_UPDATE operations after the STATE_UPDATE phase completes", async () => {
    const selectedCounts: number[] = [];
    const syncStateUpdates = vi.fn(async (input: { syncRunId: string }) => ({
      completedAt: "2026-08-29T10:00:01.000Z",
      operationsSelected: 1,
      result: {
        completed: 0,
        conflicts: 0,
        failed: 0,
        lastRequestDiagnostics: null,
        operationsAttempted: 0,
        operationsSelected: 1,
        reconciledAfterTimeout: false,
        retriable: 0,
        timeoutOccurred: false,
      },
      startedAt: "2026-08-29T10:00:00.000Z",
      syncRunId: input.syncRunId,
    }));

    await syncPendingWork({
      api: emptyRecordsApi(),
      onPhase(event) {
        if (event.phase === "state-update" && event.stateUpdateOperationsSelected !== undefined) {
          selectedCounts.push(event.stateUpdateOperationsSelected);
        }
      },
      ownerKey: "org_1:user_1",
      recordsStore: new EmptyRecordsStore([]),
      syncRunId: "sync_phase_selected",
      syncStateUpdates,
      token: "token_1",
      trigger: "reconnect",
    });

    expect(selectedCounts).toEqual([1]);
  });

  it("ignores phase diagnostics failures so business sync can continue", async () => {
    const syncStateUpdates = vi.fn(async () => null);

    await syncPendingWork({
      api: emptyRecordsApi(),
      onPhase() {
        throw new Error("diagnostics unavailable");
      },
      ownerKey: "org_1:user_1",
      recordsStore: new EmptyRecordsStore([]),
      syncStateUpdates,
      token: "token_1",
      trigger: "reconnect",
    });

    expect(syncStateUpdates).toHaveBeenCalledOnce();
  });

  it("ignores rejected async phase diagnostics so STATE_UPDATE still runs", async () => {
    const syncStateUpdates = vi.fn(async () => null);

    await syncPendingWork({
      api: emptyRecordsApi(),
      onPhase: vi.fn(async () => {
        throw new Error("app_metadata unavailable");
      }),
      ownerKey: "org_1:user_1",
      recordsStore: new EmptyRecordsStore([]),
      syncStateUpdates,
      token: "token_1",
      trigger: "reconnect",
    });

    await Promise.resolve();

    expect(syncStateUpdates).toHaveBeenCalledOnce();
  });

  it("continues from ready 200 equivalent preflight to SAVE when diagnostics persistence rejects", async () => {
    const stateUpdateStore = new MemoryStateUpdateSyncStore();
    const saveStateUpdateWorkflow = vi.fn(async () => ({
      appView: { id: "view_attendance", name: "Registro de asistencia", slug: "attendance" },
      results: [{
        recordId: "attendance_5",
        result: "CREATED" as const,
        subjectRecordId: "person_5",
        updatedAt: "2026-08-29T10:00:00.000Z",
      }],
    }));

    stateUpdateStore.operations = [stateUpdateOperation()];

    const result = await syncPendingWork({
      api: emptyRecordsApi(),
      onPhase: vi.fn(async () => {
        throw new Error("diagnostics persist rejected");
      }),
      ownerKey: "org_1:user_1",
      recordsStore: new EmptyRecordsStore([]),
      stateUpdateStore,
      syncRunId: "sync_ready_200_then_save",
      syncStateUpdates(input) {
        return syncPendingStateUpdatesOnce({
          api: { saveStateUpdateWorkflow },
          ownerKey: input.ownerKey,
          store: input.store ?? stateUpdateStore,
          syncRunId: input.syncRunId,
          token: input.token,
        }).then((syncResult) => ({
          completedAt: "2026-08-29T10:00:01.000Z",
          operationsSelected: syncResult.operationsSelected,
          result: syncResult,
          startedAt: "2026-08-29T10:00:00.000Z",
          syncRunId: input.syncRunId,
        }));
      },
      token: "token_1",
      trigger: "reconnect",
    });

    await Promise.resolve();

    expect(result.stateUpdate).toMatchObject({
      operationsSelected: 1,
      result: {
        completed: 1,
        operationsAttempted: 1,
        operationsSelected: 1,
      },
    });
    expect(saveStateUpdateWorkflow).toHaveBeenCalledOnce();
    expect(stateUpdateStore.completed).toHaveLength(1);
    expect(stateUpdateStore.operations).toHaveLength(0);
  });

  it("returns the STATE_UPDATE telemetry wrapper result from global pending work sync", async () => {
    const syncStateUpdates = vi.fn(async (input: { syncRunId: string }) => ({
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
      syncRunId: input.syncRunId,
    }));

    const result = await syncPendingWork({
      api: emptyRecordsApi(),
      ownerKey: "org_1:user_1",
      recordsStore: new EmptyRecordsStore([]),
      syncStateUpdates,
      token: "token_1",
      trigger: "unknown-to-online",
    });

    expect(result.stateUpdate?.syncRunId).toMatch(/^sync_/);
    expect(syncStateUpdates).toHaveBeenCalledWith({
      ownerKey: "org_1:user_1",
      store: undefined,
      syncRunId: expect.stringMatching(/^sync_/),
      token: "token_1",
      trigger: "unknown-to-online",
    });
  });

  it("reuses a lifecycle syncRunId across pending engines", async () => {
    const order: string[] = [];
    const syncStateUpdates = vi.fn(async (input: { syncRunId: string }) => ({
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
      syncRunId: input.syncRunId,
    }));

    const result = await syncPendingWork({
      api: emptyRecordsApi(),
      ownerKey: "org_1:user_1",
      recordsStore: new EmptyRecordsStore(order),
      syncRunId: "sync_lifecycle_1",
      syncStateUpdates,
      token: "token_1",
      trigger: "reconnect",
    });

    expect(order).toEqual(["records"]);
    expect(result.stateUpdate?.syncRunId).toBe("sync_lifecycle_1");
    expect(syncStateUpdates).toHaveBeenCalledWith({
      ownerKey: "org_1:user_1",
      store: undefined,
      syncRunId: "sync_lifecycle_1",
      token: "token_1",
      trigger: "reconnect",
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

class MemoryStateUpdateSyncStore implements StateUpdateSyncStore {
  completed: { operation: PendingOperation; result: unknown }[] = [];
  conflicts: { operation: PendingOperation; result: unknown }[] = [];
  failed: { code: string; message: string; operation: PendingOperation }[] = [];
  operations: PendingOperation[] = [];
  retried: PendingOperation[] = [];
  telemetry = new Map<string, SyncTelemetry>();

  async completeStateUpdateOperation(operation: PendingOperation, result: never) {
    this.completed.push({ operation, result });
    this.operations = this.operations.filter((item) => item.id !== operation.id);
  }

  async failStateUpdateOperation(operation: PendingOperation, code: string, message: string, _details?: unknown) {
    this.failed.push({ code, message, operation });
  }

  async listPendingStateUpdateOperations(ownerKey: string) {
    return this.operations.filter((operation) => operation.ownerKey === ownerKey);
  }

  async markStateUpdateOperationConflict(operation: PendingOperation, result: never) {
    this.conflicts.push({ operation, result });
  }

  async markStateUpdateOperationSyncing(_operationId: string) {}

  async markSyncError(input: SyncTelemetryScope & { code: SyncErrorCode; phase: SyncErrorPhase }) {
    this.telemetry.set(syncTelemetryKey(input), {
      ...emptySyncTelemetry(input),
      lastSyncErrorCode: input.code,
      lastSyncErrorPhase: input.phase,
      syncPhase: "error",
    });
  }

  async markSyncPhase(input: SyncTelemetryScope & { phase: SyncPhase }) {
    this.telemetry.set(syncTelemetryKey(input), { ...emptySyncTelemetry(input), syncPhase: input.phase });
  }

  async markSyncPhaseCompleted(input: SyncTelemetryScope & { phase: SyncErrorPhase }) {
    this.telemetry.set(syncTelemetryKey(input), { ...emptySyncTelemetry(input), lastPushCompletedAt: "now" });
  }

  async retryStateUpdateOperation(operation: PendingOperation) {
    this.retried.push(operation);
  }
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

function stateUpdateOperation(): PendingOperation {
  const payload: OfflineStateUpdatePayload = {
    appViewId: "view_attendance",
    clientRequestId: "state_update_request_1",
    date: "2026-08-29",
    extraValues: {},
    historyMode: "append",
    stateValues: [{ fieldId: "field_attendance_status", label: "Presente", optionId: "status_present" }],
    subjectDisplayName: "Persona test",
    subjectRecordId: "person_5",
    uniqueness: "subject-date",
  };

  return {
    attempts: 0,
    clientRequestId: "state_update_request_1",
    contractId: "contract_attendance",
    createdAt: "2026-08-29T09:59:00.000Z",
    entityTypeId: "entity_attendance",
    id: "pending_state_update_1",
    lastErrorCode: null,
    lastErrorMessage: null,
    localRecordId: "local_attendance_5",
    operation: STATE_UPDATE_OPERATION,
    ownerKey: "org_1:user_1",
    payload,
    serverRecordId: null,
    updatedAt: "2026-08-29T09:59:00.000Z",
  };
}

function syncTelemetryKey(input: SyncTelemetryScope) {
  return `${input.ownerKey}:${input.contractId}:${input.entityTypeId}`;
}
