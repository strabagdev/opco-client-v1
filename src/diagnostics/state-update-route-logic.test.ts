import { describe, expect, it, vi } from "vitest";

import { PendingOperation } from "../lib/offline-records";
import { OpcoApi, OpcoApiError } from "../lib/opco-api";
import { StateUpdateOutboxDiagnostics, StateUpdateSyncDiagnosticsTelemetry } from "../lib/state-update-offline";
import { StateUpdateSyncStore } from "../sync/state-update-sync";
import {
  buildStateUpdateDiagnosticHealth,
  createStateUpdateDiagnosticApi,
  createStateUpdateDiagnosticEvents,
  createStateUpdateDiagnosticStore,
  formatStateUpdatePreflightRows,
  formatStateUpdateRunRows,
  getStateUpdateDiagnosticsObservationPlan,
  getStateUpdateDiagnosticsRouteState,
  hasRecentStateUpdateTimeout,
  resolveCurrentStateUpdateRunSummary,
  resolveLastFinishedStateUpdateRunSummary,
  resolveLatestStateUpdateRunSummary,
  resolveStateUpdateCurrentActivity,
  summarizeAttendanceGetResponse,
} from "./state-update-route-logic";

describe("state update diagnostics route readiness", () => {
  it("does not allow DB diagnostics while the owner is unavailable", () => {
    const state = getStateUpdateDiagnosticsRouteState({
      localDatabaseStorageState: readyStorage(),
      ownerKey: null,
      selectedContractId: "contract_1",
      status: "authenticated",
    });

    expect(state).toEqual({
      message: "Esperando contexto local...",
      ready: false,
      reason: "owner",
    });
  });

  it("waits for SQLite before reading persisted operations", () => {
    const state = getStateUpdateDiagnosticsRouteState({
      localDatabaseStorageState: {
        destructiveRecoveryAvailable: false,
        errorCode: null,
        retryable: false,
        status: "initializing",
      },
      ownerKey: "org_1:user_1",
      selectedContractId: "contract_1",
      status: "offline",
    });

    expect(state).toMatchObject({
      message: "Abriendo datos locales...",
      ready: false,
      reason: "sqlite",
    });
  });

  it("uses the active owner and contract only after authenticated bootstrap is ready", () => {
    const state = getStateUpdateDiagnosticsRouteState({
      localDatabaseStorageState: readyStorage(),
      ownerKey: "org_1:user_1",
      selectedContractId: "contract_1",
      status: "authenticated",
    });

    expect(state).toEqual({
      message: "Diagnostico listo",
      ownerKey: "org_1:user_1",
      ready: true,
      selectedContractId: "contract_1",
    });
  });

  it("keeps the dedicated route gated behind session readiness instead of relying on a query param", () => {
    const state = getStateUpdateDiagnosticsRouteState({
      localDatabaseStorageState: readyStorage(),
      ownerKey: "org_1:user_1",
      selectedContractId: "contract_1",
      status: "loading",
    });

    expect(state).toMatchObject({
      message: "Cargando sesion...",
      ready: false,
      reason: "session",
    });
  });

  it("treats mounted diagnostics as passive observation without sync or mutation requests", () => {
    const state = getStateUpdateDiagnosticsRouteState({
      localDatabaseStorageState: readyStorage(),
      ownerKey: "org_1:user_1",
      selectedContractId: "contract_1",
      status: "authenticated",
    });

    expect(getStateUpdateDiagnosticsObservationPlan(state)).toEqual({
      autoAttendanceGet: false,
      autoMutationRequest: false,
      autoSync: false,
      readOutbox: true,
    });
  });

  it("summarizes operational health without exposing raw identifiers", () => {
    const health = buildStateUpdateDiagnosticHealth({
      diagnostics: {
        consistency: "OK",
        localRecords: [],
        operations: [],
        summary: {
          ...emptyStateUpdateDiagnosticsSummary(),
          pendingCreate: 1,
        },
      },
      now: new Date("2026-08-29T10:01:00.000Z"),
      reconnect: {
        currentConnectivity: { status: "online", updatedAt: "2026-08-29T10:00:00.000Z" },
        lastReconnect: {
          detected: true,
          detectedAt: "2026-08-29T10:00:00.000Z",
          previousConnectivityStatus: "offline",
          resultingConnectivityStatus: "online",
        },
        lastStateUpdateActivity: null,
        lastStateUpdateSync: null,
        lastVisibleErrorEvent: null,
        requestHistory: [{
          abortControllerTriggered: true,
          diagnosticOperation: "SAVE",
          diagnosticRequestId: "opco_diag_123",
          fetchResolvedAt: null,
          httpStatus: null,
          interpretation: "client_timeout_before_response",
          method: "POST",
          pathTemplate: "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update",
          requestCompletedAt: "2026-08-29T10:00:12.000Z",
          requestDurationMs: 12000,
          requestStartedAt: "2026-08-29T10:00:00.000Z",
          responseBodyStartedAt: null,
          responseParsedAt: null,
          responseRequestId: null,
          responseStarted: false,
          serverTiming: [],
          timeoutMs: 12000,
        }],
      },
    });

    expect(health.pendingState).toBe("pending_create:1");
    expect(health.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Trabajo local", tone: "warn", value: "1" }),
      expect.objectContaining({ label: "Timeout reciente", tone: "warn", value: "si" }),
    ]));
    expect(JSON.stringify(health)).not.toContain("contract_");
  });

  it("does not summarize a successful READY_CHECK as ready_failed for the same syncRunId", () => {
    const reconnect = reconnectDiagnostics({
      lastStateUpdateActivity: {
        completedAt: "2026-08-29T10:00:02.000Z",
        lastRequestDiagnostics: null,
        operationsCompleted: 0,
        operationsFailed: 1,
        result: "ready_failed",
        startedAt: "2026-08-29T10:00:00.000Z",
        syncRunId: "sync_ready_1",
        timeoutOccurred: false,
        trigger: "ready_check",
        type: "ready_check",
      },
      requestHistory: [requestHistoryEvent({
        abortControllerTriggered: false,
        diagnosticOperation: "READY_CHECK",
        diagnosticSyncRunId: "sync_ready_1",
        httpStatus: 200,
        requestCompletedAt: "2026-08-29T10:00:01.000Z",
      })],
    });

    expect(resolveStateUpdateCurrentActivity({ pending: 1, reconnect })).toEqual({
      result: "ready_confirmed",
      syncRunId: "sync_ready_1",
      type: "ready_check",
    });
  });

  it("uses the latest READY_CHECK run instead of an older ready-confirmed activity", () => {
    const reconnect = reconnectDiagnostics({
      lastStateUpdateActivity: {
        completedAt: "2026-08-29T09:04:00.000Z",
        lastRequestDiagnostics: null,
        operationsCompleted: 0,
        operationsFailed: 0,
        result: "ready_confirmed",
        startedAt: "2026-08-29T09:03:58.000Z",
        syncRunId: "sync_previous_ready",
        timeoutOccurred: false,
        trigger: "ready_check",
        type: "ready_check",
      },
      requestHistory: [
        requestHistoryEvent({
          abortControllerTriggered: false,
          diagnosticOperation: "READY_CHECK",
          diagnosticSyncRunId: "sync_previous_ready",
          httpStatus: 200,
          requestCompletedAt: "2026-08-29T09:03:59.000Z",
          requestStartedAt: "2026-08-29T09:03:58.000Z",
        }),
        requestHistoryEvent({
          abortControllerTriggered: true,
          diagnosticOperation: "READY_CHECK",
          diagnosticSyncRunId: "sync_latest_timeout",
          httpStatus: null,
          requestCompletedAt: "2026-08-29T09:05:18.472Z",
          requestDurationMs: 2500,
          requestStartedAt: "2026-08-29T09:05:15.972Z",
          timeoutMs: 2500,
        }),
      ],
    });

    expect(resolveStateUpdateCurrentActivity({ pending: 1, reconnect })).toEqual({
      result: "ready_failed",
      syncRunId: "sync_latest_timeout",
      type: "ready_check",
    });
  });

  it("summarizes current activity as idle after successful sync with no pending work", () => {
    const health = buildStateUpdateDiagnosticHealth({
      diagnostics: {
        consistency: "OK",
        localRecords: [],
        operations: [],
        summary: emptyStateUpdateDiagnosticsSummary(),
      },
      now: new Date("2026-08-29T10:10:00.000Z"),
      reconnect: reconnectDiagnostics({
        lastStateUpdateActivity: {
          completedAt: "2026-08-29T10:00:02.000Z",
          lastRequestDiagnostics: null,
          operationsCompleted: 0,
          operationsFailed: 1,
          result: "ready_failed",
          startedAt: "2026-08-29T10:00:00.000Z",
          syncRunId: "sync_ready_1",
          timeoutOccurred: false,
          trigger: "ready_check",
          type: "ready_check",
        },
        lastStateUpdateSync: {
          completedAt: "2026-08-29T10:01:00.000Z",
          lastRequestDiagnostics: null,
          operationsAttempted: 1,
          operationsCompleted: 1,
          operationsFailed: 0,
          operationsSelected: 1,
          reconciledAfterTimeout: false,
          result: "success",
          startedAt: "2026-08-29T10:00:50.000Z",
          syncRunId: "sync_ready_1",
          timeoutOccurred: false,
          trigger: "reconnect",
        },
      }),
    });

    expect(health.currentActivity).toEqual({
      result: "none",
      syncRunId: null,
      type: "idle",
    });
    expect(health.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Ultimo sync completado", value: "success" }),
      expect.objectContaining({ label: "Actividad actual", tone: "good", value: "idle" }),
      expect.objectContaining({ label: "Timeout reciente", tone: "good", value: "no" }),
    ]));
  });

  it("keeps historical timeouts but excludes them from the recent timeout summary after the window", () => {
    const reconnect = reconnectDiagnostics({
      requestHistory: [requestHistoryEvent({
        abortControllerTriggered: true,
        diagnosticOperation: "AUTH_REFRESH",
        requestCompletedAt: "2026-08-29T10:00:00.000Z",
      })],
    });

    expect(reconnect.requestHistory).toHaveLength(1);
    expect(hasRecentStateUpdateTimeout({
      now: new Date("2026-08-29T10:05:01.000Z"),
      reconnect,
    })).toBe(false);
  });

  it("summarizes a timeout inside the current window as recent", () => {
    expect(hasRecentStateUpdateTimeout({
      now: new Date("2026-08-29T10:04:59.000Z"),
      reconnect: reconnectDiagnostics({
        requestHistory: [requestHistoryEvent({
          abortControllerTriggered: true,
          diagnosticOperation: "SAVE",
          requestCompletedAt: "2026-08-29T10:00:00.000Z",
        })],
      }),
    })).toBe(true);
  });

  it("summarizes the latest run from request history instead of an older activity syncRunId", () => {
    const reconnect = reconnectDiagnostics({
      lastStateUpdateActivity: {
        completedAt: "2026-08-29T09:04:00.000Z",
        lastRequestDiagnostics: null,
        operationsCompleted: 0,
        operationsFailed: 0,
        result: "ready_confirmed",
        startedAt: "2026-08-29T09:03:58.000Z",
        syncRunId: "sync_previous_ready",
        timeoutOccurred: false,
        trigger: "ready_check",
        type: "ready_check",
      },
      requestHistory: [
        requestHistoryEvent({
          abortControllerTriggered: false,
          diagnosticOperation: "READY_CHECK",
          diagnosticSyncRunId: "sync_previous_ready",
          httpStatus: 200,
          requestCompletedAt: "2026-08-29T09:03:59.000Z",
          requestStartedAt: "2026-08-29T09:03:58.000Z",
        }),
        requestHistoryEvent({
          abortControllerTriggered: false,
          diagnosticOperation: "READY_CHECK",
          diagnosticSyncRunId: "sync_latest_ready",
          httpStatus: 200,
          requestCompletedAt: "2026-08-29T09:06:15.000Z",
          requestStartedAt: "2026-08-29T09:06:14.500Z",
        }),
      ],
    });

    expect(resolveLatestStateUpdateRunSummary(reconnect)).toMatchObject({
      phase: "request",
      syncRunId: "sync_latest_ready",
      terminalResult: "success",
    });
  });

  it("correlates the latest run with historical preflight when lastReconnectPreflight was overwritten", () => {
    const reconnect = reconnectDiagnostics({
      lastReconnectPreflight: reconnectPreflight({
        reconnectDetectedAt: "2026-08-29T09:07:00.000Z",
        syncRunId: "sync_newer_recovery",
      }),
      reconnectRunHistory: [
        reconnectPreflight({
          authDecision: "token_valid",
          countPendingOperationsCount: 0,
          listPendingStateUpdateOperationsCount: 1,
          readinessAttempts: 1,
          readinessCompletedAt: "2026-08-29T09:06:15.475Z",
          readinessConfirmedAt: "2026-08-29T09:06:15.475Z",
          readinessStartedAt: "2026-08-29T09:06:15.000Z",
          reconnectDetectedAt: "2026-08-29T09:06:14.857Z",
          runSyncStartedAt: "2026-08-29T09:06:15.000Z",
          scopeCheckAfterReadiness: "current",
          syncPendingWorkCompletedAt: null,
          syncPendingWorkStartedAt: "2026-08-29T09:06:15.500Z",
          syncRunId: "sync_latest_ready",
          trigger: "reconnect",
        }),
        reconnectPreflight({
          reconnectDetectedAt: "2026-08-29T09:07:00.000Z",
          syncRunId: "sync_newer_recovery",
        }),
      ],
      requestHistory: [requestHistoryEvent({
        abortControllerTriggered: false,
        diagnosticOperation: "READY_CHECK",
        diagnosticSyncRunId: "sync_latest_ready",
        httpStatus: 200,
        requestCompletedAt: "2026-08-29T09:06:15.475Z",
        requestStartedAt: "2026-08-29T09:06:15.000Z",
      })],
    });

    expect(resolveLatestStateUpdateRunSummary(reconnect)).toMatchObject({
      authDecision: "token_valid",
      countPendingOperationsCount: 0,
      listPendingStateUpdateOperationsCount: 1,
      phase: "request",
      readinessConfirmedAt: "2026-08-29T09:06:15.475Z",
      scopeCheckAfterReadiness: "current",
      syncPendingWorkCompletedAt: null,
      syncPendingWorkStartedAt: "2026-08-29T09:06:15.500Z",
      syncRunId: "sync_latest_ready",
      terminalResult: "success",
      trigger: "reconnect",
    });
  });

  it("keeps the active run separate from the last finished run", () => {
    const reconnect = reconnectDiagnostics({
      lastReconnectPreflight: reconnectPreflight({
        reconnectDetectedAt: "2026-08-29T09:07:00.000Z",
        runSyncStartedAt: "2026-08-29T09:07:01.000Z",
        syncRunId: "sync_current",
        trigger: "startup-with-pending",
      }),
      lastStateUpdateActivity: {
        completedAt: "2026-08-29T09:07:01.100Z",
        lastRequestDiagnostics: null,
        operationsCompleted: 0,
        operationsFailed: 0,
        result: "reconnecting",
        startedAt: "2026-08-29T09:07:01.000Z",
        syncRunId: "sync_current",
        timeoutOccurred: false,
        trigger: "ready_check",
        type: "ready_check",
      },
      lastStateUpdateSync: {
        completedAt: "2026-08-29T09:06:20.000Z",
        lastRequestDiagnostics: null,
        operationsAttempted: 1,
        operationsCompleted: 1,
        operationsFailed: 0,
        operationsSelected: 1,
        reconciledAfterTimeout: false,
        result: "success",
        startedAt: "2026-08-29T09:06:15.000Z",
        syncRunId: "sync_finished",
        timeoutOccurred: false,
        trigger: "reconnect",
      },
      reconnectRunHistory: [
        reconnectPreflight({
          syncPendingWorkCompletedAt: "2026-08-29T09:06:20.000Z",
          syncPendingWorkStartedAt: "2026-08-29T09:06:16.000Z",
          syncRunId: "sync_finished",
        }),
        reconnectPreflight({
          reconnectDetectedAt: "2026-08-29T09:07:00.000Z",
          runSyncStartedAt: "2026-08-29T09:07:01.000Z",
          syncRunId: "sync_current",
          trigger: "startup-with-pending",
        }),
      ],
    });

    expect(resolveCurrentStateUpdateRunSummary(reconnect)).toMatchObject({
      syncRunId: "sync_current",
      terminalResult: "reconnecting",
    });
    expect(resolveLastFinishedStateUpdateRunSummary(reconnect)).toMatchObject({
      operationsCompleted: 1,
      operationsSelected: 1,
      syncRunId: "sync_finished",
      terminalResult: "success",
    });
  });

  it("exposes pending-work phase diagnostics on the correlated run summary", () => {
    const reconnect = reconnectDiagnostics({
      lastReconnectPreflight: reconnectPreflight({
        recordsOperationsCompleted: 0,
        recordsOperationsFailed: 0,
        recordsPhaseCompletedAt: "2026-08-29T09:06:16.000Z",
        recordsPhaseResult: "completed",
        recordsPhaseStartedAt: "2026-08-29T09:06:15.500Z",
        stateUpdateOperationsSelected: 1,
        stateUpdatePhaseCompletedAt: "2026-08-29T09:06:20.000Z",
        stateUpdatePhaseResult: "completed",
        stateUpdatePhaseStartedAt: "2026-08-29T09:06:16.001Z",
        syncPendingWorkCompletedAt: "2026-08-29T09:06:20.000Z",
        syncPendingWorkStartedAt: "2026-08-29T09:06:15.500Z",
        syncRunId: "sync_phases",
      }),
      lastStateUpdateSync: {
        completedAt: "2026-08-29T09:06:20.000Z",
        lastRequestDiagnostics: null,
        operationsAttempted: 1,
        operationsCompleted: 1,
        operationsFailed: 0,
        operationsSelected: 1,
        reconciledAfterTimeout: false,
        result: "success",
        startedAt: "2026-08-29T09:06:15.000Z",
        syncRunId: "sync_phases",
        timeoutOccurred: false,
        trigger: "reconnect",
      },
    });

    expect(resolveLatestStateUpdateRunSummary(reconnect)).toMatchObject({
      recordsPhaseResult: "completed",
      stateUpdateOperationsSelected: 1,
      stateUpdatePhaseResult: "completed",
      syncRunId: "sync_phases",
    });
  });

  it("presents three readiness checks as one successful sync run", () => {
    const run = resolveLatestStateUpdateRunSummary(reconnectDiagnostics({
      lastReconnectPreflight: reconnectPreflight({
        readinessAttempts: 3,
        readinessCompletedAt: "2026-08-29T09:06:15.739Z",
        readinessConfirmedAt: "2026-08-29T09:06:15.739Z",
        readinessDurationMs: 739,
        readinessStartedAt: "2026-08-29T09:06:15.000Z",
        syncPendingWorkCompletedAt: "2026-08-29T09:06:20.000Z",
        syncPendingWorkStartedAt: "2026-08-29T09:06:16.000Z",
        syncRunId: "sync_ready_3",
      }),
      lastStateUpdateSync: {
        completedAt: "2026-08-29T09:06:20.000Z",
        lastRequestDiagnostics: null,
        operationsAttempted: 1,
        operationsCompleted: 1,
        operationsFailed: 0,
        operationsSelected: 1,
        reconciledAfterTimeout: false,
        result: "success",
        startedAt: "2026-08-29T09:06:16.000Z",
        syncRunId: "sync_ready_3",
        timeoutOccurred: false,
        trigger: "reconnect",
      },
      requestHistory: [
        requestHistoryEvent({
          diagnosticOperation: "READY_CHECK",
          diagnosticSyncRunId: "sync_ready_3",
          attemptNumber: 1,
          requestCompletedAt: "2026-08-29T09:06:15.200Z",
        }),
        requestHistoryEvent({
          diagnosticOperation: "READY_CHECK",
          diagnosticSyncRunId: "sync_ready_3",
          attemptNumber: 2,
          requestCompletedAt: "2026-08-29T09:06:15.500Z",
        }),
        requestHistoryEvent({
          diagnosticOperation: "READY_CHECK",
          diagnosticSyncRunId: "sync_ready_3",
          attemptNumber: 3,
          requestCompletedAt: "2026-08-29T09:06:15.739Z",
        }),
        requestHistoryEvent({
          diagnosticOperation: "SAVE",
          diagnosticSyncRunId: "sync_ready_3",
          requestCompletedAt: "2026-08-29T09:06:19.000Z",
        }),
      ],
    }));

    const rows = formatStateUpdateRunRows(run);

    expect(rows).toEqual(expect.arrayContaining([
      ["estado", "Sincronizacion completada"],
      ["operaciones", "1 operacion sincronizada"],
      ["readiness", "Readiness confirmado en 3 intentos"],
      ["readinessAttempts", 3],
      ["operationsAttempted", 1],
      ["operationsCompleted", 1],
    ]));
  });

  it("uses singular readiness wording for a one-attempt run", () => {
    const run = resolveLatestStateUpdateRunSummary(reconnectDiagnostics({
      lastReconnectPreflight: reconnectPreflight({
        readinessAttempts: 1,
        readinessCompletedAt: "2026-08-29T09:06:15.300Z",
        readinessConfirmedAt: "2026-08-29T09:06:15.300Z",
        readinessStartedAt: "2026-08-29T09:06:15.000Z",
        syncRunId: "sync_ready_1",
      }),
      lastStateUpdateSync: {
        completedAt: "2026-08-29T09:06:20.000Z",
        lastRequestDiagnostics: null,
        operationsAttempted: 1,
        operationsCompleted: 1,
        operationsFailed: 0,
        operationsSelected: 1,
        reconciledAfterTimeout: false,
        result: "success",
        startedAt: "2026-08-29T09:06:16.000Z",
        syncRunId: "sync_ready_1",
        timeoutOccurred: false,
        trigger: "reconnect",
      },
    }));

    expect(formatStateUpdateRunRows(run)).toContainEqual(["readiness", "Readiness confirmado en 1 intento"]);
  });

  it("formats optional run fields without presenting none as a meaningful state", () => {
    const rows = formatStateUpdateRunRows(resolveLatestStateUpdateRunSummary(reconnectDiagnostics()));

    expect(rows).toContainEqual(["estado", "-"]);
    expect(rows).toContainEqual(["syncRunId", "-"]);
    expect(rows).not.toContainEqual(expect.arrayContaining(["none"]));
  });

  it("summarizes reconnect readiness while keeping technical fields available", () => {
    const rows = formatStateUpdatePreflightRows(reconnectPreflight({
      readinessAttempts: 3,
      readinessCompletedAt: "2026-08-29T09:06:15.739Z",
      readinessConfirmedAt: "2026-08-29T09:06:15.739Z",
      readinessDurationMs: 739,
      readinessStartedAt: "2026-08-29T09:06:15.000Z",
      syncRunId: "sync_ready_3",
    }));

    expect(rows.slice(0, 5)).toEqual([
      ["syncRunId", "sync_ready_3"],
      ["trigger", "reconnect"],
      ["Readiness", "Confirmado"],
      ["Intentos", "3 intentos"],
      ["Duracion", "739 ms"],
    ]);
    expect(rows).toEqual(expect.arrayContaining([
      ["readinessStartedAt", "2026-08-29T09:06:15.000Z"],
      ["readinessCompletedAt", "2026-08-29T09:06:15.739Z"],
      ["readinessConfirmedAt", "2026-08-29T09:06:15.739Z"],
    ]));
  });
});

describe("attendance GET diagnostics", () => {
  it("classifies the decisive production case when summary and latest both return three records", () => {
    const diagnostics = summarizeAttendanceGetResponse({
      appViewId: "view_attendance_real",
      expectedTotal: 3,
      response: attendanceResponse({
        latestCount: 3,
        summaryTotalRegistered: 3,
      }),
    });

    expect(diagnostics).toMatchObject({
      case: "SUMMARY_AND_LATEST_MATCH_EXPECTED",
      expectedTotal: 3,
      itemsCount: 0,
      latestCount: 3,
      summaryTotalRegistered: 3,
    });
    expect(diagnostics.latest).toHaveLength(3);
    expect(JSON.stringify(diagnostics)).not.toContain("person_real_1");
    expect(JSON.stringify(diagnostics)).not.toContain("attendance_real_1");
  });

  it("classifies a backend day query that returns only two remote records", () => {
    const diagnostics = summarizeAttendanceGetResponse({
      appViewId: "view_attendance_real",
      expectedTotal: 3,
      response: attendanceResponse({
        latestCount: 2,
        summaryTotalRegistered: 2,
      }),
    });

    expect(diagnostics.case).toBe("SUMMARY_AND_LATEST_BELOW_EXPECTED");
  });

  it("classifies summary/latest divergence separately", () => {
    const diagnostics = summarizeAttendanceGetResponse({
      appViewId: "view_attendance_real",
      expectedTotal: 3,
      response: attendanceResponse({
        latestCount: 2,
        summaryTotalRegistered: 3,
      }),
    });

    expect(diagnostics.case).toBe("SUMMARY_EXCEEDS_LATEST");
  });
});

describe("state update diagnostic sync instrumentation", () => {
  it("keeps observation helpers passive until an explicit operator sync invokes the wrapped API", async () => {
    const events = createStateUpdateDiagnosticEvents({
      consistency: "OK",
      localRecords: [],
      operations: [],
      summary: emptyStateUpdateDiagnosticsSummary(),
    });
    const baseApi: Pick<OpcoApi, "saveStateUpdateWorkflow"> = {
      saveStateUpdateWorkflow: vi.fn(async () => ({
        appView: { id: "view_1", name: "Workflow", slug: "workflow" },
        results: [],
      })),
    };
    const api = createStateUpdateDiagnosticApi(baseApi, events);

    expect(baseApi.saveStateUpdateWorkflow).not.toHaveBeenCalled();

    await api.saveStateUpdateWorkflow("token", "contract_1", "view_1", {
      clientRequestId: "request_1",
      stateValues: [],
      subjectRecordId: "subject_1",
    });

    expect(baseApi.saveStateUpdateWorkflow).toHaveBeenCalledOnce();
  });

  it("captures selected operations and idempotency API failures without exposing full request IDs", async () => {
    const events = createStateUpdateDiagnosticEvents({
      consistency: "OK",
      localRecords: [],
      operations: [{
        appViewFingerprint: "view",
        appViewResolved: true,
        clientRequestId: "reques...0001",
        config: {
          definitionKind: "state-update",
          extraFieldsCount: 0,
          matchingStateValuesCount: 1,
          missingStateValuesCount: 0,
          sourceTargetConfigured: true,
          stateFieldsCount: 1,
          statusOptionResolved: true,
          workflowKey: "state-update",
        },
        contractFingerprint: "contract",
        date: "2026-08-27",
        extraValuesCount: 0,
        lastBackendErrorCode: null,
        lastErrorCode: null,
        lastErrorPhase: null,
        lastHttpStatus: null,
        manualRetryToken: null,
        manualRetryable: false,
        operationType: "STATE_UPDATE",
        payloadSchema: "current",
        retryable: true,
        retryCount: 0,
        stateValuesCount: 1,
        subjectFingerprint: "subject",
        syncStatus: "pending_update",
        updatedAt: "2026-08-27T10:00:00.000Z",
      }],
      summary: {
        attendanceDerivedPendingCount: 0,
        conflict: 0,
        eligibleForAutoSync: 1,
        failed: 0,
        localConflict: 0,
        localFailed: 0,
        localPendingCreate: 0,
        localPendingUpdate: 0,
        localSynced: 0,
        localSyncing: 0,
        localTotal: 0,
        orphanedLocalChange: 0,
        pendingCreate: 0,
        pendingUpdate: 1,
        remoteSnapshotRepairable: 0,
        stateUpdateTotalLocal: 0,
        syncing: 0,
      },
    });
    const baseStore: StateUpdateSyncStore = {
      async completeStateUpdateOperation() {},
      async failStateUpdateOperation() {},
      async listPendingStateUpdateOperations() {
        return [{
          attempts: 0,
          clientRequestId: "request-with-secret-0001",
          contractId: "contract_1",
          createdAt: "2026-08-27T10:00:00.000Z",
          entityTypeId: "entity_1",
          id: "op_1",
          lastErrorCode: null,
          lastErrorMessage: null,
          localRecordId: "local_1",
          operation: "STATE_UPDATE",
          ownerKey: "owner_1",
          payload: {},
          serverRecordId: null,
          updatedAt: "2026-08-27T10:00:00.000Z",
        }] as PendingOperation[];
      },
      async markStateUpdateOperationConflict() {},
      async markStateUpdateOperationSyncing() {},
      async retryStateUpdateOperation() {},
    };
    const store = createStateUpdateDiagnosticStore(baseStore, events);
    const baseApi: Pick<OpcoApi, "saveStateUpdateWorkflow"> = {
      async saveStateUpdateWorkflow() {
        throw new OpcoApiError("Key reused", "IDEMPOTENCY_KEY_REUSED", 409);
      },
    };
    const api = createStateUpdateDiagnosticApi(baseApi, events);

    await store.listPendingStateUpdateOperations("owner_1");
    await expect(api.saveStateUpdateWorkflow("token", "contract_1", "view_1", {
      clientRequestId: "request-with-secret-0001",
      stateValues: [],
      subjectRecordId: "subject_1",
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

    const selected = events.get("reques...0001");

    expect(selected).toMatchObject({
      httpStatus: 409,
      requestAttempted: true,
      result: "IDEMPOTENCY_KEY_REUSED",
      selectedForSync: true,
    });
    expect(JSON.stringify([...events.values()])).not.toContain("request-with-secret-0001");
  });
});

function readyStorage() {
  return {
    destructiveRecoveryAvailable: false,
    errorCode: null,
    retryable: false,
    status: "ready" as const,
  } as const;
}

function emptyStateUpdateDiagnosticsSummary(): StateUpdateOutboxDiagnostics["summary"] {
  return {
    attendanceDerivedPendingCount: 0,
    conflict: 0,
    eligibleForAutoSync: 0,
    failed: 0,
    localConflict: 0,
    localFailed: 0,
    localPendingCreate: 0,
    localPendingUpdate: 0,
    localSynced: 0,
    localSyncing: 0,
    localTotal: 0,
    orphanedLocalChange: 0,
    pendingCreate: 0,
    pendingUpdate: 0,
    remoteSnapshotRepairable: 0,
    stateUpdateTotalLocal: 0,
    syncing: 0,
  };
}

function reconnectDiagnostics(
  overrides: Partial<StateUpdateSyncDiagnosticsTelemetry> = {},
): StateUpdateSyncDiagnosticsTelemetry {
  return {
    currentConnectivity: { status: "online", updatedAt: "2026-08-29T10:00:00.000Z" },
    lastReconnect: {
      detected: false,
      detectedAt: null,
      previousConnectivityStatus: null,
      resultingConnectivityStatus: null,
    },
    lastStateUpdateActivity: null,
    lastStateUpdateSync: null,
    lastVisibleErrorEvent: null,
    requestHistory: [],
    ...overrides,
  };
}

function requestHistoryEvent(
  overrides: Partial<NonNullable<StateUpdateSyncDiagnosticsTelemetry["requestHistory"]>[number]> = {},
): NonNullable<StateUpdateSyncDiagnosticsTelemetry["requestHistory"]>[number] {
  return {
    abortControllerTriggered: false,
    diagnosticOperation: "SAVE",
    diagnosticRequestId: "opco_diag_123",
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
    responseRequestId: "opco_diag_123",
    responseStarted: true,
    serverTiming: [],
    timeoutMs: 12000,
    ...overrides,
  };
}

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

function attendanceResponse({
  latestCount,
  summaryTotalRegistered,
}: {
  latestCount: number;
  summaryTotalRegistered: number;
}) {
  return {
    appView: { id: "view_attendance_real", name: "Asistencia", slug: "asistencia" },
    date: "2026-08-26",
    items: [],
    latest: Array.from({ length: latestCount }, (_, index) => ({
      attendanceRecordId: `attendance_real_${index + 1}`,
      person: { displayName: `Persona ${index + 1}`, id: `person_real_${index + 1}` },
      statusLabel: "PRESENTE",
      statusOptionId: "present_option",
      updatedAt: `2026-08-26T12:0${index}:00.000Z`,
    })),
    sourceEntityType: { id: "people", name: "Personas" },
    statuses: [{ isDefaultCheckIn: true, label: "PRESENTE", optionId: "present_option" }],
    summary: { totalRegistered: summaryTotalRegistered },
    targetEntityType: { id: "attendance", name: "Asistencia" },
  };
}
