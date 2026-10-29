export type HomeOfflineAvailabilityRefreshSubscription = (listener: () => void) => () => void;

/** One local read at a time; a burst during that read leaves one trailing read. */
export function createHomeOfflineAvailabilityRefresh(refresh: (canUpdate: () => boolean) => void | Promise<void>) {
  let active = true;
  let pending = false;
  let generation = 0;
  let running: Promise<void> | null = null;
  return {
    request(): Promise<void> {
      if (!active) return Promise.resolve();
      pending = true;
      generation += 1;
      if (!running) {
        running = Promise.resolve().then(async () => {
          try {
            while (active && pending) {
              pending = false;
              const currentGeneration = generation;
              try { await refresh(() => active && generation === currentGeneration); } catch { /* A later invalidation can retry; never spin on an error. */ }
            }
          } finally {
            running = null;
          }
        });
      }
      return running;
    },
    dispose() { active = false; pending = false; },
  };
}

export function subscribeHomeOfflineAvailabilityRefresh({ refresh, subscribe }: {
  refresh: (canUpdate: () => boolean) => void | Promise<void>;
  subscribe: HomeOfflineAvailabilityRefreshSubscription;
}) {
  const coordinator = createHomeOfflineAvailabilityRefresh(refresh);
  const unsubscribe = subscribe(() => { void coordinator.request(); });
  return () => { coordinator.dispose(); unsubscribe(); };
}
