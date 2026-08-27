import { describe, expect, it } from "vitest";

import {
  createStateUpdateLocalRecordId,
  mergeStateUpdateSyncDiagnosticsTelemetry,
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
