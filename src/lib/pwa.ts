export const SERVICE_WORKER_PATH = "/sw.js";
export const WEB_MANIFEST_PATH = "/manifest.json";

export function registerOfflineAppShell() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(SERVICE_WORKER_PATH).catch(() => {
      // Offline shell registration is best-effort; data cache continues to own operational persistence.
    });
  });
}
