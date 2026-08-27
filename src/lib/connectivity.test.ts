import { describe, expect, it, vi } from "vitest";

import NetInfo from "@react-native-community/netinfo";

import { getCurrentConnectivityStatus, readConnectivityStatus } from "./connectivity";

vi.mock("@react-native-community/netinfo", () => ({
  default: {
    addEventListener: vi.fn(),
    fetch: vi.fn(),
  },
}));

describe("readConnectivityStatus", () => {
  it("treats a disconnected network as offline", () => {
    expect(readConnectivityStatus({ isConnected: false, isInternetReachable: null })).toBe("offline");
  });

  it("treats an unreachable internet state as offline", () => {
    expect(readConnectivityStatus({ isConnected: true, isInternetReachable: false })).toBe("offline");
  });

  it("treats reachable internet as online", () => {
    expect(readConnectivityStatus({ isConnected: true, isInternetReachable: true })).toBe("online");
  });

  it("treats connected with unknown reachability as online", () => {
    expect(readConnectivityStatus({ isConnected: true, isInternetReachable: null })).toBe("online");
  });

  it("keeps a completely unknown signal as unknown", () => {
    expect(readConnectivityStatus({ isConnected: null, isInternetReachable: null })).toBe("unknown");
  });

  it("hydrates current connectivity from NetInfo when mounted code asks for the current state", async () => {
    vi.mocked(NetInfo.fetch).mockResolvedValue({
      isConnected: true,
      isInternetReachable: null,
    } as Awaited<ReturnType<typeof NetInfo.fetch>>);

    await expect(getCurrentConnectivityStatus()).resolves.toBe("online");
  });
});
