import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { loadPanelDatasetWithOfflineCache, PANEL_DISCOVERY_SNAPSHOT_DATASET_ID } from "@/lib/offline-panels";
import { PanelAppView, PanelFilterConfig, PanelModuleConfig, PanelResponse, PanelTableConfig } from "@/lib/opco-api";
import { stableTextInputStyle } from "@/lib/visual-stability";
import { AppViewRendererProps } from "@/renderers/types";
import { useSession } from "@/state/session";

import {
  buildPanelKpiModel,
  buildPanelTableModel,
  datasetIdsForPanelModules,
  defaultPageSizeForDataset,
  normalizePanelFilters,
  panelDatasetQueryKey,
} from "./panel-renderer-logic";

type DatasetState = {
  error: string | null;
  fromCache: boolean;
  isLoading: boolean;
  panel: PanelResponse | null;
  queryKey: string | null;
  syncedAt: string | null;
};

type PanelTableModuleConfig = PanelModuleConfig & {
  visualization: {
    config: PanelTableConfig;
    type: "TABLE";
  };
};

const DATASET_KEY_SEPARATOR = "\u0000";

export function PanelRenderer({ appView }: AppViewRendererProps<PanelAppView>) {
  const { api, connectivityStatus, definitionCache, ownerKey, selectedContractId, token } = useSession();
  const { width } = useWindowDimensions();
  const configuredModules = useMemo(() => appView.config.modules ?? [], [appView.config.modules]);
  const configuredFilters = useMemo(() => appView.config.filters ?? [], [appView.config.filters]);
  const configuredColumns = appView.config.layout?.columns ?? 12;
  const configuredRowHeight = appView.config.layout?.rowHeight ?? 92;
  const initialDatasetIds = useMemo(() => datasetIdsForPanelModules(configuredModules), [configuredModules]);
  const [datasetStates, setDatasetStates] = useState<Record<string, DatasetState>>({});
  const datasetStatesRef = useRef<Record<string, DatasetState>>({});
  const [pages, setPages] = useState<Record<string, number>>(() => Object.fromEntries(initialDatasetIds.map((id) => [id, 1])));
  const [retryVersion, setRetryVersion] = useState(0);
  const [searchByDataset, setSearchByDataset] = useState<Record<string, string>>({});
  const [filterInputs, setFilterInputs] = useState<Record<string, string>>({});
  const requestSeq = useRef(0);

  const latestPanel = useMemo(
    () => Object.values(datasetStates).find((state) => state.panel)?.panel ?? null,
    [datasetStates],
  );
  const modules = latestPanel?.modules.length ? latestPanel.modules : configuredModules;
  const filters = latestPanel?.filters.length ? latestPanel.filters : configuredFilters;
  const datasetIds = useMemo(() => datasetIdsForPanelModules(modules), [modules]);
  const activeDatasetIds = latestPanel ? datasetIds : [PANEL_DISCOVERY_SNAPSHOT_DATASET_ID];
  const normalizedFilters = useMemo(() => normalizePanelFilters(filters, filterInputs), [filterInputs, filters]);
  const datasetIdsKey = activeDatasetIds.join(DATASET_KEY_SEPARATOR);
  const normalizedFiltersKey = JSON.stringify(normalizedFilters);

  useEffect(() => {
    datasetStatesRef.current = datasetStates;
  }, [datasetStates]);

  useEffect(() => {
    setDatasetStates({});
    datasetStatesRef.current = {};
    setPages(Object.fromEntries(initialDatasetIds.map((id) => [id, 1])));
    setRetryVersion(0);
    setSearchByDataset({});
    setFilterInputs({});
  }, [appView.id, initialDatasetIds, selectedContractId]);

  useEffect(() => {
    const seq = ++requestSeq.current;
    let cancelled = false;

    async function loadDatasets() {
      const activeDatasetIds = datasetIdsKey ? datasetIdsKey.split(DATASET_KEY_SEPARATOR) : [];
      const activeFilters = JSON.parse(normalizedFiltersKey) as Record<string, unknown>;

      if (!token || !selectedContractId || !ownerKey) {
        setDatasetStates(Object.fromEntries(activeDatasetIds.map((datasetId) => [datasetId, {
          error: "Selecciona un contrato antes de abrir paneles.",
          fromCache: false,
          isLoading: false,
          panel: null,
          queryKey: null,
          syncedAt: null,
        }])));
        return;
      }

      for (const datasetId of activeDatasetIds) {
        const isDiscovery = datasetId === PANEL_DISCOVERY_SNAPSHOT_DATASET_ID;
        const page = pages[datasetId] ?? 1;
        const pageSize = configuredPageSize(appView, null, datasetId);
        const search = searchByDataset[datasetId]?.trim() ?? "";
        const previous = datasetStatesRef.current[datasetId];
        const queryKey = panelDatasetQueryKey({
          filters: activeFilters,
          page,
          pageSize,
          search,
        });

        if (previous?.panel && previous.queryKey === queryKey && !previous.error) {
          continue;
        }

        setDatasetStates((current) => ({
          ...current,
          [datasetId]: {
            error: null,
            fromCache: false,
            isLoading: true,
            panel: current[datasetId]?.panel ?? null,
            queryKey,
            syncedAt: current[datasetId]?.syncedAt ?? null,
          },
        }));

        try {
          const result = await loadPanelDatasetWithOfflineCache({
            api,
            appViewId: appView.id,
            configRevision: previous?.panel?.configRevision,
            contractId: selectedContractId,
            ownerKey,
            query: {
              ...(isDiscovery ? {} : { datasetId }),
              filters: activeFilters,
              page,
              pageSize,
              search,
            },
            snapshotDatasetId: isDiscovery ? PANEL_DISCOVERY_SNAPSHOT_DATASET_ID : undefined,
            store: definitionCache,
            token,
          });

          if (cancelled || requestSeq.current !== seq) {
            continue;
          }

          const executedDatasetId = result.panel.datasets[0]?.id;
          setDatasetStates((current) => ({
            ...current,
            [datasetId]: {
              error: null,
              fromCache: result.fromCache,
              isLoading: false,
              panel: result.panel,
              queryKey,
              syncedAt: result.syncedAt,
            },
            ...(executedDatasetId && executedDatasetId !== datasetId
              ? {
                  [executedDatasetId]: {
                    error: null,
                    fromCache: result.fromCache,
                    isLoading: false,
                    panel: result.panel,
                    queryKey,
                    syncedAt: result.syncedAt,
                  },
                }
              : {}),
          }));
        } catch (error) {
          if (cancelled || requestSeq.current !== seq) {
            continue;
          }

          setDatasetStates((current) => ({
            ...current,
            [datasetId]: {
              error: error instanceof Error ? error.message : "No fue posible cargar el dataset.",
              fromCache: false,
              isLoading: false,
              panel: current[datasetId]?.panel ?? null,
              queryKey,
              syncedAt: current[datasetId]?.syncedAt ?? null,
            },
          }));
        }
      }
    }

    void loadDatasets();

    return () => {
      cancelled = true;
    };
  }, [
    api,
    appView,
    datasetIdsKey,
    definitionCache,
    normalizedFiltersKey,
    ownerKey,
    pages,
    retryVersion,
    searchByDataset,
    selectedContractId,
    token,
  ]);

  const renderedColumns = width < 760 ? 1 : configuredColumns;
  const orderedModules = [...modules].sort((left, right) => left.layout.y - right.layout.y || left.layout.x - right.layout.x);
  const isOffline = connectivityStatus === "offline" || Object.values(datasetStates).some((state) => state.fromCache);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{appView.name}</Text>
        <Text style={styles.subtitle}>{isOffline ? "Panel offline" : "Panel"}</Text>
      </View>

      {filters.length > 0 ? (
        <PanelFilters
          filters={filters}
          onChange={(filterId, value) => {
            setFilterInputs((current) => ({ ...current, [filterId]: value }));
            setPages(Object.fromEntries(datasetIds.map((datasetId) => [datasetId, 1])));
          }}
          values={filterInputs}
        />
      ) : null}

      <View style={styles.grid}>
        {orderedModules.map((module) => (
          <View
            key={module.id}
            style={[
              styles.module,
              {
                flexBasis: `${Math.min(100, Math.max(1, (module.layout.w / renderedColumns) * 100))}%`,
                minHeight: Math.max(180, module.layout.h * configuredRowHeight),
              },
            ]}
          >
            <PanelModule
              module={module}
              onNextPage={() => setPages((current) => ({ ...current, [module.datasetId]: (current[module.datasetId] ?? 1) + 1 }))}
              onPreviousPage={() => setPages((current) => ({ ...current, [module.datasetId]: Math.max(1, (current[module.datasetId] ?? 1) - 1) }))}
              onRetry={() => setRetryVersion((version) => version + 1)}
              onSearch={(value) => {
                setSearchByDataset((current) => ({ ...current, [module.datasetId]: value }));
                setPages((current) => ({ ...current, [module.datasetId]: 1 }));
              }}
              page={pages[module.datasetId] ?? 1}
              search={searchByDataset[module.datasetId] ?? ""}
              state={datasetStates[module.datasetId]}
            />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function PanelFilters({
  filters,
  onChange,
  values,
}: {
  filters: PanelFilterConfig[];
  onChange(filterId: string, value: string): void;
  values: Record<string, string>;
}) {
  return (
    <View style={styles.filters}>
      {filters.map((filter) => (
        <TextInput
          autoCapitalize="none"
          key={filter.id}
          onChangeText={(value) => onChange(filter.id, value)}
          placeholder={filter.label ?? "Filtro"}
          style={[stableTextInputStyle, styles.filterInput]}
          value={values[filter.id] ?? ""}
        />
      ))}
    </View>
  );
}

function PanelModule({
  module,
  onNextPage,
  onPreviousPage,
  onRetry,
  onSearch,
  page,
  search,
  state,
}: {
  module: PanelModuleConfig;
  onNextPage(): void;
  onPreviousPage(): void;
  onRetry(): void;
  onSearch(value: string): void;
  page: number;
  search: string;
  state: DatasetState | undefined;
}) {
  const dataset = state?.panel?.datasets.find((item) => item.id === module.datasetId);
  const table = buildPanelTableModel(module, dataset);
  const kpi = buildPanelKpiModel(module, state?.panel?.metrics);
  const isTable = module.visualization.type === "TABLE";
  const isKpi = module.visualization.type === "KPI";
  const tableConfig = isPanelTableModule(module) ? module.visualization.config : null;

  return (
    <View style={styles.moduleContent}>
      <View style={styles.moduleHeader}>
        <Text style={styles.moduleTitle}>{module.title ?? module.id}</Text>
        {state?.fromCache ? <Text style={styles.cacheLabel}>Offline</Text> : null}
      </View>

      {tableConfig?.searchable ? (
        <TextInput
          autoCapitalize="none"
          clearButtonMode="while-editing"
          onChangeText={onSearch}
          placeholder="Buscar registros"
          returnKeyType="search"
          style={[stableTextInputStyle, styles.searchInput]}
          value={search}
        />
      ) : null}

      {!isTable && !isKpi ? (
        <PanelState message="Este módulo todavía no está soportado." />
      ) : isKpi ? (
        <PanelKpi
          error={state?.error ?? null}
          isLoading={Boolean(state?.isLoading && !kpi?.calculatedAt)}
          kpi={kpi}
          offline={Boolean(state?.fromCache)}
          onRetry={onRetry}
        />
      ) : state?.isLoading && !dataset ? (
        <View style={styles.stateBox}>
          <ActivityIndicator />
          <Text style={styles.stateText}>Cargando módulo...</Text>
        </View>
      ) : state?.error ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>{state.error}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.actionButton}>
            <Text style={styles.actionButtonText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : !dataset || !table ? (
        <PanelState message="Este módulo necesita configuración." />
      ) : dataset.rows.length === 0 ? (
        <PanelState message="No hay datos para mostrar." />
      ) : (
        <>
          <PanelTable table={table} />
          {tableConfig?.paginated !== false ? (
            <View style={styles.pagination}>
              <Pressable accessibilityRole="button" disabled={page <= 1} onPress={onPreviousPage} style={[styles.actionButton, page <= 1 ? styles.disabledButton : null]}>
                <Text style={styles.actionButtonText}>Anterior</Text>
              </Pressable>
              <Text style={styles.paginationText}>Página {dataset.pagination.page}</Text>
              <Pressable accessibilityRole="button" disabled={!dataset.pagination.hasMore} onPress={onNextPage} style={[styles.actionButton, !dataset.pagination.hasMore ? styles.disabledButton : null]}>
                <Text style={styles.actionButtonText}>Siguiente</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function isPanelTableModule(module: PanelModuleConfig): module is PanelTableModuleConfig {
  return module.visualization.type === "TABLE";
}

function PanelKpi({
  error,
  isLoading,
  kpi,
  offline,
  onRetry,
}: {
  error: string | null;
  isLoading: boolean;
  kpi: ReturnType<typeof buildPanelKpiModel>;
  offline: boolean;
  onRetry(): void;
}) {
  if (isLoading) {
    return (
      <View style={styles.kpiCard}>
        <ActivityIndicator />
        <Text style={styles.stateText}>Cargando indicador...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.kpiCard}>
        <Text style={styles.stateText}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.actionButton}>
          <Text style={styles.actionButtonText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  if (!kpi) {
    return <PanelState message="Este KPI necesita configuración." />;
  }

  return (
    <View
      accessibilityLabel={`${kpi.label}: ${kpi.fullValue}${offline ? ". Datos guardados" : ""}`}
      style={styles.kpiCard}
    >
      <Text numberOfLines={2} style={styles.kpiLabel}>{kpi.label}</Text>
      <Text numberOfLines={1} style={styles.kpiValue}>{kpi.value}</Text>
      {kpi.configurationIssue ? (
        <Text style={styles.kpiMeta}>{kpi.configurationIssue}</Text>
      ) : kpi.missing ? (
        <Text style={styles.kpiMeta}>Métrica no disponible.</Text>
      ) : offline ? (
        <Text style={styles.kpiMeta}>Datos guardados.</Text>
      ) : kpi.calculatedAt ? (
        <Text style={styles.kpiMeta}>Actualizado {formatPanelKpiTimestamp(kpi.calculatedAt)}</Text>
      ) : null}
    </View>
  );
}

function PanelTable({ table }: { table: ReturnType<typeof buildPanelTableModel> & {} }) {
  return (
    <ScrollView
      contentContainerStyle={styles.horizontalScrollContent}
      horizontal
      showsHorizontalScrollIndicator
      style={styles.horizontalScroll}
    >
      <View style={[styles.table, { minWidth: table.minWidth }]}>
        <View accessibilityRole="header" style={styles.tableHeaderRow}>
          {table.columns.map((column) => (
            <Text
              accessibilityLabel={column.name}
              key={column.fieldId}
              numberOfLines={1}
              style={[
                styles.tableCell,
                styles.tableHeaderText,
                { flexGrow: column.weight, minWidth: column.minWidth },
              ]}
            >
              {column.name}
            </Text>
          ))}
        </View>
        {table.rows.map((row) => (
          <View
            accessibilityLabel={row.values.map((value, index) => `${table.columns[index]?.name ?? "Campo"}: ${value || "-"}`).join(". ")}
            key={row.id}
            style={styles.tableRow}
          >
            {row.values.map((value, index) => (
              <Text
                accessibilityLabel={`${table.columns[index]?.name ?? "Campo"}: ${value || "-"}`}
                key={`${row.id}-${table.columns[index]?.fieldId ?? index}`}
                numberOfLines={1}
                style={[
                  styles.tableCell,
                  {
                    flexGrow: table.columns[index]?.weight ?? 1,
                    minWidth: table.columns[index]?.minWidth ?? 144,
                  },
                ]}
              >
                {value || "-"}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function PanelState({ message }: { message: string }) {
  return (
    <View style={styles.stateBox}>
      <Text style={styles.stateText}>{message}</Text>
    </View>
  );
}

function configuredPageSize(appView: PanelAppView, panel: PanelResponse | null, datasetId: string) {
  const configured = appView.config.datasets?.find((dataset) => dataset.id === datasetId)?.transformation.pagination?.pageSize;

  return configured && configured > 0 ? configured : defaultPageSizeForDataset(panel, datasetId);
}

function formatPanelKpiTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString("es-CL", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: "center",
    backgroundColor: "#111827",
    borderRadius: 6,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  actionButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  cacheLabel: {
    color: "#92400e",
    fontSize: 12,
    fontWeight: "700",
  },
  container: {
    padding: 16,
  },
  disabledButton: {
    opacity: 0.5,
  },
  filterInput: {
    flexBasis: 220,
    flexGrow: 1,
  },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -6,
  },
  header: {
    marginBottom: 12,
  },
  horizontalScroll: {
    alignSelf: "stretch",
    maxWidth: "100%",
  },
  horizontalScrollContent: {
    minWidth: "100%",
  },
  kpiCard: {
    borderColor: "#e5e7eb",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    gap: 8,
    justifyContent: "center",
    minHeight: 120,
    padding: 16,
  },
  kpiLabel: {
    color: "#4b5563",
    fontSize: 14,
    fontWeight: "700",
  },
  kpiMeta: {
    color: "#6b7280",
    fontSize: 12,
  },
  kpiValue: {
    color: "#111827",
    fontSize: 34,
    fontWeight: "800",
  },
  module: {
    padding: 6,
  },
  moduleContent: {
    borderColor: "#d1d5db",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    padding: 12,
  },
  moduleHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  moduleTitle: {
    color: "#111827",
    fontSize: 16,
    fontWeight: "700",
  },
  pagination: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
    marginTop: 12,
  },
  paginationText: {
    color: "#374151",
    fontSize: 13,
  },
  searchInput: {
    marginBottom: 10,
  },
  stateBox: {
    alignItems: "center",
    borderColor: "#e5e7eb",
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    justifyContent: "center",
    minHeight: 120,
    padding: 16,
  },
  stateText: {
    color: "#4b5563",
    fontSize: 14,
    textAlign: "center",
  },
  subtitle: {
    color: "#6b7280",
    fontSize: 13,
  },
  table: {
    borderColor: "#d1d5db",
    borderLeftWidth: 1,
    borderTopWidth: 1,
    width: "100%",
  },
  tableCell: {
    borderBottomWidth: 1,
    borderColor: "#d1d5db",
    borderRightWidth: 1,
    color: "#111827",
    flexBasis: 0,
    flexShrink: 1,
    fontSize: 13,
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 11,
  },
  tableHeaderRow: {
    backgroundColor: "#f3f4f6",
    flexDirection: "row",
  },
  tableHeaderText: {
    fontWeight: "700",
  },
  tableRow: {
    flexDirection: "row",
  },
  title: {
    color: "#111827",
    fontSize: 24,
    fontWeight: "800",
  },
});
