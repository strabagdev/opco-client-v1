import { describe, expect, it } from "vitest";

import {
  CachedAppViewDefinition,
  deriveOfflineAvailability,
  getAppViewOfflineReadiness,
} from "./app-view-definitions-cache";
import { AppView } from "./opco-api";
import { appViewsFixture, entityDefinitionFixture } from "../test/fixtures";

const recordsView = appViewsFixture[0];
const attendanceView = appViewsFixture[1];
const hydratedAt = "2026-08-28T12:00:00.000Z";

describe("AppView offline readiness", () => {
  it("keeps RECORDS definition-ready but not offline-ready before a full hydration", () => {
    const readiness = getAppViewOfflineReadiness({
      appView: recordsView,
      definition: recordsDefinition(recordsView),
      recordsTelemetry: null,
    });

    expect(readiness).toEqual({
      dataReady: false,
      definitionReady: true,
      offlineReady: false,
      reason: "data-never-hydrated",
    });
    expect(deriveOfflineAvailability({ appView: recordsView, definition: recordsDefinition(recordsView) })).toBe(
      "data-not-cached",
    );
  });

  it("marks RECORDS ready after a full successful hydration even when the snapshot was empty", () => {
    expect(getAppViewOfflineReadiness({
      appView: recordsView,
      definition: recordsDefinition(recordsView),
      recordsTelemetry: { lastFullRefreshCompletedAt: hydratedAt },
    })).toMatchObject({
      dataReady: true,
      definitionReady: true,
      offlineReady: true,
      reason: "definition-ready-data-ready",
    });
  });

  it("does not treat search-only cached rows as RECORDS data readiness", () => {
    expect(getAppViewOfflineReadiness({
      appView: recordsView,
      definition: recordsDefinition(recordsView),
      recordsTelemetry: { lastFullRefreshCompletedAt: null },
    })).toMatchObject({
      dataReady: false,
      offlineReady: false,
    });
  });

  it("keeps previous RECORDS data readiness across a later network refresh failure", () => {
    expect(getAppViewOfflineReadiness({
      appView: recordsView,
      definition: recordsDefinition(recordsView),
      recordsTelemetry: {
        lastFullRefreshCompletedAt: hydratedAt,
      },
    }).offlineReady).toBe(true);
  });

  it("requires source hydration for generic state-update readiness", () => {
    const stateUpdateView: AppView = {
      config: {
        sourceEntityTypeId: "entity_assets",
        stateFields: [],
        subjectFieldId: "field_subject",
        targetEntityTypeId: "entity_events",
        workflowKey: "state-update",
      },
      icon: "workflow",
      id: "view_state_update",
      name: "Cambio de estado",
      slug: "cambio-de-estado",
      sortOrder: 2,
      type: "WORKFLOW",
    };

    expect(getAppViewOfflineReadiness({
      appView: stateUpdateView,
      definition: stateUpdateDefinition(stateUpdateView, "entity_assets"),
      sourceTelemetry: null,
    })).toMatchObject({
      dataReady: false,
      definitionReady: true,
      offlineReady: false,
    });
    expect(getAppViewOfflineReadiness({
      appView: stateUpdateView,
      definition: stateUpdateDefinition(stateUpdateView, "entity_assets"),
      sourceTelemetry: { lastFullRefreshCompletedAt: hydratedAt },
    })).toMatchObject({
      dataReady: true,
      offlineReady: true,
    });
  });

  it("does not treat Attendance as ready when only its source records are hydrated", () => {
    expect(getAppViewOfflineReadiness({
      appView: attendanceView,
      definition: stateUpdateDefinition(attendanceView, "entity_people"),
      sourceTelemetry: null,
    })).toMatchObject({
      dataReady: false,
      offlineReady: false,
    });
    expect(getAppViewOfflineReadiness({
      appView: attendanceView,
      definition: stateUpdateDefinition(attendanceView, "entity_people"),
      sourceTelemetry: { lastFullRefreshCompletedAt: hydratedAt },
    })).toMatchObject({
      attendanceTodayReady: false,
      dataReady: false,
      offlineReady: false,
      sourceReady: true,
    });
  });

  it("marks Attendance ready only when source records and the current month are fully hydrated", () => {
    expect(getAppViewOfflineReadiness({
      appView: attendanceView,
      attendanceDayHydration: { lastSuccessfulRefreshAt: hydratedAt },
      attendanceMonthStatus: "complete",
      definition: stateUpdateDefinition(attendanceView, "entity_people"),
      sourceTelemetry: { lastFullRefreshCompletedAt: hydratedAt },
    })).toMatchObject({
      attendanceMonthStatus: "complete",
      attendanceTodayReady: true,
      dataReady: true,
      offlineReady: true,
      sourceReady: true,
    });
  });

  it("keeps Attendance partially available when some current-month days are hydrated", () => {
    const readiness = getAppViewOfflineReadiness({
      appView: attendanceView,
      attendanceDayHydration: { lastSuccessfulRefreshAt: hydratedAt },
      attendanceMonthStatus: "partial",
      definition: stateUpdateDefinition(attendanceView, "entity_people"),
      sourceTelemetry: { lastFullRefreshCompletedAt: hydratedAt },
    });

    expect(readiness).toMatchObject({
      attendanceMonthStatus: "partial",
      attendanceTodayReady: true,
      dataReady: false,
      offlineReady: false,
      sourceReady: true,
    });
    expect(deriveOfflineAvailability({
      appView: attendanceView,
      attendanceDayHydration: { lastSuccessfulRefreshAt: hydratedAt },
      attendanceMonthStatus: "partial",
      definition: stateUpdateDefinition(attendanceView, "entity_people"),
      sourceTelemetry: { lastFullRefreshCompletedAt: hydratedAt },
    })).toBe("data-partial");
  });

  it("does not consider the month complete when today is hydrated but another day is missing", () => {
    expect(getAppViewOfflineReadiness({
      appView: attendanceView,
      attendanceDayHydration: { lastSuccessfulRefreshAt: hydratedAt },
      attendanceMonthStatus: "partial",
      definition: stateUpdateDefinition(attendanceView, "entity_people"),
      sourceTelemetry: { lastFullRefreshCompletedAt: hydratedAt },
    })).toMatchObject({
      attendanceTodayReady: true,
      dataReady: false,
      offlineReady: false,
    });
  });

  it("keeps Attendance unavailable offline when no current-month day is hydrated", () => {
    expect(getAppViewOfflineReadiness({
      appView: attendanceView,
      attendanceMonthStatus: "none",
      definition: stateUpdateDefinition(attendanceView, "entity_people"),
      sourceTelemetry: { lastFullRefreshCompletedAt: hydratedAt },
    })).toMatchObject({
      attendanceMonthStatus: "none",
      attendanceTodayReady: false,
      dataReady: false,
      offlineReady: false,
      sourceReady: true,
    });
  });

  it("does not reuse readiness across owner, contract, or dataset scopes", () => {
    const telemetryByScope = new Map([
      ["owner_a:contract_a:entity_1", { lastFullRefreshCompletedAt: hydratedAt }],
    ]);

    expect(readinessForRecordsScope(telemetryByScope, "owner_a", "contract_a", recordsView).offlineReady).toBe(true);
    expect(readinessForRecordsScope(telemetryByScope, "owner_b", "contract_a", recordsView).offlineReady).toBe(false);
    expect(readinessForRecordsScope(telemetryByScope, "owner_a", "contract_b", recordsView).offlineReady).toBe(false);
    expect(readinessForRecordsScope(
      telemetryByScope,
      "owner_a",
      "contract_a",
      { ...recordsView, config: { entityTypeId: "entity_other" }, id: "view_other", type: "RECORDS" },
    ).offlineReady).toBe(false);
  });

  it("evaluates each AppView against the dataset it actually needs", () => {
    const telemetryByScope = new Map([
      ["owner_a:contract_a:entity_people", { lastFullRefreshCompletedAt: hydratedAt }],
    ]);

    expect(getAppViewOfflineReadiness({
      appView: attendanceView,
      attendanceDayHydration: { lastSuccessfulRefreshAt: hydratedAt },
      attendanceMonthStatus: "complete",
      definition: stateUpdateDefinition(attendanceView, "entity_people"),
      sourceTelemetry: telemetryByScope.get("owner_a:contract_a:entity_people"),
    }).offlineReady).toBe(true);

    expect(getAppViewOfflineReadiness({
      appView: attendanceView,
      attendanceDayHydration: { lastSuccessfulRefreshAt: hydratedAt },
      attendanceMonthStatus: "complete",
      definition: stateUpdateDefinition(attendanceView, "entity_assets"),
      sourceTelemetry: telemetryByScope.get("owner_a:contract_a:entity_assets") ?? null,
    }).offlineReady).toBe(false);
  });
});

function readinessForRecordsScope(
  telemetryByScope: Map<string, { lastFullRefreshCompletedAt: string }>,
  ownerKey: string,
  contractId: string,
  appView: AppView,
) {
  return getAppViewOfflineReadiness({
    appView,
    definition: recordsDefinition(appView),
    recordsTelemetry: appView.type === "RECORDS"
      ? telemetryByScope.get(`${ownerKey}:${contractId}:${appView.config.entityTypeId}`) ?? null
      : null,
  });
}

function recordsDefinition(appView: AppView): CachedAppViewDefinition {
  return {
    appViewId: appView.id,
    appViewType: appView.type,
    contractId: "contract_1",
    definition: {
      appView,
      entityDefinition: entityDefinitionFixture,
      kind: "records",
    },
    lastPreparedAt: hydratedAt,
    ownerKey: "org_1:user_1",
    status: "ready",
    workflowKey: null,
  };
}

function stateUpdateDefinition(appView: AppView, sourceEntityTypeId: string): CachedAppViewDefinition {
  return {
    appViewId: appView.id,
    appViewType: appView.type,
    contractId: "contract_1",
    definition: {
      appView,
      extraFields: [],
      historyMode: "update-current",
      kind: "state-update",
      sourceEntityTypeId,
      stateFields: [],
      subjectFieldId: "field_subject",
      targetEntityTypeId: "entity_target",
      uniqueness: "subject-date",
    },
    lastPreparedAt: hydratedAt,
    ownerKey: "org_1:user_1",
    status: "ready",
    workflowKey: appView.type === "WORKFLOW" ? String(appView.config.workflowKey ?? "") : null,
  };
}
