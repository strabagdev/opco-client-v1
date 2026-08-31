import { describe, expect, it } from "vitest";

import {
  formatPendingSyncErrorMessage,
  formatPendingSyncErrorNotice,
  getPendingStateUpdateSyncErrors,
  getPendingSyncErrorTechnicalRows,
} from "./pending-sync-errors";
import { StateUpdateOutboxDiagnosticsOperation } from "./state-update-offline";

describe("pending sync error presentation", () => {
  it("keeps the shell notice brief and human", () => {
    expect(formatPendingSyncErrorNotice(1)).toBe("Un cambio no pudo sincronizarse.");
    expect(formatPendingSyncErrorNotice(3)).toBe("3 cambios no pudieron sincronizarse.");
  });

  it("formats INVALID_FIELD_VALUE with field context for the modal", () => {
    const error = operation({
      lastErrorCode: "INVALID_FIELD_VALUE",
      lastErrorDetails: {
        entityTypeId: "attendance",
        fields: [{
          expectedType: "FIELD_OPTION_VALUE",
          expectedValues: ["turno_a", "turno_b"],
          fieldId: "shift_field",
          fieldLabel: "Turno",
          fieldType: "SELECT",
          messages: ["La opción seleccionada no es válida."],
          rejectedValue: "shift_option_id",
          source: "extra",
        }],
      },
    });

    expect(formatPendingSyncErrorMessage(error)).toBe("El campo Turno tiene un valor que Opco no puede guardar.");
    expect(getPendingSyncErrorTechnicalRows(error)).toEqual(expect.arrayContaining([
      ["fieldId", "shift_field"],
      ["fieldLabel", "Turno"],
      ["rejectedValue", "shift_option_id"],
      ["expectedValues", "turno_a, turno_b"],
    ]));
  });

  it("selects only failed operations with pending error codes", () => {
    expect(getPendingStateUpdateSyncErrors({
      consistency: "OK",
      localRecords: [],
      operations: [
        operation({ lastErrorCode: "INVALID_FIELD_VALUE", syncStatus: "failed" }),
        operation({ lastBackendErrorCode: null, lastErrorCode: null, syncStatus: "failed" }),
        operation({ lastErrorCode: "SERVER_ERROR", syncStatus: "pending_update" }),
      ],
      summary: emptySummary(),
    })).toHaveLength(1);
  });
});

function operation(overrides: Partial<StateUpdateOutboxDiagnosticsOperation> = {}): StateUpdateOutboxDiagnosticsOperation {
  return {
    appViewFingerprint: "view***",
    appViewResolved: true,
    clientRequestId: "request***",
    config: {
      definitionKind: "state-update",
      extraFieldsCount: 1,
      matchingStateValuesCount: 1,
      missingStateValuesCount: 0,
      sourceTargetConfigured: true,
      stateFieldsCount: 1,
      statusOptionResolved: true,
      workflowKey: "attendance",
    },
    contractFingerprint: "contract***",
    date: "2026-08-31",
    extraValuesCount: 1,
    lastBackendErrorCode: "INVALID_FIELD_VALUE",
    lastErrorCode: "INVALID_FIELD_VALUE",
    lastErrorDetails: null,
    lastErrorPhase: "pushing",
    lastErrorMessage: "Uno o más campos tienen valores inválidos.",
    lastHttpStatus: null,
    manualRetryToken: "retry_1",
    manualRetryable: true,
    operationType: "STATE_UPDATE",
    payloadSchema: "current",
    retryable: false,
    retryCount: 1,
    stateValuesCount: 1,
    subjectFingerprint: "subject***",
    syncStatus: "failed",
    updatedAt: "2026-08-31T12:00:00.000Z",
    ...overrides,
  };
}

function emptySummary() {
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
