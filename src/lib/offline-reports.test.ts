import { describe, expect, it, vi } from "vitest";

import { OpcoNetworkError, ReportResponse } from "./opco-api";
import { loadReportWithOfflineCache } from "./offline-reports";

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
