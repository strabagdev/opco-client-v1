import { describe, expect, it } from "vitest";

import { appViewsFixture } from "../test/fixtures";
import { AppNavigationCache, loadAppViewsWithCache } from "./app-navigation-cache";
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

  it("surfaces the network error when AppViews cache is missing", async () => {
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
    ).rejects.toBeInstanceOf(OpcoNetworkError);
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
    ).rejects.toBeInstanceOf(OpcoNetworkError);
  });
});

class MemoryNavigationCache implements AppNavigationCache {
  private appViews = new Map<string, { syncedAt: string; views: AppView[] }>();

  async clearNavigationCache() {
    this.appViews.clear();
  }

  async getAppViews(ownerKey: string, contractId: string) {
    return this.appViews.get(`${ownerKey}:${contractId}`) ?? null;
  }

  async getContextSnapshot() {
    return null;
  }

  async upsertAppViews(ownerKey: string, contractId: string, views: AppView[], syncedAt: string) {
    this.appViews.set(`${ownerKey}:${contractId}`, { syncedAt, views });
  }

  async upsertContextSnapshot(_ownerKey: string, _me: MeResponse, _context: ContextResponse, _syncedAt: string) {
    // Not needed by these tests.
  }
}
