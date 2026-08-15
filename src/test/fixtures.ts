import { EntityDefinition } from "@/lib/opco-api";

export const entityDefinitionFixture: EntityDefinition = {
  active: true,
  fields: [
    {
      active: true,
      config: {
        display: {
          primary: true,
          showInList: true,
        },
        validation: {},
      },
      id: "field_1",
      key: "codigo",
      name: "Codigo",
      order: 1,
      required: true,
      searchable: true,
      type: "TEXT",
    },
    {
      active: true,
      config: {
        display: {
          showInList: true,
        },
        validation: {},
      },
      id: "field_2",
      key: "estado",
      name: "Estado",
      options: [
        {
          active: true,
          id: "option_1",
          label: "Operativo",
          order: 1,
          value: "operativo",
        },
      ],
      order: 2,
      required: false,
      searchable: true,
      type: "SELECT",
    },
    {
      active: true,
      config: {
        display: {},
        validation: {},
      },
      id: "field_3",
      key: "observaciones",
      name: "Observaciones",
      order: 3,
      required: false,
      type: "TEXTAREA",
    },
  ],
  icon: "warehouse",
  id: "entity_1",
  name: "Equipos",
  slug: "equipos",
};

export const entityRecordFixture = {
  displayName: "EQ-001",
  id: "record_1",
  values: {
    codigo: "EQ-001",
    estado: "operativo",
    observaciones: "Equipo en terreno",
  },
};
