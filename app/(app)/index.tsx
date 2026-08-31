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
import { deriveOfflineAvailability, OfflineAvailability } from "@/lib/app-view-definitions-cache";
import { getHomeExperienceCards, getHomeExperienceSections } from "@/lib/home-experiences";
import { prewarmAssignedAppViewsOnce } from "@/lib/app-view-prewarm";
import { loadAppViewsWithCache } from "@/lib/app-navigation-cache";
import { APP_SHELL_HORIZONTAL_GUTTER, APP_SHELL_WIDE_BREAKPOINT } from "@/lib/app-shell-layout";
import { selectContractId } from "@/lib/contract-selection";
import { AppView } from "@/lib/opco-api";
import { useSession } from "@/state/session";

export default function HomeScreen() {
  const {
    api,
    context,
    definitionCache,
    ownerKey,
    recordOfflinePreparationDiagnostics,
    selectedContractId,
    setSelectedContractId,
    status,
    token,
  } = useSession();
  const { width } = useWindowDimensions();
  const [views, setViews] = useState<AppView[]>([]);
  const [isLoadingViews, setIsLoadingViews] = useState(false);
  const [offlineAvailabilityByViewId, setOfflineAvailabilityByViewId] = useState<Record<string, OfflineAvailability>>({});
  const [error, setError] = useState<string | null>(null);
  const isWideLayout = width >= APP_SHELL_WIDE_BREAKPOINT;

  const selectedContract = useMemo(
    () => context?.contracts.find((contract) => contract.id === selectedContractId) ?? null,
    [context?.contracts, selectedContractId],
  );
  const experienceCards = useMemo(
    () => getHomeExperienceCards(views, offlineAvailabilityByViewId),
    [offlineAvailabilityByViewId, views],
  );
  const experienceSections = useMemo(
    () => getHomeExperienceSections(experienceCards),
    [experienceCards],
  );

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
        }

        if (!data.offline) {
          void prewarmAssignedAppViewsOnce({
            api,
            appViews: data.views,
            contractId: selectedContractId,
            onTelemetry: recordOfflinePreparationDiagnostics,
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
  }, [api, definitionCache, ownerKey, recordOfflinePreparationDiagnostics, selectedContractId, token]);

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

  const experiencesSection = (
    <View style={styles.section}>
      {isLoadingViews ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!isLoadingViews && selectedContractId && views.length === 0 && !error ? (
        <Text style={styles.empty}>No tienes experiencias asignadas para este contrato.</Text>
      ) : null}
      {experienceSections.map((section) => (
        <View key={section.id} style={styles.experienceGroup}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          <View style={[styles.viewList, isWideLayout ? styles.viewListWide : null]}>
            {section.cards.map(({ appView, availabilityLabel, href, metadata }) => {
              return (
                <Link href={href} key={appView.id} asChild>
                  <Pressable style={StyleSheet.flatten([styles.viewButton, isWideLayout ? styles.viewButtonWide : null])}>
                    <View style={styles.viewIcon}>
                      <AppIcon icon={appView.icon} size={22} />
                    </View>
                    <View style={styles.viewText}>
                      <Text style={styles.viewName}>{appView.name}</Text>
                      <View style={styles.typeBadge}>
                        <Text style={styles.typeBadgeText}>{metadata}</Text>
                      </View>
                      {availabilityLabel ? <Text style={styles.availabilityText}>{availabilityLabel}</Text> : null}
                    </View>
                  </Pressable>
                </Link>
              );
            })}
          </View>
        </View>
      ))}
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
          {operationalContextSection}
        </View>
        <View style={isWideLayout ? styles.experiencesColumnWide : null}>{experiencesSection}</View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 18,
    padding: APP_SHELL_HORIZONTAL_GUTTER,
    paddingBottom: 36,
    width: "100%",
  },
  contentCompact: {
    alignSelf: "stretch",
  },
  contentWide: {
    alignSelf: "stretch",
    paddingHorizontal: APP_SHELL_HORIZONTAL_GUTTER,
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
  experienceGroup: {
    gap: 8,
  },
  experiencesColumnWide: {
    width: "100%",
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
  operationalContext: {
    gap: 12,
  },
  screen: {
    backgroundColor: "#eef4f4",
    flex: 1,
  },
  section: {
    gap: 16,
  },
  sectionTitle: {
    color: "#587078",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
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
  value: {
    color: "#17363c",
    fontSize: 17,
    fontWeight: "700",
  },
});
