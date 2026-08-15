import { describe, expect, it, vi } from "vitest";

import { createTokenStorage, TOKEN_STORAGE_KEY } from "./token-storage";

vi.mock("react-native", () => ({
  Platform: {
    OS: "ios",
  },
}));

vi.mock("expo-secure-store", () => ({
  deleteItemAsync: vi.fn(async () => undefined),
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
}));

function createSecureStore() {
  return {
    deleteItemAsync: vi.fn(async () => undefined),
    getItemAsync: vi.fn(async () => "secure-token"),
    setItemAsync: vi.fn(async () => undefined),
  };
}

function createWebStorage() {
  const values = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe("token storage", () => {
  it("uses SecureStore on native platforms", async () => {
    const secureStore = createSecureStore();
    const storage = createTokenStorage({
      platformOS: "ios",
      secureStore,
      webStorage: createWebStorage(),
    });

    await storage.setToken("native-token");
    await expect(storage.getToken()).resolves.toBe("secure-token");
    await storage.deleteToken();

    expect(secureStore.setItemAsync).toHaveBeenCalledWith(TOKEN_STORAGE_KEY, "native-token");
    expect(secureStore.getItemAsync).toHaveBeenCalledWith(TOKEN_STORAGE_KEY);
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith(TOKEN_STORAGE_KEY);
  });

  it("uses localStorage on web", async () => {
    const secureStore = createSecureStore();
    const webStorage = createWebStorage();
    const storage = createTokenStorage({
      platformOS: "web",
      secureStore,
      webStorage,
    });

    await storage.setToken("web-token");
    await expect(storage.getToken()).resolves.toBe("web-token");
    await storage.deleteToken();
    await expect(storage.getToken()).resolves.toBeNull();

    expect(webStorage.setItem).toHaveBeenCalledWith(TOKEN_STORAGE_KEY, "web-token");
    expect(webStorage.getItem).toHaveBeenCalledWith(TOKEN_STORAGE_KEY);
    expect(webStorage.removeItem).toHaveBeenCalledWith(TOKEN_STORAGE_KEY);
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("does not fail on web when localStorage is unavailable", async () => {
    const storage = createTokenStorage({
      platformOS: "web",
      secureStore: createSecureStore(),
      webStorage: null,
    });

    await expect(storage.setToken("token")).resolves.toBeUndefined();
    await expect(storage.getToken()).resolves.toBeNull();
    await expect(storage.deleteToken()).resolves.toBeUndefined();
  });
});
