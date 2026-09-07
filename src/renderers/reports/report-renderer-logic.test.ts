import { describe, expect, it } from "vitest";

import { ReportResponse } from "@/lib/opco-api";

import { buildReportCurrentStatusModel, buildReportMatrixModel, buildReportTableModel } from "./report-renderer-logic";

describe("report renderer logic", () => {
  it("builds TABLE columns in configured order with SELECT labels", () => {
    const table = buildReportTableModel({
      ...baseReport,
      config: {
        entityTypeId: "attendance",
        dateFieldId: "field_date",
        presentationMode: "TABLE",
        table: {
          defaultSortDirection: "desc",
          defaultSortFieldId: "field_date",
          visibleFieldIds: ["field_person", "field_date", "field_status"],
        },
      },
    });

    expect(table?.columns.map((column) => column.name)).toEqual(["Persona", "Fecha", "Estado"]);
    expect(table?.rows[0].values).toEqual(["Juan Perez", "2026-08-01", "Presente"]);
  });

  it("uses configured internal SELECT values in TABLE reports", () => {
    const table = buildReportTableModel({
      ...baseReport,
      config: {
        entityTypeId: "attendance",
        dateFieldId: "field_date",
        presentationMode: "TABLE",
        table: {
          defaultSortDirection: "desc",
          defaultSortFieldId: "field_date",
          visibleFieldIds: ["field_person", "field_date", "field_status"],
        },
        valueDisplay: {
          field_status: "INTERNAL_VALUE",
        },
      },
    });

    expect(table?.rows[0].values).toEqual(["Juan Perez", "2026-08-01", "PRESENTE"]);
  });

  it("uppercases compact internal SELECT values in TABLE reports", () => {
    const table = buildReportTableModel({
      ...baseReport,
      config: {
        entityTypeId: "attendance",
        dateFieldId: "field_date",
        presentationMode: "TABLE",
        table: {
          defaultSortDirection: "desc",
          defaultSortFieldId: "field_date",
          visibleFieldIds: ["field_status"],
        },
        valueDisplay: {
          field_status: "INTERNAL_VALUE",
        },
      },
      fields: baseReport.fields.map((field) =>
        field.id === "field_status"
          ? {
            ...field,
            options: field.options?.map((option) =>
              option.id === "option_present" ? { ...option, value: "p" } : option,
            ),
          }
          : field,
      ),
      records: [
        {
          displayName: "Juan 2026-08-01",
          id: "record_1",
          updatedAt: "2026-08-01T12:00:00.000Z",
          values: {
            estado: "p",
          },
        },
      ],
    });

    expect(table?.rows[0].values).toEqual(["P"]);
  });

  it("builds MATRIX rows, date columns, values and lateral summary with real labels", () => {
    const matrix = buildReportMatrixModel({
      ...baseReport,
      config: {
        entityTypeId: "attendance",
        dateFieldId: "field_date",
        presentationMode: "MATRIX",
        matrix: {
          columnFieldId: "field_date",
          rowFieldId: "field_person",
          summaryFieldId: "field_status",
          valueFieldId: "field_status",
        },
      },
    });

    expect(matrix?.columns.map((column) => column.label)).toEqual(["01", "02"]);
    expect(matrix?.rows).toEqual([
      {
        id: "person_1",
        label: "Juan Perez",
        summary: "Ausente: 1 Presente: 1",
        values: {
          "2026-08-01": "Presente",
          "2026-08-02": "Ausente",
        },
      },
    ]);
  });

  it("uses configured internal SELECT values in MATRIX cells and summaries", () => {
    const matrix = buildReportMatrixModel({
      ...baseReport,
      config: {
        entityTypeId: "attendance",
        dateFieldId: "field_date",
        presentationMode: "MATRIX",
        matrix: {
          columnFieldId: "field_date",
          rowFieldId: "field_person",
          summaryFieldId: "field_status",
          valueFieldId: "field_status",
        },
        valueDisplay: {
          field_status: "INTERNAL_VALUE",
        },
      },
    });

    expect(matrix?.rows).toEqual([
      {
        id: "person_1",
        label: "Juan Perez",
        summary: "AUSENTE: 1 PRESENTE: 1",
        values: {
          "2026-08-01": "PRESENTE",
          "2026-08-02": "AUSENTE",
        },
      },
    ]);
  });

  it("keeps visible label casing when SELECT display uses LABEL", () => {
    const table = buildReportTableModel({
      ...baseReport,
      fields: baseReport.fields.map((field) =>
        field.id === "field_status"
          ? {
            ...field,
            options: field.options?.map((option) =>
              option.id === "option_present" ? { ...option, label: "Presente normal" } : option,
            ),
          }
          : field,
      ),
    });

    expect(table?.rows[0].values).toEqual(["Juan Perez", "2026-08-01", "Presente normal"]);
  });

  it("falls back to SELECT labels in internal mode when an option has no internal value", () => {
    const table = buildReportTableModel({
      ...baseReport,
      config: {
        entityTypeId: "attendance",
        dateFieldId: "field_date",
        presentationMode: "TABLE",
        table: {
          defaultSortDirection: "desc",
          visibleFieldIds: ["field_status"],
        },
        valueDisplay: {
          field_status: "INTERNAL_VALUE",
        },
      },
      fields: baseReport.fields.map((field) =>
        field.id === "field_status"
          ? {
            ...field,
            options: field.options?.map((option) =>
              option.id === "option_present" ? { ...option, value: "" } : option,
            ),
          }
          : field,
      ),
      records: [
        {
          displayName: "Juan 2026-08-01",
          id: "record_1",
          updatedAt: "2026-08-01T12:00:00.000Z",
          values: {
            estado: "option_present",
          },
        },
      ],
    });

    expect(table?.rows[0].values).toEqual(["Presente"]);
  });

  it("uppercases configured internal MULTISELECT values", () => {
    const table = buildReportTableModel({
      ...baseReport,
      config: {
        entityTypeId: "attendance",
        dateFieldId: "field_date",
        presentationMode: "TABLE",
        table: {
          defaultSortDirection: "desc",
          visibleFieldIds: ["field_tags"],
        },
        valueDisplay: {
          field_tags: "INTERNAL_VALUE",
        },
      },
      fields: [
        ...baseReport.fields,
        {
          active: true,
          config: { display: {}, validation: {} },
          id: "field_tags",
          key: "marcas",
          name: "Marcas",
          options: [
            { active: true, id: "option_p", label: "Presente", order: 1, value: "p" },
            { active: true, id: "option_l", label: "Licencia", order: 2, value: "l" },
          ],
          order: 4,
          required: false,
          searchable: false,
          type: "MULTISELECT",
          unique: false,
        },
      ],
      records: [
        {
          displayName: "Juan 2026-08-01",
          id: "record_1",
          updatedAt: "2026-08-01T12:00:00.000Z",
          values: {
            marcas: ["p", "l"],
          },
        },
      ],
    });

    expect(table?.rows[0].values).toEqual(["P, L"]);
  });

  it("builds all month days for MATRIX when date columns use MONTH time filter", () => {
    const matrix = buildReportMatrixModel({
      ...baseReport,
      config: {
        entityTypeId: "attendance",
        dateFieldId: "field_date",
        timeFilter: {
          allowChange: true,
          defaultPeriod: "CURRENT_MONTH",
          mode: "MONTH",
        },
        presentationMode: "MATRIX",
        matrix: {
          columnFieldId: "field_date",
          rowFieldId: "field_person",
          valueFieldId: "field_status",
        },
      },
      from: "2026-08-01",
      to: "2026-08-31",
    });

    expect(matrix?.columns).toHaveLength(31);
    expect(matrix?.columns[0]).toEqual({ key: "2026-08-01", label: "01" });
    expect(matrix?.columns[30]).toEqual({ key: "2026-08-31", label: "31" });
    expect(matrix?.rows[0].values["2026-08-01"]).toBe("Presente");
  });

  it("returns null when MATRIX config is incomplete", () => {
    expect(buildReportMatrixModel({
      ...baseReport,
      fields: baseReport.fields.filter((field) => field.id !== "field_status"),
      config: {
        entityTypeId: "attendance",
        dateFieldId: "field_date",
        presentationMode: "MATRIX",
        matrix: {
          columnFieldId: "field_date",
          rowFieldId: "field_person",
          valueFieldId: "field_status",
        },
      },
    })).toBeNull();
  });

  it("builds latest-by-relation rows with configured display fields for procedure versioning", () => {
    const model = buildReportCurrentStatusModel({
      ...baseReport,
      config: {
        entityTypeId: "attendance",
        presentationMode: "LATEST_BY_RELATION",
        latestByRelation: {
          relatedEntityTypeId: "procedures",
          relationFieldId: "field_person",
          requiredValueFieldId: "field_status",
          orderFieldId: "field_date",
          displayFieldIds: ["field_person", "field_version", "field_status", "field_date"],
        },
      },
      fields: [
        relationField("field_person", "procedimiento", "Procedimiento"),
        {
          active: true,
          config: { display: {}, validation: {} },
          id: "field_version",
          key: "version",
          name: "Versión",
          order: 2,
          required: false,
          searchable: false,
          type: "TEXT",
          unique: false,
        },
        baseReport.fields[2],
        baseReport.fields[1],
      ],
      records: [
        {
          displayName: "PET-001 v2",
          id: "record_version",
          updatedAt: "2026-08-10T12:00:00.000Z",
          values: {
            estado: "presente",
            fecha: "2026-08-01",
            procedimiento: { displayName: "PET-001", entityTypeId: "procedures", id: "procedure_1" },
            version: "2.0",
          },
        },
      ],
      subjectEntity: { id: "procedures", name: "Procedimientos", slug: "procedimientos" },
    });

    expect(model).toEqual({
      columns: [
        { id: "field_person", name: "Procedimiento" },
        { id: "field_version", name: "Versión" },
        { id: "field_status", name: "Estado" },
        { id: "field_date", name: "Fecha" },
      ],
      rows: [
        { id: "record_version", values: ["PET-001", "2.0", "Presente", "2026-08-01"] },
      ],
    });
  });

  it("does not use updatedAt as a CURRENT_STATUS date fallback", () => {
    const model = buildReportCurrentStatusModel({
      ...baseReport,
      config: {
        entityTypeId: "attendance",
        presentationMode: "CURRENT_STATUS",
        currentStatus: {
          subjectFieldId: "field_person",
          stateFieldId: "field_status",
        },
      },
    });

    expect(model?.columns.map((column) => column.name)).toEqual(["Persona", "Estado"]);
    expect(model?.rows[0]).toEqual({
      id: "record_1",
      values: ["Juan Perez", "Presente"],
    });
  });

  it("does not require a status field for equipment latest-by-relation reports", () => {
    const model = buildReportCurrentStatusModel({
      ...baseReport,
      config: {
        entityTypeId: "equipment_versions",
        presentationMode: "LATEST_BY_RELATION",
        latestByRelation: {
          relatedEntityTypeId: "equipment",
          relationFieldId: "field_equipment",
          orderFieldId: "field_date",
          displayFieldIds: ["field_equipment", "field_date"],
        },
      },
      fields: [
        relationField("field_equipment", "equipo", "Equipo"),
        baseReport.fields[1],
        baseReport.fields[2],
      ],
      records: [
        {
          displayName: "Excavadora 12 2026-08-01",
          id: "equipment_record_1",
          updatedAt: "2026-08-10T12:00:00.000Z",
          values: {
            equipo: { displayName: "Excavadora 12", entityTypeId: "equipment", id: "equipment_1" },
            estado: "presente",
            fecha: "2026-08-01",
          },
        },
      ],
      subjectEntity: { id: "equipment", name: "Equipos", slug: "equipos" },
    });

    expect(model).toEqual({
      columns: [
        { id: "field_equipment", name: "Equipo" },
        { id: "field_date", name: "Fecha" },
      ],
      rows: [
        { id: "equipment_record_1", values: ["Excavadora 12", "2026-08-01"] },
      ],
    });
  });
});

const baseReport: ReportResponse = {
  appView: {
    id: "view_report",
    name: "Asistencia mensual",
    slug: "asistencia-mensual",
  },
  config: {
    entityTypeId: "attendance",
    dateFieldId: "field_date",
    presentationMode: "TABLE",
    table: {
      defaultSortDirection: "desc",
      visibleFieldIds: ["field_person", "field_date", "field_status"],
    },
  },
  entity: {
    id: "attendance",
    name: "Asistencias",
    slug: "asistencias",
  },
  fields: [
    relationField("field_person", "persona", "Persona"),
    {
      active: true,
      config: { display: {}, validation: {} },
      id: "field_date",
      key: "fecha",
      name: "Fecha",
      order: 2,
      required: true,
      searchable: false,
      type: "DATE",
      unique: false,
    },
    {
      active: true,
      config: { display: {}, validation: {} },
      id: "field_status",
      key: "estado",
      name: "Estado",
      options: [
        { active: true, id: "option_present", label: "Presente", order: 1, value: "presente" },
        { active: true, id: "option_absent", label: "Ausente", order: 2, value: "ausente" },
      ],
      order: 3,
      required: true,
      searchable: false,
      type: "SELECT",
      unique: false,
    },
  ],
  from: "2026-08-01",
  records: [
    {
      displayName: "Juan Perez 2026-08-01",
      id: "record_1",
      updatedAt: "2026-08-01T12:00:00.000Z",
      values: {
        estado: "presente",
        fecha: "2026-08-01",
        persona: { displayName: "Juan Perez", entityTypeId: "people", id: "person_1" },
      },
    },
    {
      displayName: "Juan Perez 2026-08-02",
      id: "record_2",
      updatedAt: "2026-08-02T12:00:00.000Z",
      values: {
        estado: "ausente",
        fecha: "2026-08-02",
        persona: { displayName: "Juan Perez", entityTypeId: "people", id: "person_1" },
      },
    },
  ],
  to: "2026-08-31",
};

function relationField(id: string, key: string, name: string) {
  return {
    active: true,
    config: { display: {}, validation: {} },
    id,
    key,
    name,
    order: 1,
    required: true,
    searchable: true,
    type: "RELATION" as const,
    unique: false,
  };
}
