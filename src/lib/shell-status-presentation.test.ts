import { describe, expect, it } from "vitest";
import { shellStatusPresentation } from "./shell-status-presentation";
import type { AppShellStatusIndicator } from "./app-shell-feedback";
const context = { conflicts: 0, hasSyncError: false, hasReadError: false, storageRecovery: false };
const indicator = (state: AppShellStatusIndicator["state"], label: string): AppShellStatusIndicator => ({ state, label, accessibilityLabel: label });
describe("shell status wording preserves the existing resolver's meaning", () => {
  it("does not certify synchronization or coverage merely because no activity is running", () => {
    expect(shellStatusPresentation(indicator("online", "Listo"), context)).toEqual({ label: "Sin operaciones en curso", neutral: true });
  });
  it.each(["Cambios sincronizados", "Guardado en este dispositivo", "Actualizando datos", "Preparando datos", "Sin conexión", "2 cambios pendientes"]) ("keeps the resolver wording %s", label => {
    expect(shellStatusPresentation(indicator("pending", label), context)).toEqual({ label, neutral: false });
  });
  it("names a known conflict without calling it a connection failure", () => {
    expect(shellStatusPresentation(indicator("error", "Revisar"), { ...context, conflicts: 1 }).label).toBe("1 conflicto pendiente");
  });
  it("does not mask a retained read error with a conflict count", () => {
    expect(shellStatusPresentation(indicator("error", "No se pudo actualizar"), { ...context, conflicts: 2, hasReadError: true }).label).toBe("No se pudo actualizar");
  });
  it("distinguishes send failures, combined problems and local recovery", () => {
    expect(shellStatusPresentation(indicator("error", "Revisar"), { ...context, hasSyncError: true }).label).toBe("Error al enviar cambios");
    expect(shellStatusPresentation(indicator("error", "Revisar"), { ...context, hasSyncError: true, conflicts: 2 }).label).toBe("Errores y conflictos pendientes");
    expect(shellStatusPresentation(indicator("error", "Revisar"), { ...context, storageRecovery: true }).label).toBe("Revisar datos locales");
  });
});
