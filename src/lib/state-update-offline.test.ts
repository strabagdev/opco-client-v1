import { describe, expect, it } from "vitest";

import {
  appendStateUpdateRequestHistory,
  buildOfflineStateValues,
  createStateUpdateLocalRecordId,
  interpretStateUpdateRequest,
  isStateUpdateCompatibleWorkflow,
  isValidStateUpdateRemoteUpdatedAt,
  mergeStateUpdateReconnectPreflightTelemetryPatch,
  mergeStateUpdateSyncDiagnosticsTelemetry,
  normalizeStateUpdateRecord,
  stateUpdateIntentsEqual,
  stateUpdateRemoteItemMatchesPayload,
  resolveStateUpdateSyncTelemetryResult,
  STATE_UPDATE_REQUEST_HISTORY_LIMIT,
  upsertStateUpdateReconnectRunHistory,
} from "./state-update-offline";
import type { StateUpdateSyncDiagnosticsTelemetry } from "./state-update-offline";
import type { StateUpdateField } from "./opco-api";

describe("state-update offline identity", () => {
  it("consolidates update-current by appView, subject, and date when uniqueness is subject-date", () => {
    const first = createStateUpdateLocalRecordId({
      appViewId: "view_equipment_state",
      date: "2026-08-25",
      historyMode: "update-current",
      subjectRecordId: "equipment_1",
      uniqueness: "subject-date",
    });
    const second = createStateUpdateLocalRecordId({
      appViewId: "view_equipment_state",
      date: "2026-08-25",
      historyMode: "update-current",
      subjectRecordId: "equipment_1",
      uniqueness: "subject-date",
    });

    expect(second).toBe(first);
  });

  it("keeps distinct update-current intents for three different subjects on the same date", () => {
    const ids = ["person_a", "person_b", "person_c"].map((subjectRecordId) =>
      createStateUpdateLocalRecordId({
        appViewId: "view_attendance",
        date: "2026-08-26",
        historyMode: "update-current",
        subjectRecordId,
        uniqueness: "subject-date",
      })
    );

    expect(new Set(ids).size).toBe(3);
    expect(ids[0]).toContain("person_a");
    expect(ids[1]).toContain("person_b");
    expect(ids[2]).toContain("person_c");
  });

  it("does not consolidate update-current intents for the same subject across different dates", () => {
    const first = createStateUpdateLocalRecordId({
      appViewId: "view_attendance",
      date: "2026-08-26",
      historyMode: "update-current",
      subjectRecordId: "person_a",
      uniqueness: "subject-date",
    });
    const second = createStateUpdateLocalRecordId({
      appViewId: "view_attendance",
      date: "2026-08-27",
      historyMode: "update-current",
      subjectRecordId: "person_a",
      uniqueness: "subject-date",
    });

    expect(second).not.toBe(first);
  });

  it("keeps workflow intent identity separate from remote entity record local identity", () => {
    const intentLocalId = createStateUpdateLocalRecordId({
      appViewId: "view_attendance",
      date: "2026-08-27",
      historyMode: "update-current",
      subjectRecordId: "person_server_1",
      uniqueness: "subject-date",
    });

    expect(intentLocalId).toBe("state_update_view_attendance_2026-08-27_person_server_1");
    expect(intentLocalId).not.toMatch(/^remote_/);
    expect(intentLocalId).not.toContain("contract_1");
    expect(intentLocalId).not.toContain("entity_attendance");
  });

  it("does not consolidate append events for the same subject and date", () => {
    const first = createStateUpdateLocalRecordId({
      appViewId: "view_equipment_state",
      date: "2026-08-25",
      historyMode: "append",
      subjectRecordId: "equipment_1",
      uniqueness: "subject-date",
    });
    const second = createStateUpdateLocalRecordId({
      appViewId: "view_equipment_state",
      date: "2026-08-25",
      historyMode: "append",
      subjectRecordId: "equipment_1",
      uniqueness: "subject-date",
    });

    expect(second).not.toBe(first);
  });
});

function reconnectPreflight(
  overrides: Partial<NonNullable<StateUpdateSyncDiagnosticsTelemetry["lastReconnectPreflight"]>> = {},
): NonNullable<StateUpdateSyncDiagnosticsTelemetry["lastReconnectPreflight"]> {
  return {
    authDecision: null,
    authRefreshCompletedAt: null,
    authRefreshStartedAt: null,
    completedAt: null,
    countPendingOperationsCount: null,
    countPendingOperationsDurationMs: null,
    debounceCompletedAt: null,
    debounceDurationMs: null,
    debounceStartedAt: null,
    listPendingStateUpdateOperationsCount: null,
    listPendingStateUpdateOperationsDurationMs: null,
    readinessAttempts: null,
    readinessCompletedAt: null,
    readinessConfirmedAt: null,
    readinessDurationMs: null,
    readinessStartedAt: null,
    reconnectDetectedAt: null,
    runSyncStartedAt: null,
    scopeCheckAfterReadiness: null,
    shouldSyncCompletedAt: null,
    shouldSyncDurationMs: null,
    shouldSyncResult: null,
    shouldSyncStartedAt: null,
    syncPendingWorkCompletedAt: null,
    syncPendingWorkStartedAt: null,
    syncRunId: "sync_1",
    trigger: "reconnect",
    ...overrides,
  };
}

function requestDiagnostics(
  overrides: Partial<NonNullable<StateUpdateSyncDiagnosticsTelemetry["requestHistory"]>[number]> = {},
): NonNullable<StateUpdateSyncDiagnosticsTelemetry["requestHistory"]>[number] {
  return {
    abortControllerTriggered: false,
    diagnosticOperation: "SAVE",
    diagnosticRequestId: "opco_diag_1",
    diagnosticSyncRunId: "sync_1",
    errorCode: null,
    fetchResolvedAt: "2026-08-29T10:00:00.100Z",
    httpStatus: 200,
    interpretation: "success",
    method: "POST",
    pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update",
    requestCompletedAt: "2026-08-29T10:00:00.300Z",
    requestDurationMs: 300,
    requestStartedAt: "2026-08-29T10:00:00.000Z",
    responseBodyStartedAt: "2026-08-29T10:00:00.200Z",
    responseParsedAt: "2026-08-29T10:00:00.300Z",
    responseRequestId: "opco_diag_1",
    responseStarted: true,
    serverTiming: [],
    timeoutMs: 12000,
    ...overrides,
  };
}

describe("state-update exact intention matching", () => {
  it("compares requested states and extras without display labels", () => {
    expect(stateUpdateRemoteItemMatchesPayload({
      current: {
        extraValues: {
          field_active: false,
          field_count: 1,
          field_note: "",
          field_observation: "Turno AM",
          field_relation: { displayName: "Equipo viejo", entityTypeId: "equipment", id: "equipment_1" },
        },
        recordId: "record_1",
        stateValues: [{ fieldId: "field_status", label: "Texto remoto distinto", optionId: "running" }],
        updatedAt: "2026-08-27T10:00:00.000Z",
      },
      subject: { displayName: "Equipo 1", id: "equipment_1" },
    }, {
      appViewId: "view_equipment_state",
      clientRequestId: "request_1",
      date: "2026-08-27",
      extraValues: {
        field_active: false,
        field_count: 1.0,
        field_note: "",
        field_observation: "Turno AM",
        field_relation: { displayName: "Equipo nuevo", entityTypeId: "equipment", id: "equipment_1" },
      },
      historyMode: "update-current",
      stateValues: [{ fieldId: "field_status", label: "Operando", optionId: "running" }],
      subjectDisplayName: "Equipo 1",
      subjectRecordId: "equipment_1",
      uniqueness: "subject-date",
    })).toBe(true);
  });

  it("compares scalar requested states exactly, including false and zero", () => {
    expect(stateUpdateRemoteItemMatchesPayload({
      current: {
        recordId: "record_1",
        stateValues: [
          { fieldId: "field_operational", label: "No", optionId: null, value: false },
          { fieldId: "field_count", label: "0", optionId: null, value: 0 },
        ],
        updatedAt: "2026-08-27T10:00:00.000Z",
      },
      subject: { displayName: "Equipo 1", id: "equipment_1" },
    }, {
      appViewId: "view_equipment_state",
      clientRequestId: "request_1",
      date: "2026-08-27",
      historyMode: "update-current",
      stateValues: [
        { fieldId: "field_operational", optionId: null, value: false },
        { fieldId: "field_count", optionId: null, value: 0 },
      ],
      subjectDisplayName: "Equipo 1",
      subjectRecordId: "equipment_1",
      uniqueness: "subject-date",
    })).toBe(true);
  });

  it("formats offline scalar state snapshots for display", () => {
    const fields: StateUpdateField[] = [
      { fieldId: "field_operational", label: "Operacional", options: [], required: true, type: "BOOLEAN" },
      { fieldId: "field_temperature", label: "Temperatura", options: [], required: true, type: "DECIMAL" },
    ];

    expect(buildOfflineStateValues(fields, [
      { fieldId: "field_operational", optionId: null, value: false },
      { fieldId: "field_temperature", optionId: null, value: 23.5 },
    ])).toEqual([
      { fieldId: "field_operational", label: "No", optionId: null, value: false },
      { fieldId: "field_temperature", label: "23.5", optionId: null, value: 23.5 },
    ]);
  });

  it("treats omitted extras as not requested and explicit null as requested", () => {
    const item = {
      current: {
        extraValues: { field_note: "remoto" },
        recordId: "record_1",
        stateValues: [{ fieldId: "field_status", label: "OK", optionId: "running" }],
        updatedAt: "2026-08-27T10:00:00.000Z",
      },
      subject: { displayName: "Equipo 1", id: "equipment_1" },
    };
    const basePayload = {
      appViewId: "view_equipment_state",
      clientRequestId: "request_1",
      date: "2026-08-27",
      historyMode: "update-current" as const,
      stateValues: [{ fieldId: "field_status", optionId: "running" }],
      subjectDisplayName: "Equipo 1",
      subjectRecordId: "equipment_1",
      uniqueness: "subject-date" as const,
    };

    expect(stateUpdateRemoteItemMatchesPayload(item, basePayload)).toBe(true);
    expect(stateUpdateRemoteItemMatchesPayload(item, {
      ...basePayload,
      extraValues: { field_note: null },
    })).toBe(false);
  });

  it("rotates semantic intent when extra values change but ignores labels", () => {
    const previous = {
      appViewId: "view_attendance",
      clientRequestId: "request_1",
      date: "2026-08-27",
      extraValues: { observation: "Turno AM" },
      historyMode: "update-current" as const,
      stateValues: [{ fieldId: "status", label: "Presente", optionId: "present" }],
      subjectDisplayName: "Persona 1",
      subjectRecordId: "person_1",
      uniqueness: "subject-date" as const,
    };

    expect(stateUpdateIntentsEqual(previous, {
      ...previous,
      stateValues: [{ fieldId: "status", label: "Texto visual", optionId: "present" }],
    })).toBe(true);
    expect(stateUpdateIntentsEqual(previous, {
      ...previous,
      extraValues: { observation: "Turno PM" },
    })).toBe(false);
  });

  it("names the compatible workflow family and validates remote versions", () => {
    expect(isStateUpdateCompatibleWorkflow("attendance")).toBe(true);
    expect(isStateUpdateCompatibleWorkflow("state-update")).toBe(true);
    expect(isStateUpdateCompatibleWorkflow("legacy-attendance")).toBe(false);
    expect(isValidStateUpdateRemoteUpdatedAt("2026-08-27T10:00:00.000Z")).toBe(true);
    expect(isValidStateUpdateRemoteUpdatedAt("2026-08-27")).toBe(false);
  });
});

describe("state-update conflict normalization", () => {
  it("preserves remote extraValues from a persisted conflict payload", () => {
    expect(normalizeStateUpdateRecord({
      conflictRemoteDisplayName: "Persona 1",
      conflictRemoteUpdatedAt: "2026-08-27T12:00:00.000Z",
      conflictRemoteValues: {
        appViewId: "view_attendance",
        date: "2026-08-27",
        extraValues: { shift_field: "turno_b" },
        stateValues: [{ fieldId: "status", label: "Ausente", optionId: "absent" }],
        subjectDisplayName: "Persona 1",
        subjectRecordId: "person_1",
      },
      displayName: "Persona 1",
      id: "record_1",
      localId: "local_1",
      remoteUpdatedAt: null,
      serverId: null,
      syncStatus: "conflict",
      updatedAt: "2026-08-27T10:00:00.000Z",
      values: {
        appViewId: "view_attendance",
        date: "2026-08-27",
        extraValues: { shift_field: "turno_a" },
        stateValues: [{ fieldId: "status", label: "Presente", optionId: "present" }],
        subjectDisplayName: "Persona 1",
        subjectRecordId: "person_1",
      },
    })).toMatchObject({
      conflictRemoteExtraValues: { shift_field: "turno_b" },
      conflictRemoteStateValues: [{ fieldId: "status", label: "Ausente", optionId: "absent" }],
      extraValues: { shift_field: "turno_a" },
      syncStatus: "conflict",
    });
  });
});

describe("state-update sync diagnostics telemetry", () => {
  it("classifies timeout reconciliation as reconciled_success", () => {
    expect(resolveStateUpdateSyncTelemetryResult({
      operationsFailed: 0,
      operationsSelected: 1,
      reconciledAfterTimeout: true,
    })).toBe("reconciled_success");
  });

  it("does not replace the last meaningful sync run with a later noop", () => {
    const lastStateUpdateSync: NonNullable<StateUpdateSyncDiagnosticsTelemetry["lastStateUpdateSync"]> = {
      completedAt: "2026-08-27T10:00:12.000Z",
      lastRequestDiagnostics: {
        abortControllerTriggered: true,
        fetchResolvedAt: null,
        httpStatus: null,
        pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update",
        requestCompletedAt: "2026-08-27T10:00:12.000Z",
        requestDurationMs: 12000,
        requestStartedAt: "2026-08-27T10:00:00.000Z",
        responseBodyStartedAt: null,
        responseParsedAt: null,
        responseStarted: false,
        timeoutMs: 12000,
      },
      operationsAttempted: 1,
      operationsCompleted: 1,
      operationsFailed: 0,
      operationsSelected: 1,
      reconciledAfterTimeout: true,
      result: "reconciled_success",
      startedAt: "2026-08-27T10:00:00.000Z",
      syncRunId: "sync_reconnect_1",
      timeoutOccurred: true,
      trigger: "reconnect",
    };
    const current: StateUpdateSyncDiagnosticsTelemetry = {
      currentConnectivity: {
        status: "online" as const,
        updatedAt: "2026-08-27T10:00:00.000Z",
      },
      lastReconnect: {
        detected: true,
        detectedAt: "2026-08-27T10:00:00.000Z",
        previousConnectivityStatus: "offline" as const,
        resultingConnectivityStatus: "online" as const,
      },
      lastStateUpdateActivity: {
        completedAt: lastStateUpdateSync.completedAt,
        lastRequestDiagnostics: lastStateUpdateSync.lastRequestDiagnostics,
        operationsCompleted: lastStateUpdateSync.operationsCompleted,
        operationsFailed: lastStateUpdateSync.operationsFailed,
        result: lastStateUpdateSync.result,
        startedAt: lastStateUpdateSync.startedAt,
        syncRunId: lastStateUpdateSync.syncRunId,
        timeoutOccurred: lastStateUpdateSync.timeoutOccurred,
        trigger: lastStateUpdateSync.trigger,
        type: "sync",
      },
      lastStateUpdateSync,
      lastVisibleErrorEvent: null,
    };

    expect(mergeStateUpdateSyncDiagnosticsTelemetry({
      completedAt: "2026-08-27T10:01:00.000Z",
      current,
      currentConnectivityStatus: "online",
      operationsAttempted: 0,
      operationsCompleted: 0,
      operationsFailed: 0,
      operationsSelected: 0,
      reconciledAfterTimeout: false,
      startedAt: "2026-08-27T10:01:00.000Z",
      trigger: "foreground/resume",
    })).toMatchObject({
      currentConnectivity: {
        updatedAt: "2026-08-27T10:01:00.000Z",
      },
      lastStateUpdateSync: {
        completedAt: "2026-08-27T10:00:12.000Z",
        operationsSelected: 1,
        result: "reconciled_success",
        syncRunId: "sync_reconnect_1",
        timeoutOccurred: true,
        trigger: "reconnect",
      },
      lastStateUpdateActivity: {
        result: "reconciled_success",
        syncRunId: "sync_reconnect_1",
        type: "sync",
      },
    });
  });

  it("persists request diagnostics for a timeout that later reconciles successfully", () => {
    const next = mergeStateUpdateSyncDiagnosticsTelemetry({
      completedAt: "2026-08-27T10:00:13.000Z",
      current: {
        currentConnectivity: { status: "online", updatedAt: null },
        lastReconnect: {
          detected: true,
          detectedAt: "2026-08-27T10:00:00.000Z",
          previousConnectivityStatus: "offline",
          resultingConnectivityStatus: "online",
        },
        lastStateUpdateActivity: null,
        lastStateUpdateSync: null,
        lastVisibleErrorEvent: null,
      },
      currentConnectivityStatus: "online",
      lastRequestDiagnostics: {
        abortControllerTriggered: true,
        fetchResolvedAt: null,
        httpStatus: null,
        pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update",
        requestCompletedAt: "2026-08-27T10:00:12.000Z",
        requestDurationMs: 12000,
        requestStartedAt: "2026-08-27T10:00:00.000Z",
        responseBodyStartedAt: null,
        responseParsedAt: null,
        responseStarted: false,
        timeoutMs: 12000,
      },
      operationsAttempted: 1,
      operationsCompleted: 1,
      operationsFailed: 0,
      operationsSelected: 1,
      reconciledAfterTimeout: true,
      startedAt: "2026-08-27T10:00:00.000Z",
      syncRunId: "sync_reconnect_2",
      timeoutOccurred: true,
      trigger: "reconnect",
    });

    expect(next.lastStateUpdateSync).toMatchObject({
      lastRequestDiagnostics: {
        abortControllerTriggered: true,
        requestDurationMs: 12000,
      },
      reconciledAfterTimeout: true,
      result: "reconciled_success",
      syncRunId: "sync_reconnect_2",
      timeoutOccurred: true,
    });
    expect(next.lastStateUpdateActivity).toMatchObject({
      result: "reconciled_success",
      syncRunId: "sync_reconnect_2",
      timeoutOccurred: true,
      type: "sync",
    });
  });

  it("does not replace snapshot reconciliation activity with a later noop sync", () => {
    const next = mergeStateUpdateSyncDiagnosticsTelemetry({
      completedAt: "2026-08-27T10:02:00.000Z",
      current: {
        currentConnectivity: { status: "online", updatedAt: "2026-08-27T10:01:00.000Z" },
        lastReconnect: {
          detected: true,
          detectedAt: "2026-08-27T10:00:00.000Z",
          previousConnectivityStatus: "offline",
          resultingConnectivityStatus: "online",
        },
        lastStateUpdateActivity: {
          completedAt: "2026-08-27T10:01:00.000Z",
          lastRequestDiagnostics: null,
          operationsCompleted: 1,
          operationsFailed: 0,
          result: "reconciled_success",
          startedAt: "2026-08-27T10:01:00.000Z",
          syncRunId: null,
          timeoutOccurred: false,
          trigger: "snapshot_reconciliation",
          type: "snapshot_reconciliation",
        },
        lastStateUpdateSync: null,
        lastVisibleErrorEvent: null,
      },
      currentConnectivityStatus: "online",
      operationsAttempted: 0,
      operationsCompleted: 0,
      operationsFailed: 0,
      operationsSelected: 0,
      reconciledAfterTimeout: false,
      startedAt: "2026-08-27T10:02:00.000Z",
      trigger: "foreground/resume",
    });

    expect(next.lastStateUpdateActivity).toMatchObject({
      result: "reconciled_success",
      trigger: "snapshot_reconciliation",
      type: "snapshot_reconciliation",
    });
    expect(next.lastStateUpdateSync).toBeNull();
  });

  it("keeps a bounded sanitized STATE_UPDATE request history", () => {
    const current: StateUpdateSyncDiagnosticsTelemetry = {
      currentConnectivity: { status: "online", updatedAt: "2026-08-29T10:00:00.000Z" },
      lastReconnect: {
        detected: true,
        detectedAt: "2026-08-29T10:00:00.000Z",
        previousConnectivityStatus: "offline",
        resultingConnectivityStatus: "online",
      },
      lastStateUpdateActivity: null,
      lastStateUpdateSync: null,
      lastSessionTermination: null,
      lastVisibleErrorEvent: null,
      requestHistory: [],
    };

    const next = appendStateUpdateRequestHistory(current, {
      abortControllerTriggered: false,
      diagnosticOperation: "SAVE",
      diagnosticRequestId: "opco_diag_123",
      errorCode: null,
      fetchResolvedAt: "2026-08-29T10:00:01.000Z",
      httpStatus: 200,
      method: "POST",
      pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update",
      requestCompletedAt: "2026-08-29T10:00:01.500Z",
      requestDurationMs: 1500,
      requestStartedAt: "2026-08-29T10:00:00.000Z",
      responseBodyStartedAt: "2026-08-29T10:00:01.000Z",
      responseParsedAt: "2026-08-29T10:00:01.500Z",
      responseRequestId: "opco_diag_123",
      responseStarted: true,
      serverTiming: [{ description: null, durationMs: 1200, name: "total" }],
      timeoutMs: 12000,
    }, 1);

    expect(next.requestHistory).toHaveLength(1);
    expect(next.requestHistory?.[0]).toMatchObject({
      diagnosticOperation: "SAVE",
      interpretation: "success",
      pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update",
    });
    expect(JSON.stringify(next)).not.toContain("contract_1");
  });

  it("keeps exactly the 50 most recent request history events when event 51 arrives", () => {
    const current: StateUpdateSyncDiagnosticsTelemetry = {
      currentConnectivity: { status: "online", updatedAt: "2026-08-29T10:00:00.000Z" },
      lastReconnect: {
        detected: true,
        detectedAt: "2026-08-29T10:00:00.000Z",
        previousConnectivityStatus: "offline",
        resultingConnectivityStatus: "online",
      },
      lastStateUpdateActivity: null,
      lastStateUpdateSync: null,
      lastSessionTermination: null,
      lastVisibleErrorEvent: null,
      requestHistory: Array.from({ length: STATE_UPDATE_REQUEST_HISTORY_LIMIT }, (_, index) => requestDiagnostics({
        diagnosticRequestId: `opco_diag_${index + 1}`,
        requestCompletedAt: `2026-08-29T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
        requestStartedAt: `2026-08-29T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
      })),
    };

    const next = appendStateUpdateRequestHistory(current, requestDiagnostics({
      diagnosticRequestId: "opco_diag_51",
      requestCompletedAt: "2026-08-29T10:51:00.000Z",
      requestStartedAt: "2026-08-29T10:51:00.000Z",
    }));

    expect(next.requestHistory).toHaveLength(STATE_UPDATE_REQUEST_HISTORY_LIMIT);
    expect(next.requestHistory?.[0]?.diagnosticRequestId).toBe("opco_diag_2");
    expect(next.requestHistory?.at(-1)?.diagnosticRequestId).toBe("opco_diag_51");
    expect(next.requestHistory?.map((event) => event.diagnosticRequestId)).not.toContain("opco_diag_1");
  });

  it("keeps AUTH_REFRESH diagnostics with error codes in request history", () => {
    const current: StateUpdateSyncDiagnosticsTelemetry = {
      currentConnectivity: { status: "online", updatedAt: "2026-08-29T10:00:00.000Z" },
      lastReconnect: {
        detected: true,
        detectedAt: "2026-08-29T10:00:00.000Z",
        previousConnectivityStatus: "offline",
        resultingConnectivityStatus: "online",
      },
      lastStateUpdateActivity: null,
      lastStateUpdateSync: null,
      lastSessionTermination: null,
      lastVisibleErrorEvent: null,
      requestHistory: [],
    };

    const next = appendStateUpdateRequestHistory(current, {
      abortControllerTriggered: false,
      diagnosticOperation: "AUTH_REFRESH",
      diagnosticRequestId: "opco_diag_refresh",
      errorCode: "REFRESH_TOKEN_EXPIRED",
      fetchResolvedAt: "2026-08-29T10:00:01.000Z",
      httpStatus: 401,
      method: "POST",
      pathTemplate: "/api/v1/auth/refresh",
      requestCompletedAt: "2026-08-29T10:00:01.500Z",
      requestDurationMs: 1500,
      requestStartedAt: "2026-08-29T10:00:00.000Z",
      responseBodyStartedAt: "2026-08-29T10:00:01.000Z",
      responseParsedAt: "2026-08-29T10:00:01.500Z",
      responseRequestId: "opco_diag_refresh",
      responseStarted: true,
      serverTiming: [],
      timeoutMs: 12000,
    });

    expect(next.requestHistory?.[0]).toMatchObject({
      diagnosticOperation: "AUTH_REFRESH",
      errorCode: "REFRESH_TOKEN_EXPIRED",
      interpretation: "http_error",
      pathTemplate: "/api/v1/auth/refresh",
    });
  });

  it("keeps automatic reconnect readiness and save requests in history", () => {
    const current: StateUpdateSyncDiagnosticsTelemetry = {
      currentConnectivity: { status: "online", updatedAt: "2026-08-29T10:00:00.000Z" },
      lastReconnect: {
        detected: true,
        detectedAt: "2026-08-29T10:00:00.000Z",
        previousConnectivityStatus: "offline",
        resultingConnectivityStatus: "online",
      },
      lastStateUpdateActivity: null,
      lastStateUpdateSync: null,
      lastSessionTermination: null,
      lastVisibleErrorEvent: null,
      requestHistory: [],
    };

    const ready = appendStateUpdateRequestHistory(current, {
      abortControllerTriggered: false,
      attemptNumber: 1,
      diagnosticOperation: "READY_CHECK",
      diagnosticRequestId: "opco_diag_ready",
      diagnosticSyncRunId: "sync_reconnect_1",
      errorCode: null,
      fetchResolvedAt: "2026-08-29T10:00:01.000Z",
      httpStatus: 200,
      method: "GET",
      pathTemplate: "/api/v1/ready",
      requestCompletedAt: "2026-08-29T10:00:01.000Z",
      requestDurationMs: 1000,
      requestStartedAt: "2026-08-29T10:00:00.000Z",
      responseBodyStartedAt: "2026-08-29T10:00:01.000Z",
      responseParsedAt: "2026-08-29T10:00:01.000Z",
      responseStarted: true,
      serverTiming: [],
      timeoutMs: 2500,
    });
    const saved = appendStateUpdateRequestHistory(ready, {
      abortControllerTriggered: false,
      diagnosticOperation: "SAVE",
      diagnosticRequestId: "opco_diag_save",
      diagnosticSyncRunId: "sync_reconnect_1",
      errorCode: null,
      fetchResolvedAt: "2026-08-29T10:00:02.000Z",
      httpStatus: 200,
      method: "POST",
      pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update",
      requestCompletedAt: "2026-08-29T10:00:02.000Z",
      requestDurationMs: 1000,
      requestStartedAt: "2026-08-29T10:00:01.000Z",
      responseBodyStartedAt: "2026-08-29T10:00:02.000Z",
      responseParsedAt: "2026-08-29T10:00:02.000Z",
      responseStarted: true,
      serverTiming: [],
      timeoutMs: 12000,
    });

    expect(saved.requestHistory?.map((request) => request.diagnosticOperation)).toEqual(["READY_CHECK", "SAVE"]);
    expect(saved.requestHistory?.map((request) => request.diagnosticSyncRunId)).toEqual(["sync_reconnect_1", "sync_reconnect_1"]);
    expect(saved.requestHistory?.[0]?.attemptNumber).toBe(1);
  });

  it("keeps a bounded reconnect run history keyed by syncRunId", () => {
    const history = Array.from({ length: 5 }, (_, index) => reconnectPreflight({
      syncRunId: `sync_${index + 1}`,
    }));
    const updated = upsertStateUpdateReconnectRunHistory(history, reconnectPreflight({
      authDecision: "token_valid",
      syncRunId: "sync_3",
    }));
    const extended = upsertStateUpdateReconnectRunHistory(updated, reconnectPreflight({
      syncRunId: "sync_6",
    }));

    expect(updated).toHaveLength(5);
    expect(updated.filter((entry) => entry.syncRunId === "sync_3")).toHaveLength(1);
    expect(updated.at(-1)).toMatchObject({ authDecision: "token_valid", syncRunId: "sync_3" });
    expect(extended.map((entry) => entry.syncRunId)).toEqual(["sync_2", "sync_4", "sync_5", "sync_3", "sync_6"]);
  });

  it("preserves previous reconnect preflight fields when a patch is partial", () => {
    const previous = reconnectPreflight({
      readinessCompletedAt: "2026-08-29T10:00:02.000Z",
      readinessConfirmedAt: "2026-08-29T10:00:02.000Z",
      readinessStartedAt: "2026-08-29T10:00:00.000Z",
    });

    expect(mergeStateUpdateReconnectPreflightTelemetryPatch(previous, {
      runSyncStartedAt: "2026-08-29T10:00:02.100Z",
    })).toMatchObject({
      readinessCompletedAt: "2026-08-29T10:00:02.000Z",
      readinessConfirmedAt: "2026-08-29T10:00:02.000Z",
      readinessStartedAt: "2026-08-29T10:00:00.000Z",
      runSyncStartedAt: "2026-08-29T10:00:02.100Z",
    });
  });

  it("does not let a late null reconnect preflight patch erase previous timestamps", () => {
    const previous = reconnectPreflight({
      readinessCompletedAt: "2026-08-29T10:00:02.000Z",
      readinessConfirmedAt: "2026-08-29T10:00:02.000Z",
      readinessStartedAt: "2026-08-29T10:00:00.000Z",
      syncPendingWorkStartedAt: "2026-08-29T10:00:02.100Z",
    });

    expect(mergeStateUpdateReconnectPreflightTelemetryPatch(previous, reconnectPreflight({
      readinessCompletedAt: null,
      readinessConfirmedAt: null,
      readinessStartedAt: null,
      runSyncStartedAt: "2026-08-29T10:00:02.050Z",
      syncPendingWorkStartedAt: null,
    }))).toMatchObject({
      readinessCompletedAt: "2026-08-29T10:00:02.000Z",
      readinessConfirmedAt: "2026-08-29T10:00:02.000Z",
      readinessStartedAt: "2026-08-29T10:00:00.000Z",
      runSyncStartedAt: "2026-08-29T10:00:02.050Z",
      syncPendingWorkStartedAt: "2026-08-29T10:00:02.100Z",
    });
  });

  it("closes the reconnect preflight when the matching sync run succeeds", () => {
    const current: StateUpdateSyncDiagnosticsTelemetry = {
      currentConnectivity: { status: "online", updatedAt: null },
      lastReconnect: {
        detected: true,
        detectedAt: "2026-08-29T10:00:00.000Z",
        previousConnectivityStatus: "offline",
        resultingConnectivityStatus: "online",
      },
      lastReconnectPreflight: reconnectPreflight({
        completedAt: null,
        readinessAttempts: null,
        readinessCompletedAt: null,
        readinessConfirmedAt: null,
        readinessStartedAt: "2026-08-29T10:00:00.100Z",
        runSyncStartedAt: "2026-08-29T10:00:00.050Z",
        syncPendingWorkStartedAt: "2026-08-29T10:00:00.600Z",
        syncRunId: "sync_1",
      }),
      lastStateUpdateActivity: null,
      lastStateUpdateSync: null,
      lastVisibleErrorEvent: null,
      reconnectRunHistory: [],
      requestHistory: [
        requestDiagnostics({
          attemptNumber: 1,
          diagnosticOperation: "READY_CHECK",
          diagnosticSyncRunId: "sync_1",
          method: "GET",
          pathTemplate: "/api/v1/ready",
          requestCompletedAt: "2026-08-29T10:00:00.500Z",
          requestStartedAt: "2026-08-29T10:00:00.100Z",
          timeoutMs: 2500,
        }),
        requestDiagnostics({
          diagnosticOperation: "SAVE",
          diagnosticSyncRunId: "sync_1",
        }),
      ],
    };

    const next = mergeStateUpdateSyncDiagnosticsTelemetry({
      completedAt: "2026-08-29T10:00:01.000Z",
      current,
      currentConnectivityStatus: "online",
      operationsAttempted: 1,
      operationsCompleted: 1,
      operationsFailed: 0,
      operationsSelected: 1,
      reconciledAfterTimeout: false,
      startedAt: "2026-08-29T10:00:00.600Z",
      syncRunId: "sync_1",
      trigger: "reconnect",
    });

    expect(next.lastReconnectPreflight).toMatchObject({
      completedAt: "2026-08-29T10:00:01.000Z",
      readinessAttempts: 1,
      readinessCompletedAt: "2026-08-29T10:00:00.500Z",
      readinessConfirmedAt: "2026-08-29T10:00:00.500Z",
      readinessStartedAt: "2026-08-29T10:00:00.100Z",
      syncPendingWorkCompletedAt: "2026-08-29T10:00:01.000Z",
      syncPendingWorkStartedAt: "2026-08-29T10:00:00.600Z",
      syncRunId: "sync_1",
    });
    expect(next.reconnectRunHistory).toEqual([
      expect.objectContaining({
        completedAt: "2026-08-29T10:00:01.000Z",
        syncRunId: "sync_1",
      }),
    ]);
  });

  it("sets readinessAttempts to one from one READY_CHECK request", () => {
    const current: StateUpdateSyncDiagnosticsTelemetry = {
      currentConnectivity: { status: "online", updatedAt: null },
      lastReconnect: {
        detected: true,
        detectedAt: "2026-08-29T10:00:00.000Z",
        previousConnectivityStatus: "offline",
        resultingConnectivityStatus: "online",
      },
      lastReconnectPreflight: reconnectPreflight({
        syncRunId: "sync_1",
      }),
      lastStateUpdateActivity: null,
      lastStateUpdateSync: null,
      lastVisibleErrorEvent: null,
      reconnectRunHistory: [],
      requestHistory: [],
    };

    const next = appendStateUpdateRequestHistory(current, requestDiagnostics({
      attemptNumber: 1,
      diagnosticOperation: "READY_CHECK",
      diagnosticSyncRunId: "sync_1",
      method: "GET",
      pathTemplate: "/api/v1/ready",
      requestCompletedAt: "2026-08-29T10:00:00.300Z",
      requestStartedAt: "2026-08-29T10:00:00.000Z",
      timeoutMs: 2500,
    }));

    expect(next.lastReconnectPreflight).toMatchObject({
      readinessAttempts: 1,
      readinessCompletedAt: "2026-08-29T10:00:00.300Z",
      readinessConfirmedAt: "2026-08-29T10:00:00.300Z",
      readinessStartedAt: "2026-08-29T10:00:00.000Z",
      syncRunId: "sync_1",
    });
  });

  it("counts three READY_CHECK requests for the same syncRunId", () => {
    const current: StateUpdateSyncDiagnosticsTelemetry = {
      currentConnectivity: { status: "online", updatedAt: null },
      lastReconnect: {
        detected: true,
        detectedAt: "2026-08-29T10:00:00.000Z",
        previousConnectivityStatus: "offline",
        resultingConnectivityStatus: "online",
      },
      lastReconnectPreflight: reconnectPreflight({
        syncRunId: "sync_1",
      }),
      lastStateUpdateActivity: null,
      lastStateUpdateSync: null,
      lastVisibleErrorEvent: null,
      reconnectRunHistory: [],
      requestHistory: [],
    };
    const withFirst = appendStateUpdateRequestHistory(current, requestDiagnostics({
      abortControllerTriggered: true,
      attemptNumber: 1,
      diagnosticOperation: "READY_CHECK",
      diagnosticSyncRunId: "sync_1",
      fetchResolvedAt: null,
      httpStatus: null,
      method: "GET",
      pathTemplate: "/api/v1/ready",
      requestCompletedAt: "2026-08-29T10:00:02.500Z",
      requestStartedAt: "2026-08-29T10:00:00.000Z",
      responseBodyStartedAt: null,
      responseParsedAt: null,
      responseStarted: false,
      timeoutMs: 2500,
    }));
    const withSecond = appendStateUpdateRequestHistory(withFirst, requestDiagnostics({
      abortControllerTriggered: true,
      attemptNumber: 2,
      diagnosticOperation: "READY_CHECK",
      diagnosticSyncRunId: "sync_1",
      fetchResolvedAt: null,
      httpStatus: null,
      method: "GET",
      pathTemplate: "/api/v1/ready",
      requestCompletedAt: "2026-08-29T10:00:03.500Z",
      requestStartedAt: "2026-08-29T10:00:03.000Z",
      responseBodyStartedAt: null,
      responseParsedAt: null,
      responseStarted: false,
      timeoutMs: 2500,
    }));
    const withThird = appendStateUpdateRequestHistory(withSecond, requestDiagnostics({
      attemptNumber: 3,
      diagnosticOperation: "READY_CHECK",
      diagnosticSyncRunId: "sync_1",
      method: "GET",
      pathTemplate: "/api/v1/ready",
      requestCompletedAt: "2026-08-29T10:00:04.500Z",
      requestStartedAt: "2026-08-29T10:00:04.000Z",
      timeoutMs: 2500,
    }));

    expect(withThird.lastReconnectPreflight).toMatchObject({
      readinessAttempts: 3,
      readinessCompletedAt: "2026-08-29T10:00:04.500Z",
      readinessConfirmedAt: "2026-08-29T10:00:04.500Z",
      readinessStartedAt: "2026-08-29T10:00:00.000Z",
      syncRunId: "sync_1",
    });
    expect(withThird.requestHistory?.filter((request) => request.diagnosticOperation === "READY_CHECK")).toHaveLength(3);
  });

  it("does not count READY_CHECK requests from a different syncRunId", () => {
    const current: StateUpdateSyncDiagnosticsTelemetry = {
      currentConnectivity: { status: "online", updatedAt: null },
      lastReconnect: {
        detected: true,
        detectedAt: "2026-08-29T10:00:00.000Z",
        previousConnectivityStatus: "offline",
        resultingConnectivityStatus: "online",
      },
      lastReconnectPreflight: reconnectPreflight({
        readinessAttempts: 1,
        syncRunId: "sync_1",
      }),
      lastStateUpdateActivity: null,
      lastStateUpdateSync: null,
      lastVisibleErrorEvent: null,
      reconnectRunHistory: [reconnectPreflight({
        readinessAttempts: 1,
        syncRunId: "sync_1",
      })],
      requestHistory: [
        requestDiagnostics({
          attemptNumber: 1,
          diagnosticOperation: "READY_CHECK",
          diagnosticSyncRunId: "sync_1",
          pathTemplate: "/api/v1/ready",
        }),
      ],
    };

    const next = appendStateUpdateRequestHistory(current, requestDiagnostics({
      attemptNumber: 1,
      diagnosticOperation: "READY_CHECK",
      diagnosticSyncRunId: "sync_2",
      method: "GET",
      pathTemplate: "/api/v1/ready",
      requestCompletedAt: "2026-08-29T10:00:01.000Z",
      requestStartedAt: "2026-08-29T10:00:00.500Z",
      timeoutMs: 2500,
    }));

    expect(next.lastReconnectPreflight).toMatchObject({
      readinessAttempts: 1,
      syncRunId: "sync_1",
    });
    expect(next.reconnectRunHistory).toEqual([
      expect.objectContaining({
        readinessAttempts: 1,
        syncRunId: "sync_1",
      }),
    ]);
  });

  it("does not reduce readinessAttempts when a later preflight patch is stale", () => {
    const history = upsertStateUpdateReconnectRunHistory([
      reconnectPreflight({
        readinessAttempts: 3,
        readinessCompletedAt: "2026-08-29T10:00:04.500Z",
        readinessConfirmedAt: "2026-08-29T10:00:04.500Z",
        syncRunId: "sync_1",
      }),
    ], reconnectPreflight({
      readinessAttempts: 1,
      readinessCompletedAt: null,
      readinessConfirmedAt: null,
      syncRunId: "sync_1",
    }));

    expect(history).toEqual([
      expect.objectContaining({
        readinessAttempts: 3,
        readinessCompletedAt: "2026-08-29T10:00:04.500Z",
        readinessConfirmedAt: "2026-08-29T10:00:04.500Z",
        syncRunId: "sync_1",
      }),
    ]);
  });

  it("does not merge reconnect preflight data across different syncRunIds", () => {
    const current: StateUpdateSyncDiagnosticsTelemetry = {
      currentConnectivity: { status: "online", updatedAt: null },
      lastReconnect: {
        detected: true,
        detectedAt: "2026-08-29T10:00:00.000Z",
        previousConnectivityStatus: "offline",
        resultingConnectivityStatus: "online",
      },
      lastReconnectPreflight: reconnectPreflight({
        readinessConfirmedAt: "2026-08-29T10:00:00.500Z",
        syncRunId: "sync_1",
      }),
      lastStateUpdateActivity: null,
      lastStateUpdateSync: null,
      lastVisibleErrorEvent: null,
      reconnectRunHistory: [reconnectPreflight({
        readinessConfirmedAt: "2026-08-29T10:00:00.500Z",
        syncRunId: "sync_1",
      })],
      requestHistory: [],
    };

    const next = mergeStateUpdateSyncDiagnosticsTelemetry({
      completedAt: "2026-08-29T10:00:01.000Z",
      current,
      currentConnectivityStatus: "online",
      operationsAttempted: 1,
      operationsCompleted: 1,
      operationsFailed: 0,
      operationsSelected: 1,
      reconciledAfterTimeout: false,
      startedAt: "2026-08-29T10:00:00.600Z",
      syncRunId: "sync_2",
      trigger: "reconnect",
    });

    expect(next.lastReconnectPreflight).toMatchObject({
      readinessConfirmedAt: "2026-08-29T10:00:00.500Z",
      syncRunId: "sync_1",
    });
    expect(next.lastStateUpdateSync).toMatchObject({
      completedAt: "2026-08-29T10:00:01.000Z",
      syncRunId: "sync_2",
    });
    expect(next.reconnectRunHistory).toEqual([
      expect.objectContaining({
        readinessConfirmedAt: "2026-08-29T10:00:00.500Z",
        syncRunId: "sync_1",
      }),
    ]);
  });

  it("ignores non-workflow request diagnostics and classifies timeout/network cases", () => {
    const current: StateUpdateSyncDiagnosticsTelemetry = {
      currentConnectivity: { status: "online", updatedAt: null },
      lastReconnect: {
        detected: false,
        detectedAt: null,
        previousConnectivityStatus: null,
        resultingConnectivityStatus: null,
      },
      lastStateUpdateActivity: null,
      lastStateUpdateSync: null,
      lastSessionTermination: null,
      lastVisibleErrorEvent: null,
    };
    const unrelated = appendStateUpdateRequestHistory(current, {
      abortControllerTriggered: false,
      fetchResolvedAt: null,
      httpStatus: 200,
      pathTemplate: "/api/v1/me",
      requestCompletedAt: "2026-08-29T10:00:00.000Z",
      requestDurationMs: 1,
      requestStartedAt: "2026-08-29T10:00:00.000Z",
      responseBodyStartedAt: null,
      responseParsedAt: null,
      responseStarted: false,
      timeoutMs: 12000,
    });

    expect(unrelated.requestHistory).toBeUndefined();
    expect(interpretStateUpdateRequest({
      abortControllerTriggered: true,
      fetchResolvedAt: null,
      httpStatus: null,
      pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/attendance",
      requestCompletedAt: "2026-08-29T10:00:12.000Z",
      requestDurationMs: 12000,
      requestStartedAt: "2026-08-29T10:00:00.000Z",
      responseBodyStartedAt: null,
      responseParsedAt: null,
      responseStarted: false,
      timeoutMs: 12000,
    })).toBe("client_timeout_before_response");
  });
});
