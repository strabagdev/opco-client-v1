export type OpfsOpeningRecoveryStatus = "idle" | "waiting" | "manual" | "reloading";
export const OPFS_RECOVERY_RELOAD_KEY = "opco.opfs.initial-recovery-reloaded";
const MAX_CHECKS = 12;
const CHECK_TIMEOUT_MS = 5_000;

/** Availability checks only. Never opens SQLite or reuses its partially initialized worker. */
export function startOpfsOpeningRecovery({
  isEligible,
  onStatus,
  reload,
}: {
  isEligible(): boolean;
  onStatus(status: OpfsOpeningRecoveryStatus): void;
  reload(): void;
}) {
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let checks = 0;
  let inFlight = false;
  function stop() {
    stopped = true;
    clearTimeout(timer);
    worker?.terminate();
  }
  function manual() {
    stop();
    if (isEligible()) onStatus("manual");
  }
  try {
    // A missing durable per-tab budget must fail closed, not allow repeated document reloads.
    if (!isEligible() || typeof window === "undefined") return stop;
    if (window.sessionStorage.getItem(OPFS_RECOVERY_RELOAD_KEY)) {
      onStatus("manual");
      return stop;
    }
    window.sessionStorage.setItem(OPFS_RECOVERY_RELOAD_KEY, "checking-storage");
    window.sessionStorage.removeItem(OPFS_RECOVERY_RELOAD_KEY);
    // Public shell asset, not a Metro worker-module import. It is precached by the existing SW.
    worker = new window.Worker("/opfs-availability-worker.js");
    worker.onerror = manual;
    worker.onmessage = ({ data }) => {
      if (stopped || !inFlight) return;
      inFlight = false;
      clearTimeout(timer);
      if (!isEligible()) { stop(); return; }
      if (data === "free") {
        stop();
        try {
          window.sessionStorage.setItem(OPFS_RECOVERY_RELOAD_KEY, "attempted");
          onStatus("reloading");
          reload();
        } catch { onStatus("manual"); }
      } else if (data === "busy" && checks < MAX_CHECKS) {
        // One non-overlapping probe, with backoff. No SQLite queue work or periodic reloads.
        timer = setTimeout(check, Math.min(2_000 * 2 ** (checks - 1), 15_000));
      } else manual();
    };
    function check() {
      if (stopped || !isEligible()) { stop(); return; }
      checks++;
      inFlight = true;
      timer = setTimeout(manual, CHECK_TIMEOUT_MS);
      try { worker!.postMessage("check"); } catch { manual(); }
    }
    onStatus("waiting");
    check();
  } catch { manual(); }
  return stop;
}

export function clearOpfsOpeningRecoveryBudget() {
  try { window.sessionStorage.removeItem(OPFS_RECOVERY_RELOAD_KEY); } catch { /* Manual retry remains available. */ }
}
