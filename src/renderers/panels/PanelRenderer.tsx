import { metrics, type ThemeColors } from "../../theme/tokens";
import { colors } from "../../theme/paint";
import { CompactSelect } from "@/components/compact-select";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { ReadLoadingState } from "@/components/read-loading-indicator";
import { FieldFrame } from "../../components/field-frame";
import { useFieldAccessibility } from "../../components/field-accessibility";
import { FormActions } from "../../components/form-actions";
import { panelReadRows } from "./panel-read-presentation";
import { loadPanelDatasetWithOfflineCache, PANEL_DISCOVERY_SNAPSHOT_DATASET_ID, PanelLocalReadError, PanelSnapshotMissingError } from "@/lib/offline-panels";
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
import { PanelDefinitionError } from "@/lib/panel-definition";

import {
  buildPanelKpiModel,
  buildPanelModuleLayoutPlan,
  buildPanelTableModel,
  datasetIdsForPanelModules,
  defaultPageSizeForDataset,
  isPanelDatasetStateCurrent,
  missingRequiredPanelFilters,
  normalizePanelFilters,
  panelKpiValueFontSize,
  panelKpiValueWebFontSize,
  panelDatasetQueryKey,
} from "./panel-renderer-logic";

type DatasetState = {
  error: string | null;
  errorCode: string | null;
  fromCache: boolean;
  isLoading: boolean;
  panel: PanelResponse | null;
  queryKey: string | null;
  scopeKey: string;
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

export function PanelRenderer({ appView: assignedAppView }: AppViewRendererProps<PanelAppView>) {
  const { api, connectivityStatus, definitionCache, ownerKey, selectedContractId, status, token } = useSession();
  const knownOffline = connectivityStatus === "offline" || status === "offline";
  const assignedScopeKey = JSON.stringify([ownerKey, selectedContractId, assignedAppView.id, assignedAppView.configRevision ?? assignedAppView.config]);
  const [reconciled, setReconciled] = useState<{ assignedScopeKey: string; definition: PanelAppView } | null>(null);
  const appView = reconciled?.assignedScopeKey === assignedScopeKey ? reconciled.definition : assignedAppView;
  const adoptedScopeRef = useRef<string | null>(null);
  const resetScopeRef = useRef<string | null>(null);
  const { width } = useWindowDimensions();
  const configuredModules = useMemo(() => appView.config.modules ?? [], [appView.config.modules]);
  const appViewConfigKey = JSON.stringify(appView.config);
  const datasetScopeKey = JSON.stringify([ownerKey, selectedContractId, appView.id, appView.configRevision ?? appViewConfigKey]);
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
    () => Object.values(datasetStates).find((state) => state.scopeKey === datasetScopeKey && state.panel)?.panel ?? null,
    [datasetScopeKey, datasetStates],
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
    const resetKey = JSON.stringify([datasetScopeKey, appViewConfigKey]);
    if (resetScopeRef.current === resetKey) return;
    resetScopeRef.current = resetKey;
    if (adoptedScopeRef.current === datasetScopeKey) {
      adoptedScopeRef.current = null;
      return;
    }
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
  }, [appView.id, appView.configRevision, appViewConfigKey, datasetScopeKey, initialDatasetIds, ownerKey, selectedContractId]);

  useEffect(() => {
    let cancelled = false;
    async function loadFilterMetadata() {
      if (!token || !selectedContractId || !ownerKey || configuredFilters.length === 0) return;
      const datasets = appView.config.datasets ?? [];
      const entityIds = Array.from(new Set(datasets.filter((dataset) => dataset.filters?.some((binding) =>
        binding.type === "PANEL_FILTER")).map((dataset) => dataset.source.entityTypeId)));
      try {
        async function readDefinition(entityTypeId: string) {
          if (knownOffline) {
            const cached = await definitionCache.getEntityDefinition(selectedContractId!, entityTypeId);
            if (!cached) throw new Error("Filter definition unavailable offline");
            return cached.definition;
          }
          return (await getEntityDefinitionWithCache({ api, cache: definitionCache, contractId: selectedContractId!, entityTypeId, token: token! })).definition;
        }
        const definitions = await Promise.all(entityIds.map(async (entityTypeId) => ({
          entityTypeId,
          definition: await readDefinition(entityTypeId),
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
          definition: await readDefinition(entityTypeId),
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
  }, [api, appViewConfigKey, appView.config.datasets, configuredFilters, definitionCache, knownOffline, ownerKey, selectedContractId, token]);

  useEffect(() => {
    if (!token || !selectedContractId || !ownerKey) return;
    let cancelled = false;
    const targets = Array.from(new Set(Object.values(filterFields).map(getRelationTargetEntityTypeId)
      .filter((id): id is string => Boolean(id))));
    const timer = setTimeout(() => {
      void Promise.all(targets.map(async (entityTypeId) => {
        try {
          const localQuery = { contractId: selectedContractId, entityTypeId,
            ownerKey, page: 1, pageSize: 100, search: relationSearch[entityTypeId] || undefined,
            sort: "displayName" as const, direction: "asc" as const };
          const result = knownOffline
            ? await definitionCache.listCachedRecords(localQuery)
            : await loadRecordsWithOfflineCache({ ...localQuery, api, store: definitionCache, token });
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
  }, [api, definitionCache, filterFields, filterInputs, knownOffline, ownerKey, relationSearch, selectedContractId, token]);

  useEffect(() => {
    const seq = ++requestSeq.current;
    let cancelled = false;

    async function loadDatasets() {
      const activeDatasetIds = datasetIdsKey ? datasetIdsKey.split(DATASET_KEY_SEPARATOR) : [];
      const activeFilters = JSON.parse(normalizedFiltersKey) as Record<string, unknown>;

      if (!token || !selectedContractId || !ownerKey) {
        setDatasetStates(Object.fromEntries(activeDatasetIds.map((datasetId) => [datasetId, {
          error: "Selecciona un contrato antes de abrir paneles.",
          errorCode: null,
          fromCache: false,
          isLoading: false,
          panel: null,
          queryKey: null,
          scopeKey: datasetScopeKey,
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
        const stored = datasetStatesRef.current[datasetId];
        const previous = stored?.scopeKey === datasetScopeKey ? stored : undefined;
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
            errorCode: null, fromCache: false, isLoading: false, panel: null, queryKey, scopeKey: datasetScopeKey, syncedAt: null,
          } }));
          continue;
        }

        if (previous?.panel && previous.queryKey === queryKey && !previous.error) {
          continue;
        }

        const hasCompatiblePanel = Boolean(previous?.panel && previous.queryKey === queryKey);

        setDatasetStates((current) => ({
          ...current,
          [datasetId]: {
            error: null,
            errorCode: null,
            fromCache: false,
            isLoading: true,
            panel: hasCompatiblePanel ? previous?.panel ?? null : null,
            queryKey,
            scopeKey: datasetScopeKey,
            syncedAt: hasCompatiblePanel ? previous?.syncedAt ?? null : null,
          },
        }));

        try {
          const result = await loadPanelDatasetWithOfflineCache({
            api,
            appView,
            appViewId: appView.id,
            configRevision: appView.configRevision ?? previous?.panel?.configRevision,
            requireConfigRevision: hasComposedKpi,
            contractId: selectedContractId,
            isActive: () => !cancelled && requestSeq.current === seq,
            knownOffline,
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

          const resultScopeKey = result.definition
            ? JSON.stringify([ownerKey, selectedContractId, appView.id, result.definition.configRevision ?? JSON.stringify(result.definition.config)])
            : datasetScopeKey;
          if (result.definition && resultScopeKey !== datasetScopeKey) {
            adoptedScopeRef.current = resultScopeKey;
            setReconciled({ assignedScopeKey, definition: result.definition });
          }
          const executedDatasetId = result.panel.datasets[0]?.id;
          setDatasetStates((current) => ({
            ...current,
            [datasetId]: {
              error: null,
              errorCode: null,
              fromCache: result.fromCache,
              isLoading: false,
              panel: result.panel,
              queryKey,
              scopeKey: resultScopeKey,
              syncedAt: result.syncedAt,
            },
            ...(executedDatasetId && executedDatasetId !== datasetId
              ? {
                  [executedDatasetId]: {
                    error: null,
                    errorCode: null,
                    fromCache: result.fromCache,
                    isLoading: false,
                    panel: result.panel,
                    queryKey,
                    scopeKey: resultScopeKey,
                    syncedAt: result.syncedAt,
                  },
                }
              : {}),
          }));
          // Remaining modules must use the adopted definition, not the retiring one.
          if (resultScopeKey !== datasetScopeKey) return;
        } catch (error) {
          if (cancelled || requestSeq.current !== seq) {
            continue;
          }

          setDatasetStates((current) => ({
            ...current,
            [datasetId]: {
              error: error instanceof Error ? error.message : "No fue posible cargar el dataset.",
              errorCode: error instanceof PanelLocalReadError || error instanceof PanelSnapshotMissingError || error instanceof PanelDefinitionError ? error.code : "PANEL_READ_FAILED",
              fromCache: false,
              isLoading: false,
              panel: hasCompatiblePanel ? previous?.panel ?? null : null,
              queryKey,
              scopeKey: datasetScopeKey,
              syncedAt: hasCompatiblePanel ? previous?.syncedAt ?? null : null,
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
    assignedScopeKey,
    datasetIdsKey,
    definitionCache,
    configuredFilters,
    knownOffline,
    datasetScopeKey,
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
  const isOffline = knownOffline || Object.values(datasetStates).some((state) => state.scopeKey === datasetScopeKey && state.fromCache);
  const liveDatasetStates = Object.values(datasetStates).filter((state) => state.scopeKey === datasetScopeKey);
  const liveFailedCount = liveDatasetStates.filter((state) => state.error).length;
  const liveLoadedCount = liveDatasetStates.filter((state) => state.panel).length;
  useExperienceActivityReporter(appView, {
    activeCount: liveDatasetStates.filter((state) => state.isLoading).length,
    readCount: liveDatasetStates.filter((state) => state.isLoading).length,
    readMode: liveLoadedCount > 0 ? "refresh" : "initial",
    errorCode: liveDatasetStates.find((state) => state.error)?.errorCode ?? (liveFailedCount > 0 ? "PANEL_PARTIAL_LOAD_FAILED" : null),
    result: liveFailedCount > 0 && liveLoadedCount > 0 ? "partial" : liveFailedCount > 0 ? "error" : liveDatasetStates.length > 0 ? "success" : null,
  });
  const openingStatus = useMemo(() => {
    const states = Object.values(datasetStates).filter((state) => state.scopeKey === datasetScopeKey);
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
  }, [datasetScopeKey, datasetStates]);
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
            testID={`panel-module-${module.id}`}
            style={[
              styles.module,
              moduleLayoutPlan.moduleStyles[module.id],
            ]}
          >
            <PanelModule
              module={module}
              frameHeight={Number(moduleLayoutPlan.moduleStyles[module.id].height ?? moduleLayoutPlan.moduleStyles[module.id].minHeight) - 12}
              onNextPage={() => setPages((current) => ({ ...current, [module.datasetId]: (current[module.datasetId] ?? 1) + 1 }))}
              onPreviousPage={() => setPages((current) => ({ ...current, [module.datasetId]: Math.max(1, (current[module.datasetId] ?? 1) - 1) }))}
              onRetry={() => setRetryVersion((version) => version + 1)}
              onSearch={(value) => {
                setSearchByDataset((current) => ({ ...current, [module.datasetId]: value }));
                setPages((current) => ({ ...current, [module.datasetId]: 1 }));
              }}
              page={pages[module.datasetId] ?? 1}
              search={searchByDataset[module.datasetId] ?? ""}
              state={datasetStates[module.datasetId]?.scopeKey === datasetScopeKey ? datasetStates[module.datasetId] : undefined}
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
    <View testID="panel-filters" style={styles.filters}>
      {metadataError ? <Text style={styles.stateText}>{metadataError}</Text> : null}
      {filters.map((filter) => {
        const field = fields[filter.id];
        const value = values[filter.id] ?? "";
        if (!field) return <Text key={filter.id} style={styles.stateText}>{filter.label || filter.id}: campo no disponible.</Text>;
        const target = getRelationTargetEntityTypeId(field);
        return <View key={filter.id} style={styles.filterControl}>
          {field.type === "BOOLEAN" ? (
            <PanelBooleanFilter label={filter.label || field.name} value={value} required={filter.required}
              onChange={next => onChange(filter.id, String(next))} />
          ) : <RecordFieldInput
            presentation="form"
            field={{ ...field, required: filter.required ?? false }}
            onChange={(next) => onChange(filter.id, typeof next === "string" ? next : "")}
            onRelationSearch={target ? (search) => onRelationSearch(target, search) : undefined}
            relationOptions={target ? relationOptions[target] ?? [] : []}
            relationTargetEntityTypeId={target}
            value={value}
          />}
          {value && !filter.required && field.type !== "BOOLEAN" && field.type !== "SELECT" && field.type !== "DATE" && field.type !== "RELATION" ? <Pressable accessibilityRole="button" onPress={() => onChange(filter.id, "")}>
            <Text style={styles.filterClear}>Limpiar</Text>
          </Pressable> : null}
          {filter.required && !value ? <Text style={styles.filterRequired}>Selección requerida</Text> : null}
        </View>;
      })}
    </View>
  );
}

function PanelBooleanFilter({ label, value, required, onChange }: { label: string; value: string; required?: boolean; onChange(value: string): void }) {
  const a11y = useFieldAccessibility(label, undefined, required);
  return <FieldFrame label={label} labelId={a11y.labelId} errorId={a11y.errorId} required={required}>
    <CompactSelect {...a11y.accessibility} label={label} value={value} required={required}
      options={[{ label: "Sí", value: "true" }, { label: "No", value: "false" }]}
      onChange={onChange} />
  </FieldFrame>;
}

function PanelSearchField({ search, onSearch }: { search: string; onSearch(value: string): void }) {
  const a11y = useFieldAccessibility("Buscar registros");
  return <View style={tableStyles.search}>
    <FieldFrame label="Buscar registros" labelId={a11y.labelId} errorId={a11y.errorId}>
      <TextInput {...a11y.controlProps} autoCapitalize="none" clearButtonMode="while-editing"
        onChangeText={onSearch} placeholder="Buscar registros" returnKeyType="search"
        style={[stableTextInputStyle, tableStyles.searchInput]} value={search} />
    </FieldFrame>
  </View>;
}

function PanelTableHeading({ title, fromCache }: { title: string; fromCache: boolean }) {
  const [width, setWidth] = useState(0);
  return <View onLayout={event => setWidth(Math.floor(event.nativeEvent.layout.width))}
    style={[styles.moduleHeader, tableStyles.moduleHeader]}>
    <Text style={[styles.moduleTitle, width > 0 && width < 280 && tableStyles.narrowTitle]}>{title}</Text>
    {fromCache ? <Text style={styles.cacheLabel}>Offline</Text> : null}
  </View>;
}

function PanelTablePagination({ page, previousDisabled, nextDisabled, onPreviousPage, onNextPage }: {
  page: number; previousDisabled: boolean; nextDisabled: boolean;
  onPreviousPage(): void; onNextPage(): void;
}) {
  const [width, setWidth] = useState(0);
  const compact = width > 0 && width < 340;
  return <View testID="panel-table-pagination" onLayout={event => setWidth(Math.floor(event.nativeEvent.layout.width))}
    style={[tableStyles.pagination, Platform.OS === "web" && ({ position: "sticky", bottom: 0 } as never)]}>
    <FormActions>
      <Pressable accessibilityRole="button" accessibilityLabel="Anterior" accessibilityState={{ disabled: previousDisabled }}
        disabled={previousDisabled} onPress={onPreviousPage}
        style={[tableStyles.pageButton, compact && tableStyles.compactPageButton, previousDisabled && styles.disabledButton]}>
        <Text style={tableStyles.pageButtonText}>{compact ? "‹" : "Anterior"}</Text>
      </Pressable>
      <Text accessibilityLabel={`Página ${page}`} style={[styles.paginationText, tableStyles.pageText]}> {compact ? page : `Página ${page}`} </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Siguiente" accessibilityState={{ disabled: nextDisabled }}
        disabled={nextDisabled} onPress={onNextPage}
        style={[tableStyles.pageButton, compact && tableStyles.compactPageButton, nextDisabled && styles.disabledButton]}>
        <Text style={tableStyles.pageButtonText}>{compact ? "›" : "Siguiente"}</Text>
      </Pressable>
    </FormActions>
  </View>;
}

function PanelModuleFrame({ isTable, isKpi, frameHeight, children }: { isTable: boolean; isKpi: boolean; frameHeight?: number; children: ReactNode }) {
  return isTable ? <ScrollView testID="panel-table-viewport" nestedScrollEnabled showsVerticalScrollIndicator
    style={[styles.moduleContent, tableStyles.moduleViewport, { height: frameHeight, maxHeight: frameHeight, flexBasis: "auto", flexGrow: 0 }]} contentContainerStyle={tableStyles.moduleFlow}>{children}</ScrollView>
    : <View style={[styles.moduleContent, isKpi ? styles.kpiModuleContent : null]}>{children}</View>;
}

function PanelModule({
  currentQueryKey,
  frameHeight,
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
  /** Existing configured module height minus its unchanged 6px outer padding per side. */
  frameHeight?: number;
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
    <PanelModuleFrame isTable={isTable} isKpi={isKpi} frameHeight={frameHeight}>
      {isTable ? <PanelTableHeading title={moduleTitle} fromCache={Boolean(currentState?.fromCache)} /> : (
        <View style={[styles.moduleHeader, isKpi ? styles.kpiModuleHeader : null]}>
          <Text numberOfLines={2} style={[styles.moduleTitle, isKpi ? styles.kpiModuleTitle : null]}>{moduleTitle}</Text>
          {currentState?.fromCache ? <Text style={styles.cacheLabel}>Offline</Text> : null}
        </View>
      )}

      {tableConfig?.searchable ? (
        <PanelSearchField search={search} onSearch={onSearch} />
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
          <ReadLoadingState mode="initial" />
        </View>
      ) : currentState?.error && !dataset ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>{currentState.error}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.actionButton}>
            <Text style={styles.actionButtonText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : !dataset || !table ? (
        <PanelState message="Este módulo necesita configuración." />
      ) : (
        <>
          {currentState?.isLoading ? <ReadLoadingState mode="refresh" /> : null}
          {currentState?.error ? <View style={styles.inlineError}><Text style={styles.stateText}>{currentState.error}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.actionButton}><Text style={styles.actionButtonText}>Reintentar</Text></Pressable></View> : null}
          {dataset.rows.length === 0 ? (
        <PanelState message="No hay datos para mostrar." />
          ) : (
            <>
          <PanelTable table={table} dataset={dataset} module={module} />
          {tableConfig?.paginated !== false ? (
            <PanelTablePagination
              page={dataset.pagination.page}
              previousDisabled={page <= 1}
              nextDisabled={!dataset.pagination.hasMore}
              onPreviousPage={onPreviousPage}
              onNextPage={onNextPage}
            />
          ) : null}
            </>
          )}
        </>
      )}
    </PanelModuleFrame>
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
  const [valueWidth, setValueWidth] = useState(0);

  function handleValueLayout(event: LayoutChangeEvent) {
    const nextWidth = Math.floor(event.nativeEvent.layout.width);
    setValueWidth((current) => current === nextWidth ? current : nextWidth);
  }

  if (isLoading && !kpi) {
    return <View style={styles.kpiCard}><ReadLoadingState compact mode="initial" /></View>;
  }

  if (error && !kpi) {
    return (
      <ScrollView
        contentContainerStyle={styles.kpiStateContent}
        nestedScrollEnabled
        showsVerticalScrollIndicator
        style={styles.kpiStateViewport}
      >
        <Text style={styles.stateText}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.actionButton}>
          <Text style={styles.actionButtonText}>Reintentar</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (!kpi) {
    return <View style={styles.kpiCard}><Text style={styles.stateText}>Este KPI necesita configuración.</Text></View>;
  }

  const valueFontSize = panelKpiValueFontSize(kpi.value, valueWidth);
  const webValueFontSize = panelKpiValueWebFontSize(kpi.value);
  const valueTextStyle = Platform.OS === "web"
    ? ({ fontSize: webValueFontSize, lineHeight: "calc(" + webValueFontSize + " * 1.16)" } as never)
    : { fontSize: valueFontSize, lineHeight: Math.ceil(valueFontSize * 1.16) };

  return (
    <ScrollView
      accessible
      accessibilityLabel={`${title}: ${kpi.fullValue}${offline ? ". Datos guardados" : ""}`}
      contentContainerStyle={styles.kpiCard}
      nestedScrollEnabled
      showsVerticalScrollIndicator
      style={styles.kpiCardViewport}
    >
      {isLoading ? <ReadLoadingState mode="refresh" /> : null}
      {error ? <View style={styles.inlineError}><Text style={styles.stateText}>{error}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.actionButton}><Text style={styles.actionButtonText}>Reintentar</Text></Pressable></View> : null}
      <View style={[styles.kpiValueArea, Platform.OS === "web" ? ({ containerType: "inline-size" } as never) : null]}>
        <ScrollView
          onLayout={handleValueLayout}
          contentContainerStyle={styles.kpiValueContent}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator
          style={styles.kpiValueViewport}
        >
          <Text
            numberOfLines={1}
            style={[styles.kpiValue, valueTextStyle]}
          >
            {kpi.value}
          </Text>
        </ScrollView>
      </View>
      {kpi.configurationIssue ? (
        <Text style={styles.kpiMeta}>{kpi.configurationIssue}</Text>
      ) : kpi.missing ? (
        <Text style={styles.kpiMeta}>Métrica no disponible.</Text>
      ) : offline ? (
        <Text style={styles.kpiMeta}>Datos guardados.</Text>
      ) : null}
    </ScrollView>
  );
}

function PanelTable({ table, module, dataset }: { table: NonNullable<ReturnType<typeof buildPanelTableModel>>; module: PanelModuleConfig; dataset: NonNullable<DatasetState["panel"]>["datasets"][number] }) {
  const [width, setWidth] = useState(0);
  const compact = width < table.minWidth;
  const rows = panelReadRows(module, dataset, table);
  return <View testID="panel-table-content" style={tableStyles.table} onLayout={event => {
    const next = Math.floor(event.nativeEvent.layout.width);
    setWidth(current => current === next ? current : next);
  }}>
    <View accessibilityRole="header" style={[tableStyles.headerRow, compact && tableStyles.hidden]}>
      {table.columns.map(column => <Text key={column.fieldId} style={[tableStyles.headerCell,
        { flexGrow: column.weight, minWidth: column.minWidth }]}>{column.name}</Text>)}
    </View>
    {rows.map(row => <View key={row.id} style={[tableStyles.row, compact && tableStyles.compactRow]}>
      {row.cells.map((values, index) => {
        const column = table.columns[index];
        const fullWidth = width < 600 || values.length > 1 || values.some(value => value.text.length > 120)
          || dataset.schema.fields.find(field => field.id === column.fieldId)?.type === "TEXTAREA";
        return <View key={column.fieldId} style={[tableStyles.cell, compact ? [tableStyles.compactCell,
          { width: fullWidth ? "100%" : "50%", flexBasis: fullWidth ? "100%" : "50%" }] : { flexGrow: column.weight, minWidth: column.minWidth }]}>
          <Text style={[tableStyles.cellLabel, !compact && tableStyles.hidden]}>{column.name}</Text>
          {values.map((value, item) => <View key={item} style={tableStyles.valueGroup}>
            <Text selectable accessibilityLabel={`${column.name}: ${value.text}`} style={[tableStyles.value, value.status !== "value" && tableStyles.unavailable]}>{value.text}</Text>
            {value.detail ? <Text selectable style={tableStyles.trace}>{value.detail}</Text> : null}
          </View>)}
        </View>;
      })}
    </View>)}
  </View>;
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

export function createPanelStyles(p: ThemeColors = colors) {
  return StyleSheet.create({
  actionButton: {
    alignItems: "center",
    backgroundColor: p.primary,
    borderRadius: 6,
    minHeight: metrics.controlMinHeight,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  actionButtonText: {
    color: p.onPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  cacheLabel: {
    color: p.warning,
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
  filterLabel: { color: p.textSecondary, fontSize: 14, fontWeight: "600" },
  filterClear: { color: p.onSecondary, fontSize: 13, paddingVertical: 6 },
  filterRequired: { color: p.warning, fontSize: 12 },
  booleanFilter: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterChoice: { borderColor: p.controlBorder, borderRadius: 4, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  filterChoiceSelected: { backgroundColor: p.selection, borderColor: p.selectionBorder },
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
  inlineError: { alignItems: "center", gap: 8 },
  kpiCard: {
    alignItems: "stretch",
    flexGrow: 1,
    gap: 4,
    justifyContent: "center",
    minHeight: 0,
    minWidth: 0,
  },
  kpiCardViewport: {
    flex: 1,
    minHeight: 0,
  },
  kpiMeta: {
    color: p.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  kpiModuleContent: {
    padding: 6,
  },
  kpiModuleHeader: {
    marginBottom: 4,
  },
  kpiModuleTitle: {
    fontSize: 14,
    lineHeight: 18,
  },
  kpiStateContent: {
    alignItems: "center",
    flexGrow: 1,
    gap: 6,
    justifyContent: "center",
  },
  kpiStateViewport: {
    flex: 1,
    minHeight: 0,
  },
  kpiValueArea: {
    flex: 1,
    justifyContent: "center",
    minHeight: 0,
    minWidth: 0,
  },
  kpiValueContent: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    minWidth: "100%",
  },
  kpiValue: {
    color: p.text,
    flexShrink: 0,
    fontWeight: "800",
    textAlign: "center",
  },
  kpiValueViewport: {
    alignSelf: "stretch",
    maxWidth: "100%",
  },
  module: {
    padding: 6,
  },
  moduleContent: {
    borderColor: p.border,
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
    color: p.text,
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
    color: p.text,
    fontSize: 13,
  },
  searchInput: { color: p.text,
    marginBottom: 10,
  },
  stateBox: {
    alignItems: "center",
    borderColor: p.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 10,
    justifyContent: "center",
    minHeight: 120,
    padding: 16,
  },
  stateText: {
    color: p.textSecondary,
    fontSize: 14,
    textAlign: "center",
  },
  subtitle: {
    color: p.textSecondary,
    fontSize: 13,
  },
  table: {
    borderColor: p.border,
    borderLeftWidth: 1,
    borderTopWidth: 1,
    width: "100%",
  },
  tableCell: {
    borderBottomWidth: 1,
    borderColor: p.border,
    borderRightWidth: 1,
    color: p.text,
    flexBasis: 0,
    flexShrink: 1,
    fontSize: 13,
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 11,
  },
  tableHeaderRow: {
    backgroundColor: p.surfaceSubtle,
    flexDirection: "row",
  },
  tableHeaderText: {
    fontWeight: "700",
  },
  tableRow: {
    flexDirection: "row",
  },
  tableViewport: {
    flex: 1,
    minHeight: 84,
  },
  title: {
    color: p.text,
    fontSize: 24,
    fontWeight: "800",
  },
});
}
const styles = createPanelStyles();

export function createPanelTableStyles(p: ThemeColors = colors) {
  return StyleSheet.create({
  moduleViewport: { padding: 0, minHeight: 0, minWidth: 0, backgroundColor: p.surface },
  moduleFlow: { padding: 12, gap: 12, flexGrow: 1, minWidth: 0 },
  moduleHeader: { marginBottom: 0, gap: 6 },
  narrowTitle: { fontSize: 14, lineHeight: 18 },
  search: { maxWidth: 560, width: "100%", minWidth: 0 },
  searchInput: { color: p.text,  backgroundColor: p.surface, borderColor: p.controlBorder, borderWidth: 1, borderRadius: 8, minHeight: 44, paddingHorizontal: 12, fontSize: 16, minWidth: 0 },
  pageText: { alignSelf: "center" },
  pagination: { backgroundColor: p.surface, borderTopWidth: 1, borderColor: p.border, paddingVertical: 6, zIndex: 1, minWidth: 0 },
  pageButton: { minWidth: 112, minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: p.controlBorder, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: p.surface },
  compactPageButton: { minWidth: 44, paddingHorizontal: 8 },
  pageButtonText: { color: p.primary, fontSize: 15, lineHeight: 22, fontWeight: "700" },
  table: { width: "100%", minWidth: 0, borderWidth: 1, borderColor: p.border, borderRadius: 8, overflow: "hidden" },
  headerRow: { flexDirection: "row", backgroundColor: p.surfaceSubtle },
  headerCell: { flexBasis: 0, flexShrink: 1, padding: 10, color: p.textSecondary, fontSize: 13, fontWeight: "700" },
  row: { flexDirection: "row", borderTopWidth: 1, borderColor: p.border, minWidth: 0 },
  compactRow: { flexDirection: "row", flexWrap: "wrap", paddingVertical: 4 },
  cell: { flexBasis: 0, flexShrink: 1, padding: 10, gap: 4, minWidth: 0 },
  compactCell: { flexGrow: 0, flexShrink: 0, paddingVertical: 6 },
  cellLabel: { color: p.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  valueGroup: { gap: 2, minWidth: 0 },
  value: { color: p.text, fontSize: 14, lineHeight: 20, minWidth: 0 },
  unavailable: { color: p.textSecondary },
  trace: { color: p.textSecondary, fontSize: 12, lineHeight: 18 },
  hidden: { display: "none" },
});
}
const tableStyles = createPanelTableStyles();
