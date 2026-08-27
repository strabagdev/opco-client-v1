import { useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import {
  AttendanceGetDiagnostics,
  getStateUpdateDiagnosticsRouteState,
  summarizeAttendanceGetResponse,
} from "@/diagnostics/state-update-route-logic";
import { loadAppViewsWithCache } from "@/lib/app-navigation-cache";
import { AppView, DEFAULT_REQUEST_TIMEOUT_MS, OpcoApiError, OpcoNetworkError } from "@/lib/opco-api";
import { StateUpdateOutboxDiagnostics } from "@/lib/state-update-offline";
import { syncPendingStateUpdatesOnce } from "@/sync/state-update-sync";
import {
  abbreviateDiagnosticValue,
  StateUpdateDiagnosticRun,
  StateUpdateDiagnosticsPanel,
  useSession,
} from "@/state/session";

export default function StateUpdateDiagnosticsRoute() {
  const params = useLocalSearchParams<{ appViewId?: string; date?: string; expectedAttendanceTotal?: string }>();
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
  const [attendanceDiagnostics, setAttendanceDiagnostics] = useState<AttendanceGetDiagnostics | null>(null);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [isLoadingAttendanceDiagnostics, setIsLoadingAttendanceDiagnostics] = useState(false);
  const attendanceDiagnosticsDate = typeof params.date === "string" && params.date.trim()
    ? params.date.trim()
    : new Date().toISOString().slice(0, 10);
  const expectedAttendanceTotal = typeof params.expectedAttendanceTotal === "string" && /^\d+$/.test(params.expectedAttendanceTotal)
    ? Number(params.expectedAttendanceTotal)
    : attendanceDiagnosticsDate === "2026-08-26" ? 3 : null;
  const requestedAttendanceAppViewId = typeof params.appViewId === "string" && params.appViewId.trim()
    ? params.appViewId.trim()
    : null;

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
        endpoint: "none",
        finalSyncStatus: operation.syncStatus,
        httpStatus: null,
        requestAbortControllerTriggered: null,
        requestAttempted: false,
        requestDurationMs: null,
        requestStartedAt: null,
        requestTimeoutMs: null,
        responseStarted: null,
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
              endpoint: "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update",
              finalSyncStatus: "unknown",
              httpStatus: null,
              requestAbortControllerTriggered: null,
              requestAttempted: false,
              requestDurationMs: null,
              requestStartedAt: null,
              requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
              responseStarted: null,
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
            event.endpoint = "/api/v1/contracts/:contractId/views/:appViewId/workflow/state-update";
            event.requestAttempted = true;
            event.requestStartedAt = new Date().toISOString();
            event.requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
          }
          const requestStartedMs = Date.now();

          try {
            const response = await api.saveStateUpdateWorkflow(...args);

            if (event) {
              event.httpStatus = 200;
              event.requestAbortControllerTriggered = false;
              event.requestDurationMs = Date.now() - requestStartedMs;
              event.result = response.results[0]?.result ?? "EMPTY_RESULT";
              event.responseStarted = true;
            }

            return response;
          } catch (error) {
            if (event) {
              event.httpStatus = error instanceof OpcoApiError ? error.status : null;
              event.requestAbortControllerTriggered = error instanceof OpcoNetworkError ? error.diagnostics?.abortControllerTriggered ?? null : false;
              event.requestDurationMs = error instanceof OpcoNetworkError ? error.diagnostics?.requestDurationMs ?? Date.now() - requestStartedMs : Date.now() - requestStartedMs;
              event.requestStartedAt = error instanceof OpcoNetworkError ? error.diagnostics?.requestStartedAt ?? event.requestStartedAt : event.requestStartedAt;
              event.requestTimeoutMs = error instanceof OpcoNetworkError ? error.diagnostics?.timeoutMs ?? event.requestTimeoutMs : event.requestTimeoutMs;
              event.result = error instanceof OpcoApiError ? error.code : error instanceof Error ? error.name : "UNKNOWN_ERROR";
              event.responseStarted = error instanceof OpcoNetworkError ? error.diagnostics?.responseStarted ?? false : true;
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

  const refreshAttendanceDiagnostics = useCallback(async () => {
    if (!routeState.ready || !token) {
      setAttendanceError("session unavailable");
      return;
    }

    setIsLoadingAttendanceDiagnostics(true);
    try {
      const appViewsResult = await loadAppViewsWithCache({
        api,
        cache: definitionCache,
        contractId: routeState.selectedContractId,
        ownerKey: routeState.ownerKey,
        token,
      });
      const attendanceAppView = resolveAttendanceDiagnosticAppView(appViewsResult.views, requestedAttendanceAppViewId);

      if (!attendanceAppView) {
        setAttendanceDiagnostics(null);
        setAttendanceError(requestedAttendanceAppViewId ? "attendance appView unavailable" : "attendance appView not found");
        return;
      }

      const response = await api.getAttendanceWorkflow(token, routeState.selectedContractId, attendanceAppView.id, {
        date: attendanceDiagnosticsDate,
      });

      setAttendanceDiagnostics(summarizeAttendanceGetResponse({
        appViewId: attendanceAppView.id,
        expectedTotal: expectedAttendanceTotal,
        response,
      }));
      setAttendanceError(null);
    } catch (nextError) {
      setAttendanceDiagnostics(null);
      setAttendanceError(nextError instanceof OpcoApiError ? `${nextError.status}:${nextError.code}` : "attendance diagnostics unavailable");
    } finally {
      setIsLoadingAttendanceDiagnostics(false);
    }
  }, [
    api,
    attendanceDiagnosticsDate,
    definitionCache,
    expectedAttendanceTotal,
    requestedAttendanceAppViewId,
    routeState,
    token,
  ]);

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

  useEffect(() => {
    if (!routeState.ready) {
      return;
    }

    queueMicrotask(() => {
      void refreshAttendanceDiagnostics();
    });
  }, [refreshAttendanceDiagnostics, routeState.ready]);

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
      <AttendanceGetDiagnosticsPanel
        diagnostics={attendanceDiagnostics}
        error={attendanceError}
        isLoading={isLoadingAttendanceDiagnostics}
        onRefresh={refreshAttendanceDiagnostics}
      />
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

function resolveAttendanceDiagnosticAppView(appViews: AppView[], requestedAppViewId: string | null) {
  return appViews.find((view) =>
    view.type === "WORKFLOW" &&
    view.config.workflowKey === "attendance" &&
    (!requestedAppViewId || view.id === requestedAppViewId),
  ) ?? null;
}

function AttendanceGetDiagnosticsPanel({
  diagnostics,
  error,
  isLoading,
  onRefresh,
}: {
  diagnostics: AttendanceGetDiagnostics | null;
  error: string | null;
  isLoading: boolean;
  onRefresh(): void;
}) {
  const rows: [string, string | number | null][] = diagnostics
    ? [
        ["date", diagnostics.date],
        ["expectedTotal", diagnostics.expectedTotal],
        ["summary.totalRegistered", diagnostics.summaryTotalRegistered],
        ["latest.length", diagnostics.latestCount],
        ["items.length", diagnostics.itemsCount],
        ["classification", diagnostics.case],
        ["appView", diagnostics.appViewFingerprint],
      ]
    : [];

  return (
    <View style={styles.attendancePanel}>
      <View style={styles.attendanceHeader}>
        <Text style={styles.attendanceTitle}>Attendance GET diagnostics</Text>
        <Pressable disabled={isLoading} onPress={onRefresh} style={[styles.button, isLoading ? styles.buttonDisabled : null]}>
          <Text style={styles.buttonText}>{isLoading ? "Consultando" : "Consultar GET"}</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value}>{String(value ?? "none")}</Text>
        </View>
      ))}
      {diagnostics?.latest.map((item, index) => (
        <View key={`${item.attendanceRecordFingerprint}:${index}`} style={styles.latestDiagnostic}>
          <Text style={styles.operationTitle}>latest #{index + 1}</Text>
          <View style={styles.row}>
            <Text style={styles.label}>record</Text>
            <Text style={styles.value}>{item.attendanceRecordFingerprint}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>person</Text>
            <Text style={styles.value}>{item.personFingerprint}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>hasPerson</Text>
            <Text style={styles.value}>{String(item.hasPerson)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>statusLabel</Text>
            <Text style={styles.value}>{item.statusLabel ?? "none"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>statusOption</Text>
            <Text style={styles.value}>{item.statusOptionFingerprint}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  attendanceHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  attendancePanel: {
    backgroundColor: "#ffffff",
    borderColor: "#c8d7d8",
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  attendanceTitle: {
    color: "#0f3036",
    fontSize: 14,
    fontWeight: "900",
  },
  button: {
    alignItems: "center",
    backgroundColor: "#135d66",
    borderRadius: 8,
    minHeight: 40,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  error: {
    color: "#b42318",
    fontWeight: "700",
  },
  label: {
    color: "#466068",
    flex: 1,
    fontWeight: "700",
  },
  latestDiagnostic: {
    borderColor: "#dce7e8",
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 8,
  },
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
  operationTitle: {
    color: "#0f3036",
    fontWeight: "900",
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  value: {
    color: "#0f3036",
    flex: 1,
    fontFamily: "monospace",
    textAlign: "right",
  },
});
