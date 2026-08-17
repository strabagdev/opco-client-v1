import { describe, expect, it } from "vitest";

import {
  buildEntityRecordHref,
  buildRecordListItem,
  getRecordDetailFields,
  getRecordListFields,
} from "./entity-record-display";
import { EntityDefinition, EntityRecord } from "./opco-api";
import { entityDefinitionFixture, entityRecordFixture } from "../test/fixtures";

describe("entity record display", () => {
  it("uses configured showInList fields and excludes the primary field", () => {
    const fields = getRecordListFields(entityDefinitionFixture);

    expect(fields.map((field) => field.key)).toEqual(["estado"]);
  });

  it("falls back to a small active field selection without display config", () => {
    const definition: EntityDefinition = {
      ...entityDefinitionFixture,
      fields: [
        field({ key: "nombre", name: "Nombre", order: 1, type: "TEXT" }),
        field({ key: "rut", name: "RUT", order: 2, type: "TEXT" }),
        field({ key: "descripcion", name: "Descripcion", order: 3, type: "TEXTAREA" }),
        field({ key: "activo", name: "Activo", order: 4, type: "BOOLEAN" }),
        field({ key: "archivo", name: "Archivo", order: 5, type: "FILE" }),
        field({ key: "fecha", name: "Fecha", order: 6, type: "DATE" }),
      ],
    };

    expect(getRecordListFields(definition).map((item) => item.key)).toEqual(["nombre", "rut", "activo"]);
  });

  it("builds dynamic list items with displayName, labels, formatted values, and detail href", () => {
    const item = buildRecordListItem({
      definition: entityDefinitionFixture,
      record: entityRecordFixture,
    });

    expect(item).toEqual({
      fields: [
        {
          key: "estado",
          label: "Estado",
          value: "Operativo",
        },
      ],
      href: "/entity/entity_1/record/record_1",
      id: "record_1",
      title: "EQ-001",
    });
  });

  it("supports entity pages without records", () => {
    const records: EntityRecord[] = [];

    expect(records.map((record) => buildRecordListItem({ definition: entityDefinitionFixture, record }))).toEqual([]);
  });

  it("builds navigation hrefs for record detail", () => {
    expect(buildEntityRecordHref("entity 1", "record/1")).toBe("/entity/entity%201/record/record%2F1");
  });

  it("uses definition labels when rendering detail values", () => {
    expect(getRecordDetailFields(entityDefinitionFixture, entityRecordFixture)).toEqual([
      {
        key: "codigo",
        label: "Codigo",
        value: "EQ-001",
      },
      {
        key: "estado",
        label: "Estado",
        value: "Operativo",
      },
      {
        key: "observaciones",
        label: "Observaciones",
        value: "Equipo en terreno",
      },
      {
        key: "tags",
        label: "Tags",
        value: "Norte",
      },
      {
        key: "responsable",
        label: "Responsable",
        value: "Ana",
      },
    ]);
  });
});

function field({
  key,
  name,
  order,
  type,
}: {
  key: string;
  name: string;
  order: number;
  type: string;
}) {
  return {
    active: true,
    config: {
      display: {},
      validation: {},
    },
    id: `field_${key}`,
    key,
    name,
    order,
    required: false,
    type,
  };
}
