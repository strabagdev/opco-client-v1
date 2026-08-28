import { describe, expect, it } from "vitest";

import { PendingOperation } from "../lib/offline-records";
import { OpcoApi, OpcoApiError } from "../lib/opco-api";
import { StateUpdateSyncStore } from "../sync/state-update-sync";
import {
  createStateUpdateDiagnosticApi,
  createStateUpdateDiagnosticEvents,
  createStateUpdateDiagnosticStore,
  getStateUpdateDiagnosticsRouteState,
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
