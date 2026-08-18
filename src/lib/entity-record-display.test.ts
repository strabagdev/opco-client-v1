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

  it("includes every configured showInList field even after the first four", () => {
    const definition: EntityDefinition = {
      ...entityDefinitionFixture,
      fields: [
        field({
          config: { display: { primary: true, showInList: true }, validation: {} },
          key: "numero",
          name: "Numero",
          order: 1,
          type: "TEXT",
        }),
        field({
          config: { display: { showInList: true }, validation: {} },
          key: "fecha_de_inicio",
          name: "Fecha de inicio",
          order: 2,
          type: "DATE",
        }),
        field({
          config: { display: { showInList: true }, validation: {} },
          key: "fecha_de_termino",
          name: "Fecha de termino",
          order: 3,
          type: "DATE",
        }),
        field({
          config: { display: { showInList: true }, validation: {} },
          key: "monto_neto",
          name: "Monto neto",
          order: 4,
          type: "MONEY",
        }),
        field({
          config: { display: { showInList: true }, validation: {} },
          key: "estado",
          name: "Estado",
          order: 5,
          type: "TEXT",
        }),
        field({
          config: { display: { showInList: true }, validation: {} },
          key: "hes",
          name: "HES",
          order: 6,
          type: "TEXT",
        }),
      ],
    };

    expect(getRecordListFields(definition).map((item) => item.key)).toEqual([
      "fecha_de_inicio",
      "fecha_de_termino",
      "monto_neto",
      "estado",
      "hes",
    ]);
  });

  it("falls back to four useful active fields without display config", () => {
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

    expect(getRecordListFields(definition).map((item) => item.key)).toEqual(["nombre", "rut", "activo", "fecha"]);
  });

  it("omits empty configured values from a card without dropping populated records", () => {
    const definition: EntityDefinition = {
      ...entityDefinitionFixture,
      fields: [
        field({
          config: { display: { primary: true, showInList: true }, validation: {} },
          key: "numero",
          name: "Numero",
          order: 1,
          type: "TEXT",
        }),
        field({
          config: { display: { showInList: true }, validation: {} },
          key: "hes",
          name: "HES",
          order: 2,
          type: "TEXT",
        }),
      ],
    };

    expect(
      buildRecordListItem({
        definition,
        record: {
          displayName: "EDP-001",
          id: "record_1",
          values: { hes: null, numero: "EDP-001" },
        },
      }).fields,
    ).toEqual([]);
    expect(
      buildRecordListItem({
        definition,
        record: {
          displayName: "EDP-002",
          id: "record_2",
          values: { hes: "HES-123", numero: "EDP-002" },
        },
      }).fields,
    ).toEqual([{ key: "hes", label: "HES", value: "HES-123" }]);
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
  config = {
    display: {},
    validation: {},
  },
  key,
  name,
  order,
  type,
}: {
  config?: Record<string, unknown>;
  key: string;
  name: string;
  order: number;
  type: string;
}) {
  return {
    active: true,
    config,
    id: `field_${key}`,
    key,
    name,
    order,
    required: false,
    type,
  };
}
