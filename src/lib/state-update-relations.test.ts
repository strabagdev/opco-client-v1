import { describe, expect, it, vi } from "vitest";
import { loadStateUpdateRelationPage, relationValueLabels } from "./state-update-relations";
import type { EntityField } from "./opco-api";

describe("STATE_UPDATE authorized relation catalog", () => {
  const field: EntityField = { id: "location", key: "location_key", name: "Destino", type: "RELATION", required: false,
    config: { relation: { targetEntityTypeId: "places", relationKind: "ONE" } } };
  const record = { id: "remote", displayName: "Patio sintético", values: {}, updatedAt: "2026-10-25T12:00:00.000Z" };
  function input() { return { field, token: "synthetic", ownerKey: "org:user", contractId: "contract", online: true,
    api: { getEntityRecords: vi.fn().mockResolvedValue({ records: [record], pagination: { page: 1, totalPages: 2, total: 30, pageSize: 25 } }) },
    store: { upsertRemoteRecords: vi.fn(), listCachedRecords: vi.fn().mockResolvedValue({ records: [{ ...record, serverId: record.id }], pagination: { page: 1, totalPages: 1 } }) } }; }
  it("uses existing paginated API and scoped persistence without certifying a catalog", async () => {
    const params = input(); const result = await loadStateUpdateRelationPage({ ...params, search: "Patio", page: 1 });
    expect(params.api.getEntityRecords).toHaveBeenCalledWith("synthetic", "contract", "places", expect.objectContaining({ search: "Patio", page: 1, pageSize: 25 }));
    expect(params.store.upsertRemoteRecords).toHaveBeenCalledWith({ ownerKey: "org:user", contractId: "contract", entityTypeId: "places", records: [record] });
    expect(result).toMatchObject({ hasMore: true, options: [{ id: "remote", displayName: "Patio sintético" }] });
    expect(result).not.toHaveProperty("complete");
  });
  it("offline never requests and never treats an absent catalog as complete", async () => {
    const params = input(); const result = await loadStateUpdateRelationPage({ ...params, online: false });
    expect(params.api.getEntityRecords).not.toHaveBeenCalled(); expect(result.offline).toBe(true);
    expect(params.store.listCachedRecords).toHaveBeenCalledWith(expect.objectContaining({ ownerKey: params.ownerKey, contractId: params.contractId, entityTypeId: "places" }));
  });
  it("never offers a local-only unsynchronized target as a remote relation ID", async () => {
    const params = input(); params.store.listCachedRecords.mockResolvedValue({ records: [{ ...record, id: "local-only", serverId: null }], pagination: { page: 1, totalPages: 1 } });
    expect((await loadStateUpdateRelationPage({ ...params, online: false })).options).toEqual([]);
  });
  it("does not fallback to cached records when Core rejects permissions", async () => {
    const params = input(); params.api.getEntityRecords.mockRejectedValue(new Error("403"));
    await expect(loadStateUpdateRelationPage(params)).rejects.toThrow("403");
    expect(params.store.listCachedRecords).not.toHaveBeenCalled();
    expect(relationValueLabels([{ id: "remote", displayName: "Patio" }, "unknown"])).toEqual([{ id: "remote", displayName: "Patio" }]);
  });
});
