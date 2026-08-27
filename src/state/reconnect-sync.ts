import { ConnectivityStatus } from "@/lib/connectivity";

export type ReconnectSyncController = {
  dispose(): void;
  handleConnectivityStatus(status: ConnectivityStatus): void;
};

type TimerId = ReturnType<typeof setTimeout>;

type ReconnectSyncControllerOptions = {
  debounceMs?: number;
  onSynced?: () => void;
  runSync(): Promise<void>;
  shouldSync?: () => boolean | Promise<boolean>;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
};

const DEFAULT_RECONNECT_SYNC_DEBOUNCE_MS = 300;

export function createReconnectSyncController({
  clearTimer = clearTimeout,
  debounceMs = DEFAULT_RECONNECT_SYNC_DEBOUNCE_MS,
  onSynced,
  runSync,
  shouldSync,
  setTimer = setTimeout,
}: ReconnectSyncControllerOptions): ReconnectSyncController {
  let previousStatus: ConnectivityStatus = "unknown";
  let timer: TimerId | null = null;
  let isSyncing = false;

  function clearPendingTimer() {
    if (!timer) {
      return;
    }

    clearTimer(timer);
    timer = null;
  }

  async function runOnce() {
    timer = null;

    if (isSyncing) {
      return;
    }

    if (shouldSync) {
      try {
        if (!(await shouldSync())) {
          return;
        }
      } catch {
        return;
      }
    }

    isSyncing = true;

    try {
      await runSync();
      onSynced?.();
    } catch {
      // The sync engine owns failure state. A later offline -> online transition should retry.
    } finally {
      isSyncing = false;
    }
  }

  function schedule() {
    clearPendingTimer();
    timer = setTimer(() => {
      void runOnce();
    }, debounceMs);
  }

  return {
    dispose() {
      clearPendingTimer();
    },
    handleConnectivityStatus(status) {
      const wasOffline = previousStatus === "offline";
      const wasUnknown = previousStatus === "unknown";

      previousStatus = status;

      if (status !== "online") {
        clearPendingTimer();
        return;
      }

      if (wasOffline || wasUnknown) {
        schedule();
      }
    },
  };
}
