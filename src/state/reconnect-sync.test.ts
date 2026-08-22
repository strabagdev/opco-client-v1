import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createReconnectSyncController } from "./reconnect-sync";

describe("reconnect sync controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs sync once when connectivity transitions from offline to online", async () => {
    const runSync = vi.fn(async () => undefined);
    const onSynced = vi.fn();
    const controller = createReconnectSyncController({ debounceMs: 100, onSynced, runSync });

    controller.handleConnectivityStatus("offline");
    controller.handleConnectivityStatus("online");

    expect(runSync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);

    expect(runSync).toHaveBeenCalledOnce();
    expect(onSynced).toHaveBeenCalledOnce();
  });

  it("does not run sync for online to online events", async () => {
    const runSync = vi.fn(async () => undefined);
    const controller = createReconnectSyncController({ debounceMs: 100, runSync });

    controller.handleConnectivityStatus("online");
    controller.handleConnectivityStatus("online");

    await vi.advanceTimersByTimeAsync(100);

    expect(runSync).not.toHaveBeenCalled();
  });

  it("debounces repeated NetInfo events and does not duplicate sync", async () => {
    const runSync = vi.fn(async () => undefined);
    const controller = createReconnectSyncController({ debounceMs: 100, runSync });

    controller.handleConnectivityStatus("offline");
    controller.handleConnectivityStatus("online");
    controller.handleConnectivityStatus("online");
    controller.handleConnectivityStatus("online");

    await vi.advanceTimersByTimeAsync(100);

    expect(runSync).toHaveBeenCalledOnce();
  });

  it("does not start a second sync while the reconnect sync is in flight", async () => {
    let resolveSync: (value?: void | PromiseLike<void>) => void = () => undefined;
    const runSync = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSync = resolve;
        }),
    );
    const controller = createReconnectSyncController({ debounceMs: 100, runSync });

    controller.handleConnectivityStatus("offline");
    controller.handleConnectivityStatus("online");
    await vi.advanceTimersByTimeAsync(100);

    controller.handleConnectivityStatus("offline");
    controller.handleConnectivityStatus("online");
    await vi.advanceTimersByTimeAsync(100);

    expect(runSync).toHaveBeenCalledOnce();

    resolveSync?.();
    await Promise.resolve();
  });

  it("keeps failed sync eligible for a later reconnect retry", async () => {
    const runSync = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(undefined);
    const onSynced = vi.fn();
    const controller = createReconnectSyncController({ debounceMs: 100, onSynced, runSync });

    controller.handleConnectivityStatus("offline");
    controller.handleConnectivityStatus("online");
    await vi.advanceTimersByTimeAsync(100);

    expect(runSync).toHaveBeenCalledOnce();
    expect(onSynced).not.toHaveBeenCalled();

    controller.handleConnectivityStatus("offline");
    controller.handleConnectivityStatus("online");
    await vi.advanceTimersByTimeAsync(100);

    expect(runSync).toHaveBeenCalledTimes(2);
    expect(onSynced).toHaveBeenCalledOnce();
  });
});
