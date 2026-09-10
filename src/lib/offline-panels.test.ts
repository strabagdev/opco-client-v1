import { describe, expect, it, vi } from "vitest";

import { PanelSnapshotScope } from "./local-db";
import { loadPanelDatasetWithOfflineCache, PANEL_DISCOVERY_SNAPSHOT_DATASET_ID } from "./offline-panels";
import { OpcoNetworkError, PanelResponse } from "./opco-api";

describe("offline panel cache", () => {
  it("stores successful PANEL dataset responses and falls back to compatible snapshots on network errors", async () => {
    const store = new MemoryPanelStore();
    const panel = panelResponse("revision_1");
    const api = {
      getPanel: vi.fn()
        .mockResolvedValueOnce(panel)
        .mockRejectedValueOnce(new OpcoNetworkError()),
    };

    await expect(loadPanelDatasetWithOfflineCache({
      api,
      appViewId: "panel_1",
      contractId: "contract_1",
      ownerKey: "owner_1",
      query: {
        datasetId: "records",
        filters: { status: "option_1" },
        page: 1,
        pageSize: 25,
        search: "PET",
      },
      store,
      token: "token_1",
    })).resolves.toMatchObject({
      fromCache: false,
      offline: false,
      panel,
    });

    await expect(loadPanelDatasetWithOfflineCache({
      api,
      appViewId: "panel_1",
      configRevision: "revision_1",
      contractId: "contract_1",
      ownerKey: "owner_1",
      query: {
        datasetId: "records",
        filters: { status: "option_1" },
        page: 1,
        pageSize: 25,
        search: "PET",
      },
      store,
      token: "token_1",
    })).resolves.toMatchObject({
      fromCache: true,
      offline: true,
      panel,
    });
  });

  it("rejects snapshots with an incompatible configRevision", async () => {
    const store = new MemoryPanelStore();
    const api = {
      getPanel: vi.fn()
        .mockResolvedValueOnce(panelResponse("revision_old"))
        .mockRejectedValueOnce(new OpcoNetworkError()),
    };

    await loadPanelDatasetWithOfflineCache({
      api,
      appViewId: "panel_1",
      contractId: "contract_1",
      ownerKey: "owner_1",
      query: {
        datasetId: "records",
        page: 1,
        pageSize: 25,
      },
      store,
      token: "token_1",
    });

    await expect(loadPanelDatasetWithOfflineCache({
      api,
      appViewId: "panel_1",
      configRevision: "revision_new",
      contractId: "contract_1",
      ownerKey: "owner_1",
      query: {
        datasetId: "records",
        page: 1,
        pageSize: 25,
      },
      store,
      token: "token_1",
    })).rejects.toBeInstanceOf(OpcoNetworkError);
  });

  it("loads discovery without datasetId and can recover the latest discovery snapshot offline", async () => {
    const store = new MemoryPanelStore();
    const panel = panelResponse("revision_1");
    const api = {
      getPanel: vi.fn()
        .mockResolvedValueOnce(panel)
        .mockRejectedValueOnce(new OpcoNetworkError()),
    };

    await loadPanelDatasetWithOfflineCache({
      api,
      appViewId: "panel_1",
      contractId: "contract_1",
      ownerKey: "owner_1",
      query: {
        page: 1,
        pageSize: 25,
      },
      snapshotDatasetId: PANEL_DISCOVERY_SNAPSHOT_DATASET_ID,
      store,
      token: "token_1",
    });

    expect(api.getPanel.mock.calls[0]?.[3]).toEqual({ page: 1, pageSize: 25 });

    await expect(loadPanelDatasetWithOfflineCache({
      api,
      appViewId: "panel_1",
      contractId: "contract_1",
      ownerKey: "owner_1",
      query: {
        page: 1,
        pageSize: 25,
      },
      snapshotDatasetId: PANEL_DISCOVERY_SNAPSHOT_DATASET_ID,
      store,
      token: "token_1",
    })).resolves.toMatchObject({
      fromCache: true,
      panel,
    });
  });
});

class MemoryPanelStore {
  private snapshots = new Map<string, { panel: PanelResponse; syncedAt: string }>();

  async upsertPanelSnapshot(input: PanelSnapshotScope & { panel: PanelResponse; syncedAt?: string }) {
    this.snapshots.set(this.key({ ...input, configRevision: input.configRevision ?? input.panel.configRevision }), {
      panel: input.panel,
      syncedAt: input.syncedAt ?? "2026-09-09T00:00:00.000Z",
    });
  }

  async getPanelSnapshot(input: PanelSnapshotScope) {
    if (!input.configRevision) {
      const wanted = JSON.parse(this.key({ ...input, configRevision: "__any__" }));
      for (const [key, snapshot] of this.snapshots.entries()) {
        const candidate = JSON.parse(key);
        if (
          candidate.appViewId === wanted.appViewId &&
          candidate.contractId === wanted.contractId &&
          candidate.datasetId === wanted.datasetId &&
          candidate.ownerKey === wanted.ownerKey &&
          candidate.page === wanted.page &&
          candidate.pageSize === wanted.pageSize &&
          candidate.search === wanted.search &&
          JSON.stringify(candidate.filters) === JSON.stringify(wanted.filters)
        ) {
          return snapshot;
        }
      }
    }

    return this.snapshots.get(this.key(input)) ?? null;
  }

  private key(input: PanelSnapshotScope) {
    return JSON.stringify({
      appViewId: input.appViewId,
      configRevision: input.configRevision ?? "",
      contractId: input.contractId,
      datasetId: input.datasetId,
      filters: stable(input.filters ?? {}),
      ownerKey: input.ownerKey,
      page: input.page,
      pageSize: input.pageSize,
      search: input.search ?? "",
    });
  }
}

function panelResponse(configRevision: string): PanelResponse {
  return {
    appView: { id: "panel_1", name: "Panel", slug: "panel" },
    calculatedAt: "2026-09-09T12:00:00.000Z",
    configRevision,
    datasets: [
      {
        id: "records",
        pagination: { hasMore: false, page: 1, pageSize: 25, total: 1 },
        rows: [{ id: "record_1", values: { name: "A" } }],
        schema: { fields: [{ id: "name", name: "Nombre", type: "TEXT" }] },
      },
    ],
    filters: [],
    modules: [],
    schemaVersion: 1,
  };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)));
  }
  return value;
}
