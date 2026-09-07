import { describe, expect, it } from "vitest";

import { entityDefinitionFixture } from "../../test/fixtures";
import {
  buildStatusSubviewQuery,
  buildStatusSubviewRows,
  hasStatusSubview,
} from "./status-subview";

const definition = {
  ...entityDefinitionFixture,
  fields: [
    ...entityDefinitionFixture.fields,
    {
      active: true,
      config: { display: {}, validation: {} },
      id: "field_date",
      key: "fecha_estado",
      name: "Fecha estado",
      order: 9,
      required: false,
      type: "DATE" as const,
    },
  ],
};

describe("records status subview", () => {
  it("detects configured status subviews", () => {
    expect(hasStatusSubview({ entityTypeId: "entity_1" })).toBe(false);
    expect(hasStatusSubview({
      entityTypeId: "entity_1",
      statusSubview: {
        template: "versioning",
        stateFieldId: "field_2",
      },
    })).toBe(true);
  });

  it("builds server query with fieldId filter and date fieldId sort", () => {
    expect(buildStatusSubviewQuery({
      config: {
        entityTypeId: "entity_1",
        statusSubview: {
          template: "versioning",
          stateFieldId: "field_2",
          dateFieldId: "field_date",
        },
      },
      page: 2,
      pageSize: 25,
      search: "EQ",
    })).toEqual({
      direction: "desc",
      fieldIdHasValue: "field_2",
      page: 2,
      pageSize: 25,
      search: "EQ",
      sort: "fieldId:field_date",
    });
  });

  it("does not substitute missing dateFieldId with audit dates", () => {
    expect(buildStatusSubviewQuery({
      config: {
        entityTypeId: "entity_1",
        statusSubview: {
          template: "versioning",
          stateFieldId: "field_2",
        },
      },
      page: 1,
      pageSize: 25,
    })).toEqual({
      direction: undefined,
      fieldIdHasValue: "field_2",
      page: 1,
      pageSize: 25,
      search: undefined,
      sort: undefined,
    });
  });

  it("shows only records with a populated state and includes date only when configured", () => {
    const rows = buildStatusSubviewRows({
      definition,
      records: [
        {
          displayName: "EQ-001",
          id: "record_1",
          updatedAt: "2026-09-01T10:00:00.000Z",
          values: { estado: "operativo", fecha_estado: "2026-09-01" },
        },
        {
          displayName: "EQ-002",
          id: "record_2",
          updatedAt: "2026-09-02T10:00:00.000Z",
          values: { estado: "", fecha_estado: "2026-09-02" },
        },
      ],
      statusSubview: {
        template: "versioning",
        stateFieldId: "field_2",
        dateFieldId: "field_date",
      },
    });

    expect(rows).toEqual([
      {
        date: "01/09/2026",
        id: "record_1",
        name: "EQ-001",
        state: "Operativo",
      },
    ]);
  });

  it("omits date from rows when no date field is configured", () => {
    expect(buildStatusSubviewRows({
      definition,
      records: [
        {
          displayName: "EQ-001",
          id: "record_1",
          updatedAt: "2026-09-01T10:00:00.000Z",
          values: { estado: "operativo", fecha_estado: "2026-09-01" },
        },
      ],
      statusSubview: {
        template: "versioning",
        stateFieldId: "field_2",
      },
    })).toEqual([
      {
        id: "record_1",
        name: "EQ-001",
        state: "Operativo",
      },
    ]);
  });
});
