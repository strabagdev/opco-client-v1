import { describe, expect, it, vi } from "vitest";

import { readConnectivityStatus } from "./connectivity";

vi.mock("@react-native-community/netinfo", () => ({
  default: {
    addEventListener: vi.fn(),
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

  it("does not treat connected with unknown reachability as online", () => {
    expect(readConnectivityStatus({ isConnected: true, isInternetReachable: null })).toBe("unknown");
  });
});
