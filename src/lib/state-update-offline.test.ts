import { describe, expect, it } from "vitest";

import {
  appendStateUpdateRequestHistory,
  createStateUpdateLocalRecordId,
  interpretStateUpdateRequest,
  isStateUpdateCompatibleWorkflow,
  isValidStateUpdateRemoteUpdatedAt,
  mergeStateUpdateSyncDiagnosticsTelemetry,
  stateUpdateIntentsEqual,
  stateUpdateRemoteItemMatchesPayload,
  resolveStateUpdateSyncTelemetryResult,
} from "./state-update-offline";
import type { StateUpdateSyncDiagnosticsTelemetry } from "./state-update-offline";

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
