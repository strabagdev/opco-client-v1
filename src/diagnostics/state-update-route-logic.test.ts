import { describe, expect, it } from "vitest";

import { getStateUpdateDiagnosticsRouteState, summarizeAttendanceGetResponse } from "./state-update-route-logic";

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
