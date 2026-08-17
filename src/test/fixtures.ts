import { AppView, EntityDefinition } from "@/lib/opco-api";

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
        display: {},
        validation: {},
      },
      id: "field_4",
      key: "cantidad",
      name: "Cantidad",
      order: 4,
      required: false,
      type: "INTEGER",
    },
    {
      active: true,
      config: {
        display: {},
        validation: {},
      },
      id: "field_5",
      key: "critico",
      name: "Critico",
      order: 5,
      required: false,
      type: "BOOLEAN",
    },
    {
      active: true,
      config: {
        display: {},
        validation: {},
      },
      id: "field_6",
      key: "tags",
      name: "Tags",
      options: [
        {
          active: true,
          id: "option_2",
          label: "Norte",
          order: 1,
          value: "norte",
        },
        {
          active: true,
          id: "option_3",
          label: "Sur",
          order: 2,
          value: "sur",
        },
      ],
      order: 6,
      required: false,
      type: "MULTISELECT",
    },
    {
      active: true,
      config: {
        display: {},
        validation: {},
      },
      id: "field_7",
      key: "responsable",
      name: "Responsable",
      order: 7,
      required: false,
      type: "RELATION",
    },
    {
      active: true,
      config: {
        display: {},
        validation: {},
      },
      id: "field_8",
      key: "foto",
      name: "Foto",
      order: 8,
      required: false,
      type: "IMAGE",
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
    responsable: {
      displayName: "Ana",
      entityTypeId: "entity_people",
      id: "person_1",
    },
    tags: ["norte"],
  },
};

export const appViewsFixture: AppView[] = [
  {
    config: {
      entityTypeId: "entity_1",
    },
    icon: "warehouse",
    id: "view_records",
    name: "Maestro de Equipos",
    slug: "maestro-equipos",
    sortOrder: 2,
    type: "RECORDS",
  },
  {
    config: {},
    icon: "workflow",
    id: "view_workflow",
    name: "Flujo de Mantencion",
    slug: "flujo-mantencion",
    sortOrder: 1,
    type: "WORKFLOW",
  },
  {
    config: {},
    icon: "board",
    id: "view_board",
    name: "Tablero Operacional",
    slug: "tablero-operacional",
    sortOrder: 3,
    type: "BOARD",
  },
  {
    config: {},
    icon: "dashboard",
    id: "view_dashboard",
    name: "Indicadores",
    slug: "indicadores",
    sortOrder: 4,
    type: "DASHBOARD",
  },
];
