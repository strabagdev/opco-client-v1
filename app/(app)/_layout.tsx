import { Redirect, Stack, usePathname, useRouter } from "expo-router";
import { AlertCircle, LogOut, WifiOff, X } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { AppIcon } from "@/components/app-icon";
import { GLOBAL_DIAGNOSTIC_TABS, GLOBAL_DIAGNOSTICS_BUTTON, normalizeDiagnosticTabId, type DiagnosticTabId } from "@/lib/app-diagnostics";
import {
  classifyAppShellVisibleErrorEvent,
  resolveAppShellPersistentFeedback,
  resolveAppShellSuccessToast,
  resolveAppShellStatusIndicator,
  shouldShowAppShellFeedbackSpinner,
} from "@/lib/app-shell-feedback";
import type { OfflinePreparationDiagnostics } from "@/lib/app-view-prewarm";
import { APP_SHELL_HORIZONTAL_GUTTER, APP_SHELL_WIDE_BREAKPOINT } from "@/lib/app-shell-layout";
import {
  formatPendingSyncErrorMessage,
  getPendingStateUpdateSyncErrors,
  getPendingSyncErrorTechnicalRows,
} from "@/lib/pending-sync-errors";
import { useOfflineReadiness } from "@/lib/use-offline-readiness";
import {
  getRecordsFailedOperationDiagnosticsSections,
  getRecordsFailedOperationsNotice,
  getSyncDiagnosticsRows,
} from "@/renderers/records/sync-diagnostics";
import { StateUpdateDiagnosticsPanel, useSession } from "@/state/session";

const APP_SHELL_TOAST_DURATION_MS = 3500;

export default function AppLayout() {
  const {
    connectivityStatus,
    context,
    isAuthSessionRestoring,
    diagnosticsStateUpdate,
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
    selectedContractId,
    signOut,
    stateUpdateReconnectDiagnostics,
    stateUpdateReconnectRefreshKey,
    status,
  } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);
  const [isSyncErrorModalOpen, setIsSyncErrorModalOpen] = useState(false);
  const [selectedDiagnosticsTab, setSelectedDiagnosticsTab] = useState<DiagnosticTabId>("pwa");
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [toast, setToast] = useState<ReturnType<typeof resolveAppShellSuccessToast>>(null);
  const [statusPulseOpacity] = useState(() => new Animated.Value(1));
  const lastToastSyncKeyRef = useRef<string | null>(null);
  const isHome = pathname === "/";
  const isWideLayout = width >= APP_SHELL_WIDE_BREAKPOINT;
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
  const persistentFeedback = resolveAppShellPersistentFeedback({
    connectivityStatus,
    hasConflict: syncConflictCount > 0,
    hasError: hasSyncError,
    hasReadConnectivityIssue: visibleErrorKind === "read",
    isAuthSessionRestoring,
    isOfflinePreparationRunning: offlinePreparationDiagnostics?.status === "running",
    isOperationalCoreReadinessChecking,
    isPendingWorkSyncing,
    localStorageRecoveryNotice,
    offlineReadiness: offlineReadiness.offlineReadiness,
    pendingCount: pendingRecordsCount,
    syncConflictCount,
    syncErrorCount: durableSyncErrorCount,
  });
  const shellStatusIndicator = resolveAppShellStatusIndicator({
    connectivityStatus,
    hasConflict: syncConflictCount > 0,
    hasError: hasSyncError,
    hasReadConnectivityIssue: visibleErrorKind === "read",
    isAuthSessionRestoring,
    isOfflinePreparationRunning: offlinePreparationDiagnostics?.status === "running",
    isOperationalCoreReadinessChecking,
    isPendingWorkSyncing,
    localStorageRecoveryNotice,
    offlineReadiness: offlineReadiness.offlineReadiness,
    pendingCount: pendingRecordsCount,
  });
  const lastSync = stateUpdateReconnectDiagnostics.lastStateUpdateSync;
  const refreshStateUpdateDiagnostics = diagnosticsStateUpdate.onRefresh;

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

  const feedback = persistentFeedback ?? toast;
  const showFeedbackSpinner = shouldShowAppShellFeedbackSpinner(feedback);
  const userInitials = useMemo(() => getUserInitials(userDisplayName), [userDisplayName]);
  const recordsDiagnosticsRows = getSyncDiagnosticsRows({
    summary: recordsSyncSummary,
    telemetry: null,
  });
  const recordsFailedDiagnosticsSections = getRecordsFailedOperationDiagnosticsSections(recordsFailedOperations);
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
        <View style={styles.headerIdentity}>
          {!isHome ? (
            <Pressable accessibilityRole="button" onPress={goBack} style={styles.backButton}>
              <Text style={styles.backText}>←</Text>
            </Pressable>
          ) : null}
          <View style={styles.titleBlock}>
            <View style={styles.titleRow}>
              <Text numberOfLines={1} style={[styles.title, isWideLayout ? null : styles.titleCompact]}>Opco Client</Text>
              <Animated.View accessible accessibilityLabel={shellStatusIndicator.accessibilityLabel} style={[
                styles.statusDot,
                shellStatusIndicator.state === "online" ? styles.statusDotOnline : null,
                shellStatusIndicator.state === "working" ? styles.statusDotWorking : null,
                shellStatusIndicator.state === "offline" ? styles.statusDotOffline : null,
                shellStatusIndicator.state === "error" ? styles.statusDotError : null,
                shellStatusIndicator.state === "working" ? { opacity: statusPulseOpacity } : null,
              ]} />
            </View>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel={GLOBAL_DIAGNOSTICS_BUTTON.accessibilityLabel}
            accessibilityRole="button"
            onPress={() => setIsDiagnosticsOpen(true)}
            style={styles.diagnosticsIconButton}
          >
            <AppIcon icon={GLOBAL_DIAGNOSTICS_BUTTON.icon} size={18} />
          </Pressable>
          <Pressable
            accessibilityLabel="Menu de usuario"
            accessibilityRole="button"
            onPress={() => setIsUserMenuOpen(true)}
            style={styles.userButton}
          >
            <View style={styles.userAvatar}>
              <Text style={styles.userAvatarText}>{userInitials}</Text>
            </View>
            <Text numberOfLines={1} style={styles.userButtonText}>{userDisplayName}</Text>
          </Pressable>
        </View>
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
                accessibilityLabel="Ver detalle de error de sincronizacion"
                accessibilityRole="button"
                onPress={() => setIsSyncErrorModalOpen(true)}
                style={styles.feedbackDetailButton}
              >
                <Text style={styles.feedbackDetailText}>Ver detalle</Text>
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
          <View style={[styles.modalPanel, isWideLayout ? styles.diagnosticsModalPanelWide : styles.modalPanelCompact]}>
            <View style={styles.modalHeader}>
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.diagnosticsTabs}>
              <View style={styles.diagnosticsTabList}>
                {GLOBAL_DIAGNOSTIC_TABS.map((tab) => {
                  const isSelected = selectedDiagnosticsTab === tab.id;

                  return (
                    <Pressable
                      accessibilityRole="button"
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
              </View>
            </ScrollView>
            <ScrollView style={styles.modalScroll}>
              {selectedDiagnosticsTab === "pwa" ? (
                <PwaDiagnostics diagnostics={offlineReadiness} offlinePreparationDiagnostics={offlinePreparationDiagnostics} showTitle={false} />
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
                  failedSections={recordsFailedDiagnosticsSections}
                  notice={recordsFailedOperationsNotice}
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
                    <Text style={styles.diagnosticsValue}>{String(value)}</Text>
                  </View>
                ))
              ) : null}
              {shouldShowRecordsSyncErrorDetail ? (
                <RecordsFailedDiagnostics
                  failedSections={recordsFailedDiagnosticsSections}
                  notice={recordsFailedOperationsNotice}
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
          <Text style={styles.diagnosticsValue}>{value}</Text>
        </View>
      ))}
      <Text style={styles.diagnosticsTitle}>Preparacion offline</Text>
      {preparationRows.map(([label, value]) => (
        <View key={label} style={styles.diagnosticsRow}>
          <Text style={styles.diagnosticsLabel}>{label}</Text>
          <Text style={styles.diagnosticsValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function RecordsGlobalDiagnostics({
  failedSections,
  notice,
  rows,
  totalFailedCount,
}: {
  failedSections: ReturnType<typeof getRecordsFailedOperationDiagnosticsSections>;
  notice: string | null;
  rows: [string, string | number | boolean | null][];
  totalFailedCount: number;
}) {
  return (
    <View style={styles.diagnostics}>
      <Text style={styles.diagnosticsTitle}>RECORDS</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.diagnosticsRow}>
          <Text style={styles.diagnosticsLabel}>{label}</Text>
          <Text style={styles.diagnosticsValue}>{String(value)}</Text>
        </View>
      ))}
      <RecordsFailedDiagnostics
        failedSections={failedSections}
        notice={notice}
        totalFailedCount={totalFailedCount}
      />
    </View>
  );
}

function RecordsFailedDiagnostics({
  failedSections,
  notice,
  totalFailedCount,
}: {
  failedSections: ReturnType<typeof getRecordsFailedOperationDiagnosticsSections>;
  notice: string | null;
  totalFailedCount: number;
}) {
  if (totalFailedCount <= 0) {
    return null;
  }

  return (
    <View style={styles.diagnosticsSection}>
      <Text style={styles.diagnosticsTitle}>Errores de RECORDS</Text>
      {notice ? <Text style={styles.diagnosticsNotice}>{notice}</Text> : null}
      {failedSections.length > 0 ? (
        failedSections.map((section) => (
          <View key={section.title} style={styles.diagnosticsSubsection}>
            <Text style={styles.diagnosticsSectionTitle}>{section.title}</Text>
            {section.rows.map(([label, value]) => (
              <View key={`${section.title}:${label}`} style={styles.diagnosticsRow}>
                <Text style={styles.diagnosticsLabel}>{label}</Text>
                <Text style={styles.diagnosticsValue}>{String(value)}</Text>
              </View>
            ))}
          </View>
        ))
      ) : (
        <Text style={styles.diagnosticsNotice}>
          Hay errores durables de RECORDS, pero no se pudo resolver la operacion asociada.
        </Text>
      )}
    </View>
  );
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
    paddingBottom: 2,
  },
  diagnosticsTabSelected: {
    backgroundColor: "#135d66",
    borderColor: "#135d66",
  },
  diagnosticsTabs: {
    flexGrow: 0,
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
    textAlign: "right",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 56,
    overflow: "hidden",
    width: "100%",
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    maxWidth: "56%",
    minWidth: 0,
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
  statusDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  statusDotError: {
    backgroundColor: "#b42318",
  },
  statusDotOffline: {
    backgroundColor: "#8a9aa0",
  },
  statusDotOnline: {
    backgroundColor: "#13795b",
  },
  statusDotWorking: {
    backgroundColor: "#b7791f",
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
    gap: 8,
    minWidth: 0,
  },
  userAvatar: {
    alignItems: "center",
    backgroundColor: "#e4f1f2",
    borderRadius: 16,
    height: 32,
    justifyContent: "center",
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
