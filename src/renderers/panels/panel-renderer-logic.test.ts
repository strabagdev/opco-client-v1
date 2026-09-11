import { describe, expect, it } from "vitest";

import { PanelDataset, PanelModuleConfig, PanelResponse, PanelTableConfig } from "@/lib/opco-api";

import {
  buildPanelKpiModel,
  buildPanelTableModel,
  datasetIdsForPanelModules,
  displayPanelValue,
  formatPanelMetricValue,
  normalizePanelFilters,
  panelDatasetQueryKey,
  panelTableColumnMinWidth,
  panelTableColumnWeight,
} from "./panel-renderer-logic";

declare const require: (id: string) => { readFileSync: (path: string, encoding: string) => string };

describe("panel table model", () => {
  it("renders TABLE columns exactly as configured without prepending or reordering fields", () => {
    const table = buildPanelTableModel(tableModule([
      { fieldId: "status_field" },
      { fieldId: "review_field" },
      { fieldId: "date_field" },
    ]), panelDataset());

    expect(table?.columns.map((column) => column.name)).toEqual(["Estatus", "Revisión", "Fecha"]);
    expect(table?.rows[0]?.values).toEqual(["Publicado", "2", "06-09-2026"]);
  });

  it("uses the full module width with balanced column distribution metadata", () => {
    const table = buildPanelTableModel(tableModule([
      { fieldId: "procedure_field" },
      { fieldId: "status_field" },
      { fieldId: "review_field" },
      { fieldId: "date_field" },
    ]), panelDataset());

    expect(table?.columns.map((column) => column.name)).toEqual(["Procedimiento", "Estatus", "Revisión", "Fecha"]);
    expect(table?.columns.map((column) => column.type)).toEqual(["RELATION", "SELECT", "TEXT", "DATE"]);
    expect(table?.columns.map((column) => column.weight)).toEqual([
      panelTableColumnWeight("RELATION"),
      panelTableColumnWeight("SELECT"),
      panelTableColumnWeight("TEXT"),
      panelTableColumnWeight("DATE"),
    ]);
    expect(table?.minWidth).toBe(
      panelTableColumnMinWidth("RELATION")
      + panelTableColumnMinWidth("SELECT")
      + panelTableColumnMinWidth("TEXT")
      + panelTableColumnMinWidth("DATE"),
    );
  });

  it("gives RELATION and TEXT fields more space than compact DATE and numeric fields", () => {
    expect(panelTableColumnWeight("RELATION")).toBeGreaterThan(panelTableColumnWeight("DATE"));
    expect(panelTableColumnWeight("TEXT")).toBeGreaterThan(panelTableColumnWeight("INTEGER"));
    expect(panelTableColumnMinWidth("RELATION")).toBeGreaterThan(panelTableColumnMinWidth("DATE"));
    expect(panelTableColumnMinWidth("INTEGER")).toBeLessThan(panelTableColumnMinWidth("TEXT"));
  });

  it("formats SELECT, MULTISELECT, DATE, DATETIME, RELATION, and null values for display only", () => {
    const dataset = panelDataset({
      rows: [{
        id: "record_1",
        values: {
          date_field: "2026-09-06",
          datetime_field: "2026-09-06T14:30:00.000Z",
          missing_field: null,
          procedure_field: { displayName: "PET-001", entityTypeId: "procedures", id: "procedure_1" },
          status_field: "published",
          tags_field: ["north", "south"],
        },
      }],
    });
    const table = buildPanelTableModel(tableModule([
      { fieldId: "procedure_field" },
      { fieldId: "status_field" },
      { fieldId: "tags_field" },
      { fieldId: "date_field" },
      { fieldId: "datetime_field" },
      { fieldId: "missing_field" },
    ]), dataset);

    expect(table?.rows[0]?.values[0]).toBe("PET-001");
    expect(table?.rows[0]?.values[1]).toBe("Publicado");
    expect(table?.rows[0]?.values[2]).toBe("Norte, Sur");
    expect(table?.rows[0]?.values[3]).toBe("06-09-2026");
    expect(table?.rows[0]?.values[4]).not.toContain("undefined");
    expect(table?.rows[0]?.values[5]).toBe("");
  });

  it("returns null for unsupported module visualization instead of throwing", () => {
    expect(buildPanelTableModel({
      ...tableModule([{ fieldId: "status_field" }]),
      visualization: { config: {}, type: "KPI" },
    } as unknown as PanelModuleConfig, panelDataset())).toBeNull();
  });

  it("keeps long text values complete for accessible rendering while the UI may truncate", () => {
    const longValue = "Procedimiento con un nombre muy largo que debe seguir disponible completo";
    const table = buildPanelTableModel(tableModule([{ fieldId: "review_field" }]), panelDataset({
      rows: [{
        id: "version_2",
        values: {
          review_field: longValue,
        },
      }],
    }));

    expect(table?.rows[0]?.values[0]).toBe(longValue);
  });
});

describe("panel KPI model", () => {
  it("finds KPI metrics by metricId without deriving values from rows or pagination", () => {
    const model = buildPanelKpiModel(kpiModule("total-count", "records"), [
      {
        calculatedAt: "2026-09-10T12:00:00.000Z",
        datasetId: "records",
        id: "total-count",
        value: 42,
        valueType: "NUMBER",
      },
    ]);

    expect(model).toMatchObject({
      calculatedAt: "2026-09-10T12:00:00.000Z",
      label: "Total",
      metricId: "total-count",
      missing: false,
      value: "42",
    });

    const missing = buildPanelKpiModel(kpiModule("missing", "records"), []);

    expect(missing).toMatchObject({
      missing: true,
      value: "-",
    });
  });

  it("does not render a KPI metric from another dataset", () => {
    expect(buildPanelKpiModel(kpiModule("total-count", "records"), [
      {
        calculatedAt: "2026-09-10T12:00:00.000Z",
        datasetId: "other",
        id: "total-count",
        value: 99,
        valueType: "NUMBER",
      },
    ])).toMatchObject({
      missing: true,
      value: "-",
    });
  });

  it("keeps incomplete runtime KPI payloads controlled without crashing", () => {
    expect(buildPanelKpiModel({
      ...kpiModule("amount", "records"),
      visualization: {
        type: "KPI",
        config: {
          format: "MONEY",
          label: "Monto",
          metricId: "amount",
        },
      },
    } as unknown as PanelModuleConfig, [
      {
        calculatedAt: "2026-09-10T12:00:00.000Z",
        datasetId: "records",
        id: "amount",
        value: 1200,
        valueType: "NUMBER",
      },
    ])).toMatchObject({
      configurationIssue: "Configura la moneda de este KPI.",
      missing: false,
      value: "-",
    });
  });

  it("formats KPI NUMBER, INTEGER, DECIMAL, DATE, DATETIME, null, and missing values for es-CL", () => {
    expect(formatPanelMetricValue(1234.5, "NUMBER").value).toBe("1.234,5");
    expect(formatPanelMetricValue(1234.8, "INTEGER").value).toBe("1.235");
    expect(formatPanelMetricValue(1234.567, "DECIMAL").value).toBe("1.234,57");
    expect(formatPanelMetricValue("2026-09-10", "DATE").value).toBe("10-09-2026");
    expect(formatPanelMetricValue("2026-09-10T12:30:00.000Z", "DATETIME").value).not.toContain("T12:30:00.000Z");
    expect(formatPanelMetricValue(null, "NUMBER").value).toBe("-");
    expect(formatPanelMetricValue(undefined, "NUMBER").value).toBe("-");
  });

  it("formats MONEY with the configured currency without assuming CLP", () => {
    expect(formatPanelMetricValue(1234.5, {
      currencyCode: "CLP",
      format: "MONEY",
      label: "Monto",
      metricId: "amount",
    }).value).toBe(new Intl.NumberFormat("es-CL", {
      currency: "CLP",
      style: "currency",
    }).format(1234.5));
    expect(formatPanelMetricValue(1234.5, {
      currencyCode: "USD",
      format: "MONEY",
      label: "Monto",
      metricId: "amount",
    }).value).toBe(new Intl.NumberFormat("es-CL", {
      currency: "USD",
      style: "currency",
    }).format(1234.5));
  });

  it("returns a controlled state for MONEY without a currencyCode", () => {
    expect(formatPanelMetricValue(1234.5, {
      format: "MONEY",
      label: "Monto",
      metricId: "amount",
    })).toEqual({
      configurationIssue: "Configura la moneda de este KPI.",
      value: "-",
    });
  });

  it("formats PERCENT according to the explicit percentScale", () => {
    expect(formatPanelMetricValue(0.25, {
      format: "PERCENT",
      label: "Avance",
      metricId: "progress",
      percentScale: "RATIO",
    }).value).toBe(new Intl.NumberFormat("es-CL", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
      style: "percent",
    }).format(0.25));
    expect(formatPanelMetricValue(25, {
      format: "PERCENT",
      label: "Avance",
      metricId: "progress",
      percentScale: "WHOLE",
    }).value).toBe(new Intl.NumberFormat("es-CL", {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
      style: "percent",
    }).format(0.25));
  });

  it("returns a controlled state for PERCENT without percentScale", () => {
    expect(formatPanelMetricValue(25, {
      format: "PERCENT",
      label: "Avance",
      metricId: "progress",
    })).toEqual({
      configurationIssue: "Configura la escala de este KPI.",
      value: "-",
    });
  });

  it("ignores incompatible MONEY and PERCENT properties on other formats", () => {
    expect(formatPanelMetricValue(25, {
      currencyCode: "CLP",
      format: "NUMBER",
      label: "Total",
      metricId: "total",
      percentScale: "RATIO",
    }).value).toBe("25");
  });

  it("formats KPI modules from a Core-like PANEL response without changing metric values", () => {
    const panel: PanelResponse = {
      ...panelResponse(),
      metrics: [
        {
          calculatedAt: "2026-09-10T12:00:00.000Z",
          datasetId: "records",
          id: "amount",
          value: 1234.5,
          valueType: "NUMBER",
        },
        {
          calculatedAt: "2026-09-10T12:00:00.000Z",
          datasetId: "records",
          id: "progress-ratio",
          value: 0.25,
          valueType: "NUMBER",
        },
      ],
      modules: [
        {
          datasetId: "records",
          id: "amount-kpi",
          layout: { h: 2, w: 4, x: 0, y: 0 },
          title: "Monto",
          visualization: {
            config: {
              currencyCode: "CLP",
              format: "MONEY",
              label: "Monto",
              metricId: "amount",
            },
            type: "KPI",
          },
        },
        {
          datasetId: "records",
          id: "progress-kpi",
          layout: { h: 2, w: 4, x: 4, y: 0 },
          title: "Avance",
          visualization: {
            config: {
              format: "PERCENT",
              label: "Avance",
              metricId: "progress-ratio",
              percentScale: "RATIO",
            },
            type: "KPI",
          },
        },
      ],
    };

    const metrics = panel.metrics ?? [];

    expect(buildPanelKpiModel(panel.modules[0]!, metrics)).toMatchObject({
      configurationIssue: null,
      metricId: "amount",
      value: new Intl.NumberFormat("es-CL", {
        currency: "CLP",
        style: "currency",
      }).format(1234.5),
    });
    expect(buildPanelKpiModel(panel.modules[1]!, metrics)).toMatchObject({
      configurationIssue: null,
      metricId: "progress-ratio",
      value: new Intl.NumberFormat("es-CL", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
        style: "percent",
      }).format(0.25),
    });
    expect(metrics[1]?.value).toBe(0.25);
  });

  it("keeps TABLE and KPI dataset discovery deduplicated for shared datasets", () => {
    expect(datasetIdsForPanelModules([
      tableModule([{ fieldId: "status_field" }], "table", "records"),
      kpiModule("total-count", "records", "kpi_1"),
      kpiModule("total-count", "records", "kpi_2"),
      kpiModule("latest-count", "latest", "kpi_3"),
    ])).toEqual(["records", "latest"]);
  });

  it("supports a row with several KPI modules and a TABLE through configured layout metadata", () => {
    const modules = [
      kpiModule("total-count", "records", "kpi_1"),
      { ...kpiModule("open-count", "records", "kpi_2"), layout: { h: 2, w: 4, x: 4, y: 0 } },
      { ...tableModule([{ fieldId: "status_field" }], "table", "records"), layout: { h: 6, w: 12, x: 0, y: 1 } },
    ];

    expect(modules.map((module) => module.layout)).toEqual([
      { h: 2, w: 4, x: 0, y: 0 },
      { h: 2, w: 4, x: 4, y: 0 },
      { h: 6, w: 12, x: 0, y: 1 },
    ]);
    expect(datasetIdsForPanelModules(modules)).toEqual(["records"]);
  });
});

describe("panel TABLE renderer structure", () => {
  const { readFileSync } = require("fs");
  const source = readFileSync("src/renderers/panels/PanelRenderer.tsx", "utf8");

  it("renders PANEL tables at full width with internal horizontal overflow", () => {
    expect(source).toContain("horizontal");
    expect(source).toContain("maxWidth: \"100%\"");
    expect(source).toContain("minWidth: \"100%\"");
    expect(source).toContain("width: \"100%\"");
    expect(source).not.toContain("width: 160");
  });

  it("keeps pagination attached to the table with disabled previous and next states", () => {
    expect(source.indexOf("<PanelTable table={table} />")).toBeLessThan(source.indexOf("styles.pagination"));
    expect(source).toContain("disabled={page <= 1}");
    expect(source).toContain("disabled={!dataset.pagination.hasMore}");
  });

  it("renders KPI modules from server metrics with loading, error, and offline states", () => {
    expect(source).toContain("buildPanelKpiModel(module, state?.panel?.metrics)");
    expect(source).toContain("<PanelKpi");
    expect(source).toContain("Cargando indicador...");
    expect(source).toContain("Métrica no disponible.");
    expect(source).toContain("Datos guardados.");
    expect(source).not.toContain("pagination.total}");
  });

  it("keeps late responses and dataset errors isolated", () => {
    expect(source).toContain("requestSeq.current !== seq");
    expect(source).toContain("[datasetId]: {");
    expect(source).toContain("error: error instanceof Error ? error.message");
  });

  it("applies module layout to TABLE and KPI containers", () => {
    expect(source).toContain("module.layout.w / renderedColumns");
    expect(source).toContain("module.layout.h * configuredRowHeight");
    expect(source).toContain("orderedModules");
  });
});

describe("panel dataset state helpers", () => {
  it("deduplicates shared dataset requests across modules", () => {
    expect(datasetIdsForPanelModules([
      tableModule([{ fieldId: "status_field" }], "module_1", "records"),
      tableModule([{ fieldId: "review_field" }], "module_2", "records"),
      tableModule([{ fieldId: "status_field" }], "module_3", "latest"),
    ])).toEqual(["records", "latest"]);
  });

  it("normalizes filter values and keeps stable query keys independent of object order", () => {
    expect(normalizePanelFilters([
      { id: "status", valueType: "OPTION" },
      { id: "amount", valueType: "NUMBER" },
      { id: "active", valueType: "BOOLEAN" },
    ], {
      active: "true",
      amount: "12",
      empty: "",
      status: "option_1",
    })).toEqual({
      active: true,
      amount: 12,
      status: "option_1",
    });

    expect(panelDatasetQueryKey({
      filters: { b: 2, a: 1 },
      page: 1,
      pageSize: 25,
      search: " PET ",
    })).toBe(panelDatasetQueryKey({
      filters: { a: 1, b: 2 },
      page: 1,
      pageSize: 25,
      search: "PET",
    }));
  });

  it("does not expose object values as [object Object]", () => {
    expect(displayPanelValue({ id: "json", name: "JSON", type: "TEXT" }, { nested: true } as never)).toBe("");
  });
});

function tableModule(
  columns: PanelTableConfig["columns"],
  id = "module_table",
  datasetId = "records",
): PanelModuleConfig {
  return {
    datasetId,
    id,
    layout: { h: 4, w: 12, x: 0, y: 0 },
    title: "Tabla",
    visualization: {
      config: {
        columns,
        paginated: true,
        searchable: true,
      },
      type: "TABLE",
    },
  };
}

function kpiModule(metricId: string, datasetId = "records", id = "module_kpi"): PanelModuleConfig {
  return {
    datasetId,
    id,
    layout: { h: 2, w: 4, x: 0, y: 0 },
    title: "Total",
    visualization: {
      config: {
        format: "NUMBER",
        label: "Total",
        metricId,
      },
      type: "KPI",
    },
  };
}

function panelDataset(overrides: Partial<PanelDataset> = {}): PanelDataset {
  return {
    id: "records",
    pagination: { hasMore: false, page: 1, pageSize: 25, total: 1 },
    rows: [
      {
        id: "version_2",
        values: {
          date_field: "2026-09-06",
          review_field: "2",
          status_field: "published",
        },
      },
    ],
    schema: {
      fields: [
        { id: "procedure_field", name: "Procedimiento", type: "RELATION" },
        {
          id: "status_field",
          name: "Estatus",
          options: [{ id: "published_option", label: "Publicado", value: "published" }],
          type: "SELECT",
        },
        { id: "review_field", name: "Revisión", type: "TEXT" },
        { id: "date_field", name: "Fecha", type: "DATE" },
        { id: "datetime_field", name: "Actualizado", type: "DATETIME" },
        {
          id: "tags_field",
          name: "Zonas",
          options: [
            { id: "north_option", label: "Norte", value: "north" },
            { id: "south_option", label: "Sur", value: "south" },
          ],
          type: "MULTISELECT",
        },
        { id: "missing_field", name: "Pendiente", type: "TEXT" },
      ],
    },
    ...overrides,
  };
}

export function panelResponse(dataset: PanelDataset = panelDataset()): PanelResponse {
  return {
    appView: { id: "panel_1", name: "Panel", slug: "panel" },
    calculatedAt: "2026-09-09T12:00:00.000Z",
    configRevision: "revision_1",
    datasets: [dataset],
    filters: [],
    metrics: [],
    modules: [tableModule([{ fieldId: "status_field" }])],
    schemaVersion: 1,
  };
}
