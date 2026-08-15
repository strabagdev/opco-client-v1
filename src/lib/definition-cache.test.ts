import { describe, expect, it, vi } from "vitest";

import { getEntityDefinitionWithCache, EntityDefinitionCache } from "./definition-cache";
import { entityDefinitionFixture } from "../test/fixtures";

function createMemoryCache(): EntityDefinitionCache {
  const rows = new Map<string, { definition: typeof entityDefinitionFixture; syncedAt: string }>();

  return {
    async getEntityDefinition(contractId, entityTypeId) {
      return rows.get(`${contractId}:${entityTypeId}`) ?? null;
    },
    async upsertEntityDefinition(contractId, entityTypeId, definition, syncedAt) {
      rows.set(`${contractId}:${entityTypeId}`, { definition, syncedAt });
    },
  };
}

describe("getEntityDefinitionWithCache", () => {
  it("returns API definitions and persists them in cache", async () => {
    const cache = createMemoryCache();
    const syncedAt = new Date("2026-08-14T10:00:00.000Z");

    const result = await getEntityDefinitionWithCache({
      api: {
        getEntityDefinition: vi.fn(async () => ({ entity: entityDefinitionFixture })),
      },
      cache,
      contractId: "contract_1",
      entityTypeId: "entity_1",
      now: () => syncedAt,
      token: "token_123",
    });

    expect(result).toEqual({
      definition: entityDefinitionFixture,
      source: "network",
      syncedAt: syncedAt.toISOString(),
    });
    expect(await cache.getEntityDefinition("contract_1", "entity_1")).toEqual({
      definition: entityDefinitionFixture,
      syncedAt: syncedAt.toISOString(),
    });
  });

  it("returns API definitions when cache writes fail", async () => {
    const syncedAt = new Date("2026-08-14T10:00:00.000Z");

    const result = await getEntityDefinitionWithCache({
      api: {
        getEntityDefinition: vi.fn(async () => ({ entity: entityDefinitionFixture })),
      },
      cache: {
        async getEntityDefinition() {
          return null;
        },
        async upsertEntityDefinition() {
          throw new Error("sqlite");
        },
      },
      contractId: "contract_1",
      entityTypeId: "entity_1",
      now: () => syncedAt,
      token: "token_123",
    });

    expect(result).toEqual({
      definition: entityDefinitionFixture,
      source: "network",
      syncedAt: syncedAt.toISOString(),
    });
  });

  it("falls back to cache when the API fails", async () => {
    const cache = createMemoryCache();

    await cache.upsertEntityDefinition(
      "contract_1",
      "entity_1",
      entityDefinitionFixture,
      "2026-08-14T10:00:00.000Z",
    );

    const result = await getEntityDefinitionWithCache({
      api: {
        getEntityDefinition: vi.fn(async () => {
          throw new Error("network");
        }),
      },
      cache,
      contractId: "contract_1",
      entityTypeId: "entity_1",
      token: "token_123",
    });

    expect(result).toEqual({
      definition: entityDefinitionFixture,
      source: "cache",
      syncedAt: "2026-08-14T10:00:00.000Z",
    });
  });

  it("throws the API error when API and cache both fail", async () => {
    const apiError = new Error("network");

    await expect(
      getEntityDefinitionWithCache({
        api: {
          getEntityDefinition: vi.fn(async () => {
            throw apiError;
          }),
        },
        cache: {
          async getEntityDefinition() {
            throw new Error("sqlite");
          },
          async upsertEntityDefinition() {},
        },
        contractId: "contract_1",
        entityTypeId: "entity_1",
        token: "token_123",
      }),
    ).rejects.toThrow(apiError);
  });

  it("does not wait indefinitely for a hanging cache write after API success", async () => {
    const result = await Promise.race([
      getEntityDefinitionWithCache({
        api: {
          getEntityDefinition: vi.fn(async () => ({ entity: entityDefinitionFixture })),
        },
        cache: {
          async getEntityDefinition() {
            return null;
          },
          upsertEntityDefinition() {
            return new Promise<void>(() => {});
          },
        },
        cacheTimeoutMs: 5,
        contractId: "contract_1",
        entityTypeId: "entity_1",
        token: "token_123",
      }),
      delay(50).then(() => "timed-out" as const),
    ]);

    expect(result).not.toBe("timed-out");
    expect(result).toMatchObject({
      definition: entityDefinitionFixture,
      source: "network",
    });
  });

  it("does not wait indefinitely for a hanging cache read after API failure", async () => {
    const apiError = new Error("network");

    const result = await Promise.race([
      getEntityDefinitionWithCache({
        api: {
          getEntityDefinition: vi.fn(async () => {
            throw apiError;
          }),
        },
        cache: {
          getEntityDefinition() {
            return new Promise<null>(() => {});
          },
          async upsertEntityDefinition() {},
        },
        cacheTimeoutMs: 5,
        contractId: "contract_1",
        entityTypeId: "entity_1",
        token: "token_123",
      }).catch((error: unknown) => error),
      delay(50).then(() => "timed-out" as const),
    ]);

    expect(result).not.toBe("timed-out");
    expect(result).toBe(apiError);
  });
});

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
