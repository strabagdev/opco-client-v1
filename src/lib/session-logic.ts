import { AppNavigationCache, CachedContextSnapshot, isNetworkLikeError } from "./app-navigation-cache";
import { OpcoApiError, MeResponse } from "./opco-api";

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
    if (error instanceof OpcoApiError && error.status === 401) {
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
