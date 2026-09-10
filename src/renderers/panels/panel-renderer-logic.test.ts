import { describe, expect, it } from "vitest";

import { PanelDataset, PanelModuleConfig, PanelResponse } from "@/lib/opco-api";

import {
  buildPanelTableModel,
  datasetIdsForPanelModules,
  displayPanelValue,
  normalizePanelFilters,
  panelDatasetQueryKey,
} from "./panel-renderer-logic";

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
    }, panelDataset())).toBeNull();
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
  columns: NonNullable<PanelModuleConfig["visualization"]["config"]["columns"]>,
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
    modules: [tableModule([{ fieldId: "status_field" }])],
    schemaVersion: 1,
  };
}
