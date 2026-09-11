import {
  EntityRecordValue,
  PanelDataset,
  PanelField,
  PanelFilterConfig,
  PanelKpiFormat,
  PanelMetricResult,
  PanelModuleConfig,
  PanelRuntimeKpiConfig,
  PanelResponse,
  ReportSelectValueDisplay,
} from "@/lib/opco-api";

export type PanelTableModel = {
  columns: {
    fieldId: string;
    minWidth: number;
    name: string;
    type: PanelField["type"];
    weight: number;
  }[];
  minWidth: number;
  rows: {
    id: string;
    values: string[];
  }[];
};

export type PanelDatasetQueryState = {
  filters: Record<string, unknown>;
  page: number;
  pageSize: number;
  search: string;
};

export type PanelKpiModel = {
  calculatedAt: string | null;
  configurationIssue: string | null;
  fullValue: string;
  label: string;
  metricId: string;
  missing: boolean;
  value: string;
};

type ResolvedPanelColumn = {
  field: PanelField;
  fieldId: string;
  name: string;
  valueDisplay: ReportSelectValueDisplay | undefined;
};

export function buildPanelTableModel(module: PanelModuleConfig, dataset: PanelDataset | undefined): PanelTableModel | null {
  if (!dataset || module.visualization.type !== "TABLE") {
    return null;
  }

  const fieldsById = new Map(dataset.schema.fields.map((field) => [field.id, field]));
  const columns = (module.visualization.config.columns ?? [])
    .map((column) => {
      const field = fieldsById.get(column.fieldId);

      return field
        ? {
            field,
            fieldId: column.fieldId,
            name: field.name,
            valueDisplay: column.valueDisplay,
          }
        : null;
    })
    .filter((column): column is ResolvedPanelColumn => Boolean(column));

  if (columns.length === 0) {
    return null;
  }

  return {
    columns: columns.map((column) => ({
      fieldId: column.fieldId,
      minWidth: panelTableColumnMinWidth(column.field.type),
      name: column.name,
      type: column.field.type,
      weight: panelTableColumnWeight(column.field.type),
    })),
    minWidth: columns.reduce((total, column) => total + panelTableColumnMinWidth(column.field.type), 0),
    rows: dataset.rows.map((row) => ({
      id: row.id,
      values: columns.map((column) => displayPanelValue(column.field, row.values[column.fieldId], column.valueDisplay)),
    })),
  };
}

export function buildPanelKpiModel(module: PanelModuleConfig, metrics: PanelMetricResult[] | undefined): PanelKpiModel | null {
  if (module.visualization.type !== "KPI") {
    return null;
  }

  const metricId = typeof module.visualization.config.metricId === "string"
    ? module.visualization.config.metricId
    : "";
  const label = typeof module.visualization.config.label === "string" && module.visualization.config.label.trim()
    ? module.visualization.config.label.trim()
    : module.title ?? "Indicador";
  const metric = metrics?.find((item) => item.id === metricId && item.datasetId === module.datasetId);
  const formatted = formatPanelMetricValue(metric?.value, module.visualization.config);

  return {
    calculatedAt: metric?.calculatedAt ?? null,
    configurationIssue: formatted.configurationIssue,
    fullValue: formatted.value,
    label,
    metricId,
    missing: !metric,
    value: formatted.value,
  };
}

export function panelTableColumnWeight(fieldType: PanelField["type"]) {
  if (fieldType === "RELATION" || fieldType === "TEXTAREA") {
    return 2;
  }

  if (fieldType === "TEXT" || fieldType === "EMAIL" || fieldType === "URL" || fieldType === "PHONE") {
    return 1.5;
  }

  if (fieldType === "DATE" || fieldType === "TIME" || fieldType === "BOOLEAN" || fieldType === "INTEGER" || fieldType === "DECIMAL" || fieldType === "MONEY") {
    return 0.9;
  }

  return 1.2;
}

export function panelTableColumnMinWidth(fieldType: PanelField["type"]) {
  if (fieldType === "RELATION" || fieldType === "TEXTAREA") {
    return 180;
  }

  if (fieldType === "DATE" || fieldType === "TIME" || fieldType === "BOOLEAN") {
    return 112;
  }

  if (fieldType === "INTEGER" || fieldType === "DECIMAL" || fieldType === "MONEY") {
    return 120;
  }

  return 144;
}

export function displayPanelValue(
  field: PanelField,
  value: EntityRecordValue | undefined,
  selectValueDisplay: ReportSelectValueDisplay = "LABEL",
): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (field.type === "RELATION") {
    if (Array.isArray(value)) {
      return value.map(relationLabel).filter(Boolean).join(", ");
    }

    return relationLabel(value);
  }

  if (field.type === "DATE") {
    return formatPanelDateOnly(String(value));
  }

  if (field.type === "DATETIME") {
    return formatPanelDateTime(String(value));
  }

  if (field.type === "SELECT") {
    const option = field.options?.find((item) => item.value === value || item.id === value);
    return selectValueDisplay === "INTERNAL_VALUE"
      ? option?.value ?? String(value)
      : option?.label ?? String(value);
  }

  if (field.type === "MULTISELECT" && Array.isArray(value)) {
    return value.map((item) => {
      const option = field.options?.find((option) => option.value === item || option.id === item);
      return selectValueDisplay === "INTERNAL_VALUE"
        ? option?.value ?? String(item)
        : option?.label ?? String(item);
    }).join(", ");
  }

  if (Array.isArray(value)) {
    return value.map((item) => displayUnknownPanelValue(item)).filter(Boolean).join(", ");
  }

  return displayUnknownPanelValue(value);
}

export function formatPanelMetricValue(
  value: PanelMetricResult["value"] | undefined,
  configOrFormat: PanelKpiFormat | PanelRuntimeKpiConfig,
): { configurationIssue: string | null; value: string } {
  const config = typeof configOrFormat === "string"
    ? { format: configOrFormat }
    : configOrFormat;
  const format = panelKpiFormat(config.format);

  if (value === null || value === undefined || value === "") {
    return { configurationIssue: null, value: "-" };
  }

  if (format === "DATE") {
    return { configurationIssue: null, value: formatPanelDateOnly(String(value)) || "-" };
  }

  if (format === "DATETIME") {
    return { configurationIssue: null, value: formatPanelDateTime(String(value)) || "-" };
  }

  const numericValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numericValue)) {
    return { configurationIssue: null, value: typeof value === "string" ? value : "-" };
  }

  if (format === "INTEGER") {
    return { configurationIssue: null, value: new Intl.NumberFormat("es-CL", {
      maximumFractionDigits: 0,
    }).format(numericValue) };
  }

  if (format === "DECIMAL") {
    return { configurationIssue: null, value: new Intl.NumberFormat("es-CL", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(numericValue) };
  }

  if (format === "MONEY") {
    const currencyCode = typeof config.currencyCode === "string" ? config.currencyCode : "";

    if (!/^[A-Z]{3}$/.test(currencyCode)) {
      return { configurationIssue: "Configura la moneda de este KPI.", value: "-" };
    }

    try {
      return { configurationIssue: null, value: new Intl.NumberFormat("es-CL", {
        currency: currencyCode,
        style: "currency",
      }).format(numericValue) };
    } catch {
      return { configurationIssue: "Configura la moneda de este KPI.", value: "-" };
    }
  }

  if (format === "PERCENT") {
    if (config.percentScale !== "RATIO" && config.percentScale !== "WHOLE") {
      return { configurationIssue: "Configura la escala de este KPI.", value: "-" };
    }

    const presentationValue = config.percentScale === "WHOLE" ? numericValue / 100 : numericValue;

    return { configurationIssue: null, value: new Intl.NumberFormat("es-CL", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
      style: "percent",
    }).format(presentationValue) };
  }

  return { configurationIssue: null, value: new Intl.NumberFormat("es-CL", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(numericValue) };
}

export function datasetIdsForPanelModules(modules: PanelModuleConfig[]) {
  return Array.from(new Set(modules.map((module) => module.datasetId).filter(Boolean)));
}

export function defaultPageSizeForDataset(panel: PanelResponse | null, datasetId: string, fallback = 25) {
  const configured = panel?.datasets.find((dataset) => dataset.id === datasetId)?.pagination.pageSize;

  return configured && configured > 0 ? configured : fallback;
}

export function normalizePanelFilters(filters: PanelFilterConfig[], values: Record<string, string>) {
  const normalized: Record<string, unknown> = {};

  for (const filter of filters) {
    const rawValue = values[filter.id];

    if (rawValue === undefined || rawValue === "") {
      continue;
    }

    if (filter.valueType === "NUMBER") {
      const parsed = Number(rawValue);
      if (!Number.isNaN(parsed)) {
        normalized[filter.id] = parsed;
      }
      continue;
    }

    if (filter.valueType === "BOOLEAN") {
      normalized[filter.id] = rawValue === "true";
      continue;
    }

    normalized[filter.id] = rawValue;
  }

  return normalized;
}

export function panelDatasetQueryKey(input: PanelDatasetQueryState) {
  return JSON.stringify({
    filters: stableValue(input.filters),
    page: input.page,
    pageSize: input.pageSize,
    search: input.search.trim(),
  });
}

function relationLabel(value: unknown) {
  return value && typeof value === "object" && "displayName" in value
    ? String(value.displayName)
    : "";
}

function displayUnknownPanelValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    const relation = relationLabel(value);
    return relation || "";
  }

  return String(value);
}

function formatPanelDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);

  return match ? `${match[3]}-${match[2]}-${match[1]}` : value;
}

function formatPanelDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("es-CL", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function panelKpiFormat(value: unknown): PanelKpiFormat {
  return value === "INTEGER"
    || value === "DECIMAL"
    || value === "MONEY"
    || value === "PERCENT"
    || value === "DATE"
    || value === "DATETIME"
    ? value
    : "NUMBER";
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }

  return value ?? null;
}
