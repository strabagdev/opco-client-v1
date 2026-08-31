import { describe, expect, it } from "vitest";

import { ReportResponse } from "@/lib/opco-api";

import { buildReportMatrixModel, buildReportTableModel } from "./report-renderer-logic";

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
    {
      active: true,
      config: { display: {}, validation: {} },
      id: "field_person",
      key: "persona",
      name: "Persona",
      order: 1,
      required: true,
      searchable: true,
      type: "RELATION",
      unique: false,
    },
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
