import NetInfo, { NetInfoState } from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

export type ConnectivityStatus = "online" | "offline" | "unknown";

export function getInitialConnectivityStatus(): ConnectivityStatus {
  if (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean") {
    return "unknown";
  }

  return navigator.onLine ? "online" : "offline";
}

export function useConnectivityStatus() {
  const [status, setStatus] = useState<ConnectivityStatus>(getInitialConnectivityStatus);

  useEffect(() => {
    return NetInfo.addEventListener((state) => {
      setStatus(readConnectivityStatus(state));
    });
  }, []);

  return status;
}

export function readConnectivityStatus(state: Pick<NetInfoState, "isConnected" | "isInternetReachable">): ConnectivityStatus {
  if (state.isInternetReachable === false || state.isConnected === false) {
    return "offline";
  }

  if (state.isConnected === true) {
    return "online";
  }

  return "unknown";
}
