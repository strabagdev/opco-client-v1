import { AppNavigationCache, CachedContextSnapshot, isNetworkLikeError } from "./app-navigation-cache";
import { OpcoApiError, OpcoAuthSessionChangedError, type OpcoApi, MeResponse } from "./opco-api";

const INVALID_SESSION_CODES = new Set([
  "REFRESH_APP_INACTIVE",
  "REFRESH_TOKEN_EXPIRED",
  "REFRESH_TOKEN_MISSING",
  "REFRESH_TOKEN_REUSED",
  "REFRESH_TOKEN_REVOKED",
  "REFRESH_USER_INACTIVE",
  "TOKEN_INVALID",
]);

export type TokenStore = {
  clearSession(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  getSessionOwnerKey?(): Promise<string | null>;
  setSessionOwnerKey?(ownerKey: string): Promise<void>;
};

export type RestoreSessionResult =
  | {
      status: "anonymous";
    }
  | {
      status: "authenticated";
      token: string;
      me: MeResponse;
      ownerKey?: string | null;
    }
  | {
      status: "offline";
      token: string;
      snapshot?: CachedContextSnapshot;
    };

export async function restoreSession(
  tokenStore: TokenStore,
  api: Pick<OpcoApi, "getMe"> & Partial<Pick<OpcoApi, "getAuthSessionGeneration" | "commitAuthSession">>,
  cache?: Pick<AppNavigationCache, "getContextSnapshot">,
): Promise<RestoreSessionResult> {
  const generation = api.getAuthSessionGeneration?.();
  const assertCurrent = () => {
    if (generation !== undefined && api.getAuthSessionGeneration?.() !== generation) throw new OpcoAuthSessionChangedError();
  };
  const token = await tokenStore.getAccessToken();
  const storedOwnerKey = await readStoredOwnerKey(tokenStore);

  assertCurrent();
  if (!token) {
    return { status: "anonymous" };
  }

  try {
    const me = await api.getMe(token);
    assertCurrent();
    const currentToken = (await tokenStore.getAccessToken()) ?? token;

    return {
      me,
      ownerKey: storedOwnerKey,
      status: "authenticated",
      token: currentToken,
    };
  } catch (error) {
    assertCurrent();
    if (isConfirmedInvalidSessionError(error)) {
      if (api.commitAuthSession && generation !== undefined) await api.commitAuthSession(generation, () => tokenStore.clearSession());
      else await tokenStore.clearSession();
      return { status: "anonymous" };
    }

    const snapshot = isNetworkLikeError(error) && storedOwnerKey
      ? await readContextSnapshot(cache, storedOwnerKey)
      : null;

    assertCurrent();
    return {
      ...(snapshot ? { snapshot } : {}),
      status: "offline",
      token,
    };
  }
}

function isConfirmedInvalidSessionError(error: unknown) {
  return error instanceof OpcoApiError &&
    error.status === 401 &&
    INVALID_SESSION_CODES.has(error.code);
}

async function readContextSnapshot(cache: Pick<AppNavigationCache, "getContextSnapshot"> | undefined, ownerKey: string) {
  try {
    return (await cache?.getContextSnapshot(ownerKey)) ?? null;
  } catch {
    return null;
  }
}

async function readStoredOwnerKey(tokenStore: TokenStore) {
  try {
    return await tokenStore.getSessionOwnerKey?.() ?? null;
  } catch {
    return null;
  }
}
