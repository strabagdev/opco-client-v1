import { Link } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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
import { buildAppViewRecordHref, buildNewAppViewRecordHref } from "@/lib/app-views";
import { resolvePreferredAppIcon } from "@/lib/app-icons";
import { getEntityDefinitionWithCache } from "@/lib/definition-cache";
import { buildRecordListItem } from "@/lib/entity-record-display";
import { CachedEntityRecord, loadRecordsWithOfflineCache } from "@/lib/offline-records";
import { EntityDefinition, EntityRecordPagination, RecordsAppView } from "@/lib/opco-api";
import {
  stableTextInputStyle,
  STABLE_LOAD_MORE_BUTTON_MIN_WIDTH,
} from "@/lib/visual-stability";
import { AppViewRendererProps } from "@/renderers/types";
import { getRecordSyncLabel } from "@/sync/records-sync";
import { useSession } from "@/state/session";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 350;

export function RecordsRenderer({ appView }: AppViewRendererProps<RecordsAppView>) {
  const entityTypeId = appView.config.entityTypeId;
  const { api, definitionCache, ownerKey, pendingRecordsCount, selectedContractId, syncPendingRecords, token } =
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
  const [searchText, setSearchText] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const listItems = useMemo(
    () => (definition ? records.map((record) => buildRecordListItem({ definition, record })) : []),
    [definition, records],
  );
  const canLoadMore = pagination ? pagination.page < pagination.totalPages : false;

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearch(searchText.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [searchText]);

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

      try {
        const definitionResult = await getEntityDefinitionWithCache({
          api,
          cache: definitionCache,
          contractId: selectedContractId,
          entityTypeId,
          token,
        });
        const recordsResult = await loadRecordsWithOfflineCache({
          api,
          contractId: selectedContractId,
          entityTypeId,
          ownerKey,
          page: 1,
          pageSize: PAGE_SIZE,
          search: debouncedSearch,
          store: definitionCache,
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
      } catch (nextError) {
        if (isMounted) {
          setError(nextError instanceof Error ? nextError.message : "No fue posible cargar registros.");
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
  }, [api, debouncedSearch, definitionCache, entityTypeId, ownerKey, retryCount, selectedContractId, token]);

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

      {pendingRecordsCount > 0 ? (
        <View style={styles.syncBar}>
          <Text style={styles.syncText}>{pendingRecordsCount} pendientes</Text>
          <Pressable onPress={syncPendingRecords} style={styles.syncButton}>
            <Text style={styles.syncButtonText}>Sincronizar</Text>
          </Pressable>
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
          {debouncedSearch ? "No hay registros para esta busqueda." : "Esta experiencia no tiene registros."}
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
    </ScrollView>
  );
}

function SyncBadge({ record }: { record: CachedEntityRecord | undefined }) {
  const label = record ? getRecordSyncLabel(record) : null;

  if (!record || !label) {
    return null;
  }

  return (
    <View style={[styles.badge, record.syncStatus === "failed" && styles.badgeFailed]}>
      <Text style={[styles.badgeText, record.syncStatus === "failed" && styles.badgeFailedText]}>{label}</Text>
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
