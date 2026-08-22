import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const TOKEN_STORAGE_KEY = "opco.accessToken";
export const REFRESH_TOKEN_STORAGE_KEY = "opco.refreshToken";
export const SESSION_OWNER_KEY_STORAGE_KEY = "opco.sessionOwnerKey";

type SecureTokenStore = Pick<typeof SecureStore, "deleteItemAsync" | "getItemAsync" | "setItemAsync">;

type WebStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type TokenStorageDependencies = {
  platformOS: typeof Platform.OS;
  secureStore: SecureTokenStore;
  webStorage?: WebStorage | null;
};

export type TokenStorage = {
  clearSession(): Promise<void>;
  deleteAccessToken(): Promise<void>;
  deleteToken(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  getSessionOwnerKey(): Promise<string | null>;
  getToken(): Promise<string | null>;
  setAccessToken(token: string): Promise<void>;
  setRefreshToken(token: string): Promise<void>;
  setSession(tokens: { accessToken: string; refreshToken?: string | null }): Promise<void>;
  setSessionOwnerKey(ownerKey: string): Promise<void>;
  setToken(token: string): Promise<void>;
};

export function createTokenStorage({
  platformOS,
  secureStore,
  webStorage,
}: TokenStorageDependencies): TokenStorage {
  if (platformOS === "web") {
    return {
      async clearSession() {
        webStorage?.removeItem(TOKEN_STORAGE_KEY);
        webStorage?.removeItem(SESSION_OWNER_KEY_STORAGE_KEY);
      },
      async deleteAccessToken() {
        webStorage?.removeItem(TOKEN_STORAGE_KEY);
      },
      async deleteToken() {
        webStorage?.removeItem(TOKEN_STORAGE_KEY);
      },
      async getAccessToken() {
        return webStorage?.getItem(TOKEN_STORAGE_KEY) ?? null;
      },
      async getRefreshToken() {
        return null;
      },
      async getSessionOwnerKey() {
        return webStorage?.getItem(SESSION_OWNER_KEY_STORAGE_KEY) ?? null;
      },
      async getToken() {
        return webStorage?.getItem(TOKEN_STORAGE_KEY) ?? null;
      },
      async setAccessToken(token: string) {
        webStorage?.setItem(TOKEN_STORAGE_KEY, token);
      },
      async setRefreshToken() {
        // Web refresh tokens are intentionally held only in the HttpOnly cookie.
      },
      async setSession({ accessToken }) {
        webStorage?.setItem(TOKEN_STORAGE_KEY, accessToken);
      },
      async setSessionOwnerKey(ownerKey: string) {
        webStorage?.setItem(SESSION_OWNER_KEY_STORAGE_KEY, ownerKey);
      },
      async setToken(token: string) {
        webStorage?.setItem(TOKEN_STORAGE_KEY, token);
      },
    };
  }

  return {
    async clearSession() {
      await Promise.all([
        secureStore.deleteItemAsync(TOKEN_STORAGE_KEY),
        secureStore.deleteItemAsync(REFRESH_TOKEN_STORAGE_KEY),
        secureStore.deleteItemAsync(SESSION_OWNER_KEY_STORAGE_KEY),
      ]);
    },
    deleteAccessToken() {
      return secureStore.deleteItemAsync(TOKEN_STORAGE_KEY);
    },
    deleteToken() {
      return secureStore.deleteItemAsync(TOKEN_STORAGE_KEY);
    },
    getAccessToken() {
      return secureStore.getItemAsync(TOKEN_STORAGE_KEY);
    },
    getRefreshToken() {
      return secureStore.getItemAsync(REFRESH_TOKEN_STORAGE_KEY);
    },
    getSessionOwnerKey() {
      return secureStore.getItemAsync(SESSION_OWNER_KEY_STORAGE_KEY);
    },
    getToken() {
      return secureStore.getItemAsync(TOKEN_STORAGE_KEY);
    },
    setAccessToken(token: string) {
      return secureStore.setItemAsync(TOKEN_STORAGE_KEY, token);
    },
    setRefreshToken(token: string) {
      return secureStore.setItemAsync(REFRESH_TOKEN_STORAGE_KEY, token);
    },
    async setSession({ accessToken, refreshToken }) {
      await secureStore.setItemAsync(TOKEN_STORAGE_KEY, accessToken);

      if (refreshToken) {
        await secureStore.setItemAsync(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
      }
    },
    setSessionOwnerKey(ownerKey: string) {
      return secureStore.setItemAsync(SESSION_OWNER_KEY_STORAGE_KEY, ownerKey);
    },
    setToken(token: string) {
      return secureStore.setItemAsync(TOKEN_STORAGE_KEY, token);
    },
  };
}

const tokenStorage = createTokenStorage({
  platformOS: Platform.OS,
  secureStore: SecureStore,
  webStorage: getBrowserStorage(),
});

export function getToken() {
  return tokenStorage.getToken();
}

export function getAccessToken() {
  return tokenStorage.getAccessToken();
}

export function getRefreshToken() {
  return tokenStorage.getRefreshToken();
}

export function getSessionOwnerKey() {
  return tokenStorage.getSessionOwnerKey();
}

export function setToken(token: string) {
  return tokenStorage.setToken(token);
}

export function setAccessToken(token: string) {
  return tokenStorage.setAccessToken(token);
}

export function setRefreshToken(token: string) {
  return tokenStorage.setRefreshToken(token);
}

export function setSessionOwnerKey(ownerKey: string) {
  return tokenStorage.setSessionOwnerKey(ownerKey);
}

export function setSession(tokens: { accessToken: string; refreshToken?: string | null }) {
  return tokenStorage.setSession(tokens);
}

export function deleteToken() {
  return tokenStorage.deleteToken();
}

export function deleteAccessToken() {
  return tokenStorage.deleteAccessToken();
}

export function clearSession() {
  return tokenStorage.clearSession();
}

function getBrowserStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage ?? null;
}
