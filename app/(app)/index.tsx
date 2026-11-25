import { colors } from "@/theme/paint";
import { watchAttendanceLocalDay } from "@/lib/attendance-local-day";
import { CompactSelect } from "@/components/compact-select";
import { usePublishDesktopCatalog } from "@/components/desktop-navigation";
import { desktopNavigation } from "@/lib/desktop-navigation";
import { desktopStyleColors } from "@/lib/desktop-presentation";
import { Link, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { AppIcon } from "@/components/app-icon";
import { ReadLoadingState } from "@/components/read-loading-indicator";
import { attendancePreparationPeriod, deriveAttendanceMonthStatus } from "@/lib/attendance-snapshot-cache";
import { buildStateUpdateCoverageScope, deriveOfflineAvailability, OfflineAvailability } from "@/lib/app-view-definitions-cache";
import { getHomeExperienceCards, getHomeExperienceSections } from "@/lib/home-experiences";
import { createHomeOfflineAvailabilityRefresh } from "@/lib/home-offline-availability-refresh";
import { prewarmAssignedAppViewsOnce } from "@/lib/app-view-prewarm";
import { appViewsAuthorizationScope, loadAppViewsWithCache } from "@/lib/app-navigation-cache";
import { APP_SHELL_DESKTOP_GUTTER, APP_SHELL_HORIZONTAL_GUTTER, APP_SHELL_WIDE_BREAKPOINT, getHomeGridLayout, HOME_DESKTOP_CARD_GAP, HOME_MAX_WIDTH } from "@/lib/app-shell-layout";
import { selectContractId } from "@/lib/contract-selection";
import { subscribeLocalDatabaseCacheChanges } from "@/lib/local-db";
import { AppView } from "@/lib/opco-api";
import { useHomeReadActivity } from "@/renderers/use-experience-activity";
import { useSession } from "@/state/session";

export default function HomeScreen() {
  const {
    api,
    context,
    me,
    definitionCache,
    ownerKey,
    recordOfflinePreparationDiagnostics,
    recordsReconnectRefreshKey,
    recordsReconnectReadEvent,
    selectedContractId,
    setSelectedContractId,
    status,
    token,
  } = useSession();
  const { width } = useWindowDimensions();
  const [gridContentWidth, setGridContentWidth] = useState<number>();
  const gridLayout = getHomeGridLayout(width, gridContentWidth);
  const availabilityRefreshRef = useRef<ReturnType<typeof createHomeOfflineAvailabilityRefresh> | null>(null);
  const [views, setViews] = useState<AppView[]>([]);
  const availabilityViewsRef = useRef(views);
  const [isLoadingViews, setIsLoadingViews] = useState(false);
  const [isOfflineViews, setIsOfflineViews] = useState(false);
  const [loadedViewsScope, setLoadedViewsScope] = useState<string | null>(null);
  const [viewsRetryVersion, setViewsRetryVersion] = useState(0);
  const [offlineAvailabilityByViewId, setOfflineAvailabilityByViewId] = useState<Record<string, OfflineAvailability>>({});
  const [error, setError] = useState<string | null>(null);
  const [cacheNotice, setCacheNotice] = useState<{ scope: string | null; message: string } | null>(null);
  const isWideLayout = width >= APP_SHELL_WIDE_BREAKPOINT;
  const styles = isWideLayout ? desktopStyles : baseStyles;
  const { category } = useLocalSearchParams();
  const publishCatalog = usePublishDesktopCatalog();
  const viewsScope = ownerKey && selectedContractId ? ownerKey + ":" + selectedContractId : null;
  const authorizationScope = appViewsAuthorizationScope(me, context);
  const previousViewsLoad = useRef<{ scope: string | null; token: string | null; api: typeof api; key: number; retry: number; authorizationScope: string | null } | null>(null);
  const hasCompatibleViews = Boolean(viewsScope && loadedViewsScope === viewsScope);
  useHomeReadActivity({ isLoading: isLoadingViews || (!context && status !== "offline"), hasContent: hasCompatibleViews, error });
  useEffect(() => {
    if (hasCompatibleViews) publishCatalog(JSON.stringify([ownerKey, selectedContractId]), views);
  }, [hasCompatibleViews, ownerKey, selectedContractId, views, publishCatalog]);
  const selectedCategory = desktopNavigation(hasCompatibleViews ? views : [], "/", category).selectedCategory;
  const isGridLayout = gridLayout.columns > 1;
  const [observedAt, setObservedAt] = useState(() => new Date());
  const today = formatLocalDateInput(observedAt);
  const calendarsKey=JSON.stringify([...new Map(views.filter(v=>v.type==="WORKFLOW"&&v.config.workflowKey==="attendance"&&v.config.operationalCalendar).map(v=>{const calendar=(v.config as import("@/lib/opco-api").AttendanceWorkflowConfig).operationalCalendar!;return [JSON.stringify([calendar.timeZone,calendar.dayStart]),calendar] as const;})).values()]);
  useEffect(() => {
    const refresh=()=>setObservedAt(new Date());
    const clocks=[watchAttendanceLocalDay(refresh),...(JSON.parse(calendarsKey) as import("@/lib/operational-calendar").OperationalCalendar[]).map(calendar=>watchAttendanceLocalDay(refresh,calendar))];
    const resume = AppState.addEventListener("change", state => { if (state === "active") clocks.forEach(clock=>clock.refresh()); });
    return () => { clocks.forEach(clock=>clock.dispose()); resume.remove(); };
  }, [calendarsKey]);

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

  const refreshOfflineAvailability = useCallback(async (nextViews: AppView[], canUpdate: () => boolean = () => true) => {
    if (!selectedContractId || !ownerKey) {
      if (canUpdate()) {
        setOfflineAvailabilityByViewId({});
      }
      return;
    }

    // These promises live only for this pass. A cache/scope invalidation makes
    // them ineligible; the existing refresh coordinator schedules the next pass.
    const telemetryReads = new Map<string, ReturnType<typeof definitionCache.getSyncTelemetry>>();
    const countReads=new Map<string,ReturnType<typeof definitionCache.getRecordCacheStatusCounts>>();
    const readCount=async(entityTypeId:string)=>{if(!canUpdate())return undefined;const key=JSON.stringify([ownerKey,selectedContractId,entityTypeId]);let read=countReads.get(key);if(!read){read=definitionCache.getRecordCacheStatusCounts({ownerKey,contractId:selectedContractId,entityTypeId});countReads.set(key,read);}const result=await read;return canUpdate()?result.total:undefined;};
    const hydrationReads = new Map<string, ReturnType<typeof definitionCache.getAttendanceDaySnapshotHydration>>();
    const readTelemetry = async (entityTypeId: string) => {
      if (!canUpdate()) return null;
      const key = JSON.stringify([ownerKey, selectedContractId, entityTypeId]);
      let reading = telemetryReads.get(key);
      if (!reading) {
        reading = definitionCache.getSyncTelemetry({ ownerKey, contractId: selectedContractId, entityTypeId });
        telemetryReads.set(key, reading);
      }
      const value = await reading;
      return canUpdate() ? value : null;
    };
    const readHydration = async (appViewId: string, targetEntityTypeId: string, date: string) => {
      if (!canUpdate()) return null;
      const key = JSON.stringify([ownerKey, selectedContractId, appViewId, targetEntityTypeId, date]);
      let reading = hydrationReads.get(key);
      if (!reading) {
        reading = definitionCache.getAttendanceDaySnapshotHydration({ ownerKey, contractId: selectedContractId, appViewId, targetEntityTypeId, date });
        hydrationReads.set(key, reading);
      }
      const value = await reading;
      return canUpdate() ? value : null;
    };

    try {
      const now=observedAt;
      const catalogs=await definitionCache.getLocalCatalogCoverage?.({ownerKey,contractId:selectedContractId,appViews:nextViews,isCurrent:canUpdate});
      if(!canUpdate())return;
      const entries = await Promise.all(nextViews.map(async (appView) => {
        const definition = await definitionCache.getAppViewDefinition(ownerKey, selectedContractId, appView.id);
        const recordsTelemetry = appView.type === "RECORDS"
          ? await readTelemetry(appView.config.entityTypeId)
          : null;
        const sourceEntityTypeId = definition?.definition.kind === "state-update"
          ? definition.definition.sourceEntityTypeId
          : definition?.definition.kind === "attendance"
            ? definition.definition.sourceEntityTypeId
            : null;
        const targetEntityTypeId = definition?.definition.kind === "state-update"
          ? definition.definition.targetEntityTypeId
          : definition?.definition.kind === "attendance"
            ? definition.definition.targetEntityTypeId
            : null;
        const sourceTelemetry = sourceEntityTypeId
          ? await readTelemetry(sourceEntityTypeId)
          : null;
        const isAttendanceWorkflow = appView.type === "WORKFLOW" &&
          appView.config.workflowKey === "attendance";
        const period=isAttendanceWorkflow?attendancePreparationPeriod(now,(appView.config as import("@/lib/opco-api").AttendanceWorkflowConfig).operationalCalendar):null;
        const recordsCount=appView.type==="RECORDS"?await readCount(appView.config.entityTypeId):undefined;
        const attendanceDayHydration = isAttendanceWorkflow &&
          targetEntityTypeId
          ? await readHydration(appView.id, targetEntityTypeId, period!.date)
          : null;
        const attendanceMonthStatus = isAttendanceWorkflow &&
          appView.config.workflowKey === "attendance" &&
          targetEntityTypeId
          ? deriveAttendanceMonthStatus(await Promise.all(period!.dates.map((date) =>
              readHydration(appView.id, targetEntityTypeId, date)
            )))
          : undefined;
        const stateUpdateCoverage = appView.type === "WORKFLOW" &&
          appView.config.workflowKey === "state-update" &&
          definition?.definition.kind === "state-update" &&
          targetEntityTypeId
          ? await definitionCache.getStateUpdateSnapshotCoverage(buildStateUpdateCoverageScope({
              appViewId: appView.id,
              contractId: selectedContractId,
              date: today,
              ownerKey,
            }, definition.definition))
          : null;

        return [appView.id, deriveOfflineAvailability({
          attendanceDayHydration,
          attendanceMonthStatus,
          appView,
          definition,
          recordsTelemetry,
          sourceTelemetry,
          stateUpdateCoverage, recordsCount,
          catalogs:catalogs?.[appView.id]??undefined,catalogReadFailed:catalogs?.[appView.id]===null,
        })] as const;
      }));

      if (canUpdate()) {
        setOfflineAvailabilityByViewId(Object.fromEntries(entries));
      }
    } catch {
      if (canUpdate()) {
        setOfflineAvailabilityByViewId(Object.fromEntries(nextViews.map(view=>[view.id,"dependencies-unavailable"])));
      }
    }
  }, [observedAt, definitionCache, ownerKey, selectedContractId, today]);

  useEffect(() => {
    let isMounted = true;
    const previous = previousViewsLoad.current;
    previousViewsLoad.current = { scope: viewsScope, token, api, key: recordsReconnectRefreshKey, retry: viewsRetryVersion, authorizationScope };
    // Only this refresh notification may consume its lifecycle result. Mounts,
    // navigation, retry and later manual syncs still perform their own read.
    const readEvent = previous && previous.scope === viewsScope && previous.token === token && previous.api === api &&
      previous.key !== recordsReconnectRefreshKey && previous.retry === viewsRetryVersion
      ? recordsReconnectReadEvent : null;

    async function loadViews() {
      if (!token || !selectedContractId || !ownerKey) {
        setViews([]);
        return;
      }

      setIsLoadingViews(true);
      setError(null);
      setCacheNotice(null);
      let remoteSettled = false;

      try {
        const data = await loadAppViewsWithCache({
          api,
          cache: definitionCache,
          contractId: selectedContractId,
          ownerKey,
          isCurrent: () => isMounted,
          onCached: (cached) => {
            if (!isMounted || remoteSettled) return;
            setLoadedViewsScope(viewsScope);
            setViews(cached.views);
            setIsOfflineViews(true);
          },
          onCacheRead: (result) => {
            if (isMounted && result.status === "error") setCacheNotice({ scope: viewsScope, message: "No se pudo leer la lista de experiencias guardada. Intentando cargarla desde Opco." });
          },
          onCacheWrite: (result) => {
            if (isMounted) setCacheNotice(result.status === "error" ? { scope: viewsScope, message: "Las experiencias están disponibles ahora, pero no se pudo guardar la lista para abrir Inicio sin conexión. Reintenta con conexión." } : null);
          },
          token,
          readEvent,
          authorizationScope,
        });

        if (isMounted) {
          remoteSettled = true;
          setLoadedViewsScope(viewsScope);
          setIsOfflineViews(data.offline);
          setViews(data.views);
        }

        if (!data.offline && isMounted) {
          void prewarmAssignedAppViewsOnce({
            homeListWrite: data.cacheWrite ?? undefined,
            api,
            appViews: data.views,
            contractId: selectedContractId,
            onTelemetry: recordOfflinePreparationDiagnostics,
            ownerKey,
            store: definitionCache,
            token,
            trigger: viewsRetryVersion > 0 ? "manual-retry" : "home",
            reuseCompleted: viewsRetryVersion === 0,
            authorizationScope,
          }).finally(() => {
            if (isMounted) {
              void availabilityRefreshRef.current?.request();
            }
          });
        }
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
  }, [api, authorizationScope, definitionCache, ownerKey, recordOfflinePreparationDiagnostics, refreshOfflineAvailability, selectedContractId, token, viewsRetryVersion, viewsScope, recordsReconnectRefreshKey, recordsReconnectReadEvent]);

  useEffect(() => {
    availabilityViewsRef.current = views;
    if (hasCompatibleViews) void availabilityRefreshRef.current?.request();
  }, [hasCompatibleViews, views]);

  useFocusEffect(useCallback(() => {
    if (!hasCompatibleViews) return;
    const coordinator = createHomeOfflineAvailabilityRefresh(canUpdate => refreshOfflineAvailability(availabilityViewsRef.current, canUpdate));
    availabilityRefreshRef.current = coordinator;
    const unsubscribe = subscribeLocalDatabaseCacheChanges(() => { void coordinator.request(); });
    void coordinator.request();
    return () => {
      coordinator.dispose();
      unsubscribe();
      if (availabilityRefreshRef.current === coordinator) availabilityRefreshRef.current = null;
    };
  }, [hasCompatibleViews, refreshOfflineAvailability]));

  const contractSelector = context && context.contracts.length > 1 ? (
    <CompactSelect label="Contrato activo" required value={selectedContractId ?? ""}
      options={context.contracts.map(contract => ({ value: contract.id, label: `${contract.name} · ${contract.role}` }))}
      onChange={value => { void setSelectedContractId(String(value)); }} />
  ) : null;

  const operationalContextSection = (
    <View style={styles.operationalContext}>
      {!context && status !== "offline" ? <ReadLoadingState mode="initial" /> : null}
      <View style={[styles.contextPair, isWideLayout ? styles.contextPairWide : null]}>
        <View style={styles.contextItem}>
          <Text style={styles.label}>Organizacion</Text>
          <Text style={styles.value}>
            {context?.organization.name ??
              (status === "offline" ? "Contexto no disponible sin red" : "-")}
          </Text>
        </View>
        <View style={styles.contextItem}>
          <Text style={styles.label}>Contrato</Text>
          {context?.contracts.length === 0 ? (
            <Text style={styles.empty}>No hay contratos activos para este usuario.</Text>
          ) : null}
          <Text style={styles.value}>
            {selectedContract?.name ?? (context ? "Selecciona un contrato" : "-")}
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
    <View style={[styles.section, isGridLayout ? styles.sectionWide : null]}>
      {context && isLoadingViews && !hasCompatibleViews ? <ReadLoadingState mode="initial" /> : null}
      {isOfflineViews && hasCompatibleViews ? <Text style={styles.offlineText}>Experiencias guardadas en este dispositivo.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {!error && cacheNotice?.scope === viewsScope ? <Text accessibilityRole="alert" style={styles.error}>{cacheNotice.message}</Text> : null}
      {error || cacheNotice?.scope === viewsScope ? <Pressable accessibilityRole="button" onPress={() => setViewsRetryVersion((value) => value + 1)} style={styles.retryButton}><Text style={styles.retryText}>Reintentar</Text></Pressable> : null}
      {hasCompatibleViews && selectedContractId && views.length === 0 && !error ? (
        <Text style={styles.empty}>No tienes experiencias asignadas para este contrato.</Text>
      ) : null}
      {(hasCompatibleViews ? experienceSections.filter(section => !selectedCategory || section.id === selectedCategory) : []).map((section) => (
        <View key={section.id} style={[styles.experienceGroup, isGridLayout && { width: "100%" }, isGridLayout && !selectedCategory && section.cards.length === 1 && gridContentWidth ? { width: (gridContentWidth - 24) / 2 } : null]}>
          {!isWideLayout || !selectedCategory ? <Text style={[styles.sectionTitle, isWideLayout ? styles.sectionTitleWide : null]}>{section.title}</Text> : null}
          <View style={[styles.viewList, isGridLayout ? styles.viewListWide : null]}>
            {section.cards.map(({ appView, availabilityLabel, href, metadata }) => {
              return (
                <Link href={href} key={appView.id} asChild>
                  <Pressable style={StyleSheet.flatten([styles.viewButton, isGridLayout ? { width: section.cards.length === 1 && !selectedCategory ? "100%" : gridLayout.cardWidth } : null])}>
                    <View style={styles.viewIcon}>
                      <AppIcon icon={appView.icon} size={22} color={isWideLayout ? colors.primary : undefined} />
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
      testID={isWideLayout ? "desktop-home" : "compact-home"}
      style={styles.screen}
    >
      <View style={styles.bodyStack} onLayout={(event) => setGridContentWidth(event.nativeEvent.layout.width)}>
        {isWideLayout ? <Text style={styles.desktopTitle}>{experienceSections.find(section => section.id === selectedCategory)?.title ?? "Inicio"}</Text> : null}
        <View style={[styles.contextPanel, context && selectedContract && context.contracts.length > 0 ? { display: "none" } : null]}>
          {operationalContextSection}
        </View>
        <View style={isWideLayout ? styles.experiencesColumnWide : null}>{experiencesSection}</View>
      </View>
    </ScrollView>
  );
}

const baseStyles = StyleSheet.create({
  desktopTitle: { fontSize: 26, fontWeight: "800", color: colors.text },
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
    alignSelf: "center",
    maxWidth: HOME_MAX_WIDTH,
    paddingHorizontal: APP_SHELL_DESKTOP_GUTTER,
  },
  contractButton: {
    backgroundColor: colors.surface,
    borderColor: colors.controlBorder,
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
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  contractList: {
    gap: 10,
  },
  contractListWide: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  contractName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  contractNameSelected: {
    color: colors.onPrimary,
  },
  contractRole: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  contractRoleSelected: {
    color: colors.selection,
  },
  empty: {
    color: colors.textSecondary,
    lineHeight: 21,
  },
  availabilityText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  bodyStack: {
    gap: 18,
  },
  viewButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 64,
    padding: 12,
  },
  viewIcon: {
    alignItems: "center",
    backgroundColor: colors.selection,
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
    gap: HOME_DESKTOP_CARD_GAP,
  },
  viewName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  viewText: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  error: {
    color: colors.danger,
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
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  meta: {
    color: colors.textSecondary,
    marginTop: 3,
  },
  offlineText: { color: colors.textSecondary, fontSize: 13 },
  retryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  retryText: { color: colors.onPrimary, fontWeight: "800" },
  operationalContext: {
    gap: 12,
  },
  screen: {
    backgroundColor: colors.canvas,
    flex: 1,
  },
  section: {
    gap: 16,
  },
  sectionWide: {
    gap: 20, flexDirection: "row", flexWrap: "wrap",
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  sectionTitleWide: {
    fontSize: 14,
  },
  typeBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.canvas,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  typeBadgeText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  value: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
});

function formatLocalDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

const desktopStyles = StyleSheet.create({
  ...desktopStyleColors(baseStyles),
  sectionWide: { ...baseStyles.sectionWide, flexDirection: "row", flexWrap: "wrap", gap: 24 },
  sectionTitleWide: { color: colors.text, fontWeight: "800", fontSize: 18, textTransform: "none" },
  typeBadge: { ...baseStyles.typeBadge, backgroundColor: "transparent", borderWidth: 0, paddingHorizontal: 0, paddingVertical: 0 },
  typeBadgeText: { ...baseStyles.typeBadgeText, color: colors.textSecondary, fontWeight: "400" },
});
