import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { getStateUpdateDiagnosticsRouteState } from "@/diagnostics/state-update-route-logic";
import { OpcoApiError } from "@/lib/opco-api";
import { StateUpdateOutboxDiagnostics } from "@/lib/state-update-offline";
import { syncPendingStateUpdatesOnce } from "@/sync/state-update-sync";
import {
  abbreviateDiagnosticValue,
  StateUpdateDiagnosticRun,
  StateUpdateDiagnosticsPanel,
  useSession,
} from "@/state/session";

export default function StateUpdateDiagnosticsRoute() {
  const {
    api,
    definitionCache,
    localDatabaseStorageState,
    ownerKey,
    selectedContractId,
    stateUpdateReconnectDiagnostics,
    status,
    token,
  } = useSession();
  const routeState = useMemo(
    () =>
      getStateUpdateDiagnosticsRouteState({
        localDatabaseStorageState,
        ownerKey,
        selectedContractId,
        status,
      }),
    [localDatabaseStorageState, ownerKey, selectedContractId, status],
  );
  const [diagnostics, setDiagnostics] = useState<StateUpdateOutboxDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [run, setRun] = useState<StateUpdateDiagnosticRun | null>(null);

  const refresh = useCallback(async () => {
    if (!routeState.ready) {
      setDiagnostics(null);
      setError(null);
      return;
    }

    try {
      const nextDiagnostics = await definitionCache.getStateUpdateOutboxDiagnostics(routeState.ownerKey);

      setDiagnostics(nextDiagnostics);
      setError(null);
    } catch {
      setDiagnostics(null);
      setError("diagnostics unavailable");
    }
  }, [definitionCache, routeState]);

  const syncNow = useCallback(async () => {
    if (!routeState.ready || !token) {
      setError("session unavailable");
      return;
    }

    const events = new Map<string, StateUpdateDiagnosticRun["rows"][number]>();
    const beforeRun = await definitionCache.getStateUpdateOutboxDiagnostics(routeState.ownerKey);

    for (const operation of beforeRun.operations) {
      events.set(operation.clientRequestId, {
        clientRequestId: operation.clientRequestId,
        finalSyncStatus: operation.syncStatus,
        httpStatus: null,
        requestAttempted: false,
        result: "not-selected",
        selectedForSync: false,
      });
    }

    setIsSyncing(true);
    try {
      const diagnosticStore = {
        ...definitionCache,
        async listPendingStateUpdateOperations(nextOwnerKey: string) {
          const operations = await definitionCache.listPendingStateUpdateOperations(nextOwnerKey);

          for (const operation of operations) {
            events.set(abbreviateDiagnosticValue(operation.clientRequestId), {
              clientRequestId: abbreviateDiagnosticValue(operation.clientRequestId),
              finalSyncStatus: "unknown",
              httpStatus: null,
              requestAttempted: false,
              result: "selected",
              selectedForSync: true,
            });
          }

          return operations;
        },
        async completeStateUpdateOperation(...args: Parameters<typeof definitionCache.completeStateUpdateOperation>) {
          const event = events.get(abbreviateDiagnosticValue(args[0].clientRequestId));

          if (event) {
            event.finalSyncStatus = "synced";
            event.result = args[1].result;
          }

          return definitionCache.completeStateUpdateOperation(...args);
        },
        async failStateUpdateOperation(...args: Parameters<typeof definitionCache.failStateUpdateOperation>) {
          const event = events.get(abbreviateDiagnosticValue(args[0].clientRequestId));

          if (event) {
            event.finalSyncStatus = "failed";
            event.result = args[1];
          }

          return definitionCache.failStateUpdateOperation(...args);
        },
        async markStateUpdateOperationConflict(...args: Parameters<typeof definitionCache.markStateUpdateOperationConflict>) {
          const event = events.get(abbreviateDiagnosticValue(args[0].clientRequestId));

          if (event) {
            event.finalSyncStatus = "conflict";
            event.result = "CONFLICT";
          }

          return definitionCache.markStateUpdateOperationConflict(...args);
        },
        async retryStateUpdateOperation(...args: Parameters<typeof definitionCache.retryStateUpdateOperation>) {
          const event = events.get(abbreviateDiagnosticValue(args[0].clientRequestId));

          if (event) {
            event.finalSyncStatus = "pending_update";
            event.result = args[1];
          }

          return definitionCache.retryStateUpdateOperation(...args);
        },
      };
      const diagnosticApi = {
        async saveStateUpdateWorkflow(...args: Parameters<typeof api.saveStateUpdateWorkflow>) {
          const input = args[3];
          const event = [...events.values()].find((item) => item.clientRequestId === abbreviateDiagnosticValue(input.clientRequestId ?? ""));

          if (event) {
            event.requestAttempted = true;
          }

          try {
            const response = await api.saveStateUpdateWorkflow(...args);

            if (event) {
              event.httpStatus = 200;
              event.result = response.results[0]?.result ?? "EMPTY_RESULT";
            }

            return response;
          } catch (error) {
            if (event) {
              event.httpStatus = error instanceof OpcoApiError ? error.status : null;
              event.result = error instanceof OpcoApiError ? error.code : error instanceof Error ? error.name : "UNKNOWN_ERROR";
            }

            throw error;
          }
        },
      };
      const result = await syncPendingStateUpdatesOnce({
        api: diagnosticApi,
        ownerKey: routeState.ownerKey,
        store: diagnosticStore,
        token,
      });
      const refreshed = await definitionCache.getStateUpdateOutboxDiagnostics(routeState.ownerKey);

      for (const operation of refreshed.operations) {
        const event = [...events.values()].find((item) => item.clientRequestId === operation.clientRequestId);

        if (event) {
          event.finalSyncStatus = operation.syncStatus;
        }
      }

      setRun({
        invokedAt: new Date().toISOString(),
        operationsAttempted: [...events.values()].filter((event) => event.requestAttempted).length,
        operationsCompleted: result.completed,
        operationsFailed: result.failed + result.conflicts + result.retriable,
        operationsSelected: [...events.values()].filter((event) => event.selectedForSync).length,
        rows: [...events.values()],
      });
      setDiagnostics(refreshed);
      setError(null);
    } catch {
      setError("diagnostic sync failed");
      await refresh();
    } finally {
      setIsSyncing(false);
    }
  }, [api, definitionCache, refresh, routeState, token]);

  const retryFailed = useCallback(async (manualRetryToken?: string | null) => {
    if (!routeState.ready || !token) {
      setError("session unavailable");
      return;
    }

    try {
      const retried = await definitionCache.retryFailedStateUpdateOperations({
        manualRetryToken,
        ownerKey: routeState.ownerKey,
      });

      if (!retried) {
        await refresh();
        return;
      }

      await syncNow();
    } catch {
      setError("retry unavailable");
      await refresh();
    }
  }, [definitionCache, refresh, routeState, syncNow, token]);

  useEffect(() => {
    if (!routeState.ready) {
      return;
    }

    let isMounted = true;

    definitionCache.getStateUpdateOutboxDiagnostics(routeState.ownerKey)
      .then((nextDiagnostics) => {
        if (isMounted) {
          setDiagnostics(nextDiagnostics);
          setError(null);
        }
      })
      .catch(() => {
        if (isMounted) {
          setDiagnostics(null);
          setError("diagnostics unavailable");
        }
      });

    return () => {
      isMounted = false;
    };
  }, [definitionCache, routeState]);

  if (!routeState.ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
        <Text style={styles.loadingText}>{routeState.message}</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.ready}>{routeState.message}</Text>
      <StateUpdateDiagnosticsPanel
        diagnostics={diagnostics}
        error={error}
        isSyncing={isSyncing}
        onRefresh={refresh}
        onRetryFailed={retryFailed}
        onSyncNow={syncNow}
        reconnect={stateUpdateReconnectDiagnostics}
        run={run}
        variant="embedded"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    alignItems: "center",
    flex: 1,
    gap: 12,
    justifyContent: "center",
    padding: 24,
  },
  loadingText: {
    color: "#466068",
    fontWeight: "800",
  },
  ready: {
    color: "#0f3036",
    fontSize: 16,
    fontWeight: "900",
  },
  screen: {
    flex: 1,
    gap: 12,
    padding: 12,
  },
});
