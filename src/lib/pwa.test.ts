import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getOfflineReadiness,
  getOfflineShellStatus,
  OfflineShellSnapshot,
  readOfflineShellSnapshot,
  registerOfflineAppShell,
  resetOfflineAppShellRegistrationForTests,
  SERVICE_WORKER_PATH,
  WEB_MANIFEST_PATH,
} from "./pwa";

const previousDocument = globalThis.document;
const previousLocation = globalThis.location;
const previousMessageChannel = globalThis.MessageChannel;
const previousNavigator = globalThis.navigator;
const previousSessionStorage = globalThis.sessionStorage;
const previousWindow = globalThis.window;

describe("offline PWA app shell", () => {
  afterEach(() => {
    resetOfflineAppShellRegistrationForTests();
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    Object.defineProperty(globalThis, "location", { configurable: true, value: previousLocation });
    Object.defineProperty(globalThis, "MessageChannel", { configurable: true, value: previousMessageChannel });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: previousNavigator });
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: previousSessionStorage });
    Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
    vi.restoreAllMocks();
  });

  it("uses same-origin manifest and service worker paths", () => {
    expect(WEB_MANIFEST_PATH).toBe("/manifest.json");
    expect(SERVICE_WORKER_PATH).toBe("/sw.js?opco-shell=hardening-1a");
  });

  it("registers the service worker at root scope", async () => {
    const register = vi.fn(() => Promise.resolve({ active: {}, scope: "https://client.opco.cl/" }));
    mockBrowser({
      controller: {},
      register,
      ready: Promise.resolve({ active: {}, scope: "https://client.opco.cl/" }),
    });

    await registerOfflineAppShell();

    expect(register).toHaveBeenCalledWith("/sw.js?opco-shell=hardening-1a", { scope: "/" });
  });

  it("does not treat register resolution without a controller as ready", async () => {
    mockBrowser({
      controller: null,
      register: vi.fn(() => Promise.resolve({ active: createStatusWorker(), scope: "https://client.opco.cl/" })),
      ready: Promise.resolve({ active: createStatusWorker(), scope: "https://client.opco.cl/" }),
    });

    const snapshot = await readOfflineShellSnapshot();

    expect(snapshot.shellReady).toBe(true);
    expect(snapshot.controllerPresent).toBe(false);
    expect(getOfflineShellStatus(snapshot)).toBe("preparing");
  });

  it("reports shell-missing when the worker has missing precache resources", () => {
    expect(getOfflineShellStatus(snapshot({ controllerPresent: true, missingResources: ["/index.html"] }))).toBe(
      "shell-missing",
    );
  });

  it("reports ready only when shell and operational data are ready", () => {
    const shell = snapshot({ controllerPresent: true, shellReady: true });

    expect(getOfflineReadiness({ dataReady: false, shell })).toBe("data-missing");
    expect(getOfflineReadiness({ dataReady: true, shell })).toBe("ready");
  });
});

function mockBrowser({
  controller,
  ready,
  register,
}: {
  controller: unknown;
  ready: Promise<unknown>;
  register: ReturnType<typeof vi.fn>;
}) {
  const storage = new Map<string, string>();
  const reload = vi.fn();

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { readyState: "complete" },
  });
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { reload },
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      clearTimeout: vi.fn(),
      location: { reload },
      matchMedia: vi.fn(() => ({ matches: false })),
      setTimeout: vi.fn(() => 1),
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      serviceWorker: {
        addEventListener: vi.fn((_event: string, callback: () => void) => callback()),
        controller,
        ready,
        register,
        removeEventListener: vi.fn(),
      },
    },
  });
  Object.defineProperty(globalThis, "MessageChannel", {
    configurable: true,
    value: TestMessageChannel,
  });
}

function createStatusWorker() {
  return {
    postMessage(_message: unknown, ports: MessagePort[]) {
      ports[0]?.postMessage({
        missingResources: [],
        shellCacheVersion: "opco-shell-test",
        shellReady: true,
      });
    },
    scriptURL: "https://client.opco.cl/sw.js?opco-shell=hardening-1a",
  };
}

class TestMessageChannel {
  port1: MessagePort;
  port2: MessagePort;

  constructor() {
    const port1 = {
      close: vi.fn(),
      onmessage: null as ((event: { data: unknown }) => void) | null,
    };
    const port2 = {
      postMessage: (data: unknown) => {
        port1.onmessage?.({ data });
      },
    };

    this.port1 = port1 as unknown as MessagePort;
    this.port2 = port2 as unknown as MessagePort;
  }
}

function snapshot(overrides: Partial<OfflineShellSnapshot>): OfflineShellSnapshot {
  return {
    activeScriptURL: "https://client.opco.cl/sw.js?opco-shell=hardening-1a",
    controllerPresent: false,
    missingResources: [],
    registrationScope: "https://client.opco.cl/",
    runningMode: "standalone",
    serviceWorkerSupported: true,
    shellCacheVersion: "opco-shell-test",
    shellReady: false,
    ...overrides,
  };
}
