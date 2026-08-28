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
    expect(runSync).toHaveBeenCalledWith({
      previousConnectivityStatus: "offline",
      resultingConnectivityStatus: "online",
      trigger: "reconnect",
    });
    expect(onSynced).toHaveBeenCalledOnce();
  });

  it("does not run sync for online to online events", async () => {
    const runSync = vi.fn(async () => undefined);
    const controller = createReconnectSyncController({ debounceMs: 100, runSync });

    controller.handleConnectivityStatus("online");
    await vi.advanceTimersByTimeAsync(100);
    runSync.mockClear();

    controller.handleConnectivityStatus("online");
    controller.handleConnectivityStatus("online");
    await vi.advanceTimersByTimeAsync(100);

    expect(runSync).not.toHaveBeenCalled();
  });

  it("runs sync once when unknown connectivity becomes confirmed online with pending work", async () => {
    const runSync = vi.fn(async () => undefined);
    const shouldSync = vi.fn(async () => true);
    const controller = createReconnectSyncController({ debounceMs: 100, runSync, shouldSync });

    controller.handleConnectivityStatus("unknown");
    controller.handleConnectivityStatus("online");

    await vi.advanceTimersByTimeAsync(100);

    expect(shouldSync).toHaveBeenCalledOnce();
    expect(runSync).toHaveBeenCalledOnce();
    expect(runSync).toHaveBeenCalledWith({
      previousConnectivityStatus: "unknown",
      resultingConnectivityStatus: "online",
      trigger: "unknown-to-online",
    });
  });

  it("does not run startup online sync when there is no pending work", async () => {
    const runSync = vi.fn(async () => undefined);
    const onDetected = vi.fn();
    const shouldSync = vi.fn(async () => false);
    const controller = createReconnectSyncController({ debounceMs: 100, onDetected, runSync, shouldSync });

    controller.handleConnectivityStatus("online");

    expect(onDetected).toHaveBeenCalledWith({
      previousConnectivityStatus: "unknown",
      resultingConnectivityStatus: "online",
      trigger: "unknown-to-online",
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(shouldSync).toHaveBeenCalledOnce();
    expect(runSync).not.toHaveBeenCalled();
  });

  it("records an offline to online reconnect detection before checking pending work", async () => {
    const runSync = vi.fn(async () => undefined);
    const onDetected = vi.fn();
    const shouldSync = vi.fn(async () => false);
    const controller = createReconnectSyncController({ debounceMs: 100, onDetected, runSync, shouldSync });

    controller.handleConnectivityStatus("offline");
    controller.handleConnectivityStatus("online");

    expect(onDetected).toHaveBeenCalledWith({
      previousConnectivityStatus: "offline",
      resultingConnectivityStatus: "online",
      trigger: "reconnect",
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(runSync).not.toHaveBeenCalled();
  });

  it("does not run sync when pending work cannot be confirmed", async () => {
    const runSync = vi.fn(async () => undefined);
    const shouldSync = vi.fn(async () => {
      throw new Error("sqlite unavailable");
    });
    const controller = createReconnectSyncController({ debounceMs: 100, runSync, shouldSync });

    controller.handleConnectivityStatus("unknown");
    controller.handleConnectivityStatus("online");

    await vi.advanceTimersByTimeAsync(100);

    expect(shouldSync).toHaveBeenCalledOnce();
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
