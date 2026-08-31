import { describe, expect, it } from "vitest";

import { appViewsFixture } from "../test/fixtures";
import { resolveAppShellPersistentFeedback, type AppShellFeedbackInput } from "./app-shell-feedback";
import { getHomeExperienceAvailabilityLabel, getHomeExperienceCards } from "./home-experiences";

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
    expect(getHomeExperienceAvailabilityLabel("data-not-cached")).toBe(
      "Configuracion disponible; datos aun no descargados",
    );
  });
});
