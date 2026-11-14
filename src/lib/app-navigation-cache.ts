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

type ViewsReadFlight = {
  scope: ReturnType<typeof beginHomeNavigation>;
  cached: Promise<AppViewsCacheRead>;
  remote: Promise<Awaited<ReturnType<OpcoApi["getAppViews"]>>>;
  cacheWrite?: Promise<AppViewsCacheWrite>;
  snapshot?: CachedAppViewsSnapshot;
};
const viewsReadFlights = new WeakMap<object, WeakMap<object, Map<string, ViewsReadFlight>>>();
const latestViewsReads = new WeakMap<object, Map<string, ViewsReadFlight>>();

declare const readEventBrand: unique symbol;
/** Opaque, memory-only handoff for consumers of one validated lifecycle event. */
export type AppViewsReadEvent = { readonly [readEventBrand]: true };
type ViewsReadScope = {
  api: Pick<OpcoApi, "getAppViews">;
  cache: Pick<AppNavigationCache, "getAppViews" | "upsertAppViews">;
  ownerKey: string; contractId: string; token: string; authorizationScope: string | null;
};
const viewsReadEvents = new WeakMap<AppViewsReadEvent, ViewsReadScope & { invalidationKey: string; flight?: ViewsReadFlight }>();

export function appViewsAuthorizationScope(me: MeResponse | null, context: ContextResponse | null): string | null {
  if (!me || !context) return null;
  return JSON.stringify([me.app.id, me.user.id, context], (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
}

export function createAppViewsReadEvent(input: ViewsReadScope & { invalidationKey: string }): AppViewsReadEvent {
  const event = Object.freeze({}) as AppViewsReadEvent;
  viewsReadEvents.set(event, { ...input });
  return event;
}

function readForEvent(event: AppViewsReadEvent | null | undefined, input: ViewsReadScope): ViewsReadFlight | null {
  const state = event && viewsReadEvents.get(event);
  if (!state || !input.authorizationScope || state.authorizationScope !== input.authorizationScope ||
    state.api !== input.api || state.cache !== input.cache || state.ownerKey !== input.ownerKey ||
    state.contractId !== input.contractId || state.token !== input.token) return null;
  if (state.flight && latestViewsReads.get(input.cache)?.get(JSON.stringify([input.ownerKey, input.contractId])) !== state.flight) return null;
  // Retain a completed read only through this event handle, never as a time-based cache.
  return state.flight ??= acquireViewsRead(input.api, input.cache, input.ownerKey, input.contractId, input.token, state.invalidationKey);
}

/** Share only in-flight reads. A reconnect uses its own generation; completed reads are never memoized. */
function acquireViewsRead(api: Pick<OpcoApi, "getAppViews">, cache: Pick<AppNavigationCache, "getAppViews" | "upsertAppViews">,
  ownerKey: string, contractId: string, token: string, invalidationKey?: string): ViewsReadFlight {
  let byApi = viewsReadFlights.get(cache);
  if (!byApi) { byApi = new WeakMap(); viewsReadFlights.set(cache, byApi); }
  let flights = byApi.get(api);
  if (!flights) { flights = new Map(); byApi.set(api, flights); }
  const key = JSON.stringify([ownerKey, contractId, token, invalidationKey ?? null]);
  const previous = flights.get(key);
  if (previous) return previous;
  const scope = beginHomeNavigation(ownerKey, contractId);
  recordHomeNavigation(scope, { phase: "remote", result: "started", count: null, syncedAt: null, errorCode: null });
  const cached = readCachedAppViews(cache, ownerKey, contractId).then(result => {
    recordHomeNavigation(scope, { phase: "cache_read", result: result.status,
      count: result.status === "valid" ? result.snapshot.views.length : null,
      syncedAt: result.status === "valid" ? result.snapshot.syncedAt : null,
      errorCode: result.status === "error" ? result.errorCode : null });
    return result;
  });
  const scopeFlights = flights;
  let remote: ViewsReadFlight["remote"];
  try { remote = api.getAppViews(token, contractId, { diagnosticRequestId: scope.requestId }); }
  catch (error) { remote = Promise.reject(error); }
  const flight: ViewsReadFlight = { scope, cached, remote };
  flights.set(key, flight);
  let latest = latestViewsReads.get(cache);
  if (!latest) { latest = new Map(); latestViewsReads.set(cache, latest); }
  latest.set(JSON.stringify([ownerKey, contractId]), flight);
  const release = () => { if (scopeFlights.get(key) === flight) scopeFlights.delete(key); };
  void flight.remote.then(release, release);
  return flight;
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
  invalidationKey,
  readEvent,
  authorizationScope = null,
}: {
  api: Pick<OpcoApi, "getAppViews">;
  cache: Pick<AppNavigationCache, "getAppViews" | "upsertAppViews">;
  contractId: string;
  now?: () => Date;
  invalidationKey?: string;
  readEvent?: AppViewsReadEvent | null;
  authorizationScope?: string | null;
  onCached?: (snapshot: CachedAppViewsSnapshot) => void;
  onCacheRead?: (result: AppViewsCacheRead) => void;
  onCacheWrite?: (result: AppViewsCacheWrite) => void;
  isCurrent?: () => boolean;
  ownerKey: string;
  token: string;
}): Promise<AppViewsResult> {
  const flight = readForEvent(readEvent, { api, cache, ownerKey, contractId, token, authorizationScope }) ??
    acquireViewsRead(api, cache, ownerKey, contractId, token, invalidationKey);
  const scope = flight.scope;
  // A validated handoff must not briefly republish its earlier cached assignment list.
  let remoteSettled = Boolean(flight.snapshot);
  const cachedPromise = flight.cached.then(result => {
    if (!remoteSettled && isCurrent()) {
      notify(onCacheRead, result);
      if (result.status === "valid") notify(onCached, result.snapshot);
    }
    return result;
  });
  let remote;
  try {
    remote = await flight.remote;
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
  const { syncedAt, views } = flight.snapshot ??= { syncedAt: now().toISOString(), views: sortAppViews(remote.views) };
  if (!isCurrent()) return { fromCache: false, offline: false, syncedAt, views, cacheWrite: null };
  const cacheWrite = flight.cacheWrite ??= persistAppViews({ cache, ownerKey, contractId, views, syncedAt, scope });
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
