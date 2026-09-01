import { describe, expect, it, vi } from "vitest";

import { subscribeHomeOfflineAvailabilityRefresh } from "./home-offline-availability-refresh";

describe("home offline availability refresh subscription", () => {
  it("refreshes when the local cache emits a change without remounting", async () => {
    let listener: () => void = () => undefined;
    const refresh = vi.fn();

    const unsubscribe = subscribeHomeOfflineAvailabilityRefresh({
      refresh,
      subscribe: (nextListener) => {
        listener = nextListener;
        return vi.fn();
      },
    });

    listener();
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh.mock.calls[0][0]()).toBe(true);

    unsubscribe();
  });

  it("coalesces cache bursts into one refresh and does not use polling", async () => {
    let listener: () => void = () => undefined;
    const refresh = vi.fn();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    const unsubscribe = subscribeHomeOfflineAvailabilityRefresh({
      refresh,
      subscribe: (nextListener) => {
        listener = nextListener;
        return vi.fn();
      },
    });

    listener();
    listener();
    listener();
    await Promise.resolve();

    expect(refresh).toHaveBeenCalledOnce();
    expect(setIntervalSpy).not.toHaveBeenCalled();

    unsubscribe();
    setIntervalSpy.mockRestore();
  });

  it("stops refreshing after unsubscribe", async () => {
    let listener: () => void = () => undefined;
    const refresh = vi.fn();
    const unsubscribeSource = vi.fn();

    const unsubscribe = subscribeHomeOfflineAvailabilityRefresh({
      refresh,
      subscribe: (nextListener) => {
        listener = nextListener;
        return unsubscribeSource;
      },
    });

    unsubscribe();
    listener();
    await Promise.resolve();

    expect(unsubscribeSource).toHaveBeenCalledOnce();
    expect(refresh).not.toHaveBeenCalled();
  });
});
