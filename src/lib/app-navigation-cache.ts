import { sortAppViews } from "./app-views";
import {
  AppView,
  ContextResponse,
  MeResponse,
  OpcoApi,
  OpcoApiError,
  OpcoNetworkError,
} from "./opco-api";

export type CachedContextSnapshot = {
  context: ContextResponse;
  me: MeResponse;
  ownerKey: string;
  syncedAt: string;
};

export type CachedAppViewsSnapshot = {
  syncedAt: string;
  views: AppView[];
};

export type AppNavigationCache = {
  clearNavigationCache(): Promise<void>;
  getAppViews(ownerKey: string, contractId: string): Promise<CachedAppViewsSnapshot | null>;
  getContextSnapshot(ownerKey: string): Promise<CachedContextSnapshot | null>;
  upsertAppViews(ownerKey: string, contractId: string, views: AppView[], syncedAt: string): Promise<void>;
  upsertContextSnapshot(ownerKey: string, me: MeResponse, context: ContextResponse, syncedAt: string): Promise<void>;
};

export type AppViewsResult = {
  fromCache: boolean;
  offline: boolean;
  syncedAt: string;
  views: AppView[];
};

export async function loadAppViewsWithCache({
  api,
  cache,
  contractId,
  now = () => new Date(),
  token,
  ownerKey,
}: {
  api: Pick<OpcoApi, "getAppViews">;
  cache: Pick<AppNavigationCache, "getAppViews" | "upsertAppViews">;
  contractId: string;
  now?: () => Date;
  ownerKey: string;
  token: string;
}): Promise<AppViewsResult> {
  try {
    const remote = await api.getAppViews(token, contractId);
    const syncedAt = now().toISOString();
    const views = sortAppViews(remote.views);

    try {
      await cache.upsertAppViews(ownerKey, contractId, views, syncedAt);
    } catch {
      // Navigation cache writes must not block online rendering.
    }

    return {
      fromCache: false,
      offline: false,
      syncedAt,
      views,
    };
  } catch (error) {
    if (!isNetworkLikeError(error)) {
      throw error;
    }

    const cached = await readCachedAppViews(cache, ownerKey, contractId);

    if (!cached) {
      throw error;
    }

    return {
      fromCache: true,
      offline: true,
      syncedAt: cached.syncedAt,
      views: sortAppViews(cached.views),
    };
  }
}

export function isNetworkLikeError(error: unknown) {
  return error instanceof OpcoNetworkError || !(error instanceof OpcoApiError);
}

async function readCachedAppViews(
  cache: Pick<AppNavigationCache, "getAppViews">,
  ownerKey: string,
  contractId: string,
) {
  try {
    return await cache.getAppViews(ownerKey, contractId);
  } catch {
    return null;
  }
}

export function buildOwnerKey(me: MeResponse, context: ContextResponse) {
  return `${context.organization.id}:${me.user.id}`;
}
