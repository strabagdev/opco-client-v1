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
import { getEntityDefinitionWithCache } from "@/lib/definition-cache";
import { loadRecordsWithOfflineCache } from "@/lib/offline-records";
import { EntityField, PanelAppView, PanelFilterConfig, PanelModuleConfig, PanelResponse, PanelTableConfig } from "@/lib/opco-api";
import { getRelationTargetEntityTypeId } from "@/lib/record-form";
import { stableTextInputStyle } from "@/lib/visual-stability";
import { RecordFieldInput } from "@/renderers/records/RecordFieldInput";
import { AppViewRendererProps } from "@/renderers/types";
import { useExperienceOpeningTelemetry } from "@/renderers/experience-opening";
import { useExperienceActivityReporter } from "@/renderers/use-experience-activity";
import { useSession } from "@/state/session";

import {
  buildPanelKpiModel,
  buildPanelModuleLayoutPlan,
  buildPanelTableModel,
  datasetIdsForPanelModules,
  defaultPageSizeForDataset,
  isPanelDatasetStateCurrent,
  missingRequiredPanelFilters,
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
const relatedFieldId = (relationFieldId: string, fieldId: string) => `related:${relationFieldId}:${fieldId}`;

export function PanelRenderer({ appView }: AppViewRendererProps<PanelAppView>) {
  const { api, connectivityStatus, definitionCache, ownerKey, selectedContractId, token } = useSession();
  const { width } = useWindowDimensions();
  const configuredModules = useMemo(() => appView.config.modules ?? [], [appView.config.modules]);
  const appViewConfigKey = JSON.stringify(appView.config);
  const hasComposedKpi = configuredModules.some((module) => module.visualization.type === "KPI" && Boolean(module.visualization.config.composition));
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
  const [filterFields, setFilterFields] = useState<Record<string, EntityField>>({});
  const [relationOptions, setRelationOptions] = useState<Record<string, { id: string; displayName: string }[]>>({});
  const [relationSearch, setRelationSearch] = useState<Record<string, string>>({});
  const [filterMetadataError, setFilterMetadataError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const latestPanel = useMemo(
    () => Object.values(datasetStates).find((state) => state.panel)?.panel ?? null,
    [datasetStates],
  );
  const modules = latestPanel?.modules.length ? latestPanel.modules : configuredModules;
  const filters = latestPanel?.filters.length ? latestPanel.filters : configuredFilters;
  const datasetIds = useMemo(() => datasetIdsForPanelModules(modules), [modules]);
  const activeDatasetIds = datasetIds.length ? datasetIds : [PANEL_DISCOVERY_SNAPSHOT_DATASET_ID];
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
    setFilterFields({});
    setRelationOptions({});
    setRelationSearch({});
    setFilterMetadataError(null);
  }, [appView.id, appViewConfigKey, initialDatasetIds, selectedContractId]);

  useEffect(() => {
    let cancelled = false;
    async function loadFilterMetadata() {
      if (!token || !selectedContractId || !ownerKey || configuredFilters.length === 0) return;
      const datasets = appView.config.datasets ?? [];
      const entityIds = Array.from(new Set(datasets.filter((dataset) => dataset.filters?.some((binding) =>
        binding.type === "PANEL_FILTER")).map((dataset) => dataset.source.entityTypeId)));
      try {
        const definitions = await Promise.all(entityIds.map(async (entityTypeId) => ({
          entityTypeId,
          definition: (await getEntityDefinitionWithCache({ api, cache: definitionCache, contractId: selectedContractId,
            entityTypeId, token })).definition,
        })));
        const definitionsById = new Map(definitions.map((item) => [item.entityTypeId, item.definition]));
        const relatedTargets = new Set<string>();
        for (const dataset of datasets) {
          const source = definitionsById.get(dataset.source.entityTypeId);
          const filterFieldIds = new Set((dataset.filters ?? []).filter((binding) => binding.type === "PANEL_FILTER")
            .map((binding) => binding.fieldId));
          for (const selected of (dataset.relatedFields ?? []).filter((item) =>
            filterFieldIds.has(relatedFieldId(item.relationFieldId, item.fieldId)))) {
            const relation = source?.fields.find((field) => field.id === selected.relationFieldId);
            const targetId = relation?.type === "RELATION" ? getRelationTargetEntityTypeId(relation) : null;
            if (targetId) relatedTargets.add(targetId);
          }
        }
        const targetDefinitions = await Promise.all([...relatedTargets].map(async (entityTypeId) => ({
          entityTypeId,
          definition: (await getEntityDefinitionWithCache({ api, cache: definitionCache, contractId: selectedContractId,
            entityTypeId, token })).definition,
        })));
        for (const item of targetDefinitions) definitionsById.set(item.entityTypeId, item.definition);
        const fields: Record<string, EntityField> = {};
        for (const filter of configuredFilters) {
          const dataset = datasets.find((item) => item.filters?.some((binding) =>
            binding.type === "PANEL_FILTER" && binding.filterId === filter.id));
          const binding = dataset?.filters?.find((item) => item.type === "PANEL_FILTER" && item.filterId === filter.id);
          const definition = dataset ? definitionsById.get(dataset.source.entityTypeId) : undefined;
          const selected = dataset?.relatedFields?.find((item) => relatedFieldId(item.relationFieldId, item.fieldId) === binding?.fieldId);
          const relation = selected ? definition?.fields.find((item) => item.id === selected.relationFieldId) : undefined;
          const targetId = relation?.type === "RELATION" ? getRelationTargetEntityTypeId(relation) : null;
          const field = selected && targetId
            ? definitionsById.get(targetId)?.fields.find((item) => item.id === selected.fieldId)
            : definition?.fields.find((item) => item.id === binding?.fieldId);
          if (field) fields[filter.id] = { ...field, name: filter.label || field.name };
        }
        if (!cancelled) {
          setFilterFields(fields);
          setFilterMetadataError(null);
        }
      } catch {
        if (!cancelled) setFilterMetadataError("No se pudieron cargar las opciones de filtros.");
      }
    }
    void loadFilterMetadata();
    return () => { cancelled = true; };
  }, [api, appViewConfigKey, appView.config.datasets, configuredFilters, definitionCache, ownerKey, selectedContractId, token]);

  useEffect(() => {
    if (!token || !selectedContractId || !ownerKey) return;
    let cancelled = false;
    const targets = Array.from(new Set(Object.values(filterFields).map(getRelationTargetEntityTypeId)
      .filter((id): id is string => Boolean(id))));
    const timer = setTimeout(() => {
      void Promise.all(targets.map(async (entityTypeId) => {
        try {
          const result = await loadRecordsWithOfflineCache({ api, contractId: selectedContractId, entityTypeId,
            ownerKey, page: 1, pageSize: 100, search: relationSearch[entityTypeId] || undefined,
            sort: "displayName", direction: "asc", store: definitionCache, token });
          if (!cancelled) setRelationOptions((current) => {
            const selectedIds = new Set(Object.entries(filterFields).filter(([, field]) =>
              getRelationTargetEntityTypeId(field) === entityTypeId).map(([id]) => filterInputs[id]).filter(Boolean));
            const options = result.records.map((record) => ({ id: record.id, displayName: record.displayName || record.id }));
            const previousSelected = (current[entityTypeId] ?? []).filter((item) => selectedIds.has(item.id) &&
              !options.some((option) => option.id === item.id));
            return { ...current, [entityTypeId]: [...previousSelected, ...options] };
          });
        } catch {
          if (!cancelled) setFilterMetadataError("No se pudo cargar el catálogo relacionado.");
        }
      }));
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [api, definitionCache, filterFields, filterInputs, ownerKey, relationSearch, selectedContractId, token]);

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
        const datasetConfig = (appView.config.datasets ?? []).find((item) => item.id === datasetId);
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
        const missingFilters = missingRequiredPanelFilters(configuredFilters, datasetConfig, activeFilters);
        if (missingFilters.length > 0) {
          setDatasetStates((current) => ({ ...current, [datasetId]: {
            error: `Selecciona ${missingFilters.map((filter) => filter.label || filter.id).join(", ")}.`,
            fromCache: false, isLoading: false, panel: null, queryKey, syncedAt: null,
          } }));
          continue;
        }

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
            configRevision: appView.configRevision ?? previous?.panel?.configRevision,
            requireConfigRevision: hasComposedKpi,
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
    configuredFilters,
    hasComposedKpi,
    normalizedFiltersKey,
    ownerKey,
    pages,
    retryVersion,
    searchByDataset,
    selectedContractId,
    token,
  ]);

  const moduleLayoutPlan = useMemo(() => buildPanelModuleLayoutPlan({
    columns: configuredColumns,
    mode: width < 760 ? "mobile" : "desktop",
    modules,
    rowHeight: configuredRowHeight,
  }), [configuredColumns, configuredRowHeight, modules, width]);
  const isOffline = connectivityStatus === "offline" || Object.values(datasetStates).some((state) => state.fromCache);
  const liveDatasetStates = Object.values(datasetStates);
  const liveFailedCount = liveDatasetStates.filter((state) => state.error).length;
  const liveLoadedCount = liveDatasetStates.filter((state) => state.panel).length;
  useExperienceActivityReporter(appView, {
    activeCount: liveDatasetStates.filter((state) => state.isLoading).length,
    errorCode: liveFailedCount > 0 ? "PANEL_PARTIAL_LOAD_FAILED" : null,
    result: liveFailedCount > 0 && liveLoadedCount > 0 ? "partial" : liveFailedCount > 0 ? "error" : liveDatasetStates.length > 0 ? "success" : null,
  });
  const openingStatus = useMemo(() => {
    const states = Object.values(datasetStates);
    const settled = states.length > 0 && states.every((state) => !state.isLoading);
    const failed = states.filter((state) => state.error).length;
    const loaded = states.filter((state) => state.panel && !state.error).length;
    const empty = states.filter((state) => state.panel && state.panel.modules.length === 0 && !state.error).length;
    return {
      firstUseful: loaded > 0 || (settled && failed === 0),
      initialUpdateComplete: settled,
      moduleSummary: { empty, failed, loaded, total: states.length },
      ready: settled,
      result: settled ? (failed > 0 && loaded > 0 ? "partial" as const : failed > 0 ? "error" as const : "completed" as const) : "in_progress" as const,
      source: states.some((state) => state.fromCache) ? "local" as const : loaded > 0 ? "remote" as const : "unknown" as const,
    };
  }, [datasetStates]);
  useExperienceOpeningTelemetry(appView, openingStatus);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{appView.name}</Text>
        <Text style={styles.subtitle}>{isOffline ? "Panel offline" : "Panel"}</Text>
      </View>

      {filters.length > 0 ? (
        <PanelFilters
          filters={filters}
          fields={filterFields}
          metadataError={filterMetadataError}
          relationOptions={relationOptions}
          onRelationSearch={(target, search) => setRelationSearch((current) => ({ ...current, [target]: search }))}
          onChange={(filterId, value) => {
            setFilterInputs((current) => ({ ...current, [filterId]: value }));
            setPages(Object.fromEntries(datasetIds.map((datasetId) => [datasetId, 1])));
          }}
          values={filterInputs}
        />
      ) : null}

      <View style={[styles.grid, moduleLayoutPlan.containerStyle]}>
        {moduleLayoutPlan.modules.map((module) => (
          <View
            key={module.id}
            style={[
              styles.module,
              moduleLayoutPlan.moduleStyles[module.id],
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
              currentQueryKey={panelDatasetQueryKey({
                filters: normalizedFilters,
                page: pages[module.datasetId] ?? 1,
                pageSize: configuredPageSize(appView, null, module.datasetId),
                search: searchByDataset[module.datasetId] ?? "",
              })}
            />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function PanelFilters({
  filters,
  fields,
  metadataError,
  onChange,
  onRelationSearch,
  relationOptions,
  values,
}: {
  filters: PanelFilterConfig[];
  fields: Record<string, EntityField>;
  metadataError: string | null;
  onChange(filterId: string, value: string): void;
  onRelationSearch(targetEntityTypeId: string, search: string): void;
  relationOptions: Record<string, { id: string; displayName: string }[]>;
  values: Record<string, string>;
}) {
  return (
    <View style={styles.filters}>
      {metadataError ? <Text style={styles.stateText}>{metadataError}</Text> : null}
      {filters.map((filter) => {
        const field = fields[filter.id];
        const value = values[filter.id] ?? "";
        if (!field) return <Text key={filter.id} style={styles.stateText}>{filter.label || filter.id}: campo no disponible.</Text>;
        const target = getRelationTargetEntityTypeId(field);
        return <View key={filter.id} style={styles.filterControl}>
          {field.type === "BOOLEAN" ? (
            <View style={styles.booleanFilter}>
              <Text style={styles.filterLabel}>{filter.label || field.name}</Text>
              {([{ label: "Todos", value: "" }, { label: "Sí", value: "true" }, { label: "No", value: "false" }] as const).map((option) => (
                <Pressable accessibilityRole="button" key={option.value} onPress={() => onChange(filter.id, option.value)}
                  style={[styles.filterChoice, value === option.value && styles.filterChoiceSelected]}>
                  <Text>{option.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : <RecordFieldInput
            field={field}
            onChange={(next) => onChange(filter.id, typeof next === "string" ? next : "")}
            onRelationSearch={target ? (search) => onRelationSearch(target, search) : undefined}
            relationOptions={target ? relationOptions[target] ?? [] : []}
            relationTargetEntityTypeId={target}
            value={value}
          />}
          {value && field.type !== "BOOLEAN" ? <Pressable accessibilityRole="button" onPress={() => onChange(filter.id, "")}>
            <Text style={styles.filterClear}>Limpiar</Text>
          </Pressable> : null}
          {filter.required && !value ? <Text style={styles.filterRequired}>Selección requerida</Text> : null}
        </View>;
      })}
    </View>
  );
}

function PanelModule({
  currentQueryKey,
  module,
  onNextPage,
  onPreviousPage,
  onRetry,
  onSearch,
  page,
  search,
  state,
}: {
  currentQueryKey: string;
  module: PanelModuleConfig;
  onNextPage(): void;
  onPreviousPage(): void;
  onRetry(): void;
  onSearch(value: string): void;
  page: number;
  search: string;
  state: DatasetState | undefined;
}) {
  const currentState = isPanelDatasetStateCurrent(state, currentQueryKey) ? state : undefined;
  const dataset = currentState?.panel?.datasets.find((item) => item.id === module.datasetId);
  const table = buildPanelTableModel(module, dataset);
  const kpi = buildPanelKpiModel(module, currentState?.panel?.metrics, currentState?.panel?.moduleResults);
  const isTable = module.visualization.type === "TABLE";
  const isKpi = module.visualization.type === "KPI";
  const tableConfig = isPanelTableModule(module) ? module.visualization.config : null;
  const moduleTitle = module.title ?? module.id;

  return (
    <View style={styles.moduleContent}>
      <View style={styles.moduleHeader}>
        <Text numberOfLines={2} style={styles.moduleTitle}>{moduleTitle}</Text>
        {currentState?.fromCache ? <Text style={styles.cacheLabel}>Offline</Text> : null}
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
          error={currentState?.error ?? null}
          isLoading={!currentState || Boolean(currentState.isLoading)}
          kpi={kpi}
          offline={Boolean(currentState?.fromCache)}
          onRetry={onRetry}
          title={moduleTitle}
        />
      ) : (!currentState || currentState.isLoading) && !dataset ? (
        <View style={styles.stateBox}>
          <ActivityIndicator />
          <Text style={styles.stateText}>Cargando módulo...</Text>
        </View>
      ) : currentState?.error ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>{currentState.error}</Text>
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
  title,
}: {
  error: string | null;
  isLoading: boolean;
  kpi: ReturnType<typeof buildPanelKpiModel>;
  offline: boolean;
  onRetry(): void;
  title: string;
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
      accessible
      accessibilityLabel={`${title}: ${kpi.fullValue}${offline ? ". Datos guardados" : ""}`}
      style={styles.kpiCard}
    >
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
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  filterControl: { flexBasis: 220, flexGrow: 1, minWidth: 200 },
  filterLabel: { color: "#374151", fontSize: 14, fontWeight: "600" },
  filterClear: { color: "#047857", fontSize: 13, paddingVertical: 6 },
  filterRequired: { color: "#b45309", fontSize: 12 },
  booleanFilter: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterChoice: { borderColor: "#d1d5db", borderRadius: 4, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  filterChoiceSelected: { backgroundColor: "#d1fae5", borderColor: "#047857" },
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
    justifyContent: "space-between",
    minHeight: 120,
    padding: 16,
  },
  kpiMeta: {
    color: "#6b7280",
    fontSize: 12,
    lineHeight: 17,
  },
  kpiValue: {
    color: "#111827",
    flexShrink: 0,
    fontSize: 34,
    fontWeight: "800",
    lineHeight: 42,
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
    flexShrink: 1,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 21,
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
