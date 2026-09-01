export type HomeOfflineAvailabilityRefreshSubscription = (listener: () => void) => () => void;

export function subscribeHomeOfflineAvailabilityRefresh({
  refresh,
  subscribe,
}: {
  refresh: (canUpdate: () => boolean) => void | Promise<void>;
  subscribe: HomeOfflineAvailabilityRefreshSubscription;
}) {
  let active = true;
  let scheduled = false;

  const scheduleRefresh = () => {
    if (scheduled) {
      return;
    }

    scheduled = true;
    void Promise.resolve().then(() => {
      scheduled = false;

      if (active) {
        void refresh(() => active);
      }
    });
  };

  const unsubscribe = subscribe(scheduleRefresh);

  return () => {
    active = false;
    unsubscribe();
  };
}
