import { sortAppViews } from "./app-views";
import { beginHomeNavigation, recordHomeNavigation } from "./home-navigation-diagnostics";
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
  cacheWrite: Promise<AppViewsCacheWrite> | null;
};

export type AppViewsCacheRead =
  | { status: "valid"; snapshot: CachedAppViewsSnapshot }
  | { status: "absent" }
  | { status: "error"; errorCode: "HOME_CACHE_READ_FAILED" };
export type AppViewsCacheWrite = {
  scope: { ownerKey: string; contractId: string; appViewIds: string[] };
  status: "persisted" | "error";
  count: number;
  syncedAt: string;
  requestId: string;
  errorCode: "HOME_CACHE_WRITE_FAILED" | null;
};

export class AppViewsUnavailableError extends Error {
  readonly code: string;
  constructor(public readonly cacheRead: Exclude<AppViewsCacheRead, { status: "valid" }>, public readonly remoteCause: unknown) {
    super(cacheRead.status === "error"
      ? "No se pudo leer la lista de experiencias guardada en este dispositivo. Conéctate y reintenta cargar Inicio."
      : "No hay una lista de experiencias guardada para este usuario y contrato. Conéctate para cargar Inicio.");
    this.name = "AppViewsUnavailableError";
    this.code = cacheRead.status === "error" ? cacheRead.errorCode : "HOME_CACHE_ABSENT";
  }
}

function notify<T>(observer: ((value: T) => void) | undefined, value: T) {
  try { observer?.(value); } catch { /* Presentation/diagnostics never invalidate a valid cache result. */ }
}

export async function persistAppViews({ cache, ownerKey, contractId, views, syncedAt, scope = beginHomeNavigation(ownerKey, contractId) }: {
  cache: Pick<AppNavigationCache, "upsertAppViews">; ownerKey: string; contractId: string; views: AppView[]; syncedAt: string;
  scope?: ReturnType<typeof beginHomeNavigation>;
}): Promise<AppViewsCacheWrite> {
  let status: AppViewsCacheWrite["status"] = "persisted";
  try { await cache.upsertAppViews(ownerKey, contractId, views, syncedAt); } catch { status = "error"; }
  const result: AppViewsCacheWrite = { scope: { ownerKey, contractId, appViewIds: views.map(view => view.id) }, status, count: views.length, syncedAt, requestId: scope.requestId, errorCode: status === "error" ? "HOME_CACHE_WRITE_FAILED" : null };
  recordHomeNavigation(scope, { phase: "cache_write", result: status, count: result.count, syncedAt, errorCode: result.errorCode });
  return result;
}

export async function loadAppViewsWithCache({
  api,
  cache,
  contractId,
  now = () => new Date(),
  onCached,
  onCacheRead,
  onCacheWrite,
  isCurrent = () => true,
  token,
  ownerKey,
}: {
  api: Pick<OpcoApi, "getAppViews">;
  cache: Pick<AppNavigationCache, "getAppViews" | "upsertAppViews">;
  contractId: string;
  now?: () => Date;
  onCached?: (snapshot: CachedAppViewsSnapshot) => void;
  onCacheRead?: (result: AppViewsCacheRead) => void;
  onCacheWrite?: (result: AppViewsCacheWrite) => void;
  isCurrent?: () => boolean;
  ownerKey: string;
  token: string;
}): Promise<AppViewsResult> {
  const scope = beginHomeNavigation(ownerKey, contractId);
  recordHomeNavigation(scope, { phase: "remote", result: "started", count: null, syncedAt: null, errorCode: null });
  let remoteSettled = false;
  const cachedPromise = readCachedAppViews(cache, ownerKey, contractId).then(result => {
    recordHomeNavigation(scope, { phase: "cache_read", result: result.status,
      count: result.status === "valid" ? result.snapshot.views.length : null,
      syncedAt: result.status === "valid" ? result.snapshot.syncedAt : null,
      errorCode: result.status === "error" ? result.errorCode : null });
    if (!remoteSettled && isCurrent()) {
      notify(onCacheRead, result);
      if (result.status === "valid") notify(onCached, result.snapshot);
    }
    return result;
  });
  let remote;
  try {
    remote = await api.getAppViews(token, contractId, { diagnosticRequestId: scope.requestId });
  } catch (error) {
    if (!isNetworkLikeError(error)) {
      remoteSettled = true;
      throw error;
    }

    const cached = await cachedPromise;
    remoteSettled = true;
    if (cached.status !== "valid") throw new AppViewsUnavailableError(cached, error);

    return {
      fromCache: true,
      offline: true,
      syncedAt: cached.snapshot.syncedAt,
      views: cached.snapshot.views,
      cacheWrite: null,
    };
  }
  remoteSettled = true;
  const syncedAt = now().toISOString();
  const views = sortAppViews(remote.views);
  if (!isCurrent()) return { fromCache: false, offline: false, syncedAt, views, cacheWrite: null };
  const cacheWrite = persistAppViews({ cache, ownerKey, contractId, views, syncedAt, scope });
  // Render remote data immediately, but expose persistence as a preparation prerequisite.
  if (onCacheWrite) void cacheWrite.then(result => { if (isCurrent()) notify(onCacheWrite, result); });
  return { fromCache: false, offline: false, syncedAt, views, cacheWrite };
}

export function isNetworkLikeError(error: unknown) {
  return error instanceof OpcoNetworkError || !(error instanceof OpcoApiError);
}

export async function readCachedAppViews(
  cache: Pick<AppNavigationCache, "getAppViews">,
  ownerKey: string,
  contractId: string,
): Promise<AppViewsCacheRead> {
  try {
    const snapshot = await cache.getAppViews(ownerKey, contractId);
    if (!snapshot) return { status: "absent" };
    if (!Array.isArray(snapshot.views) || typeof snapshot.syncedAt !== "string" || !Number.isFinite(Date.parse(snapshot.syncedAt)) ||
      snapshot.views.some(view => !view || typeof view.id !== "string" || typeof view.name !== "string" || typeof view.type !== "string" || !view.config || typeof view.config !== "object")) {
      throw new Error("invalid navigation cache");
    }
    return { status: "valid", snapshot: { ...snapshot, views: sortAppViews(snapshot.views) } };
  } catch {
    return { status: "error", errorCode: "HOME_CACHE_READ_FAILED" };
  }
}

export function buildOwnerKey(me: MeResponse, context: ContextResponse) {
  return `${context.organization.id}:${me.user.id}`;
}
