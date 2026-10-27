import {
  LocalDatabaseStorageState,
  LocalDatabaseUnavailableCause,
} from "../lib/local-db-recovery";
import type { OpfsOpeningRecoveryStatus } from "../lib/opfs-opening-recovery";

export function getLocalDatabaseRecoveryGuidance(state: LocalDatabaseStorageState, automatic: OpfsOpeningRecoveryStatus = "idle") {
  const isAccessHandleBusy = state.status === "unavailable" && state.cause === "ACCESS_HANDLE_BUSY";
  const reloadOnRetry = isAccessHandleBusy && state.retryRequiresReload === true;

  return {
    body: reloadOnRetry && (automatic === "waiting" || automatic === "reloading")
      ? "Otra pestaña está usando los datos locales. Esperaremos a que los libere y recargaremos esta página automáticamente para continuar. No se borrarán datos ni cambios pendientes. Si la espera no termina, cierra las otras ventanas y pulsa Reintentar: también recargará esta página."
      : reloadOnRetry && automatic === "manual"
      ? "No pudimos completar la recuperación automática. Cierra las otras pestañas o ventanas de Opco Client y pulsa Reintentar: se recargará esta página. Se conservarán los datos guardados y los cambios pendientes."
      : reloadOnRetry
      ? "Cierra las otras pestañas o ventanas de Opco Client. Al pulsar Reintentar se recargará esta página para abrir de nuevo los datos locales. No se borrarán los datos guardados ni los cambios pendientes."
      : isAccessHandleBusy
      ? "Cierra las otras pestanas o ventanas de Opco Client y luego reintenta. No es necesario restablecer los datos locales."
      : "Puedes reintentar sin borrar nada. Restablecer datos locales elimina la cache de este dispositivo y puede borrar cambios no sincronizados.",
    canRequestDestructiveReset: state.status === "unavailable" && !isAccessHandleBusy,
    isAccessHandleBusy,
    reloadOnRetry,
    title: reloadOnRetry && (automatic === "waiting" || automatic === "reloading")
      ? "Esperando acceso a los datos locales"
      : isAccessHandleBusy
      ? "Opco Client ya esta abierto en otra pestana."
      : "No pudimos abrir los datos guardados en este dispositivo.",
  };
}

export function getLocalDatabaseFailurePhase(cause: LocalDatabaseUnavailableCause) {
  if (cause === "ACCESS_HANDLE_BUSY") {
    return "OPFS Access Handle";
  }

  if (cause === "OPEN_FAILED" || cause === "STORAGE_UNAVAILABLE" || cause === "CORRUPTION_SUSPECTED") {
    return "openDatabaseAsync";
  }

  if (cause === "MIGRATION_FAILED") {
    return "migration";
  }

  return "unknown";
}
