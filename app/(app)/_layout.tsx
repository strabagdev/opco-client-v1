import { Redirect, Stack, usePathname, useRouter } from "expo-router";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, CircleDashed, Clock3, LogOut, WifiOff, X } from "lucide-react-native";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { AppIcon } from "@/components/app-icon";
import { isActiveStateUpdateActivity, resolveStateUpdateCurrentActivity } from "@/diagnostics/state-update-route-logic";
import { GLOBAL_DIAGNOSTIC_TABS, GLOBAL_DIAGNOSTICS_BUTTON, normalizeDiagnosticTabId, type DiagnosticTabId } from "@/lib/app-diagnostics";
import { getDiagnosticsModalHeight, shouldShowDiagnosticsTabScrollIndicator } from "@/lib/app-diagnostics-layout";
import {
  classifyAppShellVisibleErrorEvent,
  resolveAppShellPersistentFeedback,
  resolveAppShellSuccessToast,
  resolveAppShellStatusIndicator,
  shouldShowAppShellFeedbackSpinner,
} from "@/lib/app-shell-feedback";
import type { OfflinePreparationDiagnostics } from "@/lib/app-view-prewarm";
import type { SQLiteCoordinatorDiagnostics } from "@/lib/local-db";
import { useExperienceActivitySnapshot } from "@/renderers/use-experience-activity";
import { APP_SHELL_HORIZONTAL_GUTTER, APP_SHELL_WIDE_BREAKPOINT } from "@/lib/app-shell-layout";
import { formatRecordsOpeningPerformanceCopy, getOpeningPrimaryTimingLabel, type RecordsOpeningMeasurement } from "@/lib/records-opening-history";
import {
  formatPendingSyncErrorMessage,
  getPendingStateUpdateSyncErrors,
  getPendingSyncErrorTechnicalRows,
} from "@/lib/pending-sync-errors";
import { useOfflineReadiness } from "@/lib/use-offline-readiness";
import {
  activeSince,
  buildSyncStatusDiagnostics,
  fingerprintSyncDiagnosticScope,
  formatActiveDuration,
  formatSyncStatusDiagnosticsCopy,
  updateSyncStatusHistory,
  type SyncChecklistState,
  type SyncStatusHistory,
} from "@/lib/sync-status-diagnostics";
import {
  formatRecordsFailedOperationDiagnosticsCopyText,
  getRecordsFailedOperationDiagnosticsSections,
  getRecordsFailedOperationsNotice,
  getSyncDiagnosticsRows,
} from "@/renderers/records/sync-diagnostics";
import { useRecordsOpeningHistory } from "@/renderers/records/records-opening";
import { StateUpdateDiagnosticsPanel, useSession } from "@/state/session";
import { useWriteFeedbackSnapshot } from "@/state/use-write-feedback";
import { appViewIdFromPathname, clearWriteFeedback, writeFeedbackScopeKey } from "@/lib/write-feedback";

const APP_SHELL_TOAST_DURATION_MS = 3500;
const noTranslateProps = Platform.OS === "web"
  ? ({ translate: "no" } as Record<string, string>)
  : {};

export default function AppLayout() {
  const {
    connectivityStatus,
    context,
    definitionCache,
    isAuthSessionRestoring,
    diagnosticsStateUpdate,
    isOfflinePreparationRunning,
    isOperationalCoreReadinessChecking,
    isPendingWorkSyncing,
    localDatabaseStorageState,
    localStorageRecoveryNotice,
    me,
    offlinePreparationDiagnostics,
    ownerKey,
    pendingRecordsCount,
    recordsFailedOperations,
    recordsSyncSummary,
    retryFailedRecordOperation,
    selectedContractId,
    signOut,
    stateUpdateReconnectDiagnostics,
    stateUpdateReconnectRefreshKey,
    status,
  } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const { height, width } = useWindowDimensions();
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isSyncErrorModalOpen, setIsSyncErrorModalOpen] = useState(false);
  const [selectedDiagnosticsTab, setSelectedDiagnosticsTab] = useState<DiagnosticTabId>("sync");
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [toast, setToast] = useState<ReturnType<typeof resolveAppShellSuccessToast>>(null);
  const [statusPulseOpacity] = useState(() => new Animated.Value(1));
  const [syncStatusHistory, setSyncStatusHistory] = useState<SyncStatusHistory>({ events: [], scopeKey: null });
  const recordsOpeningHistory = useRecordsOpeningHistory();
  const experienceActivity = useExperienceActivitySnapshot();
  const writeFeedbackSnapshot = useWriteFeedbackSnapshot();
  const lastToastSyncKeyRef = useRef<string | null>(null);
  const isHome = pathname === "/";
  const isWideLayout = width >= APP_SHELL_WIDE_BREAKPOINT;
  const visibleAppViewId = appViewIdFromPathname(pathname);
  const visibleWriteScope = ownerKey && selectedContractId && visibleAppViewId
    ? writeFeedbackScopeKey(ownerKey, selectedContractId, visibleAppViewId)
    : null;
  const writeFeedback = writeFeedbackSnapshot.scopeKey === visibleWriteScope ? writeFeedbackSnapshot : null;
  const diagnosticsModalHeight = getDiagnosticsModalHeight({ height, width });
  const offlineReadiness = useOfflineReadiness({
    navigationCachePresent: Boolean(selectedContractId),
    sessionSnapshotPresent: Boolean(ownerKey && me && context),
    sqliteReady: localDatabaseStorageState.status === "ready",
  });
  const userDisplayName = me?.user.name ?? me?.user.email ?? "Sesion conservada";
  const pendingStateUpdateSyncErrors = useMemo(
    () => getPendingStateUpdateSyncErrors(diagnosticsStateUpdate.diagnostics),
    [diagnosticsStateUpdate.diagnostics],
  );
  const visibleErrorKind = classifyAppShellVisibleErrorEvent(stateUpdateReconnectDiagnostics.lastVisibleErrorEvent);
  const stateUpdateConflictCount = diagnosticsStateUpdate.diagnostics
    ? Math.max(
        diagnosticsStateUpdate.diagnostics.summary.conflict,
        diagnosticsStateUpdate.diagnostics.summary.localConflict,
      )
    : 0;
  const durableSyncErrorCount = recordsSyncSummary.failedCount + pendingStateUpdateSyncErrors.length;
  const syncConflictCount = recordsSyncSummary.conflictCount + stateUpdateConflictCount;
  const hasSyncError = durableSyncErrorCount > 0;
  const stateUpdateSummary = diagnosticsStateUpdate.diagnostics?.summary;
  const hasStateUpdateSummary = Boolean(stateUpdateSummary);
  const stateUpdatePendingCount = stateUpdateSummary
    ? stateUpdateSummary.pendingCreate + stateUpdateSummary.pendingUpdate + stateUpdateSummary.syncing + stateUpdateSummary.failed + stateUpdateSummary.conflict
    : 0;
  const stateUpdateCurrentActivity = resolveStateUpdateCurrentActivity({
    pending: stateUpdatePendingCount,
    reconnect: stateUpdateReconnectDiagnostics,
  });
  const isStateUpdateActivityActive = hasStateUpdateSummary
    ? isActiveStateUpdateActivity(stateUpdateCurrentActivity)
    : isPendingWorkSyncing || isOperationalCoreReadinessChecking;
  const persistentFeedback = resolveAppShellPersistentFeedback({
    connectivityStatus,
    hasConflict: syncConflictCount > 0,
    hasError: hasSyncError,
    hasReadConnectivityIssue: visibleErrorKind === "read",
    isAuthSessionRestoring,
    isOfflinePreparationRunning,
    isOperationalCoreReadinessChecking: isOperationalCoreReadinessChecking && isStateUpdateActivityActive,
    isPendingWorkSyncing: isPendingWorkSyncing && isStateUpdateActivityActive,
    localStorageRecoveryNotice,
    offlineReadiness: offlineReadiness.offlineReadiness,
    offlinePreparationStatus: offlinePreparationDiagnostics?.status ?? null,
    pendingCount: pendingRecordsCount,
    syncConfirmationVisible: toast?.id === "sync-success",
    writeFeedback,
    syncConflictCount,
    syncErrorCount: durableSyncErrorCount,
  });
  const shellStatusIndicator = resolveAppShellStatusIndicator({
    connectivityStatus,
    experienceActivity,
    hasConflict: syncConflictCount > 0,
    hasError: hasSyncError,
    hasReadConnectivityIssue: visibleErrorKind === "read",
    isAuthSessionRestoring,
    isOfflinePreparationRunning,
    isOperationalCoreReadinessChecking: isOperationalCoreReadinessChecking && isStateUpdateActivityActive,
    isPendingWorkSyncing: isPendingWorkSyncing && isStateUpdateActivityActive,
    localStorageRecoveryNotice,
    offlineReadiness: offlineReadiness.offlineReadiness,
    pendingCount: pendingRecordsCount,
  });
  const lastSync = stateUpdateReconnectDiagnostics.lastStateUpdateSync;
  const lastActivity = stateUpdateReconnectDiagnostics.lastStateUpdateActivity;
  const lastPreflight = stateUpdateReconnectDiagnostics.lastReconnectPreflight;
  const lastSuccessfulSyncAt = lastSync && (lastSync.result === "success" || lastSync.result === "reconciled_success")
    ? lastSync.completedAt
    : null;
  const syncStatusDiagnostics = useMemo(() => buildSyncStatusDiagnostics({
    connectivity: {
      checkedAt: stateUpdateReconnectDiagnostics.currentConnectivity.updatedAt,
      status: stateUpdateReconnectDiagnostics.currentConnectivity.status,
    },
    conflicts: syncConflictCount,
    errors: durableSyncErrorCount,
    experience: experienceActivity,
    indicator: shellStatusIndicator,
    offlinePreparation: {
      activeInCurrentRuntime: isOfflinePreparationRunning,
      completedAt: offlinePreparationDiagnostics?.prewarmCompletedAt ?? null,
      startedAt: offlinePreparationDiagnostics?.prewarmStartedAt ?? null,
      status: offlinePreparationDiagnostics?.status ?? null,
    },
    pendingCount: pendingRecordsCount,
    readiness: {
      active: isOperationalCoreReadinessChecking && isStateUpdateActivityActive,
      checkedAt: lastPreflight?.readinessCompletedAt ?? lastPreflight?.readinessConfirmedAt ?? null,
      failed: lastActivity?.type === "ready_check" && lastActivity.result === "ready_failed",
      reason: lastActivity?.type === "ready_check" ? lastActivity.result : null,
      runId: lastPreflight?.syncRunId ?? null,
      startedAt: lastPreflight?.readinessStartedAt ?? null,
    },
    readIssue: visibleErrorKind === "read",
    session: { restoring: isAuthSessionRestoring, status },
    sync: {
      active: isPendingWorkSyncing && isStateUpdateActivityActive,
      completedAt: lastSync?.completedAt ?? null,
      lastSuccessAt: lastSuccessfulSyncAt,
      result: lastSync?.result ?? null,
      runId: lastSync?.syncRunId ?? null,
      startedAt: lastActivity?.type === "sync" && !lastActivity.completedAt ? lastActivity.startedAt : lastSync?.startedAt ?? null,
    },
    writeFeedback,
  }), [
    durableSyncErrorCount,
    experienceActivity,
    isAuthSessionRestoring,
    isOfflinePreparationRunning,
    isOperationalCoreReadinessChecking,
    isPendingWorkSyncing,
    isStateUpdateActivityActive,
    lastActivity,
    lastPreflight,
    lastSuccessfulSyncAt,
    lastSync,
    offlinePreparationDiagnostics,
    pendingRecordsCount,
    shellStatusIndicator,
    stateUpdateReconnectDiagnostics.currentConnectivity,
    status,
    syncConflictCount,
    visibleErrorKind,
    writeFeedback,
  ]);
  const refreshStateUpdateDiagnostics = diagnosticsStateUpdate.onRefresh;

  useEffect(() => {
    const timeout = setTimeout(() => {
      setSyncStatusHistory((current) => updateSyncStatusHistory({
        at: new Date().toISOString(),
        current,
        next: syncStatusDiagnostics,
        runIds: {
          "Disponibilidad del servicio": lastPreflight?.syncRunId ?? null,
          "Envío de cambios": lastSync?.syncRunId ?? null,
        },
        scopeKey: ownerKey && selectedContractId ? fingerprintSyncDiagnosticScope(ownerKey, selectedContractId) : null,
      }));
    }, 0);

    return () => clearTimeout(timeout);
  }, [lastPreflight?.syncRunId, lastSync?.syncRunId, ownerKey, selectedContractId, syncStatusDiagnostics]);

  useEffect(() => {
    if (shellStatusIndicator.state !== "working") {
      statusPulseOpacity.stopAnimation();
      statusPulseOpacity.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(statusPulseOpacity, {
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          toValue: 0.45,
          useNativeDriver: true,
        }),
        Animated.timing(statusPulseOpacity, {
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();

    return () => {
      animation.stop();
      statusPulseOpacity.setValue(1);
    };
  }, [shellStatusIndicator.state, statusPulseOpacity]);

  useEffect(() => {
    if (!lastSync?.completedAt) {
      return;
    }

    const toastKey = `${lastSync.syncRunId ?? "sync"}:${lastSync.completedAt}`;

    if (lastToastSyncKeyRef.current === toastKey) {
      return;
    }

    lastToastSyncKeyRef.current = toastKey;

    const nextToast = resolveAppShellSuccessToast({
      operationsCompleted: lastSync.operationsCompleted,
      result: lastSync.result,
    });

    const timeout = nextToast ? setTimeout(() => setToast(nextToast), 0) : null;

    return () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [lastSync?.completedAt, lastSync?.operationsCompleted, lastSync?.result, lastSync?.syncRunId]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = setTimeout(() => setToast(null), APP_SHELL_TOAST_DURATION_MS);

    return () => clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!writeFeedbackSnapshot.id || !writeFeedbackSnapshot.scopeKey) return;
    const { id, scopeKey } = writeFeedbackSnapshot;
    const timeout = setTimeout(() => clearWriteFeedback(id, scopeKey), APP_SHELL_TOAST_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [writeFeedbackSnapshot]);

  useEffect(() => {
    if (isDiagnosticsOpen && selectedDiagnosticsTab === "state-update") {
      void refreshStateUpdateDiagnostics();
    }
  }, [isDiagnosticsOpen, refreshStateUpdateDiagnostics, selectedDiagnosticsTab]);

  useEffect(() => {
    if (persistentFeedback?.id === "sync-error") {
      void refreshStateUpdateDiagnostics();
    }
  }, [persistentFeedback?.id, refreshStateUpdateDiagnostics]);

  useEffect(() => {
    void refreshStateUpdateDiagnostics();
  }, [refreshStateUpdateDiagnostics, stateUpdateReconnectRefreshKey]);

  const feedback = persistentFeedback;
  const showFeedbackSpinner = shouldShowAppShellFeedbackSpinner(feedback);
  const userInitials = useMemo(() => getUserInitials(userDisplayName), [userDisplayName]);
  const recordsDiagnosticsRows = getSyncDiagnosticsRows({
    summary: recordsSyncSummary,
    telemetry: null,
  });
  const recordsFailedDiagnosticsSections = getRecordsFailedOperationDiagnosticsSections(recordsFailedOperations);
  const recordsFailedDiagnosticsCopyText = formatRecordsFailedOperationDiagnosticsCopyText(recordsFailedDiagnosticsSections);
  const recordsFailedOperationsNotice = getRecordsFailedOperationsNotice(recordsSyncSummary);
  const firstPendingSyncError = pendingStateUpdateSyncErrors[0] ?? null;
  const shouldShowRecordsSyncErrorDetail = recordsSyncSummary.failedCount > 0 && !firstPendingSyncError;
  const syncErrorMessage = shouldShowRecordsSyncErrorDetail
    ? "Un cambio de RECORDS no pudo sincronizarse. Revisa el detalle durable retenido localmente."
    : formatPendingSyncErrorMessage(firstPendingSyncError);
  const syncErrorTechnicalRows = shouldShowRecordsSyncErrorDetail ? [] : getPendingSyncErrorTechnicalRows(firstPendingSyncError);
  const pendingSyncErrorCount = shouldShowRecordsSyncErrorDetail
    ? recordsSyncSummary.failedCount
    : pendingStateUpdateSyncErrors.length;
  const syncErrorSubtitle = shouldShowRecordsSyncErrorDetail
    ? (pendingSyncErrorCount > 1 ? `${pendingSyncErrorCount} cambios retenidos con error` : "1 cambio retenido con error")
    : (pendingSyncErrorCount > 1 ? `${pendingSyncErrorCount} cambios no pudieron sincronizarse` : "1 cambio no pudo sincronizarse");
  const canRetryFirstPendingSyncError = Boolean(
    firstPendingSyncError?.manualRetryable && firstPendingSyncError.manualRetryToken,
  );
  const statusIndicator = (
    <View
      accessibilityLabel={`Estado ${shellStatusIndicator.label}. ${shellStatusIndicator.accessibilityLabel}`}
      accessibilityLiveRegion="polite"
      accessible
      style={styles.statusIndicator}
    >
      <Animated.View style={shellStatusIndicator.state === "working" ? { opacity: statusPulseOpacity } : null}>
        {statusIndicatorIcon(shellStatusIndicator.state)}
      </Animated.View>
      <Text style={styles.statusLabel}>{shellStatusIndicator.label}</Text>
    </View>
  );
  const userMenuButton = (
    <Pressable
      accessibilityLabel="Menu de usuario"
      accessibilityRole="button"
      onPress={() => setIsUserMenuOpen(true)}
      style={[styles.userButton, !isWideLayout ? styles.userButtonCompact : null]}
    >
      <View style={styles.userAvatar}>
        <Text style={styles.userAvatarText}>{userInitials}</Text>
      </View>
      <Text style={[styles.userButtonText, !isWideLayout ? styles.userButtonTextCompact : null]}>{userDisplayName}</Text>
    </Pressable>
  );

  function goBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace("/");
  }

  if (status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (status === "anonymous") {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <View style={styles.shell}>
      <View style={[styles.header, isWideLayout ? styles.headerWide : styles.headerCompact]}>
        <View style={styles.headerMainRow}>
          <View style={styles.headerIdentity}>
          {!isHome ? (
            <Pressable accessibilityRole="button" onPress={goBack} style={styles.backButton}>
              <Text style={styles.backText}>←</Text>
            </Pressable>
          ) : null}
          <View style={styles.titleBlock}>
            <View style={styles.titleRow}>
              <Text numberOfLines={1} style={[styles.title, isWideLayout ? null : styles.titleCompact]}>Opco Client</Text>
            </View>
          </View>
          </View>
          {isWideLayout ? <View style={styles.headerStatusZone}>{statusIndicator}</View> : null}
          <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel={GLOBAL_DIAGNOSTICS_BUTTON.accessibilityLabel}
            accessibilityRole="button"
            onPress={() => setIsDiagnosticsOpen(true)}
            style={styles.diagnosticsIconButton}
          >
            <AppIcon icon={GLOBAL_DIAGNOSTICS_BUTTON.icon} size={18} />
          </Pressable>
          {isWideLayout ? userMenuButton : null}
          </View>
        </View>
        {!isWideLayout ? <View style={styles.headerUserRow}>{userMenuButton}</View> : null}
        {!isWideLayout ? <View style={styles.headerStatusRow}>{statusIndicator}</View> : null}
      </View>

      {feedback ? (
        <View style={[styles.feedbackRow, isWideLayout ? styles.feedbackRowWide : styles.feedbackRowCompact]}>
          <View style={[
            styles.feedbackBanner,
            feedback.tone === "error" ? styles.feedbackBannerError : null,
            feedback.tone === "success" ? styles.feedbackBannerSuccess : null,
            feedback.tone === "warning" ? styles.feedbackBannerWarning : null,
            feedback.tone === "info" ? styles.feedbackBannerInfo : null,
          ]}>
            {showFeedbackSpinner ? <ActivityIndicator color="#135d66" size="small" /> : null}
            {feedback.visual === "info" ? (
              <View style={styles.feedbackInfoIcon}>
                <WifiOff color="#2f5e66" size={15} strokeWidth={2.2} />
              </View>
            ) : null}
            {feedback.visual === "error" ? (
              <View style={styles.feedbackErrorIcon}>
                <AlertCircle color="#b42318" size={16} strokeWidth={2.2} />
              </View>
            ) : null}
            {feedback.visual === "success" ? (
              <View style={styles.feedbackSuccessIcon}>
                <AppIcon color="#13795b" icon="clipboard-check" size={16} />
              </View>
            ) : null}
            <Text style={[
              styles.feedbackText,
              feedback.tone === "error" ? styles.feedbackTextError : null,
              feedback.tone === "success" ? styles.feedbackTextSuccess : null,
              feedback.tone === "warning" ? styles.feedbackTextWarning : null,
              feedback.tone === "info" ? styles.feedbackTextInfo : null,
            ]} numberOfLines={feedback.id === "offline" ? 1 : undefined}>
              {feedback.message}
            </Text>
            {persistentFeedback?.id === "sync-error" ? (
              <Pressable
                accessibilityLabel="Ver diagnostico de error de sincronizacion"
                accessibilityRole="button"
                onPress={() => {
                  setSelectedDiagnosticsTab(shouldShowRecordsSyncErrorDetail ? "records" : "state-update");
                  setIsDiagnosticsOpen(true);
                }}
                style={styles.feedbackDetailButton}
              >
                <Text style={styles.feedbackDetailText}>Ver diagnostico</Text>
              </Pressable>
            ) : null}
            {!persistentFeedback ? (
              <Pressable
                accessibilityLabel="Cerrar mensaje"
                accessibilityRole="button"
                onPress={() => setToast(null)}
                style={styles.feedbackCloseButton}
              >
                <Text style={styles.feedbackCloseText}>Cerrar</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={styles.content}>
        <Stack screenOptions={{ headerShown: false }} />
      </View>

      <Modal
        animationType="fade"
        onRequestClose={() => setIsDiagnosticsOpen(false)}
        transparent
        visible={isDiagnosticsOpen}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalPanel,
              styles.diagnosticsModalPanel,
              isWideLayout ? styles.diagnosticsModalPanelWide : styles.modalPanelCompact,
              { height: diagnosticsModalHeight, maxHeight: diagnosticsModalHeight },
            ]}
          >
            <View style={[styles.modalHeader, styles.diagnosticsModalHeader]}>
              <Text style={styles.modalTitle}>Diagnostico</Text>
              <Pressable
                accessibilityLabel="Cerrar diagnostico"
                accessibilityRole="button"
                onPress={() => setIsDiagnosticsOpen(false)}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>Cerrar</Text>
              </Pressable>
            </View>
            <View style={styles.diagnosticsNavigation}>
              <ScrollView
                contentContainerStyle={styles.diagnosticsTabList}
                horizontal
                showsHorizontalScrollIndicator={shouldShowDiagnosticsTabScrollIndicator(width)}
                style={styles.diagnosticsTabs}
              >
                {GLOBAL_DIAGNOSTIC_TABS.map((tab) => {
                  const isSelected = selectedDiagnosticsTab === tab.id;

                  return (
                    <Pressable
                      accessibilityRole="tab"
                      accessibilityState={{ selected: isSelected }}
                      key={tab.id}
                      onPress={() => setSelectedDiagnosticsTab(normalizeDiagnosticTabId(tab.id))}
                      style={[styles.diagnosticsTab, isSelected ? styles.diagnosticsTabSelected : null]}
                    >
                      <Text style={[styles.diagnosticsTabText, isSelected ? styles.diagnosticsTabTextSelected : null]}>
                        {tab.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
            <ScrollView
              contentContainerStyle={styles.diagnosticsContent}
              keyboardShouldPersistTaps="handled"
              style={styles.diagnosticsContentScroll}
            >
              {selectedDiagnosticsTab === "sync" ? (
                <SyncStatusDiagnosticsPanel
                  getSQLiteDiagnostics={definitionCache.getSQLiteCoordinatorDiagnostics}
                  key={`${ownerKey ?? "none"}:${selectedContractId ?? "none"}`}
                  diagnostics={syncStatusDiagnostics}
                  history={syncStatusHistory}
                />
              ) : null}
              {selectedDiagnosticsTab === "pwa" ? (
                <PwaDiagnostics diagnostics={offlineReadiness} offlinePreparationDiagnostics={offlinePreparationDiagnostics} showTitle={false} />
              ) : null}
              {selectedDiagnosticsTab === "performance" ? (
                <RecordsPerformanceDiagnostics key={`${ownerKey ?? "none"}:${selectedContractId ?? "none"}`} history={recordsOpeningHistory.history} />
              ) : null}
              {selectedDiagnosticsTab === "state-update" ? (
                <StateUpdateDiagnosticsPanel
                  diagnostics={diagnosticsStateUpdate.diagnostics}
                  error={diagnosticsStateUpdate.error}
                  isSyncing={diagnosticsStateUpdate.isSyncing}
                  onRefresh={diagnosticsStateUpdate.onRefresh}
                  onRetryFailed={diagnosticsStateUpdate.onRetryFailed}
                  onSyncNow={diagnosticsStateUpdate.onSyncNow}
                  reconnect={stateUpdateReconnectDiagnostics}
                  run={diagnosticsStateUpdate.run}
                  variant="embedded"
                />
              ) : null}
              {selectedDiagnosticsTab === "records" ? (
                <RecordsGlobalDiagnostics
                  copyText={recordsFailedDiagnosticsCopyText}
                  failedSections={recordsFailedDiagnosticsSections}
                  notice={recordsFailedOperationsNotice}
                  onRetryOperation={retryFailedRecordOperation}
                  rows={recordsDiagnosticsRows}
                  totalFailedCount={recordsSyncSummary.failedCount}
                />
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setIsSyncErrorModalOpen(false)}
        transparent
        visible={isSyncErrorModalOpen}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalPanel, isWideLayout ? styles.modalPanelWide : styles.modalPanelCompact]}>
            <View style={styles.modalHeader}>
              <View style={styles.syncErrorTitleBlock}>
                <Text style={styles.modalTitle}>Error de sincronizacion</Text>
                <Text style={styles.syncErrorSubtitle}>{syncErrorSubtitle}</Text>
              </View>
              <Pressable
                accessibilityLabel="Cerrar detalle de error de sincronizacion"
                accessibilityRole="button"
                onPress={() => setIsSyncErrorModalOpen(false)}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>Cerrar</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll}>
              <View style={styles.syncErrorMessageBox}>
                <Text style={styles.syncErrorMessage}>{syncErrorMessage}</Text>
              </View>
              <Text style={styles.diagnosticsTitle}>Detalle tecnico</Text>
              {syncErrorTechnicalRows.length > 0 ? (
                syncErrorTechnicalRows.map(([label, value]) => (
                  <View key={label} style={styles.diagnosticsRow}>
                    <Text style={styles.diagnosticsLabel}>{label}</Text>
                    <Text {...noTranslateProps} style={styles.diagnosticsValue}>{String(value)}</Text>
                  </View>
                ))
              ) : null}
              {shouldShowRecordsSyncErrorDetail ? (
                <RecordsFailedDiagnostics
                  copyText={recordsFailedDiagnosticsCopyText}
                  failedSections={recordsFailedDiagnosticsSections}
                  notice={recordsFailedOperationsNotice}
                  onRetryOperation={retryFailedRecordOperation}
                  totalFailedCount={recordsSyncSummary.failedCount}
                />
              ) : null}
            </ScrollView>
            <View style={styles.syncErrorFooter}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setIsDiagnosticsOpen(true);
                  setSelectedDiagnosticsTab(shouldShowRecordsSyncErrorDetail ? "records" : "state-update");
                  setIsSyncErrorModalOpen(false);
                }}
                style={styles.secondaryModalButton}
              >
                <Text style={styles.secondaryModalButtonText}>Abrir diagnostico</Text>
              </Pressable>
              {canRetryFirstPendingSyncError ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={diagnosticsStateUpdate.isSyncing}
                  onPress={() => {
                    void diagnosticsStateUpdate.onRetryFailed(firstPendingSyncError?.manualRetryToken ?? null);
                    setIsSyncErrorModalOpen(false);
                  }}
                  style={[styles.primaryModalButton, diagnosticsStateUpdate.isSyncing ? styles.primaryModalButtonDisabled : null]}
                >
                  <Text style={styles.primaryModalButtonText}>
                    {diagnosticsStateUpdate.isSyncing ? "Reintentando" : "Reintentar"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setIsUserMenuOpen(false)}
        transparent
        visible={isUserMenuOpen}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.userMenuPanel, isWideLayout ? styles.userMenuPanelWide : styles.userMenuPanelCompact]}>
            <View style={styles.userMenuHeader}>
              <View style={styles.userMenuIdentity}>
                <View style={styles.userAvatarLarge}>
                  <Text style={styles.userAvatarLargeText}>{userInitials}</Text>
                </View>
                <View style={styles.userMenuText}>
                  <Text numberOfLines={1} style={styles.userMenuName}>{userDisplayName}</Text>
                  {me?.user.email ? <Text numberOfLines={1} style={styles.userMenuEmail}>{me.user.email}</Text> : null}
                </View>
              </View>
              <Pressable
                accessibilityLabel="Cerrar menu de usuario"
                accessibilityRole="button"
                onPress={() => setIsUserMenuOpen(false)}
                style={styles.userMenuCloseButton}
              >
                <X color="#587078" size={18} strokeWidth={2.2} />
              </Pressable>
            </View>
            <View style={styles.userMenuBody} />
            <View style={styles.userMenuFooter}>
              <Pressable
                accessibilityLabel="Cerrar sesion"
                accessibilityRole="button"
                onPress={() => {
                  setIsUserMenuOpen(false);
                  void signOut();
                }}
                style={styles.logoutButton}
              >
                <LogOut color="#9f3412" size={16} strokeWidth={2.2} />
                <Text style={styles.logoutText}>Cerrar sesion</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function PwaDiagnostics({
  diagnostics,
  offlinePreparationDiagnostics,
  showTitle = true,
}: {
  diagnostics: ReturnType<typeof useOfflineReadiness>;
  offlinePreparationDiagnostics: OfflinePreparationDiagnostics | null;
  showTitle?: boolean;
}) {
  const rows = [
    ["runningMode", diagnostics.runningMode],
    ["serviceWorkerSupported", diagnostics.serviceWorkerSupported ? "yes" : "no"],
    ["registrationScope", diagnostics.registrationScope ?? "none"],
    ["controllerPresent", diagnostics.controllerPresent ? "yes" : "no"],
    ["activeScriptURL", diagnostics.activeScriptURL ? new URL(diagnostics.activeScriptURL).pathname : "none"],
    ["shellCacheVersion", diagnostics.shellCacheVersion ?? "none"],
    ["shellReady", diagnostics.shellReady ? "yes" : "no"],
    ["sessionSnapshotPresent", diagnostics.sessionSnapshotPresent ? "yes" : "no"],
    ["navigationCachePresent", diagnostics.navigationCachePresent ? "yes" : "no"],
    ["SQLiteReady", diagnostics.sqliteReady ? "yes" : "no"],
  ];
  const preparationRows = getOfflinePreparationRows(offlinePreparationDiagnostics);

  return (
    <View style={styles.diagnostics}>
      {showTitle ? <Text style={styles.diagnosticsTitle}>Diagnostico PWA</Text> : null}
      {rows.map(([label, value]) => (
        <View key={label} style={styles.diagnosticsRow}>
          <Text style={styles.diagnosticsLabel}>{label}</Text>
          <Text {...noTranslateProps} style={styles.diagnosticsValue}>{value}</Text>
        </View>
      ))}
      <Text style={styles.diagnosticsTitle}>Preparacion offline</Text>
      {preparationRows.map(([label, value]) => (
        <View key={label} style={styles.diagnosticsRow}>
          <Text style={styles.diagnosticsLabel}>{label}</Text>
          <Text {...noTranslateProps} style={styles.diagnosticsValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function SyncStatusDiagnosticsPanel({
  diagnostics,
  getSQLiteDiagnostics,
  history,
}: {
  diagnostics: ReturnType<typeof buildSyncStatusDiagnostics>;
  getSQLiteDiagnostics: () => SQLiteCoordinatorDiagnostics;
  history: SyncStatusHistory;
}) {
  const [copyState, setCopyState] = useState<"idle" | "success" | "error">("idle");
  const copyResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSince = [...history.events].reverse().find((event) => event.process === "Indicador")?.at ?? null;
  const sqliteDiagnostics = getSQLiteDiagnostics();

  async function handleCopy() {
    if (copyResetTimeout.current) {
      clearTimeout(copyResetTimeout.current);
    }

    try {
      await copyTextToClipboard(formatSyncStatusDiagnosticsCopy(diagnostics, history, getSQLiteDiagnostics()));
      setCopyState("success");
      copyResetTimeout.current = setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
    }
  }

  useEffect(() => () => {
    if (copyResetTimeout.current) clearTimeout(copyResetTimeout.current);
  }, []);

  return (
    <View style={styles.syncDiagnostics}>
      <View style={styles.syncDiagnosticsHeader}>
        <View style={styles.syncDiagnosticsTitleBlock}>
          <Text style={styles.diagnosticsTitle}>Sincronización</Text>
          <Text style={styles.syncDiagnosticsReason}>{diagnostics.reason}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={handleCopy} style={styles.secondaryModalButton}>
          <Text style={styles.secondaryModalButtonText}>
            {copyState === "success" ? "Copiado" : copyState === "error" ? "No se pudo copiar" : "Copiar diagnóstico de sincronización"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.syncSummaryGrid}>
        <SyncSummaryValue label="Estado actual" value={syncStateLabel(diagnostics.indicator.state)} />
        <SyncSummaryValue label="Anima" value={diagnostics.indicator.state === "working" ? "Sí" : "No"} />
        <SyncSummaryValue label="Desde" value={currentSince ?? "Sin información"} />
        <SyncSummaryValue label="Último éxito" value={diagnostics.lastSuccessfulSyncAt ?? "Sin información"} />
      </View>
      <Text style={styles.syncActivitiesText}>
        Actividades concurrentes: {diagnostics.activities.join(", ") || "Ninguna"}
      </Text>
      <Text style={styles.syncActivitiesText}>
        SQLite activa: {sqliteDiagnostics.active?.name ?? "Ninguna"} · En espera: {sqliteDiagnostics.waitingTotal}
      </Text>

      <Text style={styles.diagnosticsTitle}>Checklist automático</Text>
      <View style={styles.syncChecklist}>
        {diagnostics.checklist.map((entry) => (
          <DiagnosticDisclosureRow
            key={entry.id}
            icon={syncStateIcon(entry.state)}
            primary={entry.label}
            secondary={`${entry.state}${entry.count !== null ? ` (${entry.count})` : ""}`}
          >
              <Text style={styles.syncChecklistDetail}>{entry.detail}</Text>
              <Text style={styles.syncChecklistMeta}>
                Comprobado: {entry.checkedAt ?? "Sin información"} · Inicio: {activeSince(entry, history)} · Duración: {formatActiveDuration(activeSince(entry, history))}
              </Text>
          </DiagnosticDisclosureRow>
        ))}
      </View>

      <Text style={styles.diagnosticsTitle}>Historial breve</Text>
      <Text style={styles.syncHistoryNotice}>En memoria, máximo 50 eventos; se limpia al cerrar o cambiar sesión/contrato.</Text>
      {history.events.length ? [...history.events].reverse().map((event, index) => (
        <DiagnosticDisclosureRow
          key={`${event.at}:${event.process}:${event.runId ?? index}`}
          primary={event.process}
          secondary={`${event.at} · ${event.to}`}
        >
          <Text style={styles.syncHistoryTransition}>{event.from} → {event.to}</Text>
          <Text style={styles.syncChecklistDetail}>{event.reason}</Text>
          {event.runId ? <Text style={styles.syncChecklistMeta}>run: {event.runId}</Text> : null}
        </DiagnosticDisclosureRow>
      )) : <Text style={styles.syncHistoryNotice}>Sin información</Text>}
    </View>
  );
}

function SyncSummaryValue({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.syncSummaryValue}>
      <Text style={styles.diagnosticsLabel}>{label}</Text>
      <Text selectable style={styles.diagnosticsValue}>{value}</Text>
    </View>
  );
}

function syncStateLabel(state: ReturnType<typeof buildSyncStatusDiagnostics>["indicator"]["state"]) {
  if (state === "working") return "En curso";
  if (state === "pending") return "Pendiente";
  if (state === "error") return "Error";
  if (state === "offline") return "Offline";
  return "Correcto";
}

function syncStateIcon(state: SyncChecklistState) {
  if (state === "Correcto") return <CheckCircle2 color="#13795b" size={18} />;
  if (state === "En curso") return <Clock3 color="#b7791f" size={18} />;
  if (state === "Error") return <AlertCircle color="#b42318" size={18} />;
  return <CircleDashed color="#64757b" size={18} />;
}

function statusIndicatorIcon(state: ReturnType<typeof resolveAppShellStatusIndicator>["state"]) {
  if (state === "online") return <CheckCircle2 color="#13795b" size={17} />;
  if (state === "working") return <Clock3 color="#b7791f" size={17} />;
  if (state === "offline") return <WifiOff color="#64757b" size={17} />;
  if (state === "error") return <AlertCircle color="#b42318" size={17} />;
  return <CircleDashed color="#b7791f" size={17} />;
}

function RecordsPerformanceDiagnostics({ history }: { history: RecordsOpeningMeasurement[] }) {
  const [copyState, setCopyState] = useState<"idle" | "success" | "error">("idle");
  const copyResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyResetTimeout.current) clearTimeout(copyResetTimeout.current);
  }, []);

  async function handleCopy() {
    try {
      await copyTextToClipboard(formatRecordsOpeningPerformanceCopy(history));
      setCopyState("success");
      if (copyResetTimeout.current) clearTimeout(copyResetTimeout.current);
      copyResetTimeout.current = setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
    }
  }

  return (
    <View style={styles.diagnostics}>
      <View style={styles.diagnosticsSectionHeader}>
        <View style={styles.performanceTitleBlock}>
          <Text style={styles.diagnosticsTitle}>Rendimiento de experiencias</Text>
          <Text style={styles.diagnosticsNotice}>El detalle indica si cada medición comenzó en la ruta o en el renderer.</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={handleCopy} style={styles.secondaryModalButton}>
          <Text style={styles.secondaryModalButtonText}>
            {copyState === "success" ? "Copiado" : copyState === "error" ? "No se pudo copiar" : "Copiar diagnóstico de rendimiento"}
          </Text>
        </Pressable>
      </View>
      {history.length === 0 ? <Text style={styles.diagnosticsNotice}>Sin información</Text> : history.map((entry) => (
        <DiagnosticDisclosureRow
          key={entry.id}
          primary={entry.appViewTitle}
          secondary={`${getOpeningPrimaryTimingLabel(entry)} · ${performanceResultLabel(entry.result)}`}
        >
          <Text style={styles.syncHistoryAt}>{entry.startedAt} · {entry.appViewType ?? "RECORDS"}{entry.variant ? ` / ${entry.variant}` : ""}</Text>
          {performanceRows(entry).map(([label, value]) => (
            <View key={`${entry.id}:${label}`} style={styles.diagnosticsRow}>
              <Text style={styles.diagnosticsLabel}>{label}</Text>
              <Text {...noTranslateProps} style={styles.diagnosticsValue}>{value}</Text>
            </View>
          ))}
        </DiagnosticDisclosureRow>
      ))}
    </View>
  );
}

function performanceRows(entry: RecordsOpeningMeasurement): [string, string][] {
  return [
    ["Medición", entry.id],
    ["Fuente inicial", entry.source],
    ["Origen de medición", entry.origin ?? "renderer (historial anterior)"],
    ["Tipo / variante", `${entry.appViewType ?? "RECORDS"} / ${entry.variant ?? "No aplica"}`],
    ["Cobertura local", entry.coverage],
    ["Mostrados / procesados", `${entry.shownCount} / ${entry.processedCount}`],
    ["Primeras filas", performanceDuration(entry.timeToFirstRowsMs)],
    ["Primera presentación útil", performanceDuration(entry.firstUsefulContentMs ?? entry.timeToFirstRowsMs)],
    ["Lista para operar", performanceDuration(entry.readyMs ?? null)],
    ["Resolución de experiencia", performanceDuration(entry.appViewResolutionMs ?? null)],
    ["Lectura local", performanceDuration(entry.localReadMs)],
    ["Actualización remota", performanceDuration(entry.remoteRefreshMs)],
    ["Preparación", performanceDuration(entry.preparationMs)],
    ["Error", entry.errorCode ?? "none"],
    ["Módulos PANEL", entry.moduleSummary ? `${entry.moduleSummary.loaded} cargados, ${entry.moduleSummary.empty} vacíos, ${entry.moduleSummary.failed} fallidos, ${entry.moduleSummary.total} total` : "No aplica"],
  ];
}

function performanceDuration(value: number | null) {
  return value === null ? "Sin información" : `${value} ms`;
}

function performanceResultLabel(result: RecordsOpeningMeasurement["result"]) {
  if (result === "in_progress") return "En curso";
  if (result === "completed") return "Completado";
  if (result === "cancelled") return "Cancelado";
  if (result === "interrupted") return "Interrumpido";
  return "Error";
}

function RecordsGlobalDiagnostics({
  copyText,
  failedSections,
  notice,
  onRetryOperation,
  rows,
  totalFailedCount,
}: {
  copyText: string;
  failedSections: ReturnType<typeof getRecordsFailedOperationDiagnosticsSections>;
  notice: string | null;
  onRetryOperation(manualRetryToken: string): Promise<void>;
  rows: [string, string | number | boolean | null][];
  totalFailedCount: number;
}) {
  return (
    <View style={styles.diagnostics}>
      <Text style={styles.diagnosticsTitle}>RECORDS</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.diagnosticsRow}>
          <Text style={styles.diagnosticsLabel}>{label}</Text>
          <Text {...noTranslateProps} style={styles.diagnosticsValue}>{String(value)}</Text>
        </View>
      ))}
      <RecordsFailedDiagnostics
        copyText={copyText}
        failedSections={failedSections}
        notice={notice}
        onRetryOperation={onRetryOperation}
        totalFailedCount={totalFailedCount}
      />
    </View>
  );
}

function RecordsFailedDiagnostics({
  copyText,
  failedSections,
  notice,
  onRetryOperation,
  totalFailedCount,
}: {
  copyText: string;
  failedSections: ReturnType<typeof getRecordsFailedOperationDiagnosticsSections>;
  notice: string | null;
  onRetryOperation(manualRetryToken: string): Promise<void>;
  totalFailedCount: number;
}) {
  const [copyState, setCopyState] = useState<"idle" | "success" | "error">("idle");
  const [retryingToken, setRetryingToken] = useState<string | null>(null);
  const copyResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyResetTimeout.current) {
      clearTimeout(copyResetTimeout.current);
    }
  }, []);

  if (totalFailedCount <= 0) {
    return null;
  }

  async function handleCopyRecordsDiagnostics() {
    if (!copyText.trim()) {
      return;
    }

    if (copyResetTimeout.current) {
      clearTimeout(copyResetTimeout.current);
      copyResetTimeout.current = null;
    }

    try {
      await copyTextToClipboard(copyText);
      setCopyState("success");
      copyResetTimeout.current = setTimeout(() => {
        setCopyState("idle");
        copyResetTimeout.current = null;
      }, 2000);
    } catch {
      setCopyState("error");
    }
  }

  async function handleRetryOperation(manualRetryToken: string) {
    setRetryingToken(manualRetryToken);

    try {
      await onRetryOperation(manualRetryToken);
    } finally {
      setRetryingToken(null);
    }
  }

  const canCopy = copyText.trim().length > 0;
  const copyButtonText = copyState === "success"
    ? "Copiado"
    : copyState === "error"
      ? "No se pudo copiar"
      : "Copiar diagnóstico";

  return (
    <View style={styles.diagnosticsSection}>
      <View style={styles.diagnosticsSectionHeader}>
        <Text style={styles.diagnosticsTitle}>Errores de RECORDS</Text>
        <Pressable
          accessibilityRole="button"
          disabled={!canCopy}
          onPress={handleCopyRecordsDiagnostics}
          style={[styles.secondaryModalButton, !canCopy ? styles.primaryModalButtonDisabled : null]}
        >
          <Text style={styles.secondaryModalButtonText}>{copyButtonText}</Text>
        </Pressable>
      </View>
      {notice ? <Text style={styles.diagnosticsNotice}>{notice}</Text> : null}
      {failedSections.length > 0 ? (
          failedSections.map((section) => (
          <DiagnosticDisclosureRow
            action={section.action.kind === "correct-required" ? (
                <Text style={styles.diagnosticsNotice}>Resolver error</Text>
              ) : section.manualRetryable && section.manualRetryToken ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={retryingToken === section.manualRetryToken}
                  onPress={() => {
                    if (section.manualRetryToken) {
                      void handleRetryOperation(section.manualRetryToken);
                    }
                  }}
                  style={[styles.secondaryModalButton, retryingToken === section.manualRetryToken ? styles.primaryModalButtonDisabled : null]}
                >
                  <Text style={styles.secondaryModalButtonText}>
                    {retryingToken === section.manualRetryToken ? "Reintentando" : "Reintentar"}
                  </Text>
                </Pressable>
              ) : null}
            key={section.title}
            primary={section.title}
            secondary={String(section.rows.find(([label]) => label.toLowerCase().includes("estado"))?.[1] ?? "Error")}
          >
            {section.rows.map(([label, value]) => (
              <View key={`${section.title}:${label}`} style={styles.diagnosticsRow}>
                <Text style={styles.diagnosticsLabel}>{label}</Text>
                <Text {...noTranslateProps} style={styles.diagnosticsValue}>{String(value)}</Text>
              </View>
            ))}
          </DiagnosticDisclosureRow>
        ))
      ) : (
        <Text style={styles.diagnosticsNotice}>
          Hay errores durables de RECORDS, pero no se pudo resolver la operacion asociada.
        </Text>
      )}
    </View>
  );
}

function DiagnosticDisclosureRow({
  action,
  children,
  icon,
  primary,
  secondary,
}: {
  action?: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
  primary: string;
  secondary: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={styles.disclosureRow}>
      <View style={styles.disclosureSummaryLine}>
        <Pressable
          accessibilityHint="Muestra u oculta el detalle"
          accessibilityLabel={`${primary}. ${secondary}`}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((value) => !value)}
          style={styles.disclosureToggle}
        >
          <View style={styles.disclosureIndicator}>{expanded ? <ChevronDown color="#135d66" size={18} /> : <ChevronRight color="#135d66" size={18} />}</View>
          {icon ? <View style={styles.syncChecklistIcon}>{icon}</View> : null}
          <Text style={styles.disclosurePrimary}>{primary}</Text>
          <Text style={styles.disclosureSecondary}>{secondary}</Text>
        </Pressable>
        {action ? <View style={styles.disclosureAction}>{action}</View> : null}
      </View>
      {expanded ? <View style={styles.disclosureDetail}>{children}</View> : null}
    </View>
  );
}

async function copyTextToClipboard(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard unavailable");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");

    if (!copied) {
      throw new Error("Clipboard copy failed");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

function getOfflinePreparationRows(diagnostics: OfflinePreparationDiagnostics | null) {
  if (!diagnostics) {
    return [
      ["Estado", "idle"],
      ["AppViews", "0/0"],
      ["Ultima AppView", "none"],
      ["Top lento", "none"],
    ];
  }

  return [
    ["Estado", diagnostics.status],
    ["startedAt", diagnostics.prewarmStartedAt ?? "none"],
    ["completedAt", diagnostics.prewarmCompletedAt ?? "none"],
    ["durationMs", String(diagnostics.prewarmDurationMs ?? "none")],
    ["slow", diagnostics.slow ? "yes" : "no"],
    ["AppViews", `${diagnostics.appViews.completed}/${diagnostics.appViews.total}`],
    ["failed", String(diagnostics.appViews.failed)],
    ["running", String(diagnostics.appViews.running)],
    ["Ultima AppView", diagnostics.lastAppView ? `${diagnostics.lastAppView.fingerprint} ${diagnostics.lastAppView.stage} ${diagnostics.lastAppView.result}` : "none"],
    ["Top lento", diagnostics.slowestStages.map((stage) => `${stage.stage}:${stage.durationMs ?? "none"}ms`).join(", ") || "none"],
  ];
}

function getUserInitials(value: string | null | undefined) {
  if (!value) {
    return "?";
  }

  const parts = value
    .replace(/@.*/, "")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#ffffff",
    borderColor: "#b8c7ca",
    borderRadius: 24,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  backText: {
    color: "#135d66",
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 26,
  },
  center: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  content: {
    flex: 1,
  },
  diagnostics: {
    backgroundColor: "#ffffff",
    gap: 6,
  },
  diagnosticsIconButton: {
    alignItems: "center",
    borderColor: "#b8c7ca",
    borderRadius: 8,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  diagnosticsLabel: {
    color: "#587078",
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  diagnosticsRow: {
    flexDirection: "row",
    gap: 8,
  },
  diagnosticsModalPanelWide: {
    maxWidth: 920,
  },
  diagnosticsModalHeader: {
    flexShrink: 0,
    padding: 16,
  },
  diagnosticsModalPanel: {
    gap: 0,
    padding: 0,
  },
  diagnosticsNavigation: {
    borderBottomColor: "#d9e3e5",
    borderBottomWidth: 1,
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  diagnosticsContent: {
    padding: 16,
    paddingBottom: 20,
  },
  diagnosticsContentScroll: {
    flex: 1,
    minHeight: 0,
  },
  diagnosticsNotice: {
    color: "#587078",
    fontSize: 12,
    lineHeight: 17,
  },
  diagnosticsTab: {
    alignItems: "center",
    backgroundColor: "#eef4f4",
    borderColor: "#c8d2d5",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 14,
  },
  diagnosticsTabList: {
    flexDirection: "row",
    gap: 8,
    paddingBottom: 4,
    paddingRight: 2,
  },
  diagnosticsTabSelected: {
    backgroundColor: "#135d66",
    borderColor: "#135d66",
  },
  diagnosticsTabs: {
    flexGrow: 0,
    flexShrink: 0,
  },
  diagnosticsTabText: {
    color: "#17363c",
    fontSize: 12,
    fontWeight: "800",
  },
  diagnosticsTabTextSelected: {
    color: "#ffffff",
  },
  diagnosticsTitle: {
    color: "#17363c",
    fontSize: 14,
    fontWeight: "800",
  },
  diagnosticsSection: {
    borderColor: "#d9e3e5",
    borderTopWidth: 1,
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
  },
  diagnosticsSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
  diagnosticsSectionTitle: {
    color: "#17363c",
    fontSize: 12,
    fontWeight: "800",
  },
  diagnosticsSubsection: {
    gap: 6,
  },
  diagnosticsValue: {
    color: "#17363c",
    flex: 1,
    fontSize: 12,
    minWidth: 0,
    textAlign: "right",
  },
  header: {
    alignItems: "stretch",
    minHeight: 56,
    width: "100%",
  },
  headerActions: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "flex-end",
    minWidth: 0,
  },
  headerMainRow: {
    alignItems: "center",
    flexDirection: "row",
    width: "100%",
  },
  headerStatusRow: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 8,
    width: "100%",
  },
  headerStatusZone: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
  },
  headerUserRow: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 4,
    width: "100%",
  },
  headerCompact: {
    paddingHorizontal: APP_SHELL_HORIZONTAL_GUTTER,
    paddingVertical: 10,
  },
  headerWide: {
    paddingHorizontal: APP_SHELL_HORIZONTAL_GUTTER,
    paddingTop: 20,
  },
  headerIdentity: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 12,
    minWidth: 0,
  },
  feedbackBanner: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#c8d2d5",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  feedbackBannerError: {
    backgroundColor: "#fff7f7",
    borderColor: "#f1b8b8",
  },
  feedbackBannerInfo: {
    backgroundColor: "#f3f8f8",
    borderColor: "#d6e4e6",
  },
  feedbackBannerSuccess: {
    backgroundColor: "#eefbf4",
    borderColor: "#b9e4c9",
  },
  feedbackBannerWarning: {
    backgroundColor: "#fff7e0",
    borderColor: "#f0c36d",
  },
  feedbackCloseButton: {
    minHeight: 32,
    justifyContent: "center",
  },
  feedbackCloseText: {
    color: "#135d66",
    fontWeight: "800",
  },
  feedbackDetailButton: {
    alignItems: "center",
    borderColor: "#f1b8b8",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 10,
  },
  feedbackDetailText: {
    color: "#b42318",
    fontSize: 12,
    fontWeight: "800",
  },
  feedbackErrorIcon: {
    alignItems: "center",
    flexShrink: 0,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  feedbackSuccessIcon: {
    alignItems: "center",
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  feedbackInfoIcon: {
    alignItems: "center",
    flexShrink: 0,
    height: 18,
    justifyContent: "center",
    width: 18,
  },
  feedbackRow: {
    width: "100%",
  },
  feedbackRowCompact: {
    paddingHorizontal: APP_SHELL_HORIZONTAL_GUTTER,
    paddingTop: 10,
  },
  feedbackRowWide: {
    paddingHorizontal: APP_SHELL_HORIZONTAL_GUTTER,
    paddingTop: 12,
  },
  feedbackText: {
    color: "#17363c",
    flex: 1,
    fontWeight: "700",
    lineHeight: 20,
    minWidth: 0,
  },
  feedbackTextError: {
    color: "#b42318",
  },
  feedbackTextInfo: {
    color: "#2f5e66",
  },
  feedbackTextSuccess: {
    color: "#13795b",
  },
  feedbackTextWarning: {
    color: "#6f4f08",
  },
  logoutButton: {
    alignItems: "center",
    alignSelf: "flex-end",
    backgroundColor: "#ffffff",
    borderColor: "#d8e2e4",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  logoutText: {
    color: "#9f3412",
    fontWeight: "800",
  },
  modalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(15, 48, 54, 0.45)",
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  modalCloseButton: {
    alignItems: "center",
    backgroundColor: "#eef4f4",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 12,
  },
  modalCloseText: {
    color: "#135d66",
    fontWeight: "800",
  },
  modalHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  modalPanel: {
    backgroundColor: "#ffffff",
    borderRadius: 8,
    gap: 14,
    maxHeight: "86%",
    padding: 16,
    width: "100%",
  },
  modalPanelCompact: {
    maxWidth: 620,
  },
  modalPanelWide: {
    maxWidth: 680,
  },
  modalScroll: {
    flexShrink: 1,
  },
  modalTitle: {
    color: "#17363c",
    flex: 1,
    fontSize: 18,
    fontWeight: "800",
  },
  primaryModalButton: {
    alignItems: "center",
    backgroundColor: "#135d66",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 14,
  },
  primaryModalButtonDisabled: {
    opacity: 0.55,
  },
  primaryModalButtonText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  disclosureAction: {
    flexShrink: 0,
  },
  disclosureDetail: {
    gap: 6,
    paddingBottom: 12,
    paddingHorizontal: 12,
  },
  disclosureIndicator: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
    width: 20,
  },
  disclosurePrimary: {
    color: "#17363c",
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "800",
    minWidth: 120,
  },
  disclosureRow: {
    borderBottomColor: "#d9e3e5",
    borderBottomWidth: 1,
  },
  disclosureSecondary: {
    color: "#425d64",
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  disclosureSummaryLine: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingVertical: 4,
  },
  disclosureToggle: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 6,
    borderWidth: 2,
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    minHeight: 44,
    minWidth: 0,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  performanceEntry: {
    borderBottomColor: "#d9e3e5",
    borderBottomWidth: 1,
    gap: 6,
    paddingVertical: 12,
  },
  performanceEntryTitle: {
    color: "#17363c",
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
    minWidth: 180,
  },
  performanceResult: {
    color: "#425d64",
    fontSize: 12,
    fontWeight: "800",
  },
  performanceTitleBlock: {
    flex: 1,
    gap: 4,
    minWidth: 220,
  },
  secondaryModalButton: {
    alignItems: "center",
    backgroundColor: "#eef4f4",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 14,
  },
  secondaryModalButtonText: {
    color: "#135d66",
    fontWeight: "800",
  },
  shell: {
    backgroundColor: "#eef4f4",
    flex: 1,
    overflow: "hidden",
  },
  statusIndicator: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: 6,
    minWidth: 0,
    justifyContent: "center",
  },
  statusLabel: {
    color: "#425d64",
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
    textAlign: "center",
  },
  syncActivitiesText: {
    color: "#425d64",
    fontSize: 12,
    lineHeight: 18,
  },
  syncChecklist: {
    borderColor: "#d9e3e5",
    borderTopWidth: 1,
  },
  syncChecklistContent: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  syncChecklistDetail: {
    color: "#425d64",
    fontSize: 12,
    lineHeight: 17,
  },
  syncChecklistHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
  syncChecklistIcon: {
    paddingTop: 1,
    width: 22,
  },
  syncChecklistLabel: {
    color: "#17363c",
    flexGrow: 1,
    fontSize: 13,
    fontWeight: "800",
  },
  syncChecklistMeta: {
    color: "#6b7f85",
    fontSize: 11,
    lineHeight: 16,
  },
  syncChecklistRow: {
    alignItems: "flex-start",
    borderBottomColor: "#e5ecee",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingVertical: 9,
  },
  syncChecklistState: {
    color: "#425d64",
    fontSize: 12,
    fontWeight: "700",
  },
  syncDiagnostics: {
    backgroundColor: "#ffffff",
    gap: 12,
  },
  syncDiagnosticsHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
  },
  syncDiagnosticsReason: {
    color: "#425d64",
    fontSize: 13,
    lineHeight: 18,
  },
  syncDiagnosticsTitleBlock: {
    flex: 1,
    gap: 4,
    minWidth: 220,
  },
  syncHistoryAt: {
    color: "#6b7f85",
    fontSize: 11,
  },
  syncHistoryNotice: {
    color: "#6b7f85",
    fontSize: 11,
    lineHeight: 16,
  },
  syncHistoryProcess: {
    color: "#17363c",
    fontSize: 12,
    fontWeight: "800",
  },
  syncHistoryRow: {
    borderBottomColor: "#e5ecee",
    borderBottomWidth: 1,
    gap: 3,
    paddingVertical: 8,
  },
  syncHistoryTransition: {
    color: "#425d64",
    fontSize: 12,
    fontWeight: "700",
  },
  syncSummaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  syncSummaryValue: {
    backgroundColor: "#f4f7f7",
    borderColor: "#d9e3e5",
    borderRadius: 6,
    borderWidth: 1,
    flexBasis: 180,
    flexGrow: 1,
    gap: 3,
    minWidth: 0,
    padding: 9,
  },
  syncErrorFooter: {
    borderColor: "#d8e2e4",
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-end",
    paddingTop: 12,
  },
  syncErrorMessage: {
    color: "#17363c",
    fontSize: 14,
    lineHeight: 20,
  },
  syncErrorMessageBox: {
    backgroundColor: "#fff7f7",
    borderColor: "#f1b8b8",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  syncErrorSubtitle: {
    color: "#587078",
    fontSize: 12,
    fontWeight: "700",
  },
  syncErrorTitleBlock: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  title: {
    color: "#0f3036",
    fontSize: 26,
    fontWeight: "800",
  },
  titleCompact: {
    fontSize: 22,
  },
  titleBlock: {
    flexShrink: 1,
    minWidth: 0,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    minWidth: 0,
  },
  userAvatar: {
    alignItems: "center",
    backgroundColor: "#e4f1f2",
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
    flexShrink: 0,
    width: 32,
  },
  userAvatarLarge: {
    alignItems: "center",
    backgroundColor: "#e4f1f2",
    borderRadius: 24,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  userAvatarLargeText: {
    color: "#135d66",
    fontWeight: "900",
  },
  userAvatarText: {
    color: "#135d66",
    fontSize: 12,
    fontWeight: "900",
  },
  userButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    maxWidth: 220,
    minHeight: 40,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  userButtonText: {
    color: "#17363c",
    flexShrink: 1,
    fontWeight: "800",
    lineHeight: 18,
    textAlign: "right",
  },
  userButtonCompact: {
    justifyContent: "center",
    maxWidth: "100%",
    width: "100%",
  },
  userButtonTextCompact: {
    textAlign: "left",
  },
  userMenuBody: {
    minHeight: 20,
  },
  userMenuCloseButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  userMenuEmail: {
    color: "#587078",
    flexShrink: 1,
    marginTop: 2,
  },
  userMenuFooter: {
    alignItems: "flex-end",
    borderTopColor: "#e1e8ea",
    borderTopWidth: 1,
    paddingTop: 14,
  },
  userMenuHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  userMenuIdentity: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 12,
    minWidth: 0,
  },
  userMenuName: {
    color: "#17363c",
    flexShrink: 1,
    fontSize: 18,
    fontWeight: "800",
  },
  userMenuPanel: {
    backgroundColor: "#ffffff",
    borderRadius: 8,
    gap: 14,
    maxHeight: "86%",
    padding: 16,
    width: "100%",
  },
  userMenuPanelCompact: {
    maxWidth: 420,
  },
  userMenuPanelWide: {
    maxWidth: 460,
  },
  userMenuText: {
    flex: 1,
    minWidth: 0,
  },
});
