import { Link, useLocalSearchParams } from "expo-router";
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

import { getEntityDefinitionWithCache } from "@/lib/definition-cache";
import { buildRecordListItem } from "@/lib/entity-record-display";
import { EntityDefinition, EntityRecord, EntityRecordPagination } from "@/lib/opco-api";
import { useSession } from "@/state/session";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 350;

export default function EntityRecordsScreen() {
  const { entityTypeId } = useLocalSearchParams<{ entityTypeId: string }>();
  const { api, definitionCache, selectedContractId, token } = useSession();
  const [definition, setDefinition] = useState<EntityDefinition | null>(null);
  const [records, setRecords] = useState<EntityRecord[]>([]);
  const [pagination, setPagination] = useState<EntityRecordPagination | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
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
      if (!token || !selectedContractId || !entityTypeId) {
        setError("Selecciona un contrato antes de abrir una entidad.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      setDefinition(null);
      setRecords([]);
      setPagination(null);
      setFromCache(false);
      setSyncedAt(null);

      try {
        const definitionResult = await getEntityDefinitionWithCache({
          api,
          cache: definitionCache,
          contractId: selectedContractId,
          entityTypeId,
          token,
        });
        const recordsResult = await api.getEntityRecords(token, selectedContractId, entityTypeId, {
          page: 1,
          pageSize: PAGE_SIZE,
          search: debouncedSearch,
        });

        if (isMounted) {
          setDefinition(definitionResult.definition);
          setFromCache(definitionResult.source === "cache");
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
  }, [api, debouncedSearch, definitionCache, entityTypeId, retryCount, selectedContractId, token]);

  async function loadMoreRecords() {
    if (!token || !selectedContractId || !entityTypeId || !pagination || isLoadingMore) {
      return;
    }

    setIsLoadingMore(true);
    setError(null);

    try {
      const result = await api.getEntityRecords(token, selectedContractId, entityTypeId, {
        page: pagination.page + 1,
        pageSize: PAGE_SIZE,
        search: debouncedSearch,
      });

      setRecords((current) => [...current, ...result.records]);
      setPagination(result.pagination);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No fue posible cargar mas registros.");
    } finally {
      setIsLoadingMore(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} style={styles.screen}>
      {definition ? (
        <View style={styles.header}>
          <Text style={styles.icon}>{definition.icon ?? "[]"}</Text>
          <View style={styles.headerText}>
            <Text style={styles.title}>{definition.name}</Text>
            <Text style={styles.meta}>{pagination ? `${pagination.total} registros` : "Registros"}</Text>
          </View>
        </View>
      ) : null}

      {fromCache ? (
        <View style={styles.cacheBanner}>
          <Text style={styles.cacheText}>Definicion cacheada.</Text>
          {syncedAt ? <Text style={styles.cacheMeta}>Ultima sincronizacion: {syncedAt}</Text> : null}
        </View>
      ) : null}

      <TextInput
        autoCapitalize="none"
        clearButtonMode="while-editing"
        onChangeText={setSearchText}
        placeholder="Buscar registros"
        returnKeyType="search"
        style={styles.searchInput}
        value={searchText}
      />

      {isLoading ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {error && records.length === 0 ? (
        <Pressable onPress={() => setRetryCount((count) => count + 1)} style={styles.retryButton}>
          <Text style={styles.retryText}>Reintentar</Text>
        </Pressable>
      ) : null}
      {!isLoading && !error && records.length === 0 ? (
        <Text style={styles.empty}>
          {debouncedSearch ? "No hay registros para esta busqueda." : "Esta entidad no tiene registros."}
        </Text>
      ) : null}

      <View style={styles.recordList}>
        {listItems.map((item) => (
          <Link href={item.href} key={item.id} asChild>
            <Pressable style={styles.recordCard}>
              <Text style={styles.recordTitle}>{item.title}</Text>
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

const styles = StyleSheet.create({
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
    color: "#135d66",
    fontSize: 24,
    fontWeight: "800",
    minWidth: 42,
    textAlign: "center",
  },
  loadMoreButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#135d66",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 46,
    minWidth: 140,
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
    fontSize: 17,
    fontWeight: "800",
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
    minHeight: 46,
    paddingHorizontal: 14,
  },
  title: {
    color: "#0f3036",
    fontSize: 26,
    fontWeight: "800",
  },
});
