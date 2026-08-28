import { describe, expect, it } from "vitest";

import {
  createStateUpdateLocalRecordId,
  isStateUpdateCompatibleWorkflow,
  isValidStateUpdateRemoteUpdatedAt,
  mergeStateUpdateSyncDiagnosticsTelemetry,
  stateUpdateIntentsEqual,
  stateUpdateRemoteItemMatchesPayload,
  resolveStateUpdateSyncTelemetryResult,
} from "./state-update-offline";

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
    const current = {
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
      lastStateUpdateSync: {
        completedAt: "2026-08-27T10:00:12.000Z",
        operationsAttempted: 1,
        operationsCompleted: 1,
        operationsFailed: 0,
        operationsSelected: 1,
        reconciledAfterTimeout: true,
        result: "reconciled_success" as const,
        startedAt: "2026-08-27T10:00:00.000Z",
        trigger: "reconnect" as const,
      },
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
        trigger: "reconnect",
      },
    });
  });
});
