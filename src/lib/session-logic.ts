import { AppNavigationCache, CachedContextSnapshot, isNetworkLikeError } from "./app-navigation-cache";
import { OpcoApiError, MeResponse } from "./opco-api";

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
  api: { getMe(token: string): Promise<MeResponse> },
  cache?: Pick<AppNavigationCache, "getContextSnapshot">,
): Promise<RestoreSessionResult> {
  const token = await tokenStore.getAccessToken();
  const storedOwnerKey = await readStoredOwnerKey(tokenStore);

  if (!token) {
    return { status: "anonymous" };
  }

  try {
    const me = await api.getMe(token);
    const currentToken = (await tokenStore.getAccessToken()) ?? token;

    return {
      me,
      ownerKey: storedOwnerKey,
      status: "authenticated",
      token: currentToken,
    };
  } catch (error) {
    if (isConfirmedInvalidSessionError(error)) {
      await tokenStore.clearSession();
      return { status: "anonymous" };
    }

    const snapshot = isNetworkLikeError(error) && storedOwnerKey
      ? await readContextSnapshot(cache, storedOwnerKey)
      : null;

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
