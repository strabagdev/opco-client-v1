import { Redirect, Stack, usePathname, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { AppIcon } from "@/components/app-icon";
import { APP_SHELL_HORIZONTAL_GUTTER, APP_SHELL_WIDE_BREAKPOINT } from "@/lib/app-shell-layout";
import { useOfflineReadiness } from "@/lib/use-offline-readiness";
import { useSession } from "@/state/session";

export default function AppLayout() {
  const {
    context,
    localDatabaseStorageState,
    me,
    ownerKey,
    selectedContractId,
    signOut,
    status,
  } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const [isPwaDiagnosticsOpen, setIsPwaDiagnosticsOpen] = useState(false);
  const isHome = pathname === "/";
  const isWideLayout = width >= APP_SHELL_WIDE_BREAKPOINT;
  const showPwaDiagnostics = shouldShowPwaDiagnostics();
  const offlineReadiness = useOfflineReadiness({
    navigationCachePresent: Boolean(selectedContractId),
    sessionSnapshotPresent: Boolean(ownerKey && me && context),
    sqliteReady: localDatabaseStorageState.status === "ready",
  });

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
        <View>
          <Text style={styles.kicker}>Sesion activa</Text>
          <Text style={styles.title}>Opco Client</Text>
        </View>
        <View style={styles.headerActions}>
          {showPwaDiagnostics ? (
            <Pressable
              accessibilityLabel="Diagnostico PWA"
              accessibilityRole="button"
              onPress={() => setIsPwaDiagnosticsOpen(true)}
              style={styles.diagnosticsIconButton}
            >
              <AppIcon icon="settings" size={18} />
            </Pressable>
          ) : null}
          <Pressable onPress={signOut} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Logout</Text>
          </Pressable>
        </View>
      </View>

      {!isHome ? (
        <View style={[styles.backRow, isWideLayout ? styles.backRowWide : styles.backRowCompact]}>
          <Pressable accessibilityRole="button" onPress={goBack} style={styles.backButton}>
            <Text style={styles.backText}>← Volver</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.content}>
        <Stack screenOptions={{ headerShown: false }} />
      </View>

      <Modal
        animationType="fade"
        onRequestClose={() => setIsPwaDiagnosticsOpen(false)}
        transparent
        visible={isPwaDiagnosticsOpen}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalPanel, isWideLayout ? styles.modalPanelWide : styles.modalPanelCompact]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Diagnostico PWA</Text>
              <Pressable
                accessibilityLabel="Cerrar diagnostico PWA"
                accessibilityRole="button"
                onPress={() => setIsPwaDiagnosticsOpen(false)}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>Cerrar</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll}>
              <PwaDiagnostics diagnostics={offlineReadiness} showTitle={false} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function shouldShowPwaDiagnostics() {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    return true;
  }

  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).has("pwaDiagnostics");
}

function PwaDiagnostics({
  diagnostics,
  showTitle = true,
}: {
  diagnostics: ReturnType<typeof useOfflineReadiness>;
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

  return (
    <View style={styles.diagnostics}>
      {showTitle ? <Text style={styles.diagnosticsTitle}>Diagnostico PWA</Text> : null}
      {rows.map(([label, value]) => (
        <View key={label} style={styles.diagnosticsRow}>
          <Text style={styles.diagnosticsLabel}>{label}</Text>
          <Text style={styles.diagnosticsValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    justifyContent: "center",
    minHeight: 40,
    paddingRight: 10,
  },
  backRow: {
    width: "100%",
  },
  backRowCompact: {
    paddingHorizontal: APP_SHELL_HORIZONTAL_GUTTER,
    paddingTop: 12,
  },
  backRowWide: {
    paddingHorizontal: APP_SHELL_HORIZONTAL_GUTTER,
    paddingTop: 14,
  },
  backText: {
    color: "#135d66",
    fontWeight: "800",
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
  diagnosticsTitle: {
    color: "#17363c",
    fontSize: 14,
    fontWeight: "800",
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
    width: "100%",
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  headerCompact: {
    padding: APP_SHELL_HORIZONTAL_GUTTER,
    paddingBottom: 0,
  },
  headerWide: {
    paddingHorizontal: APP_SHELL_HORIZONTAL_GUTTER,
    paddingTop: 20,
  },
  kicker: {
    color: "#587078",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  logoutButton: {
    borderColor: "#b8c7ca",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  logoutText: {
    color: "#17363c",
    fontWeight: "700",
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
  shell: {
    backgroundColor: "#eef4f4",
    flex: 1,
  },
  title: {
    color: "#0f3036",
    fontSize: 26,
    fontWeight: "800",
    marginTop: 4,
  },
});
