import {
  LocalDatabaseStorageState,
  LocalDatabaseUnavailableCause,
} from "../lib/local-db-recovery";

export function getLocalDatabaseRecoveryGuidance(state: LocalDatabaseStorageState) {
  const isAccessHandleBusy = state.status === "unavailable" && state.cause === "ACCESS_HANDLE_BUSY";

  return {
    body: isAccessHandleBusy
      ? "Cierra las otras pestanas o ventanas de Opco Client y luego reintenta. No es necesario restablecer los datos locales."
      : "Puedes reintentar sin borrar nada. Restablecer datos locales elimina la cache de este dispositivo y puede borrar cambios no sincronizados.",
    canRequestDestructiveReset: state.status === "unavailable" && !isAccessHandleBusy,
    isAccessHandleBusy,
    title: isAccessHandleBusy
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
