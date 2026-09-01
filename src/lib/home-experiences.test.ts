import { describe, expect, it } from "vitest";

import { appViewsFixture } from "../test/fixtures";
import { resolveAppShellPersistentFeedback, type AppShellFeedbackInput } from "./app-shell-feedback";
import {
  getHomeExperienceAvailabilityLabel,
  getHomeExperienceCards,
  getHomeExperienceSection,
  getHomeExperienceSections,
} from "./home-experiences";
import type { AppView } from "./opco-api";

const baseFeedbackInput: AppShellFeedbackInput = {
  connectivityStatus: "online",
  hasConflict: false,
  hasError: false,
  isAuthSessionRestoring: false,
  isOfflinePreparationRunning: false,
  isOperationalCoreReadinessChecking: false,
  isPendingWorkSyncing: false,
  localStorageRecoveryNotice: null,
  offlineReadiness: "ready",
  pendingCount: 0,
};

describe("Home experience offline presentation", () => {
  it("keeps the global offline feedback visible", () => {
    expect(resolveAppShellPersistentFeedback({
      ...baseFeedbackInput,
      connectivityStatus: "offline",
    })?.message).toBe("Modo sin conexion");
  });

  it("keeps card navigation and metadata while omitting ready-offline labels", () => {
    const cards = getHomeExperienceCards(appViewsFixture, {
      view_board: "ready",
      view_dashboard: "ready",
      view_records: "ready",
      view_workflow: "ready",
    });

    expect(cards.map((card) => ({
      availabilityLabel: card.availabilityLabel,
      href: card.href,
      metadata: card.metadata,
      name: card.appView.name,
    }))).toEqual([
      {
        availabilityLabel: null,
        href: "/view/view_records",
        metadata: "Registros",
        name: "Maestro de Equipos",
      },
      {
        availabilityLabel: null,
        href: "/view/view_workflow",
        metadata: "Flujo",
        name: "Tomar asistencia",
      },
      {
        availabilityLabel: null,
        href: "/view/view_board",
        metadata: "Tablero",
        name: "Tablero Operacional",
      },
      {
        availabilityLabel: null,
        href: "/view/view_dashboard",
        metadata: "Dashboard",
        name: "Indicadores",
      },
    ]);
  });

  it("hides the ready-offline label on experience cards", () => {
    expect(getHomeExperienceAvailabilityLabel("ready")).toBeNull();
  });

  it("keeps exception labels so navigation availability can remain explicit", () => {
    expect(getHomeExperienceAvailabilityLabel("online-only")).toBe("Requiere conexion");
    expect(getHomeExperienceAvailabilityLabel("definition-missing")).toBe("Requiere conexion para preparar datos");
    expect(getHomeExperienceAvailabilityLabel("data-partial")).toBe("Datos offline parciales");
    expect(getHomeExperienceAvailabilityLabel("data-not-cached")).toBe(
      "Datos aun no disponibles sin conexion",
    );
  });
});

describe("Home experience sections", () => {
  it("classifies experiences by AppView type", () => {
    expect(getHomeExperienceSection("RECORDS").title).toBe("Registros");
    expect(getHomeExperienceSection("WORKFLOW").title).toBe("Flujos");
    expect(getHomeExperienceSection("REPORT").title).toBe("Análisis");
    expect(getHomeExperienceSection("DASHBOARD").title).toBe("Análisis");
    expect(getHomeExperienceSection("BOARD").title).toBe("Análisis");
  });

  it("groups cards in section order while preserving card order inside each section", () => {
    const cards = getHomeExperienceCards(sectionViews, {});
    const sections = getHomeExperienceSections(cards);

    expect(sections.map((section) => section.title)).toEqual(["Registros", "Flujos", "Análisis"]);
    expect(sections.map((section) => section.cards.map((card) => card.appView.name))).toEqual([
      ["Registro Personas"],
      ["Registro de Asistencia"],
      ["Reporte de Asistencia", "Dashboard Ejecutivo", "Tablero Operacional"],
    ]);
  });

  it("omits empty sections", () => {
    const cards = getHomeExperienceCards([
      view("view_report", "REPORT", "Reporte de Asistencia"),
    ], {});

    expect(getHomeExperienceSections(cards).map((section) => section.title)).toEqual(["Análisis"]);
  });

  it("keeps unknown AppView types visible in the analytics section", () => {
    const cards = getHomeExperienceCards([
      view("view_unknown", "UNKNOWN", "Experiencia futura"),
    ] as AppView[], {});
    const sections = getHomeExperienceSections(cards);

    expect(sections.map((section) => section.title)).toEqual(["Análisis"]);
    expect(sections[0].cards[0].appView.name).toBe("Experiencia futura");
    expect(sections[0].cards[0].metadata).toBe("Experiencia");
  });
});

const sectionViews = [
  view("view_workflow", "WORKFLOW", "Registro de Asistencia"),
  view("view_report", "REPORT", "Reporte de Asistencia"),
  view("view_records", "RECORDS", "Registro Personas"),
  view("view_dashboard", "DASHBOARD", "Dashboard Ejecutivo"),
  view("view_board", "BOARD", "Tablero Operacional"),
];

function view(id: string, type: string, name: string): AppView {
  return {
    config: type === "REPORT"
      ? {
        dateFieldId: "field_date",
        entityTypeId: "entity_attendance",
        presentationMode: "TABLE",
        table: {
          defaultSortDirection: "asc",
          visibleFieldIds: ["field_status"],
        },
      }
      : type === "RECORDS"
        ? { entityTypeId: "entity_people" }
        : {},
    icon: null,
    id,
    name,
    slug: id,
    sortOrder: 1,
    type,
  } as AppView;
}
