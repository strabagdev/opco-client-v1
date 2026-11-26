import {
  LOCAL_MIGRATION_AMBIGUOUS_CODE,
  LocalDatabaseStorageState,
  LocalDatabaseUnavailableCause,
} from "../lib/local-db-recovery";
import type { OpfsOpeningRecoveryStatus } from "../lib/opfs-opening-recovery";

export function getLocalDatabaseRecoveryGuidance(state: LocalDatabaseStorageState, automatic: OpfsOpeningRecoveryStatus = "idle") {
  const isAccessHandleBusy = state.status === "unavailable" && state.cause === "ACCESS_HANDLE_BUSY";
  const isCloseFailure = state.status === "unavailable" && state.cause === "CLOSE_FAILED";
  const ambiguousMigration = state.status === "unavailable" && state.cause === "MIGRATION_FAILED" &&
    state.technicalMessage.startsWith(LOCAL_MIGRATION_AMBIGUOUS_CODE + ":");
  const reloadOnRetry = (isAccessHandleBusy || isCloseFailure) && state.retryRequiresReload === true;

  return {
    body: ambiguousMigration
      ? "No pudimos verificar una conversión de los datos locales. Se conservaron las tablas y los cambios pendientes. Puedes reintentar sin borrar datos; si el problema continúa, revisa el diagnóstico antes de continuar."
      : isCloseFailure
      ? reloadOnRetry
        ? "No pudimos confirmar el cierre de los datos locales. El formulario se conserva en memoria, pero las operaciones con datos locales están bloqueadas. Reintentar permite revisar la recarga de esta página para abrir la misma base. Recargar pierde los cambios sin guardar; los registros ya guardados y sus pendientes se conservan."
        : "No pudimos confirmar el cierre de los datos locales. El formulario se conserva en memoria mientras la aplicación siga abierta. Para recuperar, cierra y vuelve a abrir la aplicación; esto perderá los cambios sin guardar. Los registros ya guardados y sus pendientes se conservan. No borres datos ni repitas el guardado para intentar recuperarlos."
      : reloadOnRetry && (automatic === "waiting" || automatic === "reloading")
      ? "Otra pestaña está usando los datos locales. Esperaremos a que los libere y recargaremos esta página automáticamente para continuar. No se borrarán datos ni cambios pendientes. Si la espera no termina, cierra las otras ventanas y pulsa Reintentar: también recargará esta página."
      : reloadOnRetry && automatic === "manual"
      ? "No pudimos completar la recuperación automática. Cierra las otras pestañas o ventanas de Opco Client y pulsa Reintentar: se recargará esta página. Se conservarán los datos guardados y los cambios pendientes."
      : reloadOnRetry
      ? "Cierra las otras pestañas o ventanas de Opco Client. Al pulsar Reintentar se recargará esta página para abrir de nuevo los datos locales. No se borrarán los datos guardados ni los cambios pendientes."
      : isAccessHandleBusy
      ? "Cierra las otras pestanas o ventanas de Opco Client y luego reintenta. No es necesario restablecer los datos locales."
      : "Puedes reintentar sin borrar nada. Restablecer datos locales elimina la cache de este dispositivo y puede borrar cambios no sincronizados.",
    canRequestDestructiveReset: state.status === "unavailable" && state.destructiveRecoveryAvailable && !isAccessHandleBusy && !isCloseFailure,
    isAccessHandleBusy,
    preserveMountedContent: isCloseFailure,
    reloadConfirmation: isCloseFailure && reloadOnRetry ? {
      title: "¿Recargar Opco Client?",
      body: "Se recargará toda la página. Los cambios sin guardar del formulario se perderán. Los registros ya guardados y sus operaciones pendientes se conservarán. Cancelar mantiene el formulario en memoria; las operaciones con datos locales seguirán bloqueadas.",
    } : null,
    reloadOnRetry,
    title: isCloseFailure
      ? "Es necesario volver a abrir los datos locales"
      : reloadOnRetry && (automatic === "waiting" || automatic === "reloading")
      ? "Esperando acceso a los datos locales"
      : isAccessHandleBusy
      ? "Opco Client ya esta abierto en otra pestana."
      : "No pudimos abrir los datos guardados en este dispositivo.",
  };
}

export function getLocalDatabaseFailurePhase(cause: LocalDatabaseUnavailableCause) {
  if (cause === "CLOSE_FAILED") return "closeAsync";
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
