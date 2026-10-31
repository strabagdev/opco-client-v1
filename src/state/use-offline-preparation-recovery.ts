import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { reconcileOfflinePreparation, subscribeOfflinePreparationExecution, type OfflinePreparationExecution } from "../lib/app-view-prewarm";
import type { LocalDatabase } from "../lib/local-db";
import type { OpcoApi } from "../lib/opco-api";
import type { ConnectivityStatus } from "../lib/connectivity";

type Input = {
  api: OpcoApi; store: LocalDatabase; ownerKey: string | null; contractId: string | null;
  token: string | null; connectivityStatus: ConnectivityStatus; canRecover: boolean;
  beforeRecovery(): Promise<boolean>; onChange(value: OfflinePreparationExecution): void;
};
/** Only event wiring: the existing preparation coordinator owns liveness, claims and single flight. */
export function useOfflinePreparationRecovery(input: Input) {
  const latest = useRef(input);
  useEffect(() => { latest.current = input; });
  const {store, ownerKey, contractId, token, connectivityStatus, canRecover} = input;
  useEffect(() => {
    let mounted = true;
    const current = () => mounted && latest.current.store === store && latest.current.ownerKey === ownerKey &&
      latest.current.contractId === contractId && latest.current.token === token;
    latest.current.onChange({ active: false, diagnostics: null });
    if (!ownerKey || !contractId || !token) return () => { mounted = false; };
    const unsubscribe = subscribeOfflinePreparationExecution({ store, ownerKey, contractId, token,
      onChange: value => { if (current()) latest.current.onChange(value); } });
    const reconcile = () => {
      if (!current()) return;
      void reconcileOfflinePreparation({ store, api: latest.current.api, ownerKey, contractId, token,
        online: latest.current.connectivityStatus === "online" && latest.current.canRecover,
        isCurrent: current,
        canRecover: () => latest.current.connectivityStatus === "online" && latest.current.canRecover,
        beforeRecovery: () => current() && latest.current.connectivityStatus === "online" && latest.current.canRecover
          ? latest.current.beforeRecovery() : Promise.resolve(false),
      }).catch(() => { /* storage recovery retains its own visible state; no automatic retry loop */ });
    };
    reconcile();
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", next => {
      const prior = previous; previous = next;
      if (next === "active" && prior !== "active") reconcile();
    });
    return () => { mounted = false; unsubscribe(); subscription.remove(); };
  }, [store, ownerKey, contractId, token]);

  // A real connectivity/readiness transition can resume reconciliation; ordinary renders do not.
  useEffect(() => {
    if (!ownerKey || !contractId || !token || connectivityStatus !== "online" || !canRecover) return;
    const current = () => latest.current.store === store && latest.current.ownerKey === ownerKey &&
      latest.current.contractId === contractId && latest.current.token === token &&
      latest.current.connectivityStatus === "online" && latest.current.canRecover;
    void reconcileOfflinePreparation({ store, api: latest.current.api, ownerKey, contractId, token, online: true,
      isCurrent: current, beforeRecovery: () => current() ? latest.current.beforeRecovery() : Promise.resolve(false),
    }).catch(() => undefined);
  }, [store, ownerKey, contractId, token, connectivityStatus, canRecover]);
}
