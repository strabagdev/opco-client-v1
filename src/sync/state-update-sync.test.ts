import { beforeEach, describe, expect, it, vi } from "vitest";

import { PendingOperation } from "../lib/offline-records";
import { OpcoApiError, OpcoNetworkError } from "../lib/opco-api";
import { OfflineStateUpdatePayload, STATE_UPDATE_OPERATION } from "../lib/state-update-offline";
import { SyncErrorCode, SyncErrorPhase, SyncPhase, SyncTelemetry, SyncTelemetryScope, emptySyncTelemetry } from "../lib/sync-telemetry";
import { StateUpdateSyncStore, syncPendingStateUpdatesOnce } from "./state-update-sync";

let store: MemoryStateUpdateSyncStore;

beforeEach(() => {
  store = new MemoryStateUpdateSyncStore();
});

describe("state-update sync engine", () => {
  it("syncs an Attendance offline STATE_UPDATE through the generic state-update endpoint and removes pending", async () => {
    store.operations = [operation({
      clientRequestId: "attendance_request_1",
      contractId: "contract_attendance",
      entityTypeId: "entity_attendance",
      id: "state_update_attendance_1",
      localRecordId: "state_update_view_attendance_2026_08_25_person_1",
      payload: {
        appViewId: "view_attendance",
        clientRequestId: "attendance_request_1",
        date: "2026-08-25",
        extraValues: { field_observation: "Turno AM" },
        historyMode: "update-current",
        stateValues: [{ fieldId: "field_attendance_status", label: "Presente", optionId: "status_present" }],
        subjectDisplayName: "Ana Perez",
        subjectRecordId: "person_1",
        uniqueness: "subject-date",
      },
      serverRecordId: null,
    })];
    const api = {
      saveStateUpdateWorkflow: vi.fn(async () => ({
        appView: { id: "view_attendance", name: "Registro de asistencia", slug: "attendance" },
        results: [{ recordId: "attendance_1", result: "CREATED" as const, subjectRecordId: "person_1" }],
      })),
    };

    const result = await syncPendingStateUpdatesOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(result.completed).toBe(1);
    expect(api.saveStateUpdateWorkflow).toHaveBeenCalledWith("token_1", "contract_attendance", "view_attendance", {
      clientRequestId: "attendance_request_1",
      date: "2026-08-25",
      expectedUpdatedAt: undefined,
      extraValues: { field_observation: "Turno AM" },
      overwrite: undefined,
      stateValues: [{ fieldId: "field_attendance_status", optionId: "status_present" }],
      subjectRecordId: "person_1",
    });
    expect(store.operations).toHaveLength(0);
  });

  it("syncs multi-state offline changes with the stable clientRequestId and extra values", async () => {
    store.operations = [operation()];
    const api = {
      saveStateUpdateWorkflow: vi.fn(async () => ({
        appView: { id: "view_equipment_state", name: "Estado Equipo", slug: "estado-equipo" },
        date: "2026-08-25",
        results: [{ recordId: "event_1", result: "UPDATED" as const, subjectRecordId: "equipment_1" }],
      })),
    };

    const result = await syncPendingStateUpdatesOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(result.completed).toBe(1);
    expect(api.saveStateUpdateWorkflow).toHaveBeenCalledWith("token_1", "contract_1", "view_equipment_state", {
      clientRequestId: "request_original",
      date: "2026-08-25",
      expectedUpdatedAt: "2026-08-24T10:00:00.000Z",
      extraValues: { motivo: "mantencion", observacion: "Turno AM" },
      overwrite: undefined,
      stateValues: [
        { fieldId: "field_operational_status", optionId: "running" },
        { fieldId: "field_availability", optionId: "available" },
      ],
      subjectRecordId: "equipment_1",
    });
    expect(store.completed).toHaveLength(1);
    expect(store.telemetry.get("org_1:user_1:contract_1:workflow:view_equipment_state")?.lastPushCompletedAt).toBe("now");
  });

  it("keeps the same clientRequestId when a network retry is needed", async () => {
    store.operations = [operation()];
    const api = {
      saveStateUpdateWorkflow: vi.fn(async () => {
        throw new OpcoNetworkError();
      }),
    };

    const result = await syncPendingStateUpdatesOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(result.retriable).toBe(1);
    expect(store.retried[0].clientRequestId).toBe("request_original");
  });

  it("marks ERROR results as failed without deleting the operation", async () => {
    store.operations = [operation()];
    const api = {
      saveStateUpdateWorkflow: vi.fn(async () => ({
        appView: { id: "view_equipment_state", name: "Estado Equipo", slug: "estado-equipo" },
        date: "2026-08-25",
        results: [{ code: "INVALID_STATE", message: "Estado invalido", result: "ERROR" as const, subjectRecordId: "equipment_1" }],
      })),
    };

    const result = await syncPendingStateUpdatesOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(result.failed).toBe(1);
    expect(store.failed[0]).toMatchObject({ code: "INVALID_STATE", operation: store.operations[0] });
  });

  it("marks validation API errors as failed instead of retrying forever", async () => {
    store.operations = [operation()];
    const api = {
      saveStateUpdateWorkflow: vi.fn(async () => {
        throw new OpcoApiError("subjectRecordId es obligatorio.", "INVALID_STATE_UPDATE_BODY", 400);
      }),
    };

    const result = await syncPendingStateUpdatesOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(result.failed).toBe(1);
    expect(result.retriable).toBe(0);
    expect(store.failed[0]).toMatchObject({
      code: "INVALID_STATE_UPDATE_BODY",
      message: "subjectRecordId es obligatorio.",
    });
    expect(store.telemetry.get("org_1:user_1:contract_1:workflow:view_equipment_state")?.lastSyncErrorCode).toBe("VALIDATION");
  });

  it("persists generic CONFLICT snapshots for explicit user resolution", async () => {
    store.operations = [operation()];
    const api = {
      saveStateUpdateWorkflow: vi.fn(async () => ({
        appView: { id: "view_equipment_state", name: "Estado Equipo", slug: "estado-equipo" },
        date: "2026-08-25",
        results: [{
          existing: {
            recordId: "event_1",
            stateValues: [
              { fieldId: "field_operational_status", label: "Detenido", optionId: "stopped" },
              { fieldId: "field_availability", label: "No disponible", optionId: "unavailable" },
            ],
            updatedAt: "2026-08-25T12:00:00.000Z",
          },
          requested: {
            stateValues: [
              { fieldId: "field_operational_status", label: "Operando", optionId: "running" },
              { fieldId: "field_availability", label: "Disponible", optionId: "available" },
            ],
          },
          result: "CONFLICT" as const,
          subjectRecordId: "equipment_1",
        }],
      })),
    };

    const result = await syncPendingStateUpdatesOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(result.conflicts).toBe(1);
    expect((store.conflicts[0].result as { existing: { stateValues: { fieldId: string }[] } }).existing.stateValues).toHaveLength(2);
    expect(store.telemetry.get("org_1:user_1:contract_1:workflow:view_equipment_state")?.lastSyncErrorCode).toBe("CONFLICT");
  });
});

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

  async failStateUpdateOperation(operation: PendingOperation, code: string, message: string) {
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
    this.telemetry.set(key(input), {
      ...emptySyncTelemetry(input),
      lastSyncErrorCode: input.code,
      lastSyncErrorPhase: input.phase,
      syncPhase: "error",
    });
  }

  async markSyncPhase(input: SyncTelemetryScope & { phase: SyncPhase }) {
    this.telemetry.set(key(input), { ...emptySyncTelemetry(input), syncPhase: input.phase });
  }

  async markSyncPhaseCompleted(input: SyncTelemetryScope & { phase: SyncErrorPhase }) {
    this.telemetry.set(key(input), { ...emptySyncTelemetry(input), lastPushCompletedAt: "now" });
  }

  async retryStateUpdateOperation(operation: PendingOperation) {
    this.retried.push(operation);
  }
}

function operation(overrides: Partial<PendingOperation> = {}): PendingOperation {
  const payload: OfflineStateUpdatePayload = {
    appViewId: "view_equipment_state",
    clientRequestId: "request_original",
    date: "2026-08-25",
    expectedUpdatedAt: "2026-08-24T10:00:00.000Z",
    extraValues: { motivo: "mantencion", observacion: "Turno AM" },
    historyMode: "update-current",
    stateValues: [
      { fieldId: "field_operational_status", label: "Operando", optionId: "running" },
      { fieldId: "field_availability", label: "Disponible", optionId: "available" },
    ],
    subjectDisplayName: "Excavadora 1",
    subjectRecordId: "equipment_1",
    uniqueness: "subject-date",
  };

  return {
    attempts: 0,
    clientRequestId: "request_original",
    contractId: "contract_1",
    createdAt: "2026-08-25T10:00:00.000Z",
    entityTypeId: "entity_equipment_events",
    id: "state_update_local_1",
    lastErrorCode: null,
    lastErrorMessage: null,
    localRecordId: "local_1",
    operation: STATE_UPDATE_OPERATION,
    ownerKey: "org_1:user_1",
    payload,
    serverRecordId: "event_1",
    updatedAt: "2026-08-25T10:00:00.000Z",
    ...overrides,
  };
}

function key(scope: SyncTelemetryScope) {
  return `${scope.ownerKey}:${scope.contractId}:${scope.entityTypeId}`;
}
