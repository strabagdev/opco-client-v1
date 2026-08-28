import { describe, expect, it } from "vitest";

import { getOfflineAvailabilityText } from "./app-view-offline-readiness";

describe("AppView offline availability labels", () => {
  it("uses the offline-ready label only when definition and data are ready", () => {
    expect(getOfflineAvailabilityText("ready")).toBe("Disponible sin conexion");
  });

  it("uses an honest partial label when only configuration is available", () => {
    expect(getOfflineAvailabilityText("data-not-cached")).toBe(
      "Configuracion disponible; datos aun no descargados",
    );
  });

  it("requires connection when definition/data are not prepared", () => {
    expect(getOfflineAvailabilityText("definition-missing")).toBe("Requiere conexion para preparar datos");
  });
});
