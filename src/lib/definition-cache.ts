import { EntityDefinition, OpcoApi } from "./opco-api";

export type CachedEntityDefinition = {
  definition: EntityDefinition;
  syncedAt: string;
};

export type EntityDefinitionCache = {
  getEntityDefinition(contractId: string, entityTypeId: string): Promise<CachedEntityDefinition | null>;
  upsertEntityDefinition(
    contractId: string,
    entityTypeId: string,
    definition: EntityDefinition,
    syncedAt: string,
  ): Promise<void>;
};

export type DefinitionResult = {
  definition: EntityDefinition;
  source: "network" | "cache";
  syncedAt: string;
};

type Params = {
  api: Pick<OpcoApi, "getEntityDefinition">;
  cache: EntityDefinitionCache;
  cacheTimeoutMs?: number;
  contractId: string;
  entityTypeId: string;
  now?: () => Date;
  token: string;
};

const DEFAULT_CACHE_TIMEOUT_MS = 1_500;

export async function getEntityDefinitionWithCache({
  api,
  cache,
  cacheTimeoutMs = DEFAULT_CACHE_TIMEOUT_MS,
  contractId,
  entityTypeId,
  now = () => new Date(),
  token,
}: Params): Promise<DefinitionResult> {
  try {
    const response = await api.getEntityDefinition(token, contractId, entityTypeId);
    const syncedAt = now().toISOString();

    void writeDefinitionToCache({
      cache,
      cacheTimeoutMs,
      contractId,
      definition: response.entity,
      entityTypeId,
      syncedAt,
    });

    return {
      definition: response.entity,
      source: "network",
      syncedAt,
    };
  } catch (error) {
    const cached = await readDefinitionFromCache({
      cache,
      cacheTimeoutMs,
      contractId,
      entityTypeId,
    });

    if (cached) {
      return {
        definition: cached.definition,
        source: "cache",
        syncedAt: cached.syncedAt,
      };
    }

    throw error;
  }
}

type CacheParams = {
  cache: EntityDefinitionCache;
  cacheTimeoutMs: number;
  contractId: string;
  entityTypeId: string;
};

type CacheWriteParams = CacheParams & {
  definition: EntityDefinition;
  syncedAt: string;
};

async function writeDefinitionToCache({
  cache,
  cacheTimeoutMs,
  contractId,
  definition,
  entityTypeId,
  syncedAt,
}: CacheWriteParams) {
  try {
    await withTimeout(
      cache.upsertEntityDefinition(contractId, entityTypeId, definition, syncedAt),
      cacheTimeoutMs,
      "La cache local agoto el tiempo de espera.",
    );
  } catch {
    // Definition cache writes are best-effort; remote data must render even if SQLite Web is unavailable.
  }
}

async function readDefinitionFromCache({
  cache,
  cacheTimeoutMs,
  contractId,
  entityTypeId,
}: CacheParams) {
  try {
    return await withTimeout(
      cache.getEntityDefinition(contractId, entityTypeId),
      cacheTimeoutMs,
      "La cache local agoto el tiempo de espera.",
    );
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}
