import { Link } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { AppIcon } from "@/components/app-icon";
import { getOfflineAvailabilityText } from "@/lib/app-view-offline-readiness";
import { buildAppViewHref, getAppViewCardMetadata } from "@/lib/app-views";
import { deriveOfflineAvailability, OfflineAvailability } from "@/lib/app-view-definitions-cache";
import { prewarmAssignedAppViewsOnce } from "@/lib/app-view-prewarm";
import { loadAppViewsWithCache } from "@/lib/app-navigation-cache";
import { selectContractId } from "@/lib/contract-selection";
import { AppView } from "@/lib/opco-api";
import { useOfflineReadiness } from "@/lib/use-offline-readiness";
import { useSession } from "@/state/session";

const HOME_WIDE_BREAKPOINT = 900;

export default function HomeScreen() {
  const {
    api,
    context,
    definitionCache,
    localDatabaseStorageState,
    localStorageRecoveryNotice,
    me,
    ownerKey,
    selectedContractId,
    setSelectedContractId,
    status,
    token,
  } = useSession();
  const { width } = useWindowDimensions();
  const [views, setViews] = useState<AppView[]>([]);
  const [isLoadingViews, setIsLoadingViews] = useState(false);
  const [viewsFromCache, setViewsFromCache] = useState(false);
  const [viewsSyncedAt, setViewsSyncedAt] = useState<string | null>(null);
  const [offlineAvailabilityByViewId, setOfflineAvailabilityByViewId] = useState<Record<string, OfflineAvailability>>({});
  const [error, setError] = useState<string | null>(null);
  const isWideLayout = width >= HOME_WIDE_BREAKPOINT;
  const offlineReadiness = useOfflineReadiness({
    navigationCachePresent: Boolean(selectedContractId && views.length > 0),
    sessionSnapshotPresent: Boolean(ownerKey && me && context),
    sqliteReady: localDatabaseStorageState.status === "ready",
  });

  const selectedContract = useMemo(
    () => context?.contracts.find((contract) => contract.id === selectedContractId) ?? null,
    [context?.contracts, selectedContractId],
  );
  const notifications = useMemo(() => {
    const items: { id: string; message: string; tone: "error" | "info" }[] = [];

    if (localStorageRecoveryNotice) {
      items.push({
        id: "local-storage-recovery",
        message: localStorageRecoveryNotice,
        tone: "error",
      });
    }

    return items;
  }, [localStorageRecoveryNotice]);

  useEffect(() => {
    if (!context) {
      return;
    }

    const nextContractId = selectContractId(context.contracts, selectedContractId);

    if (nextContractId && nextContractId !== selectedContractId) {
      void setSelectedContractId(nextContractId);
    }
  }, [context, selectedContractId, setSelectedContractId]);

  useEffect(() => {
    let isMounted = true;

    async function refreshOfflineAvailability(nextViews: AppView[]) {
      if (!selectedContractId || !ownerKey) {
        setOfflineAvailabilityByViewId({});
        return;
      }

      try {
        const entries = await Promise.all(nextViews.map(async (appView) => {
          const definition = await definitionCache.getAppViewDefinition(ownerKey, selectedContractId, appView.id);
          const recordsTelemetry = appView.type === "RECORDS"
            ? await definitionCache.getSyncTelemetry({
                contractId: selectedContractId,
                entityTypeId: appView.config.entityTypeId,
                ownerKey,
              })
            : null;
          const sourceEntityTypeId = definition?.definition.kind === "state-update"
            ? definition.definition.sourceEntityTypeId
            : definition?.definition.kind === "attendance"
              ? definition.definition.sourceEntityTypeId
              : null;
          const sourceTelemetry = sourceEntityTypeId
            ? await definitionCache.getSyncTelemetry({
                contractId: selectedContractId,
                entityTypeId: sourceEntityTypeId,
                ownerKey,
              })
            : null;

          return [appView.id, deriveOfflineAvailability({
            appView,
            definition,
            recordsTelemetry,
            sourceTelemetry,
          })] as const;
        }));

        if (isMounted) {
          setOfflineAvailabilityByViewId(Object.fromEntries(entries));
        }
      } catch {
        if (isMounted) {
          setOfflineAvailabilityByViewId({});
        }
      }
    }

    async function loadViews() {
      if (!token || !selectedContractId || !ownerKey) {
        setViews([]);
        setViewsFromCache(false);
        setViewsSyncedAt(null);
        return;
      }

      setIsLoadingViews(true);
      setError(null);

      try {
        const data = await loadAppViewsWithCache({
          api,
          cache: definitionCache,
          contractId: selectedContractId,
          ownerKey,
          token,
        });

        if (isMounted) {
          setViews(data.views);
          setViewsFromCache(data.fromCache);
          setViewsSyncedAt(data.syncedAt);
        }

        if (!data.offline) {
          void prewarmAssignedAppViewsOnce({
            api,
            appViews: data.views,
            contractId: selectedContractId,
            ownerKey,
            store: definitionCache,
            token,
          }).finally(() => {
            if (isMounted) {
              void refreshOfflineAvailability(data.views);
            }
          });
        }
        await refreshOfflineAvailability(data.views);
      } catch (nextError) {
        if (isMounted) {
          setError(nextError instanceof Error ? nextError.message : "No fue posible cargar experiencias.");
          setViewsFromCache(false);
          setViewsSyncedAt(null);
        }
      } finally {
        if (isMounted) {
          setIsLoadingViews(false);
        }
      }
    }

    void loadViews();

    return () => {
      isMounted = false;
    };
  }, [api, definitionCache, ownerKey, selectedContractId, token]);

  const contractSelector = context && context.contracts.length > 1 ? (
    <View style={[styles.contractList, isWideLayout ? styles.contractListWide : null]}>
      {context.contracts.map((contract) => {
        const isSelected = contract.id === selectedContractId;

        return (
          <Pressable
            key={contract.id}
            onPress={() => setSelectedContractId(contract.id)}
            style={[
              styles.contractButton,
              isWideLayout ? styles.contractButtonWide : null,
              isSelected ? styles.contractButtonSelected : null,
            ]}
          >
            <Text style={[styles.contractName, isSelected ? styles.contractNameSelected : null]}>
              {contract.name}
            </Text>
            <Text style={[styles.contractRole, isSelected ? styles.contractRoleSelected : null]}>
              {contract.role}
            </Text>
          </Pressable>
        );
      })}
    </View>
  ) : null;

  const userSection = (
    <View style={styles.userSection}>
      <View style={styles.userMark}>
        <Text style={styles.userMarkText}>{getUserInitials(me?.user.name ?? me?.user.email)}</Text>
      </View>
      <View style={styles.userText}>
        <Text style={styles.label}>Usuario</Text>
        <Text style={styles.value}>{me?.user.name ?? me?.user.email ?? "Sesion conservada"}</Text>
        <Text style={styles.meta}>
          {status === "offline"
            ? "Sin conexion. Datos guardados localmente."
            : me?.user.email}
        </Text>
        <Text style={offlineReadiness.offlineReadiness === "ready" ? styles.readyText : styles.meta}>
          {getOfflineReadinessText(offlineReadiness.offlineReadiness)}
        </Text>
      </View>
    </View>
  );

  const operationalContextSection = (
    <View style={styles.operationalContext}>
      <View style={[styles.contextPair, isWideLayout ? styles.contextPairWide : null]}>
        <View style={styles.contextItem}>
          <Text style={styles.label}>Organizacion</Text>
          <Text style={styles.value}>
            {context?.organization.name ??
              (status === "offline" ? "Contexto no disponible sin red" : "Cargando contexto...")}
          </Text>
        </View>
        <View style={styles.contextItem}>
          <Text style={styles.label}>Contrato</Text>
          {!context && status !== "offline" ? <ActivityIndicator /> : null}
          {context?.contracts.length === 0 ? (
            <Text style={styles.empty}>No hay contratos activos para este usuario.</Text>
          ) : null}
          <Text style={styles.value}>
            {selectedContract?.name ?? (context ? "Selecciona un contrato" : "Cargando contexto...")}
          </Text>
        </View>
      </View>
      {status === "offline" && !context ? (
        <Text style={styles.error}>No hay datos guardados en este dispositivo. Conectate al menos una vez.</Text>
      ) : null}
      {contractSelector}
    </View>
  );

  const notificationsSection = (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Notificaciones</Text>
      {notifications.length > 0 ? (
        <View style={styles.notificationList}>
          {notifications.map((notification) => (
            <View
              key={notification.id}
              style={[
                styles.notificationItem,
                notification.tone === "error" ? styles.notificationItemError : null,
              ]}
            >
              <Text style={notification.tone === "error" ? styles.error : styles.meta}>{notification.message}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>No hay notificaciones.</Text>
      )}
    </View>
  );

  const experiencesSection = (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Experiencias</Text>
      {isLoadingViews ? <ActivityIndicator /> : null}
      {viewsFromCache ? (
        <View style={styles.cacheBanner}>
          <Text style={styles.cacheText}>Sin conexion. Experiencias guardadas localmente.</Text>
          {viewsSyncedAt ? <Text style={styles.cacheMeta}>Ultima sincronizacion: {viewsSyncedAt}</Text> : null}
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!isLoadingViews && selectedContractId && views.length === 0 && !error ? (
        <Text style={styles.empty}>No tienes experiencias asignadas para este contrato.</Text>
      ) : null}
      <View style={[styles.viewList, isWideLayout ? styles.viewListWide : null]}>
        {views.map((appView) => (
          <Link href={buildAppViewHref(appView.id)} key={appView.id} asChild>
            <Pressable style={StyleSheet.flatten([styles.viewButton, isWideLayout ? styles.viewButtonWide : null])}>
              <View style={styles.viewIcon}>
                <AppIcon icon={appView.icon} size={22} />
              </View>
              <View style={styles.viewText}>
                <Text style={styles.viewName}>{appView.name}</Text>
                <View style={styles.typeBadge}>
                  <Text style={styles.typeBadgeText}>{getAppViewCardMetadata(appView)}</Text>
                </View>
                <Text style={styles.availabilityText}>
                  {getOfflineAvailabilityText(offlineAvailabilityByViewId[appView.id] ?? "definition-missing")}
                </Text>
              </View>
            </Pressable>
          </Link>
        ))}
      </View>
    </View>
  );

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        isWideLayout ? styles.contentWide : styles.contentCompact,
      ]}
      style={styles.screen}
    >
      <View style={styles.bodyStack}>
        <View style={[styles.contextPanel, isWideLayout ? styles.contextPanelWide : null]}>
          {userSection}
          {operationalContextSection}
        </View>

        {isWideLayout ? (
          <View style={styles.mainGridWide}>
            <View style={styles.experiencesColumnWide}>{experiencesSection}</View>
            <View style={styles.notificationsColumnWide}>{notificationsSection}</View>
          </View>
        ) : (
          <>
            {notificationsSection}
            {experiencesSection}
          </>
        )}
      </View>
    </ScrollView>
  );
}

function getOfflineReadinessText(readiness: ReturnType<typeof useOfflineReadiness>["offlineReadiness"]) {
  switch (readiness) {
    case "ready":
      return "Disponible sin conexion";
    case "data-missing":
      return "Abre al menos una experiencia con conexion para usarla offline.";
    case "shell-missing":
      return "Preparando uso sin conexion...";
    case "unsupported":
      return "Uso sin conexion no disponible en este navegador.";
    case "preparing":
    default:
      return "Preparando uso sin conexion...";
  }
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
  content: {
    gap: 18,
    padding: 20,
    paddingBottom: 36,
    width: "100%",
  },
  contentCompact: {
    alignSelf: "center",
    maxWidth: 620,
  },
  contentWide: {
    alignSelf: "center",
    maxWidth: 1180,
    paddingHorizontal: 28,
  },
  contractButton: {
    backgroundColor: "#ffffff",
    borderColor: "#c8d2d5",
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 14,
  },
  contractButtonWide: {
    flexBasis: 220,
    flexGrow: 1,
  },
  contractButtonSelected: {
    backgroundColor: "#135d66",
    borderColor: "#135d66",
  },
  contractList: {
    gap: 10,
  },
  contractListWide: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cacheBanner: {
    backgroundColor: "#fff7e0",
    borderColor: "#f0c36d",
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  cacheMeta: {
    color: "#6f4f08",
    fontSize: 12,
  },
  cacheText: {
    color: "#6f4f08",
    fontWeight: "700",
  },
  contractName: {
    color: "#17363c",
    fontSize: 16,
    fontWeight: "700",
  },
  contractNameSelected: {
    color: "#ffffff",
  },
  contractRole: {
    color: "#587078",
    fontSize: 13,
  },
  contractRoleSelected: {
    color: "#dceff1",
  },
  empty: {
    color: "#587078",
    lineHeight: 21,
  },
  availabilityText: {
    color: "#587078",
    fontSize: 12,
  },
  bodyStack: {
    gap: 18,
  },
  viewButton: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#d4dddf",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
    padding: 12,
  },
  viewButtonWide: {
    flexBasis: 260,
    flexGrow: 1,
    maxWidth: 360,
  },
  viewIcon: {
    alignItems: "center",
    backgroundColor: "#e4f1f2",
    borderRadius: 8,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  viewList: {
    gap: 10,
  },
  viewListWide: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
  },
  viewName: {
    color: "#17363c",
    fontSize: 16,
    fontWeight: "700",
  },
  viewText: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  error: {
    color: "#b42318",
    lineHeight: 20,
  },
  contextColumn: {
    gap: 18,
  },
  contextColumnWide: {
    flexBasis: 320,
    flexGrow: 1,
    maxWidth: 420,
  },
  experiencesColumn: {
    gap: 18,
  },
  experiencesColumnWide: {
    flexBasis: 520,
    flexGrow: 2,
  },
  homeGrid: {
    gap: 18,
  },
  homeGridCompact: {
    flexDirection: "column",
  },
  homeGridWide: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  contextItem: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  contextPair: {
    gap: 14,
  },
  contextPairWide: {
    flexDirection: "row",
  },
  contextPanel: {
    gap: 16,
  },
  contextPanelWide: {
    backgroundColor: "#ffffff",
    borderColor: "#d7e4e7",
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  label: {
    color: "#587078",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  meta: {
    color: "#587078",
    marginTop: 3,
  },
  mainGridWide: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 20,
  },
  readyText: {
    color: "#13795b",
    fontWeight: "800",
    marginTop: 3,
  },
  notificationItem: {
    backgroundColor: "#ffffff",
    borderColor: "#d7e4e7",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  notificationItemError: {
    borderColor: "#f1b8b8",
  },
  notificationList: {
    gap: 10,
  },
  notificationsColumnWide: {
    flexBasis: 280,
    flexGrow: 1,
    maxWidth: 340,
  },
  operationalContext: {
    gap: 12,
  },
  screen: {
    backgroundColor: "#eef4f4",
    flex: 1,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: "#17363c",
    fontSize: 18,
    fontWeight: "800",
  },
  typeBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#edf6f6",
    borderColor: "#cfe1e3",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  typeBadgeText: {
    color: "#2f5e66",
    fontSize: 12,
    fontWeight: "800",
  },
  userMark: {
    alignItems: "center",
    backgroundColor: "#e4f1f2",
    borderRadius: 8,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  userMarkText: {
    color: "#135d66",
    fontWeight: "900",
  },
  userSection: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  userText: {
    flex: 1,
    minWidth: 0,
  },
  value: {
    color: "#17363c",
    fontSize: 17,
    fontWeight: "700",
  },
});
