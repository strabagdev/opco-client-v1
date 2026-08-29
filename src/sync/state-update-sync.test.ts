import { beforeEach, describe, expect, it, vi } from "vitest";

import { PendingOperation } from "../lib/offline-records";
import { EntityRecordValue, OpcoApiError, OpcoNetworkError } from "../lib/opco-api";
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
        results: [{ recordId: "attendance_1", result: "CREATED" as const, subjectRecordId: "person_1", updatedAt: "2026-08-26T12:00:00.000Z" }],
      })),
    };

    const result = await syncPendingStateUpdatesOnce({
      api,
      ownerKey: "org_1:user_1",
      store,
      token: "token_1",
    });

    expect(result.completed).toBe(1);
    expect(api.saveStateUpdateWorkflow).toHaveBeenCalledWith("token_1", "contract_attendance", "view_attendance", {
      clientRequestId: "attendance_request_1",
      date: "2026-08-25",
      expectedUpdatedAt: undefined,
      extraValues: { field_observation: "Turno AM" },
      overwrite: undefined,
      stateValues: [{ fieldId: "field_attendance_status", optionId: "status_present" }],
      subjectRecordId: "person_1",
    }, {
      diagnosticSyncRunId: null,
    });
    expect(store.operations).toHaveLength(0);
  });

  it("syncs multi-state offline changes with the stable clientRequestId and extra values", async () => {
    store.operations = [operation()];
    const api = {
      saveStateUpdateWorkflow: vi.fn(async () => ({
        appView: { id: "view_equipment_state", name: "Estado Equipo", slug: "estado-equipo" },
        date: "2026-08-25",
        results: [{ recordId: "event_1", result: "UPDATED" as const, subjectRecordId: "equipment_1", updatedAt: "2026-08-26T12:00:00.000Z" }],
      })),
    };

    const result = await syncPendingStateUpdatesOnce({
      api,
      ownerKey: "org_1:user_1",
      store,
      token: "token_1",
    });

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
    }, {
      diagnosticSyncRunId: null,
    });
    expect(store.completed).toHaveLength(1);
    expect(store.telemetry.get("org_1:user_1:contract_1:workflow:view_equipment_state")?.lastPushCompletedAt).toBe("now");
  });

  it("passes the lifecycle syncRunId to STATE_UPDATE POST diagnostics", async () => {
    store.operations = [operation()];
    const api = {
      saveStateUpdateWorkflow: vi.fn(async () => ({
        appView: { id: "view_equipment_state", name: "Estado Equipo", slug: "estado-equipo" },
        date: "2026-08-25",
        results: [{ recordId: "event_1", result: "UPDATED" as const, subjectRecordId: "equipment_1", updatedAt: "2026-08-26T12:00:00.000Z" }],
      })),
    };

    await syncPendingStateUpdatesOnce({
      api,
      ownerKey: "org_1:user_1",
      store,
      syncRunId: "sync_reconnect_1",
      token: "token_1",
    });

    expect(api.saveStateUpdateWorkflow).toHaveBeenCalledWith(
      "token_1",
      "contract_1",
      "view_equipment_state",
      expect.any(Object),
      { diagnosticSyncRunId: "sync_reconnect_1" },
    );
  });

  it("syncs three distinct offline Attendance STATE_UPDATE operations through the generic engine", async () => {
    store.operations = [
      operation({ clientRequestId: "request_a", id: "state_update_a", localRecordId: "local_a", payload: attendancePayload("person_a", "request_a") }),
      operation({ clientRequestId: "request_b", id: "state_update_b", localRecordId: "local_b", payload: attendancePayload("person_b", "request_b") }),
      operation({ clientRequestId: "request_c", id: "state_update_c", localRecordId: "local_c", payload: attendancePayload("person_c", "request_c") }),
    ];
    const api = {
      saveStateUpdateWorkflow: vi.fn(async (_token: string, _contractId: string, _appViewId: string, input: { subjectRecordId: string }) => ({
        appView: { id: "view_attendance", name: "Registro de asistencia", slug: "attendance" },
        results: [{ recordId: `attendance_${input.subjectRecordId}`, result: "CREATED" as const, subjectRecordId: input.subjectRecordId, updatedAt: "2026-08-26T12:00:00.000Z" }],
      })),
    };

    const result = await syncPendingStateUpdatesOnce({
      api,
      ownerKey: "org_1:user_1",
      store,
      syncRunId: "sync_reconnect_timeout",
      token: "token_1",
    });

    expect(result).toMatchObject({ completed: 3, failed: 0 });
    expect(api.saveStateUpdateWorkflow).toHaveBeenCalledTimes(3);
    expect(api.saveStateUpdateWorkflow.mock.calls.map((call) => call[3].subjectRecordId)).toEqual(["person_a", "person_b", "person_c"]);
    expect(store.operations).toHaveLength(0);
    expect(store.completed.map((item) => item.operation.localRecordId)).toEqual(["local_a", "local_b", "local_c"]);
  });

  it("keeps only the failed Attendance operation pending after partial state-update sync failure", async () => {
    store.operations = [
      operation({ clientRequestId: "request_a", id: "state_update_a", localRecordId: "local_a", payload: attendancePayload("person_a", "request_a") }),
      operation({ clientRequestId: "request_b", id: "state_update_b", localRecordId: "local_b", payload: attendancePayload("person_b", "request_b") }),
      operation({ clientRequestId: "request_c", id: "state_update_c", localRecordId: "local_c", payload: attendancePayload("person_c", "request_c") }),
    ];
    const api = {
      saveStateUpdateWorkflow: vi.fn(async (_token: string, _contractId: string, _appViewId: string, input: { subjectRecordId: string }) => {
        if (input.subjectRecordId === "person_c") {
          return {
            appView: { id: "view_attendance", name: "Registro de asistencia", slug: "attendance" },
            results: [{ code: "INVALID_STATE", message: "Estado invalido", result: "ERROR" as const, subjectRecordId: input.subjectRecordId }],
          };
        }

        return {
          appView: { id: "view_attendance", name: "Registro de asistencia", slug: "attendance" },
          results: [{ recordId: `attendance_${input.subjectRecordId}`, result: "CREATED" as const, subjectRecordId: input.subjectRecordId, updatedAt: "2026-08-26T12:00:00.000Z" }],
        };
      }),
    };

    const result = await syncPendingStateUpdatesOnce({
      api,
      ownerKey: "org_1:user_1",
      store,
      syncRunId: "sync_reconnect_timeout",
      token: "token_1",
    });

    expect(result).toMatchObject({ completed: 2, failed: 1 });
    expect(store.operations.map((item) => item.localRecordId)).toEqual(["local_c"]);
    expect(store.failed[0]).toMatchObject({ code: "INVALID_STATE" });
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

  it("completes a timed out operation when remote reconciliation confirms the requested state", async () => {
    store.operations = [operation()];
    const api = {
      getStateUpdateWorkflow: vi.fn(async () => stateUpdateWorkflowResponse({
        currentExtraValues: { motivo: "mantencion", observacion: "Turno AM" },
        currentStateValues: [
          { fieldId: "field_operational_status", label: "Operando", optionId: "running" },
          { fieldId: "field_availability", label: "Disponible", optionId: "available" },
        ],
      })),
      saveStateUpdateWorkflow: vi.fn(async () => {
        throw timeoutError();
      }),
    };

    const result = await syncPendingStateUpdatesOnce({
      api,
      ownerKey: "org_1:user_1",
      store,
      syncRunId: "sync_reconnect_timeout",
      token: "token_1",
    });

    expect(result).toMatchObject({ completed: 1, retriable: 0 });
    expect(result.operationsAttempted).toBe(1);
    expect(result.operationsSelected).toBe(1);
    expect(result.reconciledAfterTimeout).toBe(true);
    expect(result.timeoutOccurred).toBe(true);
    expect(result.lastRequestDiagnostics).toMatchObject({
      abortControllerTriggered: true,
      pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update",
      requestDurationMs: 12000,
      timeoutMs: 12000,
    });
    expect(api.getStateUpdateWorkflow).toHaveBeenCalledWith("token_1", "contract_1", "view_equipment_state", {
      date: "2026-08-25",
      subjectRecordId: "equipment_1",
    }, {
      diagnosticSyncRunId: "sync_reconnect_timeout",
    });
    expect(api.saveStateUpdateWorkflow).toHaveBeenCalledWith(
      "token_1",
      "contract_1",
      "view_equipment_state",
      expect.any(Object),
      { diagnosticSyncRunId: "sync_reconnect_timeout" },
    );
    expect(store.completed[0]).toMatchObject({
      operation: { clientRequestId: "request_original" },
      result: { recordId: "event_1", result: "UNCHANGED", subjectRecordId: "equipment_1", updatedAt: "2026-08-26T12:00:11.000Z" },
    });
    expect(store.retried).toHaveLength(0);
    expect(store.operations).toHaveLength(0);
    expect(store.telemetry.get("org_1:user_1:contract_1:workflow:view_equipment_state")?.lastPushCompletedAt).toBe("now");
  });

  it("keeps a timed out operation retryable when remote reconciliation cannot confirm the write", async () => {
    store.operations = [operation()];
    const api = {
      getStateUpdateWorkflow: vi.fn(async () => stateUpdateWorkflowResponse({
        currentExtraValues: { motivo: "mantencion", observacion: "Turno AM" },
        currentStateValues: [
          { fieldId: "field_operational_status", label: "Detenido", optionId: "stopped" },
          { fieldId: "field_availability", label: "Disponible", optionId: "available" },
        ],
      })),
      saveStateUpdateWorkflow: vi.fn(async () => {
        throw timeoutError();
      }),
    };

    const result = await syncPendingStateUpdatesOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(result).toMatchObject({ completed: 0, retriable: 1 });
    expect(result.reconciledAfterTimeout).toBe(false);
    expect(result.timeoutOccurred).toBe(true);
    expect(result.lastRequestDiagnostics?.requestStartedAt).toBe("2026-08-26T12:00:00.000Z");
    expect(store.completed).toHaveLength(0);
    expect(store.retried[0].clientRequestId).toBe("request_original");
    expect(store.operations).toHaveLength(1);
  });

  it("keeps a timed out operation retryable when states match but requested extras differ", async () => {
    store.operations = [operation()];
    const api = {
      getStateUpdateWorkflow: vi.fn(async () => stateUpdateWorkflowResponse({
        currentExtraValues: { motivo: "mantencion", observacion: "Turno PM" },
        currentStateValues: [
          { fieldId: "field_operational_status", label: "Operando", optionId: "running" },
          { fieldId: "field_availability", label: "Disponible", optionId: "available" },
        ],
      })),
      saveStateUpdateWorkflow: vi.fn(async () => {
        throw timeoutError();
      }),
    };

    const result = await syncPendingStateUpdatesOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(result).toMatchObject({ completed: 0, retriable: 1 });
    expect(result.reconciledAfterTimeout).toBe(false);
    expect(store.completed).toHaveLength(0);
    expect(store.retried[0].clientRequestId).toBe("request_original");
    expect(store.operations).toHaveLength(1);
  });

  it("reconciles RESULT_UNAVAILABLE for update-current only when remote exact intent matches", async () => {
    store.operations = [operation()];
    const api = {
      getStateUpdateWorkflow: vi.fn(async () => stateUpdateWorkflowResponse({
        currentExtraValues: { motivo: "mantencion", observacion: "Turno AM" },
        currentStateValues: [
          { fieldId: "field_operational_status", label: "Operando", optionId: "running" },
          { fieldId: "field_availability", label: "Disponible", optionId: "available" },
        ],
      })),
      saveStateUpdateWorkflow: vi.fn(async () => {
        throw new OpcoApiError("Resultado no disponible.", "IDEMPOTENCY_RESULT_UNAVAILABLE", 409);
      }),
    };

    const result = await syncPendingStateUpdatesOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(result).toMatchObject({ completed: 1, failed: 0 });
    expect(store.completed[0]).toMatchObject({
      operation: { clientRequestId: "request_original" },
      result: { recordId: "event_1", result: "UNCHANGED", updatedAt: "2026-08-26T12:00:11.000Z" },
    });
    expect(store.failed).toHaveLength(0);
  });

  it("does not rotate or retry automatically when idempotency key was reused", async () => {
    store.operations = [operation()];
    const api = {
      saveStateUpdateWorkflow: vi.fn(async () => {
        throw new OpcoApiError("Key reutilizada.", "IDEMPOTENCY_KEY_REUSED", 409);
      }),
    };

    const result = await syncPendingStateUpdatesOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(result).toMatchObject({ failed: 1, retriable: 0 });
    expect(store.failed[0]).toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
      operation: { clientRequestId: "request_original" },
    });
    expect(store.retried).toHaveLength(0);
    expect(store.operations[0].clientRequestId).toBe("request_original");
  });

  it("does not invent a new key for append RESULT_UNAVAILABLE", async () => {
    const appendPayload = operation().payload as OfflineStateUpdatePayload;

    store.operations = [operation({
      payload: {
        ...appendPayload,
        historyMode: "append",
        uniqueness: "none",
      },
    })];
    const api = {
      getStateUpdateWorkflow: vi.fn(async () => stateUpdateWorkflowResponse({
        currentExtraValues: { motivo: "mantencion", observacion: "Turno AM" },
        currentStateValues: [
          { fieldId: "field_operational_status", label: "Operando", optionId: "running" },
          { fieldId: "field_availability", label: "Disponible", optionId: "available" },
        ],
      })),
      saveStateUpdateWorkflow: vi.fn(async () => {
        throw new OpcoApiError("Resultado no disponible.", "IDEMPOTENCY_RESULT_UNAVAILABLE", 409);
      }),
    };

    const result = await syncPendingStateUpdatesOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(result).toMatchObject({ failed: 1, retriable: 0 });
    expect(api.getStateUpdateWorkflow).not.toHaveBeenCalled();
    expect(store.failed[0]).toMatchObject({
      code: "IDEMPOTENCY_RESULT_UNAVAILABLE",
      operation: { clientRequestId: "request_original" },
    });
  });

  it("keeps timeout retries idempotent when the backend write completed before the response was lost", async () => {
    store.operations = [operation()];
    const api = {
      saveStateUpdateWorkflow: vi.fn()
        .mockRejectedValueOnce(timeoutError())
        .mockResolvedValueOnce({
          appView: { id: "view_equipment_state", name: "Estado Equipo", slug: "estado-equipo" },
          date: "2026-08-25",
          results: [{ recordId: "event_1", result: "UNCHANGED" as const, subjectRecordId: "equipment_1", updatedAt: "2026-08-26T12:00:00.000Z" }],
        }),
    };

    const first = await syncPendingStateUpdatesOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });
    const second = await syncPendingStateUpdatesOnce({ api, ownerKey: "org_1:user_1", store, token: "token_1" });

    expect(first).toMatchObject({ completed: 0, retriable: 1 });
    expect(second).toMatchObject({ completed: 1, retriable: 0 });
    expect(api.saveStateUpdateWorkflow).toHaveBeenCalledTimes(2);
    expect(api.saveStateUpdateWorkflow.mock.calls.map((call) => call[3].clientRequestId)).toEqual([
      "request_original",
      "request_original",
    ]);
    expect(store.operations).toHaveLength(0);
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
    expect(store.failed[0]).toMatchObject({
      code: "INVALID_STATE",
      operation: { id: "state_update_local_1" },
    });
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
    this.operations = this.operations.filter((item) => item.id !== operation.id);
    this.operations.push({ ...operation, lastErrorCode: code, lastErrorMessage: message });
  }

  async listPendingStateUpdateOperations(ownerKey: string) {
    return this.operations.filter((operation) => operation.ownerKey === ownerKey);
  }

  async markStateUpdateOperationConflict(operation: PendingOperation, result: never) {
    this.conflicts.push({ operation, result });
    this.operations = this.operations.filter((item) => item.id !== operation.id);
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

function timeoutError() {
  return new OpcoNetworkError("La solicitud a Opco agoto el tiempo de espera.", {
    abortControllerTriggered: true,
    fetchResolvedAt: null,
    httpStatus: null,
    method: "POST",
    pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update",
    requestCompletedAt: "2026-08-26T12:00:12.000Z",
    requestDurationMs: 12000,
    requestStartedAt: "2026-08-26T12:00:00.000Z",
    responseBodyStartedAt: null,
    responseParsedAt: null,
    responseStarted: false,
    timeoutMs: 12000,
  });
}

function stateUpdateWorkflowResponse({
  currentExtraValues,
  currentStateValues,
}: {
  currentExtraValues?: Record<string, EntityRecordValue>;
  currentStateValues: { fieldId: string; label: string | null; optionId: string | null }[];
}) {
  return {
    appView: { id: "view_equipment_state", name: "Estado Equipo", slug: "estado-equipo" },
    date: "2026-08-25",
    dateFieldId: "field_date",
    extraFields: [],
    historyMode: "update-current" as const,
    items: [{
      current: {
        extraValues: currentExtraValues,
        recordId: "event_1",
        stateValues: currentStateValues,
        updatedAt: "2026-08-26T12:00:11.000Z",
      },
      subject: { displayName: "Excavadora 1", id: "equipment_1" },
    }],
    latest: [],
    sourceEntityType: { id: "entity_equipment", name: "Equipos" },
    stateFields: [],
    subjectFieldId: "field_equipment",
    summary: { totalRegistered: 1 },
    targetEntityType: { id: "entity_equipment_events", name: "Eventos" },
    uniqueness: "subject-date" as const,
  };
}

function attendancePayload(subjectRecordId: string, clientRequestId: string): OfflineStateUpdatePayload {
  return {
    appViewId: "view_attendance",
    clientRequestId,
    date: "2026-08-26",
    extraValues: { field_observation: "Turno AM" },
    historyMode: "update-current",
    stateValues: [{ fieldId: "field_attendance_status", label: "Presente", optionId: "present_option" }],
    subjectDisplayName: `Persona ${subjectRecordId}`,
    subjectRecordId,
    uniqueness: "subject-date",
  };
}

function key(scope: SyncTelemetryScope) {
  return `${scope.ownerKey}:${scope.contractId}:${scope.entityTypeId}`;
}
