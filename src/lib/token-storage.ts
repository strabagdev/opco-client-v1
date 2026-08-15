import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const TOKEN_STORAGE_KEY = "opco.accessToken";

type SecureTokenStore = Pick<typeof SecureStore, "deleteItemAsync" | "getItemAsync" | "setItemAsync">;

type WebStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type TokenStorageDependencies = {
  platformOS: typeof Platform.OS;
  secureStore: SecureTokenStore;
  webStorage?: WebStorage | null;
};

export type TokenStorage = {
  deleteToken(): Promise<void>;
  getToken(): Promise<string | null>;
  setToken(token: string): Promise<void>;
};

export function createTokenStorage({
  platformOS,
  secureStore,
  webStorage,
}: TokenStorageDependencies): TokenStorage {
  if (platformOS === "web") {
    return {
      async deleteToken() {
        webStorage?.removeItem(TOKEN_STORAGE_KEY);
      },
      async getToken() {
        return webStorage?.getItem(TOKEN_STORAGE_KEY) ?? null;
      },
      async setToken(token: string) {
        webStorage?.setItem(TOKEN_STORAGE_KEY, token);
      },
    };
  }

  return {
    deleteToken() {
      return secureStore.deleteItemAsync(TOKEN_STORAGE_KEY);
    },
    getToken() {
      return secureStore.getItemAsync(TOKEN_STORAGE_KEY);
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

export function setToken(token: string) {
  return tokenStorage.setToken(token);
}

export function deleteToken() {
  return tokenStorage.deleteToken();
}

function getBrowserStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage ?? null;
}
