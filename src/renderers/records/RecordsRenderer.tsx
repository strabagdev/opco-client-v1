import { Link } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { formatLastSuccessfulSyncAt, SyncTelemetry } from "@/lib/sync-telemetry";
import {
  stableTextInputStyle,
  STABLE_LOAD_MORE_BUTTON_MIN_WIDTH,
} from "@/lib/visual-stability";
import {
  getRecordsCacheBannerMessage,
  resolveRecordsSearchForScopeChange,
  shouldShowRecordsSyncProblem,
} from "@/renderers/records/records-renderer-state";
import {
  buildStatusSubviewQuery,
  buildStatusSubviewRows,
  hasStatusSubview,
  statusSubviewFields,
  type RecordsSubviewTab,
} from "@/renderers/records/status-subview";
import { AppViewRendererProps } from "@/renderers/types";
import { getRecordSyncLabel } from "@/sync/records-sync";
import { useSession } from "@/state/session";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 350;

export function RecordsRenderer({ appView }: AppViewRendererProps<RecordsAppView>) {
  const entityTypeId = appView.config.entityTypeId;
  const { api, connectivityStatus, definitionCache, ownerKey, recordsReconnectRefreshKey, recordsSyncSummary, refreshRecordsSyncSummary, selectedContractId, status, syncPendingRecords, token } =
    useSession();
  const [definition, setDefinition] = useState<EntityDefinition | null>(null);
  const [records, setRecords] = useState<CachedEntityRecord[]>([]);
  const [pagination, setPagination] = useState<EntityRecordPagination | null>(null);
  const [statusRecords, setStatusRecords] = useState<CachedEntityRecord[]>([]);
  const [statusPagination, setStatusPagination] = useState<EntityRecordPagination | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isStatusLoading, setIsStatusLoading] = useState(false);
  const [isStatusLoadingMore, setIsStatusLoadingMore] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [isOfflineData, setIsOfflineData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [recordsSyncTelemetry, setRecordsSyncTelemetry] = useState<SyncTelemetry | null>(null);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedTab, setSelectedTab] = useState<RecordsSubviewTab>("records");
  const previousScopeRef = useRef({ appViewId: appView.id, entityTypeId });
  const statusSubviewEnabled = hasStatusSubview(appView.config);
  const activeTab: RecordsSubviewTab = statusSubviewEnabled ? selectedTab : "records";

  const listItems = useMemo(
    () => (definition ? records.map((record) => buildRecordListItem({ definition, record })) : []),
    [definition, records],
  );
  const statusRows = useMemo(
    () => definition && appView.config.statusSubview
      ? buildStatusSubviewRows({ definition, records: statusRecords, statusSubview: appView.config.statusSubview })
      : [],
    [appView.config.statusSubview, definition, statusRecords],
  );
  const canLoadMore = pagination ? pagination.page < pagination.totalPages : false;
  const canLoadMoreStatus = statusPagination ? statusPagination.page < statusPagination.totalPages : false;
  const hasSyncIssues = recordsSyncSummary.failedCount > 0 || recordsSyncSummary.conflictCount > 0;
  const hasSyncActivity =
    recordsSyncSummary.pendingCount > 0 ||
    recordsSyncSummary.syncingCount > 0 ||
    recordsSyncSummary.failedCount > 0 ||
    recordsSyncSummary.conflictCount > 0;
  const cacheBannerMessage = getRecordsCacheBannerMessage({ connectivityStatus, fromCache, isLoading });

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

    async function loadEntityRecords() {
      if (!token || !selectedContractId || !entityTypeId || !ownerKey) {
        setError("Selecciona un contrato antes de abrir registros.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      setDefinition(null);
      setRecords([]);
      setPagination(null);
      setStatusRecords([]);
      setStatusPagination(null);
      setStatusError(null);
      setFromCache(false);
      setIsOfflineData(false);
      setSyncedAt(null);

      try {
        const definitionResult = await getEntityDefinitionWithCache({
          api,
          cache: definitionCache,
          contractId: selectedContractId,
          entityTypeId,
          token,
        });
        const recordsResult = debouncedSearch
          ? await loadRecordsWithOfflineCache({
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
          : await refreshEntityRecordsCache({
              api,
              contractId: selectedContractId,
              entityTypeId,
              ownerKey,
              resultPageSize: PAGE_SIZE,
              store: definitionCache,
              suppressNetworkTelemetry: status === "offline",
              token,
            });

        if (isMounted) {
          setDefinition(definitionResult.definition);
          setFromCache(definitionResult.source === "cache" || recordsResult.fromCache);
          setIsOfflineData(recordsResult.offline);
          setSyncedAt(definitionResult.syncedAt);
          setRecords(recordsResult.records);
          setPagination(recordsResult.pagination);
        }
        await refreshRecordsSyncSummary();
        await refreshCurrentSyncTelemetry();
      } catch (nextError) {
        if (isMounted) {
          const message = nextError instanceof Error ? nextError.message : "No fue posible cargar registros.";

          setError(message);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadEntityRecords();

    return () => {
      isMounted = false;
    };
  }, [
    api,
    appView.id,
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
    token,
  ]);

  useEffect(() => {
    let isMounted = true;

    async function loadStatusRecords() {
      if (!statusSubviewEnabled || activeTab !== "status") {
        return;
      }

      if (!token || !selectedContractId || !entityTypeId || !ownerKey || !definition || !appView.config.statusSubview) {
        return;
      }

      const fields = statusSubviewFields(definition, appView.config);

      setIsStatusLoading(true);
      setStatusError(null);
      setStatusRecords([]);
      setStatusPagination(null);

      try {
        const query = buildStatusSubviewQuery({
          config: appView.config,
          page: 1,
          pageSize: PAGE_SIZE,
          search: debouncedSearch,
        });
        const result = await loadRecordsWithOfflineCache({
          api,
          contractId: selectedContractId,
          direction: query.direction,
          entityTypeId,
          fieldIdHasValue: query.fieldIdHasValue,
          fields: definition.fields,
          ownerKey,
          page: query.page,
          pageSize: query.pageSize,
          search: query.search,
          sort: query.sort,
          store: definitionCache,
          token,
        });

        if (isMounted) {
          setStatusRecords(result.records);
          setStatusPagination(result.pagination);
          setFromCache((current) => current || result.fromCache);
          setIsOfflineData((current) => current || result.offline);
        }
      } catch (nextError) {
        if (isMounted) {
          const fallbackLabel = fields.stateField ? "No fue posible cargar estados." : "La subvista Estados no tiene un campo valido.";

          setStatusError(nextError instanceof Error ? nextError.message : fallbackLabel);
        }
      } finally {
        if (isMounted) {
          setIsStatusLoading(false);
        }
      }
    }

    void loadStatusRecords();

    return () => {
      isMounted = false;
    };
  }, [
    api,
    appView.config,
    debouncedSearch,
    definition,
    definitionCache,
    entityTypeId,
    ownerKey,
    recordsReconnectRefreshKey,
    retryCount,
    selectedContractId,
    activeTab,
    statusSubviewEnabled,
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
      setPagination(result.pagination);
      setFromCache((current) => current || result.fromCache);
      setIsOfflineData((current) => current || result.offline);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No fue posible cargar mas registros.");
    } finally {
      setIsLoadingMore(false);
    }
  }

  async function loadMoreStatusRecords() {
    if (!token || !selectedContractId || !entityTypeId || !ownerKey || !statusPagination || isStatusLoadingMore || !definition) {
      return;
    }

    setIsStatusLoadingMore(true);
    setStatusError(null);

    try {
      const query = buildStatusSubviewQuery({
        config: appView.config,
        page: statusPagination.page + 1,
        pageSize: PAGE_SIZE,
        search: debouncedSearch,
      });
      const result = await loadRecordsWithOfflineCache({
        api,
        contractId: selectedContractId,
        direction: query.direction,
        entityTypeId,
        fieldIdHasValue: query.fieldIdHasValue,
        fields: definition.fields,
        ownerKey,
        page: query.page,
        pageSize: query.pageSize,
        search: query.search,
        sort: query.sort,
        store: definitionCache,
        token,
      });

      setStatusRecords((current) => [...current, ...result.records]);
      setStatusPagination(result.pagination);
      setFromCache((current) => current || result.fromCache);
      setIsOfflineData((current) => current || result.offline);
    } catch (nextError) {
      setStatusError(nextError instanceof Error ? nextError.message : "No fue posible cargar mas estados.");
    } finally {
      setIsStatusLoadingMore(false);
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
          <Text style={styles.syncText}>{formatSyncSummary(recordsSyncSummary)}</Text>
          <View style={styles.syncActions}>
            {hasSyncIssues ? (
              <Link href={buildAppViewProblemsHref(appView.id)} asChild>
                <Pressable style={styles.secondarySyncButton}>
                  <Text style={styles.secondarySyncButtonText}>Ver problemas</Text>
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
        {activeTab === "records" ? (
          <Link href={buildNewAppViewRecordHref(appView.id)} asChild>
            <Pressable style={styles.createButton}>
              <Text style={styles.createText}>Crear</Text>
            </Pressable>
          </Link>
        ) : null}
      </View>

      {statusSubviewEnabled ? (
        <View style={styles.tabs}>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === "records" }}
            onPress={() => setSelectedTab("records")}
            style={[styles.tabButton, activeTab === "records" && styles.tabButtonActive]}
          >
            <Text style={[styles.tabText, activeTab === "records" && styles.tabTextActive]}>Registros</Text>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === "status" }}
            onPress={() => setSelectedTab("status")}
            style={[styles.tabButton, activeTab === "status" && styles.tabButtonActive]}
          >
            <Text style={[styles.tabText, activeTab === "status" && styles.tabTextActive]}>Estados</Text>
          </Pressable>
        </View>
      ) : null}

      {activeTab === "status" && appView.config.statusSubview ? (
        <StatusSubviewContent
          canLoadMore={canLoadMoreStatus}
          error={statusError}
          isLoading={isStatusLoading}
          isLoadingMore={isStatusLoadingMore}
          onLoadMore={loadMoreStatusRecords}
          onRetry={() => setRetryCount((count) => count + 1)}
          rows={statusRows}
          showDate={Boolean(appView.config.statusSubview.dateFieldId)}
          appViewId={appView.id}
        />
      ) : (
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
      )}
    </ScrollView>
  );
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
          <Text style={styles.retryText}>Reintentar</Text>
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

function StatusSubviewContent({
  appViewId,
  canLoadMore,
  error,
  isLoading,
  isLoadingMore,
  onLoadMore,
  onRetry,
  rows,
  showDate,
}: {
  appViewId: string;
  canLoadMore: boolean;
  error: string | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  rows: ReturnType<typeof buildStatusSubviewRows>;
  showDate: boolean;
}) {
  return (
    <>
      {isLoading ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {error && rows.length === 0 ? (
        <Pressable onPress={onRetry} style={styles.retryButton}>
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      ) : null}
      {!isLoading && !error && rows.length === 0 ? (
        <Text style={styles.empty}>No hay registros con estado.</Text>
      ) : null}

      <View style={styles.recordList}>
        {rows.map((row) => (
          <Link href={buildAppViewRecordHref(appViewId, row.id)} key={row.id} asChild>
            <Pressable style={styles.statusRow}>
              <Text numberOfLines={1} style={styles.statusName}>{row.name}</Text>
              <Text numberOfLines={1} style={styles.statusValue}>{row.state}</Text>
              {showDate ? <Text numberOfLines={1} style={styles.statusDate}>{row.date ?? ""}</Text> : null}
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

function formatSyncSummary(summary: {
  conflictCount: number;
  failedCount: number;
  pendingCount: number;
  syncingCount: number;
}) {
  return [
    summary.pendingCount ? `${summary.pendingCount} pendientes` : null,
    summary.syncingCount ? `${summary.syncingCount} sincronizando` : null,
    summary.failedCount ? `${summary.failedCount} errores` : null,
    summary.conflictCount ? `${summary.conflictCount} conflictos` : null,
  ].filter(Boolean).join(" · ");
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
  statusDate: {
    color: "#587078",
    flexBasis: 96,
    fontSize: 13,
    fontWeight: "700",
  },
  statusName: {
    color: "#17363c",
    flex: 1,
    fontSize: 15,
    fontWeight: "800",
    minWidth: 120,
  },
  statusRow: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderColor: "#d4dddf",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  statusValue: {
    color: "#135d66",
    flexBasis: 120,
    fontSize: 14,
    fontWeight: "800",
  },
  tabButton: {
    alignItems: "center",
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
  },
  tabButtonActive: {
    backgroundColor: "#ffffff",
  },
  tabs: {
    backgroundColor: "#dce9eb",
    borderRadius: 8,
    flexDirection: "row",
    gap: 4,
    padding: 4,
  },
  tabText: {
    color: "#587078",
    fontWeight: "800",
  },
  tabTextActive: {
    color: "#0f3036",
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
