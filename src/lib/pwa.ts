export const SERVICE_WORKER_PATH = "/sw.js?opco-shell=hardening-1a";
export const WEB_MANIFEST_PATH = "/manifest.json";

const controlledReloadStorageKey = "opco.offlineShellControlledReload";
const messageTimeoutMs = 3000;

export type OfflineShellStatus =
  | "unsupported"
  | "preparing"
  | "ready"
  | "shell-missing";

export type OfflineReadiness = OfflineShellStatus | "data-missing";

export type ShellStatusMessage = {
  missingResources: string[];
  shellCacheVersion: string | null;
  shellReady: boolean;
};

export type OfflineShellSnapshot = ShellStatusMessage & {
  activeScriptURL: string | null;
  controllerPresent: boolean;
  registrationScope: string | null;
  runningMode: "browser" | "standalone";
  serviceWorkerSupported: boolean;
};

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function resetOfflineAppShellRegistrationForTests() {
  registrationPromise = null;
}

export function registerOfflineAppShell() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }

  if (!registrationPromise) {
    registrationPromise = whenWindowLoaded()
      .then(() => navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: "/" }))
      .then(async (registration) => {
        await registration.update().catch(() => undefined);
        await waitForActiveWorker(registration);
        await ensureControllerAfterFirstInstall();
        return registration;
      })
      .catch(() => null);
  }

  return registrationPromise;
}

export async function readOfflineShellSnapshot(): Promise<OfflineShellSnapshot> {
  const runningMode = getRunningMode();

  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return {
      activeScriptURL: null,
      controllerPresent: false,
      missingResources: [],
      registrationScope: null,
      runningMode,
      serviceWorkerSupported: false,
      shellCacheVersion: null,
      shellReady: false,
    };
  }

  const registration = await registerOfflineAppShell();
  const readyRegistration = await navigator.serviceWorker.ready.catch(() => registration);
  const activeWorker = readyRegistration?.active ?? registration?.active ?? null;
  const shellStatus = activeWorker ? await requestShellStatus(activeWorker) : null;

  return {
    activeScriptURL: activeWorker?.scriptURL ?? null,
    controllerPresent: Boolean(navigator.serviceWorker.controller),
    missingResources: shellStatus?.missingResources ?? [],
    registrationScope: readyRegistration?.scope ?? registration?.scope ?? null,
    runningMode,
    serviceWorkerSupported: true,
    shellCacheVersion: shellStatus?.shellCacheVersion ?? null,
    shellReady: Boolean(shellStatus?.shellReady),
  };
}

export function getOfflineShellStatus(snapshot: OfflineShellSnapshot): OfflineShellStatus {
  if (!snapshot.serviceWorkerSupported) {
    return "unsupported";
  }

  if (!snapshot.controllerPresent) {
    return "preparing";
  }

  if (!snapshot.shellReady || snapshot.missingResources.length > 0) {
    return "shell-missing";
  }

  return "ready";
}

export function getOfflineReadiness({
  dataReady,
  shell,
}: {
  dataReady: boolean;
  shell: OfflineShellSnapshot;
}): OfflineReadiness {
  const shellStatus = getOfflineShellStatus(shell);

  if (shellStatus !== "ready") {
    return shellStatus;
  }

  return dataReady ? "ready" : "data-missing";
}

function whenWindowLoaded() {
  if (document.readyState === "complete") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    window.addEventListener("load", () => resolve(), { once: true });
  });
}

async function waitForActiveWorker(registration: ServiceWorkerRegistration) {
  if (registration.active) {
    return;
  }

  const worker = registration.installing ?? registration.waiting;

  if (!worker) {
    return;
  }

  if (worker.state === "activated") {
    return;
  }

  await Promise.race([
    new Promise<void>((resolve) => {
      worker.addEventListener(
        "statechange",
        () => {
          if (worker.state === "activated") {
            resolve();
          }
        },
        { once: false },
      );
    }),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 1500);
    }),
  ]);
}

async function ensureControllerAfterFirstInstall() {
  if (navigator.serviceWorker.controller) {
    sessionStorage.removeItem(controlledReloadStorageKey);
    return;
  }

  await Promise.race([
    new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
    }),
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, 1500);
    }),
  ]);

  if (navigator.serviceWorker.controller) {
    return;
  }

  if (sessionStorage.getItem(controlledReloadStorageKey) === "1") {
    return;
  }

  sessionStorage.setItem(controlledReloadStorageKey, "1");
  window.location.reload();
}

function requestShellStatus(worker: ServiceWorker): Promise<ShellStatusMessage | null> {
  if (typeof MessageChannel === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, messageTimeoutMs);

    channel.port1.onmessage = (event) => {
      window.clearTimeout(timeout);
      channel.port1.close();
      resolve(isShellStatusMessage(event.data) ? event.data : null);
    };

    worker.postMessage({ type: "OPCO_SHELL_STATUS" }, [channel.port2]);
  });
}

function isShellStatusMessage(value: unknown): value is ShellStatusMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as ShellStatusMessage;

  return (
    Array.isArray(candidate.missingResources) &&
    typeof candidate.shellReady === "boolean" &&
    (candidate.shellCacheVersion === null || typeof candidate.shellCacheVersion === "string")
  );
}

function getRunningMode(): OfflineShellSnapshot["runningMode"] {
  if (typeof window === "undefined") {
    return "browser";
  }

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };

  if (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    Boolean(navigatorWithStandalone.standalone)
  ) {
    return "standalone";
  }

  return "browser";
}
