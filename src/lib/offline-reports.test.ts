import { describe, expect, it, vi } from "vitest";

import { OpcoNetworkError, ReportResponse } from "./opco-api";
import { loadReportWithOfflineCache } from "./offline-reports";
import { buildReportCurrentStatusModel } from "../renderers/reports/report-renderer-logic";

describe("offline report cache", () => {
  it("stores successful REPORT responses and falls back to cached data on network errors", async () => {
    const store = new MemoryReportStore();
    const report = currentStatusReport();
    const api = {
      getReport: vi.fn(async () => report),
    };

    await expect(loadReportWithOfflineCache({
      api,
      appViewId: "report_1",
      contractId: "contract_1",
      ownerKey: "owner_1",
      query: { search: "PET" },
      store,
      token: "token_1",
    })).resolves.toMatchObject({
      fromCache: false,
      offline: false,
      report,
    });

    api.getReport.mockRejectedValueOnce(new OpcoNetworkError());

    await expect(loadReportWithOfflineCache({
      api,
      appViewId: "report_1",
      contractId: "contract_1",
      ownerKey: "owner_1",
      query: { search: "PET" },
      store,
      token: "token_1",
    })).resolves.toMatchObject({
      fromCache: true,
      offline: true,
      report,
    });
  });

  it("keeps latest-by-relation order and date formatting from cached reports", async () => {
    const store = new MemoryReportStore();
    const report = latestByRelationReport();
    const api = {
      getReport: vi.fn()
        .mockResolvedValueOnce(report)
        .mockRejectedValueOnce(new OpcoNetworkError()),
    };

    await loadReportWithOfflineCache({
      api,
      appViewId: "report_1",
      contractId: "contract_1",
      ownerKey: "owner_1",
      query: { search: "PET" },
      store,
      token: "token_1",
    });
    const cached = await loadReportWithOfflineCache({
      api,
      appViewId: "report_1",
      contractId: "contract_1",
      ownerKey: "owner_1",
      query: { search: "PET" },
      store,
      token: "token_1",
    });

    expect(cached.fromCache).toBe(true);
    expect(buildReportCurrentStatusModel(cached.report)).toEqual({
      columns: [
        { id: "procedure_field", name: "Procedimiento" },
        { id: "review_field", name: "Revisión" },
        { id: "status_field", name: "Estatus" },
        { id: "date_field", name: "Fecha" },
      ],
      rows: [
        { id: "version_2", values: ["PET-001", "2", "Publicado", "06-09-2026"] },
      ],
    });
  });
});

class MemoryReportStore {
  private snapshots = new Map<string, { report: ReportResponse; syncedAt: string }>();

  async upsertReportSnapshot(input: {
    appViewId: string;
    contractId: string;
    from?: string | null;
    ownerKey: string;
    report: ReportResponse;
    search?: string | null;
    syncedAt?: string;
    to?: string | null;
  }) {
    this.snapshots.set(this.key(input), {
      report: input.report,
      syncedAt: input.syncedAt ?? "2026-09-07T00:00:00.000Z",
    });
  }

  async getReportSnapshot(input: {
    appViewId: string;
    contractId: string;
    from?: string | null;
    ownerKey: string;
    search?: string | null;
    to?: string | null;
  }) {
    return this.snapshots.get(this.key(input)) ?? null;
  }

  private key(input: {
    appViewId: string;
    contractId: string;
    from?: string | null;
    ownerKey: string;
    search?: string | null;
    to?: string | null;
  }) {
    return JSON.stringify({
      appViewId: input.appViewId,
      contractId: input.contractId,
      from: input.from ?? "",
      ownerKey: input.ownerKey,
      search: input.search ?? "",
      to: input.to ?? "",
    });
  }
}

function currentStatusReport(): ReportResponse {
  return {
    appView: {
      id: "report_1",
      name: "Dashboard Procedimientos",
      slug: "dashboard-procedimientos",
    },
    config: {
      entityTypeId: "versions",
      presentationMode: "CURRENT_STATUS",
      currentStatus: {
        subjectFieldId: "procedure_field",
        stateFieldId: "status_field",
        dateFieldId: "date_field",
      },
    },
    entity: {
      id: "versions",
      name: "Versionado",
      slug: "versionado",
    },
    fields: [],
    from: "",
    records: [],
    to: "",
  };
}

function latestByRelationReport(): ReportResponse {
  return {
    appView: {
      id: "report_1",
      name: "Dashboard Procedimientos",
      slug: "dashboard-procedimientos",
    },
    config: {
      entityTypeId: "versions",
      presentationMode: "LATEST_BY_RELATION",
      latestByRelation: {
        relatedEntityTypeId: "procedures",
        relationFieldId: "procedure_field",
        orderFieldId: "date_field",
        requiredValueFieldId: "status_field",
        displayFieldIds: ["review_field", "status_field", "date_field", "procedure_field"],
      },
    },
    entity: {
      id: "versions",
      name: "Versionado",
      slug: "versionado",
    },
    fields: [
      {
        active: true,
        config: { display: {}, relationKind: "ONE", targetEntityTypeId: "procedures", validation: {} },
        id: "procedure_field",
        key: "procedimiento",
        name: "Procedimiento",
        order: 1,
        required: true,
        searchable: true,
        type: "RELATION",
        unique: false,
      },
      {
        active: true,
        config: { display: {}, validation: {} },
        id: "review_field",
        key: "revision",
        name: "Revisión",
        order: 2,
        required: false,
        searchable: false,
        type: "TEXT",
        unique: false,
      },
      {
        active: true,
        config: { display: {}, validation: {} },
        id: "status_field",
        key: "estatus",
        name: "Estatus",
        options: [{ active: true, id: "published_option", label: "Publicado", order: 1, value: "publicado" }],
        order: 3,
        required: false,
        searchable: false,
        type: "SELECT",
        unique: false,
      },
      {
        active: true,
        config: { display: {}, validation: {} },
        id: "date_field",
        key: "fecha",
        name: "Fecha",
        order: 4,
        required: false,
        searchable: false,
        type: "DATE",
        unique: false,
      },
    ],
    from: "",
    records: [
      {
        displayName: "PET-001 v2",
        id: "version_2",
        updatedAt: "2026-09-06T12:00:00.000Z",
        values: {
          estatus: "publicado",
          fecha: "2026-09-06",
          procedimiento: { displayName: "PET-001", entityTypeId: "procedures", id: "procedure_1" },
          revision: "2",
        },
      },
    ],
    subjectEntity: { id: "procedures", name: "Procedimientos", slug: "procedimientos" },
    to: "",
  };
}
