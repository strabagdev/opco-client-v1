import { describe, expect, it } from "vitest";

import { getOfflineAvailabilityText } from "./app-view-offline-readiness";

describe("AppView offline availability labels", () => {
  it("uses the offline-ready label only when definition and data are ready", () => {
    expect(getOfflineAvailabilityText("ready")).toBe("Disponible sin conexion");
  });

  it("uses an honest partial label when only configuration is available", () => {
    expect(getOfflineAvailabilityText("data-not-cached")).toBe(
      "Datos aun no disponibles sin conexion",
    );
  });

  it("uses a discrete partial label when some Attendance days are available", () => {
    expect(getOfflineAvailabilityText("data-partial")).toBe("Datos offline parciales");
  });

  it("requires connection when definition/data are not prepared", () => {
    expect(getOfflineAvailabilityText("definition-missing")).toBe("Requiere conexion para preparar datos");
  });
});
