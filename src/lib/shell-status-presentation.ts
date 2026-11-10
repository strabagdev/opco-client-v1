import type { AppShellStatusIndicator } from "./app-shell-feedback";

/** Wording/paint only. The existing shell resolver remains the source of activity and priority. */
export function shellStatusPresentation(indicator: AppShellStatusIndicator, input: {
  conflicts: number;
  hasSyncError: boolean;
  hasReadError: boolean;
  storageRecovery: boolean;
}) {
  if (indicator.state === "online" && indicator.label === "Listo") {
    // Idle is not an ACK and does not certify that every record is synchronized or prepared.
    return { label: "Sin operaciones en curso", neutral: true };
  }
  if (indicator.state === "error") {
    if (input.storageRecovery) return { label: "Revisar datos locales", neutral: false };
    if (input.hasSyncError && input.conflicts > 0) return { label: "Errores y conflictos pendientes", neutral: false };
    if (input.hasSyncError) return { label: "Error al enviar cambios", neutral: false };
    if (input.conflicts > 0 && !input.hasReadError) return { label: input.conflicts === 1 ? "1 conflicto pendiente" : `${input.conflicts} conflictos pendientes`, neutral: false };
  }
  return { label: indicator.label, neutral: false };
}
