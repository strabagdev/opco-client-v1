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
  RecordsDiagnosticsState,
  getRecordsDiagnosticsRows,
  getSyncDiagnosticsRows,
} from "@/renderers/records/sync-diagnostics";
import { resolveRecordsSearchForScopeChange } from "@/renderers/records/records-renderer-state";
import { AppViewRendererProps } from "@/renderers/types";
import { getRecordSyncLabel } from "@/sync/records-sync";
import { useSession } from "@/state/session";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 350;

export function RecordsRenderer({ appView }: AppViewRendererProps<RecordsAppView>) {
  const entityTypeId = appView.config.entityTypeId;
  const { api, definitionCache, ownerKey, recordsReconnectRefreshKey, recordsSyncSummary, refreshRecordsSyncSummary, selectedContractId, status, syncPendingRecords, token } =
    useSession();
  const [definition, setDefinition] = useState<EntityDefinition | null>(null);
  const [records, setRecords] = useState<CachedEntityRecord[]>([]);
  const [pagination, setPagination] = useState<EntityRecordPagination | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [isOfflineData, setIsOfflineData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [recordsSyncTelemetry, setRecordsSyncTelemetry] = useState<SyncTelemetry | null>(null);
  const [recordsDiagnostics, setRecordsDiagnostics] = useState<RecordsDiagnosticsState | null>(null);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const previousScopeRef = useRef({ appViewId: appView.id, entityTypeId });

  const listItems = useMemo(
    () => (definition ? records.map((record) => buildRecordListItem({ definition, record })) : []),
    [definition, records],
  );
  const canLoadMore = pagination ? pagination.page < pagination.totalPages : false;
  const hasSyncIssues = recordsSyncSummary.failedCount > 0 || recordsSyncSummary.conflictCount > 0;
  const hasSyncActivity =
    recordsSyncSummary.pendingCount > 0 ||
    recordsSyncSummary.syncingCount > 0 ||
    recordsSyncSummary.failedCount > 0 ||
    recordsSyncSummary.conflictCount > 0;

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
      setFromCache(false);
      setIsOfflineData(false);
      setSyncedAt(null);
      setRecordsDiagnostics({
        appViewId: appView.id,
        connectivityStatus: status === "offline" ? "offline" : "online",
        contractId: selectedContractId,
        entityTypeId,
        error: null,
        isLoading: true,
        local: null,
        outboxConsistency: null,
        ownerKey,
        page: 1,
        refresh: null,
        rendererRecords: 0,
        search: debouncedSearch,
        sessionStatus: status,
      });

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
              onDiagnostics: (diagnostics) => {
                if (!isMounted) {
                  return;
                }

                setRecordsDiagnostics({
                  appViewId: appView.id,
                  connectivityStatus: status === "offline" ? "offline" : "online",
                  contractId: selectedContractId,
                  entityTypeId,
                  error: null,
                  isLoading: true,
                  local: diagnostics.afterReconcile ?? null,
                  outboxConsistency: null,
                  ownerKey,
                  page: 1,
                  refresh: diagnostics,
                  rendererRecords: 0,
                  search: debouncedSearch,
                  sessionStatus: status,
                });
              },
              resultPageSize: PAGE_SIZE,
              store: definitionCache,
              suppressNetworkTelemetry: status === "offline",
              token,
            });
        let outboxConsistency: RecordsDiagnosticsState["outboxConsistency"] = null;

        if (shouldShowRecordsDiagnostics()) {
          try {
            outboxConsistency = await definitionCache.getRecordOutboxConsistency({
              contractId: selectedContractId,
              entityTypeId,
              ownerKey,
            });
          } catch {
            outboxConsistency = null;
          }
        }

        if (isMounted) {
          setDefinition(definitionResult.definition);
          setFromCache(definitionResult.source === "cache" || recordsResult.fromCache);
          setIsOfflineData(recordsResult.offline);
          setSyncedAt(definitionResult.syncedAt);
          setRecords(recordsResult.records);
          setPagination(recordsResult.pagination);
          setRecordsDiagnostics((current) => ({
            appViewId: current?.appViewId ?? appView.id,
            connectivityStatus: current?.connectivityStatus ?? (status === "offline" ? "offline" : "online"),
            contractId: current?.contractId ?? selectedContractId,
            entityTypeId: current?.entityTypeId ?? entityTypeId,
            error: null,
            isLoading: false,
            local: current?.local ?? null,
            outboxConsistency,
            ownerKey: current?.ownerKey ?? ownerKey,
            page: recordsResult.pagination.page,
            refresh: current?.refresh ?? null,
            rendererRecords: recordsResult.records.length,
            search: debouncedSearch,
            sessionStatus: current?.sessionStatus ?? status,
          }));
        }
        await refreshRecordsSyncSummary();
        await refreshCurrentSyncTelemetry();
      } catch (nextError) {
        if (isMounted) {
          const message = nextError instanceof Error ? nextError.message : "No fue posible cargar registros.";

          setError(message);
          setRecordsDiagnostics((current) => current ? { ...current, error: message, isLoading: false } : current);
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
    ownerKey,
    recordsReconnectRefreshKey,
    refreshCurrentSyncTelemetry,
    refreshRecordsSyncSummary,
    retryCount,
    selectedContractId,
    status,
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
        </View>
      </View>

      {fromCache ? (
        <View style={styles.cacheBanner}>
          <Text style={styles.cacheText}>
            {isOfflineData ? "Sin conexion. Datos guardados localmente." : "Datos guardados localmente."}
          </Text>
          {syncedAt ? <Text style={styles.cacheMeta}>Ultima sincronizacion: {syncedAt}</Text> : null}
        </View>
      ) : null}

      <SyncTelemetrySummary telemetry={recordsSyncTelemetry} />

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
        <Link href={buildNewAppViewRecordHref(appView.id)} asChild>
          <Pressable style={styles.createButton}>
            <Text style={styles.createText}>Crear</Text>
          </Pressable>
        </Link>
      </View>

      {isLoading ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {error && records.length === 0 ? (
        <Pressable onPress={() => setRetryCount((count) => count + 1)} style={styles.retryButton}>
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
        {listItems.map((item) => (
          <Link href={buildAppViewRecordHref(appView.id, item.id)} key={item.id} asChild>
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
        <Pressable disabled={isLoadingMore} onPress={loadMoreRecords} style={styles.loadMoreButton}>
          {isLoadingMore ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.loadMoreText}>Cargar mas</Text>}
        </Pressable>
      ) : null}

      {shouldShowSyncDiagnostics() ? (
        <SyncDiagnostics summary={recordsSyncSummary} telemetry={recordsSyncTelemetry} />
      ) : null}
      {shouldShowRecordsDiagnostics() ? (
        <RecordsDiagnostics diagnostics={recordsDiagnostics} telemetry={recordsSyncTelemetry} />
      ) : null}
    </ScrollView>
  );
}


function SyncTelemetrySummary({ telemetry }: { telemetry: SyncTelemetry | null }) {
  if (!telemetry) {
    return null;
  }

  if (telemetry.syncPhase === "error" || telemetry.lastSyncErrorAt) {
    return <Text style={styles.syncProblemText}>Problema de sincronizacion</Text>;
  }

  const formatted = formatLastSuccessfulSyncAt(telemetry.lastSuccessfulSyncAt);

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

function shouldShowSyncDiagnostics() {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    return true;
  }

  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).has("syncDiagnostics");
}

function shouldShowRecordsDiagnostics() {
  if (typeof window === "undefined") {
    return false;
  }

  return new URLSearchParams(window.location.search).get("recordsDiagnostics") === "1";
}

function RecordsDiagnostics({
  diagnostics,
  telemetry,
}: {
  diagnostics: RecordsDiagnosticsState | null;
  telemetry: SyncTelemetry | null;
}) {
  const rows = getRecordsDiagnosticsRows(diagnostics, telemetry);

  return (
    <View style={styles.syncDiagnostics}>
      <Text style={styles.syncDiagnosticsTitle}>Diagnostico de records</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.syncDiagnosticsRow}>
          <Text style={styles.syncDiagnosticsLabel}>{label}</Text>
          <Text style={styles.syncDiagnosticsValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function SyncDiagnostics({
  summary,
  telemetry,
}: {
  summary: {
    conflictCount: number;
    failedCount: number;
    pendingCount: number;
    syncingCount: number;
  };
  telemetry: SyncTelemetry | null;
}) {
  const rows = getSyncDiagnosticsRows({ summary, telemetry });

  return (
    <View style={styles.syncDiagnostics}>
      <Text style={styles.syncDiagnosticsTitle}>Diagnostico de sincronizacion</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.syncDiagnosticsRow}>
          <Text style={styles.syncDiagnosticsLabel}>{label}</Text>
          <Text style={styles.syncDiagnosticsValue}>{value}</Text>
        </View>
      ))}
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
  syncDiagnostics: {
    backgroundColor: "#ffffff",
    borderColor: "#c8d2d5",
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  syncDiagnosticsLabel: {
    color: "#587078",
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  syncDiagnosticsRow: {
    flexDirection: "row",
    gap: 8,
  },
  syncDiagnosticsTitle: {
    color: "#17363c",
    fontSize: 14,
    fontWeight: "800",
  },
  syncDiagnosticsValue: {
    color: "#17363c",
    flex: 1,
    fontSize: 12,
    textAlign: "right",
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
