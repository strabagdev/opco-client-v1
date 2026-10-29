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


describe("serial availability reads", () => {
  it("groups invalidations during a read and drains exactly one trailing refresh", async () => {
    let emit = () => {};
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let active = 0, peak = 0;
    const refresh = vi.fn(async () => {
      active++; peak = Math.max(peak, active);
      try { if (refresh.mock.calls.length === 1) await held; } finally { active--; }
    });
    const stop = subscribeHomeOfflineAvailabilityRefresh({ refresh, subscribe: listener => { emit = listener; return () => {}; } });
    emit(); await Promise.resolve();
    emit(); await Promise.resolve();
    emit(); await Promise.resolve();
    emit(); await Promise.resolve();
    expect(refresh).toHaveBeenCalledTimes(1);
    release(); await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(peak).toBe(1);
    await Promise.resolve(); expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });

  it("ignores completion and pending invalidations after losing focus/scope", async () => {
    let emit = () => {};
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    const published: string[] = [];
    const refresh = vi.fn(async (canUpdate: () => boolean) => { await held; if (canUpdate()) published.push("old-scope"); });
    const stop = subscribeHomeOfflineAvailabilityRefresh({ refresh, subscribe: listener => { emit = listener; return () => {}; } });
    emit(); await Promise.resolve(); emit(); stop(); release();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(published).toEqual([]); expect(refresh).toHaveBeenCalledOnce();
  });

  it("a rejected read stops without automatic retries, but a later event can recover", async () => {
    let emit = () => {};
    const refresh = vi.fn().mockRejectedValueOnce(new Error("synthetic read failure")).mockResolvedValue(undefined);
    const stop = subscribeHomeOfflineAvailabilityRefresh({ refresh, subscribe: listener => { emit = listener; return () => {}; } });
    emit(); await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(refresh).toHaveBeenCalledOnce(); emit();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2)); stop();
  });
});


it("does not publish a read invalidated by a newer definition/cache result", async () => {
  let emit = () => {}, release = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const published: number[] = [];
  let calls = 0;
  const stop = subscribeHomeOfflineAvailabilityRefresh({
    subscribe: listener => { emit = listener; return () => {}; },
    refresh: async canUpdate => {
      const call = ++calls;
      if (call === 1) await held;
      if (canUpdate()) published.push(call);
    },
  });
  emit(); await Promise.resolve(); emit(); release();
  await vi.waitFor(() => expect(calls).toBe(2));
  expect(published).toEqual([2]); stop();
});
