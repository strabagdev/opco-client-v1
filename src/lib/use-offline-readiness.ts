import { useEffect, useMemo, useState } from "react";

import {
  getOfflineReadiness,
  OfflineReadiness,
  OfflineShellSnapshot,
  readOfflineShellSnapshot,
} from "./pwa";

export type OfflineReadinessDiagnostics = OfflineShellSnapshot & {
  navigationCachePresent: boolean;
  offlineReadiness: OfflineReadiness;
  sessionSnapshotPresent: boolean;
  sqliteReady: boolean;
};

export function useOfflineReadiness({
  navigationCachePresent,
  sessionSnapshotPresent,
  sqliteReady,
}: {
  navigationCachePresent: boolean;
  sessionSnapshotPresent: boolean;
  sqliteReady: boolean;
}) {
  const [shellSnapshot, setShellSnapshot] = useState<OfflineShellSnapshot | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function refreshSnapshot() {
      const nextSnapshot = await readOfflineShellSnapshot();

      if (isMounted) {
        setShellSnapshot(nextSnapshot);
      }
    }

    void refreshSnapshot();

    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", refreshSnapshot);

      return () => {
        isMounted = false;
        navigator.serviceWorker.removeEventListener("controllerchange", refreshSnapshot);
      };
    }

    return () => {
      isMounted = false;
    };
  }, []);

  return useMemo<OfflineReadinessDiagnostics>(() => {
    const shell = shellSnapshot ?? emptyShellSnapshot();
    const dataReady = sessionSnapshotPresent && navigationCachePresent && sqliteReady;

    return {
      ...shell,
      navigationCachePresent,
      offlineReadiness: getOfflineReadiness({ dataReady, shell }),
      sessionSnapshotPresent,
      sqliteReady,
    };
  }, [navigationCachePresent, sessionSnapshotPresent, shellSnapshot, sqliteReady]);
}

function emptyShellSnapshot(): OfflineShellSnapshot {
  return {
    activeScriptURL: null,
    controllerPresent: false,
    missingResources: [],
    registrationScope: null,
    runningMode: "browser",
    serviceWorkerSupported: typeof navigator !== "undefined" && "serviceWorker" in navigator,
    shellCacheVersion: null,
    shellReady: false,
  };
}
