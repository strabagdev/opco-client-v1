import { useLocalSearchParams } from "expo-router";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  AttendanceGetDiagnostics,
  buildStateUpdateDiagnosticHealth,
  createStateUpdateDiagnosticApi,
  createStateUpdateDiagnosticEvents,
  createStateUpdateDiagnosticStore,
  formatStateUpdatePreflightRows,
  formatStateUpdateRunRows,
  getStateUpdateDiagnosticsRouteState,
  resolveCurrentStateUpdateRunSummary,
  resolveLastFinishedStateUpdateRunSummary,
  resolveLatestStateUpdateRunSummary,
  summarizeAttendanceGetResponse,
} from "@/diagnostics/state-update-route-logic";
import { loadAppViewsWithCache } from "@/lib/app-navigation-cache";
import { AppView, OpcoApiError } from "@/lib/opco-api";
import { StateUpdateOutboxDiagnostics, StateUpdateRequestDiagnostics, StateUpdateRequestHistoryEvent } from "@/lib/state-update-offline";
import {
  StateUpdateDiagnosticRun,
  StateUpdateReconnectDiagnostics,
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
    syncPendingStateUpdatesWithTelemetry,
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
  const [healthCheck, setHealthCheck] = useState<{ endpoint: "health" | "ready"; durationMs: number; ok: boolean; status: string } | null>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState<"health" | "ready" | null>(null);
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

    const beforeRun = await definitionCache.getStateUpdateOutboxDiagnostics(routeState.ownerKey);
    const events = createStateUpdateDiagnosticEvents(beforeRun);

    setIsSyncing(true);
    try {
      const diagnosticStore = createStateUpdateDiagnosticStore(definitionCache, events);
      const diagnosticApi = createStateUpdateDiagnosticApi(api, events);
      const runResult = await syncPendingStateUpdatesWithTelemetry({
        api: diagnosticApi,
        ownerKey: routeState.ownerKey,
        store: diagnosticStore,
        token,
        trigger: "manual-retry",
      });

      if (!runResult) {
        setError("session unavailable");
        return;
      }

      const { completedAt, result } = runResult;
      const refreshed = await definitionCache.getStateUpdateOutboxDiagnostics(routeState.ownerKey);

      for (const operation of refreshed.operations) {
        const event = [...events.values()].find((item) => item.clientRequestId === operation.clientRequestId);

        if (event) {
          event.finalSyncStatus = operation.syncStatus;
        }
      }

      setRun({
        invokedAt: completedAt,
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
  }, [api, definitionCache, refresh, routeState, syncPendingStateUpdatesWithTelemetry, token]);

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
      }, "DAY_LOAD");

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

  const checkHealth = useCallback(async (endpoint: "health" | "ready") => {
    const startedAt = Date.now();

    setIsCheckingHealth(endpoint);
    try {
      if (endpoint === "health") {
        await api.getHealth();
      } else {
        await api.getReady();
      }

      setHealthCheck({
        durationMs: Date.now() - startedAt,
        endpoint,
        ok: true,
        status: "OK",
      });
    } catch (nextError) {
      setHealthCheck({
        durationMs: Date.now() - startedAt,
        endpoint,
        ok: false,
        status: nextError instanceof OpcoApiError ? `${nextError.status}:${nextError.code}` : "NETWORK_ERROR",
      });
    } finally {
      setIsCheckingHealth(null);
    }
  }, [api]);

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
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.ready}>{routeState.message}</Text>
      <StateUpdateOperationalDiagnostics
        diagnostics={diagnostics}
        error={error}
        healthCheck={healthCheck}
        isCheckingHealth={isCheckingHealth}
        isSyncing={isSyncing}
        onCheckHealth={checkHealth}
        onRefresh={refresh}
        onRetryFailed={retryFailed}
        onSyncNow={syncNow}
        reconnect={stateUpdateReconnectDiagnostics}
        run={run}
      />
      <AttendanceGetDiagnosticsPanel
        diagnostics={attendanceDiagnostics}
        error={attendanceError}
        isLoading={isLoadingAttendanceDiagnostics}
        onRefresh={refreshAttendanceDiagnostics}
      />
    </ScrollView>
  );
}

function resolveAttendanceDiagnosticAppView(appViews: AppView[], requestedAppViewId: string | null) {
  return appViews.find((view) =>
    view.type === "WORKFLOW" &&
    view.config.workflowKey === "attendance" &&
    (!requestedAppViewId || view.id === requestedAppViewId),
  ) ?? null;
}

function StateUpdateOperationalDiagnostics({
  diagnostics,
  error,
  healthCheck,
  isCheckingHealth,
  isSyncing,
  onCheckHealth,
  onRefresh,
  onRetryFailed,
  onSyncNow,
  reconnect,
  run,
}: {
  diagnostics: StateUpdateOutboxDiagnostics | null;
  error: string | null;
  healthCheck: { endpoint: "health" | "ready"; durationMs: number; ok: boolean; status: string } | null;
  isCheckingHealth: "health" | "ready" | null;
  isSyncing: boolean;
  onCheckHealth(endpoint: "health" | "ready"): Promise<void>;
  onRefresh(): Promise<void>;
  onRetryFailed(manualRetryToken?: string | null): Promise<void>;
  onSyncNow(): Promise<void>;
  reconnect: StateUpdateReconnectDiagnostics;
  run: StateUpdateDiagnosticRun | null;
}) {
  const health = buildStateUpdateDiagnosticHealth({ diagnostics, reconnect });
  const currentRun = resolveCurrentStateUpdateRunSummary(reconnect);
  const lastFinishedRun = resolveLastFinishedStateUpdateRunSummary(reconnect);
  const latestRun = resolveLatestStateUpdateRunSummary(reconnect);
  const requestHistory = reconnect.requestHistory ?? [];
  const lastRequest = requestHistory.at(-1) ?? reconnect.lastStateUpdateActivity?.lastRequestDiagnostics ?? reconnect.lastStateUpdateSync?.lastRequestDiagnostics ?? null;
  const activeSummary = diagnostics ? Object.entries(diagnostics.summary).filter(([, value]) => value > 0) : [];

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>STATE_UPDATE operativo</Text>
        <View style={styles.actions}>
          <Pressable onPress={onRefresh} style={styles.button}>
            <Text style={styles.buttonText}>Refrescar lectura</Text>
          </Pressable>
          <Pressable disabled={isSyncing} onPress={onSyncNow} style={[styles.button, isSyncing ? styles.buttonDisabled : null]}>
            <Text style={styles.buttonText}>{isSyncing ? "Sincronizando" : "Sync manual"}</Text>
          </Pressable>
          <Pressable disabled={isCheckingHealth === "health"} onPress={() => onCheckHealth("health")} style={[styles.secondaryButton, isCheckingHealth === "health" ? styles.buttonDisabled : null]}>
            <Text style={styles.secondaryButtonText}>Health</Text>
          </Pressable>
          <Pressable disabled={isCheckingHealth === "ready"} onPress={() => onCheckHealth("ready")} style={[styles.secondaryButton, isCheckingHealth === "ready" ? styles.buttonDisabled : null]}>
            <Text style={styles.secondaryButtonText}>Ready</Text>
          </Pressable>
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.cards}>
        {health.cards.map((card) => (
          <View key={card.label} style={[styles.card, card.tone === "risk" ? styles.cardRisk : card.tone === "warn" ? styles.cardWarn : styles.cardGood]}>
            <Text style={styles.cardLabel}>{card.label}</Text>
            <Text style={styles.cardValue}>{card.value}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.interpretation}>{health.interpretation}</Text>
      <Section title="Actividad actual">
        <DiagnosticsRows rows={[
          ["connectivity", reconnect.currentConnectivity.status],
          ["connectivityUpdatedAt", reconnect.currentConnectivity.updatedAt ?? "none"],
          ["lastReconnect", reconnect.lastReconnect.detectedAt ?? "none"],
          ["reconnect", reconnect.lastReconnect.detected ? `${reconnect.lastReconnect.previousConnectivityStatus} -> ${reconnect.lastReconnect.resultingConnectivityStatus}` : "none"],
          ["activityType", health.currentActivity.type],
          ["trigger", health.currentActivity.type === "idle" ? "none" : reconnect.lastStateUpdateActivity?.trigger ?? reconnect.lastStateUpdateSync?.trigger ?? "none"],
          ["result", health.currentActivity.result],
          ["syncRunId", health.currentActivity.syncRunId ?? "none"],
          ["T reconnect->activity ms", elapsedMs(reconnect.lastReconnect.detectedAt, reconnect.lastStateUpdateActivity?.startedAt ?? reconnect.lastStateUpdateSync?.startedAt)],
        ]} />
      </Section>
      <Section title="Ultimo run">
        <DiagnosticsRows rows={formatStateUpdateRunRows(latestRun)} />
      </Section>
      <Section title="Run actual">
        <DiagnosticsRows rows={formatStateUpdateRunRows(currentRun)} />
      </Section>
      <Section title="Ultimo run terminado">
        <DiagnosticsRows rows={formatStateUpdateRunRows(lastFinishedRun)} />
      </Section>
      <Section title="Ultimo request">
        {lastRequest ? <DiagnosticsRows rows={requestRows(lastRequest)} /> : <Text style={styles.empty}>Sin requests STATE_UPDATE/Attendance registrados.</Text>}
      </Section>
      <Section title="Ultimo cierre de sesion">
        {reconnect.lastSessionTermination ? <DiagnosticsRows rows={[
          ["reason", reconnect.lastSessionTermination.reason],
          ["source", reconnect.lastSessionTermination.source],
          ["errorCode", reconnect.lastSessionTermination.errorCode],
          ["timestamp", reconnect.lastSessionTermination.timestamp],
          ["requestId", reconnect.lastSessionTermination.requestId ?? "none"],
        ]} /> : <Text style={styles.empty}>Sin cierre de sesion registrado.</Text>}
      </Section>
      <Section title="Historial de requests">
        {requestHistory.length ? requestHistory.slice().reverse().map((request, index) => (
          <View key={`${request.diagnosticRequestId}:${request.requestStartedAt}:${index}`} style={styles.operation}>
            <DiagnosticsRows rows={[
              ["#", requestHistory.length - index],
              ["operation", request.diagnosticOperation ?? "OTHER"],
              ["method", request.method ?? "UNKNOWN"],
              ["path", request.pathTemplate],
              ["durationMs", request.requestDurationMs],
              ["status", request.httpStatus ?? "none"],
              ["operationResult", request.operationResult ?? "none"],
              ["timeout", request.abortControllerTriggered],
              ["attempt", request.attemptNumber ?? "none"],
              ["errorCode", request.errorCode ?? "none"],
              ["interpretation", request.interpretation],
              ["requestId", request.responseRequestId ?? request.diagnosticRequestId ?? "unknown"],
              ["syncRunId", request.diagnosticSyncRunId ?? "none"],
              ["serverTiming", formatServerTiming(request.serverTiming ?? [])],
            ]} />
          </View>
        )) : <Text style={styles.empty}>No hay historial durable todavia.</Text>}
      </Section>
      <Section title="Estado actual">
        <DiagnosticsRows rows={[
          ["consistency", diagnostics?.consistency ?? "loading"],
          ["pending/syncing/failed/conflict", health.pendingState],
          ["workflow local records", diagnostics?.summary.localTotal ?? "loading"],
          ["state-update local records", diagnostics?.summary.stateUpdateTotalLocal ?? "loading"],
          ["active non-zero metrics", activeSummary.length ? activeSummary.map(([key, value]) => `${key}:${value}`).join(", ") : "none"],
        ]} />
      </Section>
      <Section title="Preflight reconnect">
        <DiagnosticsRows rows={formatStateUpdatePreflightRows(reconnect.lastReconnectPreflight)} />
      </Section>
      {healthCheck ? (
        <Section title="Health manual">
          <DiagnosticsRows rows={[
            ["endpoint", healthCheck.endpoint],
            ["ok", healthCheck.ok],
            ["status", healthCheck.status],
            ["durationMs", healthCheck.durationMs],
          ]} />
        </Section>
      ) : null}
      <Section title="Operaciones locales">
        {!diagnostics ? (
          <Text style={styles.empty}>Cargando operaciones...</Text>
        ) : diagnostics.operations.length ? diagnostics.operations.map((operation, index) => (
          <View key={`${operation.clientRequestId}:${index}`} style={styles.operation}>
            <View style={styles.operationHeader}>
              <Text style={styles.operationTitle}>#{index + 1} {operation.syncStatus}</Text>
              {operation.manualRetryable && operation.manualRetryToken ? (
                <Pressable disabled={isSyncing} onPress={() => onRetryFailed(operation.manualRetryToken)} style={[styles.secondaryButton, isSyncing ? styles.buttonDisabled : null]}>
                  <Text style={styles.secondaryButtonText}>Reintentar</Text>
                </Pressable>
              ) : null}
            </View>
            <DiagnosticsRows rows={[
              ["clientRequestId", operation.clientRequestId],
              ["operation", operation.operationType],
              ["retryable", operation.retryable],
              ["appView", operation.appViewFingerprint],
              ["contract", operation.contractFingerprint],
              ["subject", operation.subjectFingerprint],
              ["date", operation.date ?? "none"],
              ["retryCount", operation.retryCount],
              ["lastErrorCode", operation.lastErrorCode ?? "none"],
              ["lastErrorPhase", operation.lastErrorPhase ?? "none"],
              ["lastHttpStatus", operation.lastHttpStatus ?? "not stored"],
              ["payloadSchema", operation.payloadSchema],
              ["stateValues", operation.stateValuesCount],
              ["extraValues", operation.extraValuesCount],
            ]} />
          </View>
        )) : <Text style={styles.empty}>No hay operaciones STATE_UPDATE locales.</Text>}
      </Section>
      <Section title="Run manual">
        {run ? (
          <DiagnosticsRows rows={[
            ["invokedAt", run.invokedAt],
            ["operationsSelected", run.operationsSelected],
            ["operationsAttempted", run.operationsAttempted],
            ["operationsCompleted", run.operationsCompleted],
            ["operationsFailed", run.operationsFailed],
          ]} />
        ) : <Text style={styles.empty}>Sin corrida manual en esta pantalla.</Text>}
      </Section>
    </View>
  );
}

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function DiagnosticsRows({ rows }: { rows: [string, string | number | boolean | null][] }) {
  return (
    <View style={styles.rows}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.value}>{String(value)}</Text>
        </View>
      ))}
    </View>
  );
}

function requestRows(request: StateUpdateRequestDiagnostics): [string, string | number | boolean | null][] {
  return [
    ["operation", request.diagnosticOperation ?? "OTHER"],
    ["method", request.method ?? "UNKNOWN"],
    ["path", request.pathTemplate],
    ["startedAt", request.requestStartedAt],
    ["fetchResolvedAt", request.fetchResolvedAt ?? "none"],
    ["bodyStartedAt", request.responseBodyStartedAt ?? "none"],
    ["parsedAt", request.responseParsedAt ?? "none"],
    ["completedAt", request.requestCompletedAt],
    ["durationMs", request.requestDurationMs],
    ["timeoutMs", request.timeoutMs],
    ["attempt", request.attemptNumber ?? "none"],
    ["abortController", request.abortControllerTriggered],
    ["httpStatus", request.httpStatus ?? "none"],
    ["operationResult", request.operationResult ?? "none"],
    ["errorCode", request.errorCode ?? "none"],
    ["requestId", request.responseRequestId ?? request.diagnosticRequestId ?? "unknown"],
    ["syncRunId", request.diagnosticSyncRunId ?? "none"],
    ["serverTiming", formatServerTiming(request.serverTiming ?? [])],
    ["clientMinusServerMs", clientMinusServerMs(request)],
  ];
}

function elapsedMs(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) {
    return "none";
  }

  const elapsed = Date.parse(end) - Date.parse(start);

  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : "none";
}

function formatServerTiming(timing: NonNullable<StateUpdateRequestHistoryEvent["serverTiming"]>) {
  return timing.length
    ? timing.map((metric) => `${metric.name}${typeof metric.durationMs === "number" ? `=${Math.round(metric.durationMs)}ms` : ""}`).join(", ")
    : "none";
}

function clientMinusServerMs(request: StateUpdateRequestDiagnostics) {
  const totalServerMs = (request.serverTiming ?? []).reduce((sum, metric) =>
    sum + (typeof metric.durationMs === "number" ? metric.durationMs : 0), 0);

  if (!totalServerMs) {
    return "none";
  }

  return Math.round(request.requestDurationMs - totalServerMs);
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
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
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
  card: {
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: 150,
    flexGrow: 1,
    gap: 4,
    padding: 10,
  },
  cardGood: {
    backgroundColor: "#f3faf7",
    borderColor: "#9bd3bd",
  },
  cardLabel: {
    color: "#466068",
    fontSize: 12,
    fontWeight: "800",
  },
  cardRisk: {
    backgroundColor: "#fff5f5",
    borderColor: "#f3a7a7",
  },
  cards: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  cardValue: {
    color: "#0f3036",
    fontSize: 16,
    fontWeight: "900",
  },
  cardWarn: {
    backgroundColor: "#fff9ed",
    borderColor: "#f0c36d",
  },
  empty: {
    color: "#466068",
    fontSize: 12,
  },
  error: {
    color: "#b42318",
    fontWeight: "700",
  },
  header: {
    gap: 8,
  },
  interpretation: {
    color: "#2f4b53",
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
  operation: {
    borderColor: "#dce7e8",
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 8,
  },
  operationHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  operationTitle: {
    color: "#0f3036",
    fontWeight: "900",
  },
  panel: {
    backgroundColor: "#ffffff",
    borderColor: "#c8d7d8",
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    padding: 12,
  },
  ready: {
    color: "#0f3036",
    fontSize: 16,
    fontWeight: "900",
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  rows: {
    gap: 6,
  },
  screen: {
    gap: 12,
    padding: 12,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#eef5f6",
    borderColor: "#c8d7d8",
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 40,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: "#135d66",
    fontWeight: "800",
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    color: "#0f3036",
    fontSize: 13,
    fontWeight: "900",
  },
  title: {
    color: "#0f3036",
    fontSize: 16,
    fontWeight: "900",
  },
  value: {
    color: "#0f3036",
    flex: 1,
    fontFamily: "monospace",
    textAlign: "right",
  },
});
