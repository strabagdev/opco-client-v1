import { Link } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { AppIcon } from "@/components/app-icon";
import { buildAppViewProblemsHref, buildAppViewRecordHref, buildNewAppViewRecordHref } from "@/lib/app-views";
import { resolvePreferredAppIcon } from "@/lib/app-icons";
import { getEntityDefinitionWithCache } from "@/lib/definition-cache";
import { buildRecordListItem } from "@/lib/entity-record-display";
import {
  CachedEntityRecord,
  loadRecordsWithOfflineCache,
  refreshEntityRecordsCache,
} from "@/lib/offline-records";
import { EntityDefinition, EntityRecordPagination, RecordsAppView } from "@/lib/opco-api";
import type { RecordsOpeningMeasurement } from "@/lib/records-opening-history";
import { classifySyncTelemetryError, formatLastSuccessfulSyncAt, SyncTelemetry } from "@/lib/sync-telemetry";
import {
  stableTextInputStyle,
  STABLE_LOAD_MORE_BUTTON_MIN_WIDTH,
} from "@/lib/visual-stability";
import {
  getRecordsInlineSyncSummary,
  getRecordsListErrorMessage,
  getRecordsCacheBannerMessage,
  resolveRecordsSearchForScopeChange,
  shouldShowRecordsSyncProblem,
} from "@/renderers/records/records-renderer-state";
import {
  activateRecordsOpeningHistoryOwner,
  hydrateRecordsOpeningHistory,
  loadRecordsCacheFirst,
  recordRecordsOpeningMeasurement,
  selectPresentableLocalRecords,
  shouldStartRecordsOpeningMeasurement,
} from "@/renderers/records/records-opening";
import { AppViewRendererProps } from "@/renderers/types";
import { useExperienceOpeningSession } from "@/renderers/experience-opening";
import { useExperienceActivityReporter } from "@/renderers/use-experience-activity";
import { getRecordSyncLabel } from "@/sync/records-sync";
import { useSession } from "@/state/session";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 350;

export function RecordsRenderer({ appView }: AppViewRendererProps<RecordsAppView>) {
  const sharedOpening = useExperienceOpeningSession();
  const entityTypeId = appView.config.entityTypeId;
  const { api, connectivityStatus, definitionCache, ownerKey, recordsReconnectRefreshKey, recordsSyncSummary, refreshRecordsSyncSummary, selectedContractId, status, syncPendingRecords, token } =
    useSession();
  const [definition, setDefinition] = useState<EntityDefinition | null>(null);
  const [records, setRecords] = useState<CachedEntityRecord[]>([]);
  const [listItems, setListItems] = useState<ReturnType<typeof buildRecordListItem>[]>([]);
  const [pagination, setPagination] = useState<EntityRecordPagination | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [isOfflineData, setIsOfflineData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [recordsSyncTelemetry, setRecordsSyncTelemetry] = useState<SyncTelemetry | null>(null);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const previousScopeRef = useRef({ appViewId: appView.id, entityTypeId });
  const loadedScopeRef = useRef<string | null>(null);
  const measuredOpeningScopeRef = useRef<string | null>(null);

  const canLoadMore = pagination ? pagination.page < pagination.totalPages : false;
  const hasSyncIssues = recordsSyncSummary.failedCount > 0 || recordsSyncSummary.conflictCount > 0;
  const hasSyncActivity =
    recordsSyncSummary.pendingCount > 0 ||
    recordsSyncSummary.syncingCount > 0 ||
    recordsSyncSummary.failedCount > 0 ||
    recordsSyncSummary.conflictCount > 0;
  const inlineSyncSummary = getRecordsInlineSyncSummary(recordsSyncSummary);
  const cacheBannerMessage = getRecordsCacheBannerMessage({ connectivityStatus, fromCache, isLoading: isRefreshing });
  useExperienceActivityReporter(appView, {
    activeCount: Number(isRefreshing) + Number(isLoadingMore),
    errorCode: error ? "RECORDS_READ_FAILED" : null,
    result: error ? "error" : !isRefreshing && !isLoading ? "success" : null,
  });

  useEffect(() => {
    const nextScope = { appViewId: appView.id, entityTypeId };
    const nextSearch = resolveRecordsSearchForScopeChange({
      currentSearch: { debouncedSearch: "preserve", searchText: "preserve" },
      nextScope,
      previousScope: previousScopeRef.current,
    });

    previousScopeRef.current = nextScope;
    if (nextSearch.searchText === "preserve" && nextSearch.debouncedSearch === "preserve") {
      return;
    }

    setSearchText(nextSearch.searchText);
    setDebouncedSearch(nextSearch.debouncedSearch);
  }, [appView.id, entityTypeId]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearch(searchText.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [searchText]);

  const refreshCurrentSyncTelemetry = useCallback(async () => {
    if (!ownerKey || !selectedContractId || !entityTypeId) {
      setRecordsSyncTelemetry(null);
      return;
    }

    try {
      setRecordsSyncTelemetry(await definitionCache.getSyncTelemetry({
        contractId: selectedContractId,
        entityTypeId,
        ownerKey,
      }));
    } catch {
      setRecordsSyncTelemetry(null);
    }
  }, [definitionCache, entityTypeId, ownerKey, selectedContractId]);

  useEffect(() => {
    let isMounted = true;
    let measurement: RecordsOpeningMeasurement | null = null;
    let measurementContractId: string | null = null;
    let measurementOwnerKey: string | null = null;
    let terminalResult = false;

    async function loadEntityRecords() {
      if (!token || !selectedContractId || !entityTypeId || !ownerKey) {
        setError("Selecciona un contrato antes de abrir registros.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setIsRefreshing(true);
      setError(null);
      const activeOwnerKey = ownerKey;
      const activeContractId = selectedContractId;
      measurementOwnerKey = activeOwnerKey;
      measurementContractId = activeContractId;
      const scopeKey = `${activeOwnerKey}:${activeContractId}:${entityTypeId}`;
      const openingScopeKey = `${scopeKey}:${appView.id}`;
      const shouldMeasureOpening = shouldStartRecordsOpeningMeasurement(measuredOpeningScopeRef.current, openingScopeKey);
      if (shouldMeasureOpening) measuredOpeningScopeRef.current = openingScopeKey;
      const openingStartedAt = sharedOpening?.monotonicStartedAt ?? monotonicNow();
      const openingStartedAtIso = sharedOpening?.startedAt ?? new Date().toISOString();
      let localReadMs: number | null = null;
      let localSnapshotComplete = false;
      let hasPresentableLocalRecords = false;
      let localDefinition: EntityDefinition | null = null;
      let firstRowsAt: number | null = null;
      let presentedCount = 0;
      let presentedSource: "local" | "remote" | "none" = "none";
      let remoteStartedAt: number | null = null;
      measurement = shouldMeasureOpening ? {
        appViewId: appView.id,
        appViewTitle: appView.name,
        coverage: "unknown",
        errorCode: null,
        appViewResolutionMs: sharedOpening?.resolutionMs ?? null,
        appViewType: "RECORDS",
        firstUsefulContentMs: null,
        id: sharedOpening?.id ?? createOpeningMeasurementId(),
        origin: sharedOpening?.origin ?? "renderer",
        localReadMs: null,
        preparationMs: null,
        processedCount: 0,
        remoteRefreshMs: null,
        result: "in_progress",
        shownCount: 0,
        source: "none",
        startedAt: openingStartedAtIso,
        timeToFirstRowsMs: null,
        variant: null,
      } : null;

      function publishOpeningMeasurement(patch: Partial<RecordsOpeningMeasurement>) {
        if (!isMounted || !measurement) return;
        measurement = { ...measurement, ...patch, localReadMs };
        recordRecordsOpeningMeasurement({
          contractId: activeContractId,
          measurement,
          ownerKey: activeOwnerKey,
          store: definitionCache,
        });
      }

      function presentRecords(
        nextDefinition: EntityDefinition,
        result: Awaited<ReturnType<typeof definitionCache.listCachedRecords>>,
        source: "local" | "remote",
        remoteRefreshMs: number | null,
      ) {
        const preparationStartedAt = monotonicNow();
        const nextItems = result.records.map((record) => buildRecordListItem({ definition: nextDefinition, record }));
        const preparationMs = elapsedMs(preparationStartedAt);

        if (!isMounted) return;
        if (firstRowsAt === null && nextItems.length > 0) firstRowsAt = monotonicNow();
        presentedCount = result.records.length;
        presentedSource = source;
        setDefinition(nextDefinition);
        setRecords(result.records);
        setListItems(nextItems);
        setPagination(result.pagination);
        setFromCache(source === "local" || result.fromCache);
        setIsOfflineData(result.offline);
        loadedScopeRef.current = scopeKey;
        publishOpeningMeasurement({
          coverage: source === "remote" && !result.fromCache ? "complete" : measurement?.coverage ?? "unknown",
          preparationMs,
          processedCount: source === "remote" ? result.pagination.total : result.records.length,
          remoteRefreshMs,
          shownCount: result.records.length,
          source: !measurement || measurement.source === "none" ? source : measurement.source,
          timeToFirstRowsMs: firstRowsAt === null ? null : elapsedMs(openingStartedAt, firstRowsAt),
          firstUsefulContentMs: firstRowsAt === null ? null : elapsedMs(openingStartedAt, firstRowsAt),
        });
      }

      if (shouldMeasureOpening) {
        activateRecordsOpeningHistoryOwner(activeOwnerKey);
        void hydrateRecordsOpeningHistory({ contractId: activeContractId, ownerKey: activeOwnerKey, store: definitionCache });
        publishOpeningMeasurement({});
      }

      if (loadedScopeRef.current !== scopeKey) {
        setDefinition(null);
        setRecords([]);
        setListItems([]);
        setPagination(null);
        setFromCache(false);
        setIsOfflineData(false);
        setSyncedAt(null);
      }

      try {
        remoteStartedAt = monotonicNow();
        const opening = await loadRecordsCacheFirst({
          canPresentLocal: (local) => {
            localSnapshotComplete = Boolean(local.definition && local.telemetry?.lastFullRefreshCompletedAt);
            hasPresentableLocalRecords = localSnapshotComplete ||
              local.records.records.some((record) => record.syncStatus !== "synced");
            return hasPresentableLocalRecords && Boolean(local.definition);
          },
          isActive: () => isMounted,
          onPresentLocal: (local) => {
            if (local.definition) {
              localDefinition = local.definition.definition;
              const recordsToPresent = localSnapshotComplete
                ? local.records
                : selectPresentableLocalRecords(local.records, false);
              if (measurement) {
                measurement = { ...measurement, coverage: localSnapshotComplete ? "complete" : "partial" };
              }
              presentRecords(local.definition.definition, recordsToPresent, "local", null);
              setSyncedAt(local.definition.syncedAt);
              setIsLoading(false);
            }
          },
          readLocal: async () => {
            const localStartedAt = monotonicNow();
            const [cachedDefinition, cachedRecords, telemetry] = await Promise.all([
              definitionCache.getEntityDefinition(selectedContractId, entityTypeId),
              definitionCache.listCachedRecords({
                contractId: selectedContractId,
                entityTypeId,
                ownerKey,
                page: 1,
                pageSize: PAGE_SIZE,
                search: debouncedSearch,
              }),
              definitionCache.getSyncTelemetry({ contractId: selectedContractId, entityTypeId, ownerKey }),
            ]);
            localReadMs = elapsedMs(localStartedAt);
            return { definition: cachedDefinition, records: cachedRecords, telemetry };
          },
          refreshRemote: async () => {
            const [definitionResult, recordsResult] = await Promise.all([
              getEntityDefinitionWithCache({
                api,
                cache: definitionCache,
                contractId: selectedContractId,
                entityTypeId,
                token,
              }),
              debouncedSearch
                ? loadRecordsWithOfflineCache({
                    api,
                    contractId: selectedContractId,
                    entityTypeId,
                    ownerKey,
                    page: 1,
                    pageSize: PAGE_SIZE,
                    search: debouncedSearch,
                    store: definitionCache,
                    token,
                  })
                : refreshEntityRecordsCache({
                    api,
                    contractId: selectedContractId,
                    entityTypeId,
                    ownerKey,
                    resultPageSize: PAGE_SIZE,
                    store: definitionCache,
                    suppressNetworkTelemetry: status === "offline",
                    token,
                  }),
            ]);
            return { definitionResult, recordsResult };
          },
        });
        const remoteRefreshMs = elapsedMs(remoteStartedAt);

        if (opening.remote.recordsResult.fromCache && !localSnapshotComplete) {
          throw new Error("No existe un snapshot local completo para esta experiencia.");
        }

        presentRecords(
          opening.remote.definitionResult.definition,
          opening.remote.recordsResult,
          opening.remote.recordsResult.fromCache ? "local" : "remote",
          remoteRefreshMs,
        );
        if (isMounted) setSyncedAt(opening.remote.definitionResult.syncedAt);
        terminalResult = true;
        publishOpeningMeasurement({ errorCode: null, result: "completed" });
        await refreshRecordsSyncSummary();
        await refreshCurrentSyncTelemetry();
      } catch (nextError) {
        if (isMounted) {
          const message = getRecordsListErrorMessage(nextError) ?? "No pudimos cargar la lista de personas";

          try {
            const cached = await definitionCache.listCachedRecords({
              contractId: selectedContractId,
              entityTypeId,
              ownerKey,
              page: 1,
              pageSize: PAGE_SIZE,
              search: debouncedSearch,
            });

            if (isMounted && localSnapshotComplete && localDefinition && cached.records.length > 0) {
              presentRecords(localDefinition, { ...cached, offline: true }, "local", null);
            }
          } catch {
            // The original load error is more useful to the user and diagnostics.
          }

          setError(message);
          terminalResult = true;
          publishOpeningMeasurement({
            errorCode: classifySyncTelemetryError(nextError),
            processedCount: presentedCount,
            remoteRefreshMs: remoteStartedAt === null ? null : elapsedMs(remoteStartedAt),
            result: "error",
            source: !measurement || measurement.source === "none" ? presentedSource : measurement.source,
          });
        }
        try {
          await refreshRecordsSyncSummary();
          await refreshCurrentSyncTelemetry();
        } catch {
          // Diagnostics refresh must not replace the list load failure.
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    }

    void loadEntityRecords();

    return () => {
      if (!terminalResult && measurement && measurementContractId && measurementOwnerKey) {
        recordRecordsOpeningMeasurement({
          contractId: measurementContractId,
          measurement: { ...measurement, result: "cancelled" },
          ownerKey: measurementOwnerKey,
          store: definitionCache,
        });
      }
      isMounted = false;
    };
  }, [
    api,
    appView.id,
    appView.name,
    debouncedSearch,
    definitionCache,
    entityTypeId,
    connectivityStatus,
    ownerKey,
    recordsReconnectRefreshKey,
    refreshCurrentSyncTelemetry,
    refreshRecordsSyncSummary,
    retryCount,
    selectedContractId,
    status,
    sharedOpening,
    token,
  ]);

  async function loadMoreRecords() {
    if (!token || !selectedContractId || !entityTypeId || !ownerKey || !pagination || isLoadingMore) {
      return;
    }

    setIsLoadingMore(true);
    setError(null);

    try {
      const result = await loadRecordsWithOfflineCache({
        api,
        contractId: selectedContractId,
        entityTypeId,
        ownerKey,
        page: pagination.page + 1,
        pageSize: PAGE_SIZE,
        search: debouncedSearch,
        store: definitionCache,
        token,
      });

      setRecords((current) => [...current, ...result.records]);
      if (definition) {
        setListItems((current) => [
          ...current,
          ...result.records.map((record) => buildRecordListItem({ definition, record })),
        ]);
      }
      setPagination(result.pagination);
      setFromCache((current) => current || result.fromCache);
      setIsOfflineData((current) => current || result.offline);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No fue posible cargar mas registros.");
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function synchronizeRecords() {
    await syncPendingRecords();
    await refreshCurrentSyncTelemetry();
    setRetryCount((count) => count + 1);
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <AppIcon icon={resolvePreferredAppIcon(appView.icon, definition?.icon)} size={26} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>{appView.name}</Text>
          <Text style={styles.meta}>
            {definition?.name ? `${definition.name} · ${pagination ? `${pagination.total} registros` : "Registros"}` : "Registros"}
          </Text>
          <SyncTelemetrySummary connectivityStatus={connectivityStatus} fallbackSyncedAt={syncedAt} telemetry={recordsSyncTelemetry} />
        </View>
      </View>

      {cacheBannerMessage ? (
        <View style={styles.cacheBanner}>
          <Text style={styles.cacheText}>{cacheBannerMessage}</Text>
        </View>
      ) : null}

      {hasSyncActivity ? (
        <View style={styles.syncBar}>
          <Text style={styles.syncText}>{inlineSyncSummary}</Text>
          <View style={styles.syncActions}>
            {hasSyncIssues ? (
              <Link href={buildAppViewProblemsHref(appView.id)} asChild>
                <Pressable style={styles.secondarySyncButton}>
                  <Text style={styles.secondarySyncButtonText}>Ver cambios afectados</Text>
                </Pressable>
              </Link>
            ) : null}
            {recordsSyncSummary.pendingCount > 0 ? (
              <Pressable onPress={synchronizeRecords} style={styles.syncButton}>
                <Text style={styles.syncButtonText}>Sincronizar</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={styles.toolbar}>
        <TextInput
          autoCapitalize="none"
          clearButtonMode="while-editing"
          onChangeText={setSearchText}
          placeholder="Buscar registros"
          returnKeyType="search"
          style={styles.searchInput}
          value={searchText}
        />
        <Link href={buildNewAppViewRecordHref(appView.id)} asChild>
          <Pressable style={styles.createButton}>
            <Text style={styles.createText}>Crear</Text>
          </Pressable>
        </Link>
      </View>

      <RecordsListContent
        canLoadMore={canLoadMore}
        debouncedSearch={debouncedSearch}
        error={error}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        isOfflineData={isOfflineData}
        items={listItems}
        onLoadMore={loadMoreRecords}
        onRetry={() => setRetryCount((count) => count + 1)}
        records={records}
        appViewId={appView.id}
      />
    </ScrollView>
  );
}

let openingSequence = 0;

function createOpeningMeasurementId() {
  openingSequence += 1;
  return `records-opening-${Date.now().toString(36)}-${openingSequence.toString(36)}`;
}

function monotonicNow() {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function elapsedMs(startedAt: number, completedAt = monotonicNow()) {
  return Math.max(0, Math.round(completedAt - startedAt));
}

function RecordsListContent({
  appViewId,
  canLoadMore,
  debouncedSearch,
  error,
  isLoading,
  isLoadingMore,
  isOfflineData,
  items,
  onLoadMore,
  onRetry,
  records,
}: {
  appViewId: string;
  canLoadMore: boolean;
  debouncedSearch: string;
  error: string | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  isOfflineData: boolean;
  items: ReturnType<typeof buildRecordListItem>[];
  onLoadMore: () => void;
  onRetry: () => void;
  records: CachedEntityRecord[];
}) {
  return (
    <>
      {isLoading ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {error && records.length === 0 ? (
        <Pressable onPress={onRetry} style={styles.retryButton}>
          <Text style={styles.retryText}>Volver a cargar</Text>
        </Pressable>
      ) : null}
      {!isLoading && !error && records.length === 0 ? (
        <Text style={styles.empty}>
          {isOfflineData && !debouncedSearch
            ? "No hay datos guardados para esta experiencia."
            : debouncedSearch ? "No hay registros para esta busqueda." : "Esta experiencia no tiene registros."}
        </Text>
      ) : null}

      <View style={styles.recordList}>
        {items.map((item) => (
          <Link href={buildAppViewRecordHref(appViewId, item.id)} key={item.id} asChild>
            <Pressable style={styles.recordCard}>
              <View style={styles.recordTitleRow}>
                <Text style={styles.recordTitle}>{item.title}</Text>
                <SyncBadge record={records.find((record) => record.id === item.id)} />
              </View>
              {item.fields.length > 0 ? (
                <View style={styles.recordFields}>
                  {item.fields.map((field) => (
                    <View key={field.key} style={styles.recordField}>
                      <Text style={styles.recordLabel}>{field.label}</Text>
                      <Text numberOfLines={1} style={styles.recordValue}>
                        {field.value}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Pressable>
          </Link>
        ))}
      </View>

      {canLoadMore ? (
        <Pressable disabled={isLoadingMore} onPress={onLoadMore} style={styles.loadMoreButton}>
          {isLoadingMore ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.loadMoreText}>Cargar mas</Text>}
        </Pressable>
      ) : null}
    </>
  );
}

function SyncTelemetrySummary({
  connectivityStatus,
  fallbackSyncedAt,
  telemetry,
}: {
  connectivityStatus: ReturnType<typeof useSession>["connectivityStatus"];
  fallbackSyncedAt: string | null;
  telemetry: SyncTelemetry | null;
}) {
  if (shouldShowRecordsSyncProblem({ connectivityStatus, telemetry })) {
    return <Text style={styles.syncProblemText}>Problema de sincronizacion</Text>;
  }

  const formatted = formatLastSuccessfulSyncAt(telemetry?.lastSuccessfulSyncAt ?? null) ?? fallbackSyncedAt;

  if (!formatted) {
    return null;
  }

  return <Text style={styles.lastSyncText}>Ultima sincronizacion: {formatted}</Text>;
}

function SyncBadge({ record }: { record: CachedEntityRecord | undefined }) {
  const label = record ? getRecordSyncLabel(record) : null;

  if (!record || !label) {
    return null;
  }

  return (
    <View style={[
      styles.badge,
      record.syncStatus === "failed" && styles.badgeFailed,
      record.syncStatus === "conflict" && styles.badgeConflict,
    ]}>
      <Text style={[
        styles.badgeText,
        record.syncStatus === "failed" && styles.badgeFailedText,
        record.syncStatus === "conflict" && styles.badgeConflictText,
      ]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: "#eef4f4",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeFailed: {
    backgroundColor: "#fef3f2",
  },
  badgeConflict: {
    backgroundColor: "#fff7ed",
  },
  badgeConflictText: {
    color: "#9a3412",
  },
  badgeFailedText: {
    color: "#b42318",
  },
  badgeText: {
    color: "#466068",
    fontSize: 12,
    fontWeight: "800",
  },
  cacheBanner: {
    backgroundColor: "#fff7ed",
    borderColor: "#fed7aa",
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  cacheMeta: {
    color: "#9a3412",
    marginTop: 4,
  },
  cacheText: {
    color: "#9a3412",
    fontWeight: "700",
  },
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 36,
  },
  createButton: {
    alignItems: "center",
    backgroundColor: "#135d66",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 18,
  },
  createText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  empty: {
    color: "#587078",
    lineHeight: 21,
  },
  error: {
    color: "#b42318",
    lineHeight: 20,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
  },
  headerText: {
    flex: 1,
  },
  icon: {
    alignItems: "center",
    backgroundColor: "#e4f1f2",
    borderRadius: 8,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  loadMoreButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#135d66",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 46,
    minWidth: STABLE_LOAD_MORE_BUTTON_MIN_WIDTH,
    paddingHorizontal: 18,
  },
  loadMoreText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  lastSyncText: {
    color: "#587078",
    fontSize: 13,
  },
  meta: {
    color: "#587078",
    marginTop: 3,
  },
  recordCard: {
    backgroundColor: "#ffffff",
    borderColor: "#d4dddf",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  recordField: {
    flexBasis: 180,
    flexGrow: 1,
    gap: 3,
    minWidth: 0,
  },
  recordFields: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  recordLabel: {
    color: "#587078",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  recordList: {
    gap: 10,
  },
  recordTitle: {
    color: "#17363c",
    flexShrink: 1,
    fontSize: 17,
    fontWeight: "800",
  },
  recordTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
  recordValue: {
    color: "#17363c",
    fontSize: 14,
  },
  retryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#135d66",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: 16,
  },
  retryText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  screen: {
    backgroundColor: "#eef4f4",
    flex: 1,
  },
  searchInput: {
    backgroundColor: "#ffffff",
    borderColor: "#c8d2d5",
    borderRadius: 8,
    borderWidth: 1,
    color: "#17363c",
    flex: 1,
    minHeight: 46,
    ...stableTextInputStyle,
    minWidth: 0,
    paddingHorizontal: 14,
  },
  syncBar: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#d4dddf",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    padding: 12,
  },
  secondarySyncButton: {
    alignItems: "center",
    borderColor: "#b8c7ca",
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 14,
  },
  secondarySyncButtonText: {
    color: "#17363c",
    fontWeight: "800",
  },
  syncActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-end",
  },
  syncProblemText: {
    color: "#9a3412",
    fontSize: 13,
    fontWeight: "700",
  },
  syncButton: {
    alignItems: "center",
    backgroundColor: "#135d66",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: 14,
  },
  syncButtonText: {
    color: "#ffffff",
    fontWeight: "800",
  },
  syncText: {
    color: "#17363c",
    fontWeight: "800",
  },
  title: {
    color: "#0f3036",
    fontSize: 26,
    fontWeight: "800",
  },
  toolbar: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
});
