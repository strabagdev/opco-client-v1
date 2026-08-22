import { describe, expect, it, vi } from "vitest";

import { registerOfflineAppShell, SERVICE_WORKER_PATH, WEB_MANIFEST_PATH } from "./pwa";

describe("offline PWA app shell", () => {
  it("uses same-origin manifest and service worker paths", () => {
    expect(WEB_MANIFEST_PATH).toBe("/manifest.json");
    expect(SERVICE_WORKER_PATH).toBe("/sw.js?opco-shell=hardening-1a");
  });

  it("registers the service worker on web load", () => {
    const listeners = new Map<string, () => void>();
    const register = vi.fn(() => Promise.resolve({}));
    const previousWindow = globalThis.window;
    const previousNavigator = globalThis.navigator;

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        addEventListener: vi.fn((event: string, callback: () => void) => {
          listeners.set(event, callback);
        }),
      },
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        serviceWorker: { register },
      },
    });

    registerOfflineAppShell();
    listeners.get("load")?.();

    expect(register).toHaveBeenCalledWith("/sw.js?opco-shell=hardening-1a");

    Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: previousNavigator });
  });
});
