import { ConnectivityStatus } from "@/lib/connectivity";
import { StateUpdateSyncTrigger } from "@/lib/state-update-offline";

export type ReconnectSyncController = {
  dispose(): void;
  handleConnectivityStatus(status: ConnectivityStatus): void;
};

type TimerId = ReturnType<typeof setTimeout>;

type ReconnectSyncControllerOptions = {
  debounceMs?: number;
  onSynced?: () => void;
  runSync(input: {
    previousConnectivityStatus: ConnectivityStatus;
    resultingConnectivityStatus: ConnectivityStatus;
    trigger: StateUpdateSyncTrigger;
  }): Promise<void>;
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

  async function runOnce(input: {
    previousConnectivityStatus: ConnectivityStatus;
    resultingConnectivityStatus: ConnectivityStatus;
    trigger: StateUpdateSyncTrigger;
  }) {
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
      await runSync(input);
      onSynced?.();
    } catch {
      // The sync engine owns failure state. A later offline -> online transition should retry.
    } finally {
      isSyncing = false;
    }
  }

  function schedule(input: {
    previousConnectivityStatus: ConnectivityStatus;
    resultingConnectivityStatus: ConnectivityStatus;
    trigger: StateUpdateSyncTrigger;
  }) {
    clearPendingTimer();
    timer = setTimer(() => {
      void runOnce(input);
    }, debounceMs);
  }

  return {
    dispose() {
      clearPendingTimer();
    },
    handleConnectivityStatus(status) {
      const priorStatus = previousStatus;
      const wasOffline = previousStatus === "offline";
      const wasUnknown = previousStatus === "unknown";

      previousStatus = status;

      if (status !== "online") {
        clearPendingTimer();
        return;
      }

      if (wasOffline || wasUnknown) {
        schedule({
          previousConnectivityStatus: priorStatus,
          resultingConnectivityStatus: status,
          trigger: wasOffline ? "reconnect" : "unknown-to-online",
        });
      }
    },
  };
}
