import { describe, expect, it, vi } from "vitest";

import {
  clearRecordsOpeningHistorySnapshot,
  getRecordsOpeningHistorySnapshot,
  hydrateRecordsOpeningHistory,
  loadRecordsCacheFirst,
  recordRecordsOpeningMeasurement,
  selectPresentableLocalRecords,
  shouldStartRecordsOpeningMeasurement,
} from "./records-opening";
import type { RecordsOpeningMeasurement } from "@/lib/records-opening-history";

describe("RECORDS cache-first opening", () => {
  it("presents a complete local snapshot before a slow remote refresh resolves", async () => {
    let resolveRemote!: (value: string) => void;
    const remote = new Promise<string>((resolve) => {
      resolveRemote = resolve;
    });
    const presentations: string[] = [];
    const opening = loadRecordsCacheFirst({
      canPresentLocal: (local: string[]) => local.length > 0,
      onPresentLocal: (local) => presentations.push(`local:${local.length}`),
      readLocal: async () => ["cached"],
      refreshRemote: () => remote,
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(presentations).toEqual(["local:1"]);

    resolveRemote("remote");
    await expect(opening).resolves.toMatchObject({ localPresented: true, remote: "remote" });
  });

  it("does not present an incomplete local snapshot as a complete list", async () => {
    const onPresentLocal = vi.fn();

    await loadRecordsCacheFirst({
      canPresentLocal: () => false,
      onPresentLocal,
      readLocal: async () => ["partial"],
      refreshRemote: async () => "remote",
    });

    expect(onPresentLocal).not.toHaveBeenCalled();
  });

  it("creates one measurement per mounted AppView scope, not per refresh or render", () => {
    expect(shouldStartRecordsOpeningMeasurement(null, "owner:contract:entity:view")).toBe(true);
    expect(shouldStartRecordsOpeningMeasurement("owner:contract:entity:view", "owner:contract:entity:view")).toBe(false);
    expect(shouldStartRecordsOpeningMeasurement("owner:contract:entity:view", "owner:contract:entity:other-view")).toBe(true);
  });

  it("keeps unresolved local work but excludes synced rows from an incomplete snapshot", () => {
    const result = selectPresentableLocalRecords({
      fromCache: true,
      offline: false,
      pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
      records: [
        cachedRecord("server_1", "synced"),
        cachedRecord("local_1", "pending_create"),
      ],
    }, false);

    expect(result.records.map((record) => record.id)).toEqual(["local_1"]);
    expect(result.pagination.total).toBe(1);
  });

  it("keeps the local presentation observable when the remote refresh fails", async () => {
    const presentations: string[] = [];

    await expect(loadRecordsCacheFirst({
      canPresentLocal: () => true,
      onPresentLocal: () => presentations.push("local"),
      readLocal: async () => ["cached"],
      refreshRemote: async () => {
        throw new Error("network");
      },
    })).rejects.toThrow("network");

    expect(presentations).toEqual(["local"]);
  });

  it("does not present a late local response after the active experience changes", async () => {
    let active = true;
    let resolveLocal!: (value: string[]) => void;
    const onPresentLocal = vi.fn();
    const opening = loadRecordsCacheFirst({
      canPresentLocal: () => true,
      isActive: () => active,
      onPresentLocal,
      readLocal: () => new Promise((resolve) => {
        resolveLocal = resolve;
      }),
      refreshRemote: async () => "remote",
    });

    active = false;
    resolveLocal(["old-scope"]);
    await opening;

    expect(onPresentLocal).not.toHaveBeenCalled();
  });

  it("continues with the remote result when the local database read fails", async () => {
    await expect(loadRecordsCacheFirst({
      canPresentLocal: () => true,
      onPresentLocal: vi.fn(),
      readLocal: async () => {
        throw new Error("sqlite unavailable");
      },
      refreshRemote: async () => "remote",
    })).resolves.toMatchObject({
      local: null,
      localPresented: false,
      remote: "remote",
    });
  });

  it("does not block presentation when diagnostic storage fails", async () => {
    clearRecordsOpeningHistorySnapshot();
    recordRecordsOpeningMeasurement({
      contractId: "contract_1",
      measurement: measurement(),
      ownerKey: "owner_1",
      store: {
        async clearRecordsOpeningHistory() {},
        async getRecordsOpeningHistory() { return []; },
        async upsertRecordsOpeningMeasurement() { throw new Error("storage"); },
      },
    });
    await Promise.resolve();

    expect(getRecordsOpeningHistorySnapshot().history).toHaveLength(1);
  });

  it("does not restore a late hydration after logout cleanup", async () => {
    let resolveHistory!: (history: RecordsOpeningMeasurement[]) => void;
    const hydration = hydrateRecordsOpeningHistory({
      contractId: "contract_1",
      ownerKey: "owner_1",
      store: {
        async clearRecordsOpeningHistory() {},
        getRecordsOpeningHistory: () => new Promise((resolve) => { resolveHistory = resolve; }),
        async upsertRecordsOpeningMeasurement() {},
      },
    });

    clearRecordsOpeningHistorySnapshot("owner_1");
    resolveHistory([measurement()]);
    await hydration;

    expect(getRecordsOpeningHistorySnapshot().history).toEqual([]);
  });
});

function measurement(): RecordsOpeningMeasurement {
  return {
    appViewId: "view_1",
    appViewTitle: "Personas",
    coverage: "complete",
    errorCode: null,
    id: "opening_1",
    localReadMs: 12,
    preparationMs: 2,
    processedCount: 25,
    remoteRefreshMs: 800,
    result: "completed",
    shownCount: 25,
    source: "local",
    startedAt: "2026-09-17T12:00:00.000Z",
    timeToFirstRowsMs: 14,
  };
}

function cachedRecord(id: string, syncStatus: "synced" | "pending_create") {
  return {
    cachedAt: "2026-09-17T12:00:00.000Z",
    conflictRemoteDisplayName: null,
    conflictRemoteUpdatedAt: null,
    conflictRemoteValues: null,
    displayName: id,
    id,
    localId: id,
    remoteUpdatedAt: null,
    serverId: syncStatus === "synced" ? id : null,
    syncErrorCode: null,
    syncErrorMessage: null,
    syncStatus,
    updatedAt: "2026-09-17T12:00:00.000Z",
    values: {},
  };
}
