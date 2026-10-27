import { describe, expect, it, vi } from "vitest";

import { appViewsFixture } from "../test/fixtures";
import { AppNavigationCache, AppViewsUnavailableError, loadAppViewsWithCache, readCachedAppViews } from "./app-navigation-cache";
import { AppViewDefinitionCache, CachedAppViewDefinition, UpsertAppViewDefinitionInput } from "./app-view-definitions-cache";
import { AppView, ContextResponse, MeResponse, OpcoApiError, OpcoNetworkError } from "./opco-api";

describe("app navigation cache", () => {
  it("stores AppViews when the remote request succeeds", async () => {
    const cache = new MemoryNavigationCache();

    const result = await loadAppViewsWithCache({
      api: {
        getAppViews: async () => ({ views: appViewsFixture }),
      },
      cache,
      contractId: "contract_1",
      now: () => new Date("2026-08-19T12:00:00.000Z"),
      ownerKey: "org_1:user_1",
      token: "token_1",
    });

    expect(result).toMatchObject({
      fromCache: false,
      offline: false,
      syncedAt: "2026-08-19T12:00:00.000Z",
    });
    expect(result.views.map((view) => view.id)).toEqual([
      "view_workflow",
      "view_records",
      "view_board",
      "view_dashboard",
    ]);
    await expect(cache.getAppViews("org_1:user_1", "contract_1")).resolves.toMatchObject({
      syncedAt: "2026-08-19T12:00:00.000Z",
    });
  });

  it("finishes the route load from remote data while coordinated SQLite cache work is waiting", async () => {
    const never = new Promise<never>(() => undefined);
    const getAppViews = vi.fn(async () => ({ views: appViewsFixture }));
    const cache = {
      getAppViews: vi.fn(() => never),
      upsertAppViews: vi.fn(() => never),
    };

    const result = await loadAppViewsWithCache({
      api: { getAppViews },
      cache,
      contractId: "contract_1",
      onCached: vi.fn(),
      ownerKey: "org_1:user_1",
      token: "token_1",
    });

    expect(getAppViews).toHaveBeenCalledOnce();
    expect(cache.getAppViews).toHaveBeenCalledOnce();
    expect(cache.upsertAppViews).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      fromCache: false,
      offline: false,
      views: expect.arrayContaining([
        expect.objectContaining({ id: "view_workflow" }),
      ]),
    });
  });

  it("uses cached AppViews when the remote request fails by network", async () => {
    const cache = new MemoryNavigationCache();
    await cache.upsertAppViews("org_1:user_1", "contract_1", appViewsFixture, "2026-08-19T12:00:00.000Z");

    const result = await loadAppViewsWithCache({
      api: {
        getAppViews: async () => {
          throw new OpcoNetworkError();
        },
      },
      cache,
      contractId: "contract_1",
      ownerKey: "org_1:user_1",
      token: "token_1",
    });

    expect(result.offline).toBe(true);
    expect(result.fromCache).toBe(true);
    expect(result.views.map((view) => view.id)).toContain("view_records");
  });

  it("does not use AppViews cache when the API returns an auth error", async () => {
    const cache = new MemoryNavigationCache();
    await cache.upsertAppViews("org_1:user_1", "contract_1", appViewsFixture, "2026-08-19T12:00:00.000Z");

    await expect(
      loadAppViewsWithCache({
        api: {
          getAppViews: async () => {
            throw new OpcoApiError("Token invalido.", "TOKEN_INVALID", 401);
          },
        },
        cache,
        contractId: "contract_1",
        ownerKey: "org_1:user_1",
        token: "token_1",
      }),
    ).rejects.toMatchObject({ code: "TOKEN_INVALID", status: 401 });
  });

  it("explains missing cache while preserving the remote error", async () => {
    await expect(
      loadAppViewsWithCache({
        api: {
          getAppViews: async () => {
            throw new OpcoNetworkError();
          },
        },
        cache: new MemoryNavigationCache(),
        contractId: "contract_1",
        ownerKey: "org_1:user_1",
        token: "token_1",
      }),
    ).rejects.toMatchObject({ code: "HOME_CACHE_ABSENT", remoteCause: expect.any(OpcoNetworkError) });
  });

  it("does not expose cached AppViews across owners", async () => {
    const cache = new MemoryNavigationCache();

    await cache.upsertAppViews("org_1:user_a", "contract_1", appViewsFixture, "2026-08-19T12:00:00.000Z");

    await expect(
      loadAppViewsWithCache({
        api: {
          getAppViews: async () => {
            throw new OpcoNetworkError();
          },
        },
        cache,
        contractId: "contract_1",
        ownerKey: "org_1:user_b",
        token: "token_b",
      }),
    ).rejects.toBeInstanceOf(AppViewsUnavailableError);
  });

  it("reads an authorized owner and contract snapshot without waiting for a remote request", async () => {
    const cache = new MemoryNavigationCache();
    await cache.upsertAppViews("org_1:user_a", "contract_1", appViewsFixture, "2026-08-19T12:00:00.000Z");

    await expect(readCachedAppViews(cache, "org_1:user_a", "contract_1")).resolves.toMatchObject({
      status: "valid", snapshot: { syncedAt: "2026-08-19T12:00:00.000Z" },
    });
    await expect(readCachedAppViews(cache, "org_1:user_b", "contract_1")).resolves.toEqual({ status: "absent" });
    await expect(readCachedAppViews(cache, "org_1:user_a", "contract_2")).resolves.toEqual({ status: "absent" });
  });

  it("distinguishes a read error from both absence and a valid empty assignment list", async () => {
    const cache = new MemoryNavigationCache();
    await cache.upsertAppViews("owner", "contract", [], "2026-10-26T12:00:00Z");
    expect(await readCachedAppViews(cache, "owner", "contract")).toMatchObject({ status: "valid", snapshot: { views: [] } });
    const read = vi.spyOn(cache, "getAppViews").mockRejectedValueOnce(new Error("private payload"));
    expect(await readCachedAppViews(cache, "owner", "contract")).toEqual({ status: "error", errorCode: "HOME_CACHE_READ_FAILED" });
    expect(read).toHaveBeenCalledOnce();
  });

  it("does not replace a completed remote load with a late cached list", async () => {
    let finish!: (value: { views: AppView[]; syncedAt: string }) => void;
    const cache = new MemoryNavigationCache();
    vi.spyOn(cache, "getAppViews").mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const onCached = vi.fn();
    const result = await loadAppViewsWithCache({ api: { getAppViews: async () => ({ views: [] }) }, cache, ownerKey: "owner", contractId: "contract", token: "synthetic", onCached });
    finish({ views: appViewsFixture, syncedAt: "2026-10-26T12:00:00Z" });
    await Promise.resolve();
    expect(result.views).toEqual([]);
    expect(onCached).not.toHaveBeenCalled();
  });

  it("does not persist or publish a response after its requesting scope leaves", async () => {
    let finish!: (value: { views: AppView[] }) => void;
    let current = true;
    const cache = new MemoryNavigationCache();
    const write = vi.spyOn(cache, "upsertAppViews");
    const onCached = vi.fn(), onCacheWrite = vi.fn();
    const pending = loadAppViewsWithCache({ api: { getAppViews: () => new Promise(resolve => { finish = resolve; }) }, cache, ownerKey: "owner", contractId: "contract", token: "synthetic", onCached, onCacheWrite, isCurrent: () => current });
    current = false;
    finish({ views: appViewsFixture });
    expect((await pending).cacheWrite).toBeNull();
    expect(write).not.toHaveBeenCalled();
    expect(onCached).not.toHaveBeenCalled();
    expect(onCacheWrite).not.toHaveBeenCalled();
  });

  it("makes failed persistence explicit without discarding the authorized remote list", async () => {
    const cache = new MemoryNavigationCache();
    vi.spyOn(cache, "upsertAppViews").mockRejectedValue(new Error("private value"));
    const onCacheWrite = vi.fn();
    const result = await loadAppViewsWithCache({ api: { getAppViews: async () => ({ views: appViewsFixture }) }, cache, ownerKey: "owner", contractId: "contract", token: "synthetic", onCacheWrite });
    expect(result.views).toEqual(expect.arrayContaining(appViewsFixture));
    expect(await result.cacheWrite).toMatchObject({ status: "error", errorCode: "HOME_CACHE_WRITE_FAILED", count: appViewsFixture.length });
    expect(onCacheWrite).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }));
  });

  it("keeps observer failures separate from a valid cache fallback", async () => {
    const cache = new MemoryNavigationCache();
    await cache.upsertAppViews("owner", "contract", [], "2026-10-26T12:00:00Z");
    const throwingObserver = () => { throw new Error("synthetic observer failure"); };
    const result = await loadAppViewsWithCache({ api: { getAppViews: async () => { throw new OpcoNetworkError(); } }, cache,
      ownerKey: "owner", contractId: "contract", token: "synthetic", onCached: throwingObserver, onCacheRead: throwingObserver });
    expect(result).toMatchObject({ fromCache: true, offline: true, views: [] });
  });

  it("does not publish a late write completion after a scope change", async () => {
    let finish!: () => void;
    let current = true;
    const cache = new MemoryNavigationCache();
    const write = vi.spyOn(cache, "upsertAppViews").mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    const onCacheWrite = vi.fn();
    const result = await loadAppViewsWithCache({ api: { getAppViews: async () => ({ views: [] }) }, cache,
      ownerKey: "original-owner", contractId: "original-contract", token: "synthetic", isCurrent: () => current, onCacheWrite });
    current = false;
    finish();
    await result.cacheWrite;
    expect(write).toHaveBeenCalledWith("original-owner", "original-contract", [], expect.any(String));
    expect(onCacheWrite).not.toHaveBeenCalled();
  });
});

class MemoryNavigationCache implements AppNavigationCache, AppViewDefinitionCache {
  private appViews = new Map<string, { syncedAt: string; views: AppView[] }>();
  private definitions = new Map<string, CachedAppViewDefinition>();

  async clearNavigationCache() {
    this.appViews.clear();
    this.definitions.clear();
  }

  async getAppViews(ownerKey: string, contractId: string) {
    return this.appViews.get(`${ownerKey}:${contractId}`) ?? null;
  }

  async getContextSnapshot() {
    return null;
  }

  async getAppViewDefinition(ownerKey: string, contractId: string, appViewId: string) {
    return this.definitions.get(`${ownerKey}:${contractId}:${appViewId}`) ?? null;
  }

  async listAppViewDefinitions(ownerKey: string, contractId: string) {
    return [...this.definitions.values()].filter(
      (definition) => definition.ownerKey === ownerKey && definition.contractId === contractId,
    );
  }

  async reconcileAppViewDefinitions(ownerKey: string, contractId: string, assignedAppViewIds: string[]) {
    for (const [key, definition] of this.definitions) {
      if (
        definition.ownerKey === ownerKey &&
        definition.contractId === contractId &&
        !assignedAppViewIds.includes(definition.appViewId)
      ) {
        this.definitions.delete(key);
      }
    }
  }

  async upsertAppViews(ownerKey: string, contractId: string, views: AppView[], syncedAt: string) {
    this.appViews.set(`${ownerKey}:${contractId}`, { syncedAt, views });
  }

  async upsertContextSnapshot(_ownerKey: string, _me: MeResponse, _context: ContextResponse, _syncedAt: string) {
    // Not needed by these tests.
  }

  async upsertAppViewDefinition(input: UpsertAppViewDefinitionInput) {
    this.definitions.set(`${input.ownerKey}:${input.contractId}:${input.appViewId}`, {
      appViewId: input.appViewId,
      appViewType: input.appViewType,
      contractId: input.contractId,
      definition: input.definition,
      lastPreparedAt: input.lastPreparedAt,
      ownerKey: input.ownerKey,
      status: input.status,
      workflowKey: input.workflowKey ?? null,
    });
  }
}
