import { ConnectivityStatus } from "@/lib/connectivity";
import { CachedEntityRecord, RecordsFailedOperationDiagnostics } from "@/lib/offline-records";

export function confirmWebRecordProblemAction({
  getWindow,
  message,
  title,
}: {
  getWindow: () => Pick<Window, "confirm"> | undefined;
  message: string;
  title: string;
}) {
  const currentWindow = getWindow();

  return currentWindow ? currentWindow.confirm(`${title}\n\n${message}`) : false;
}

export function findRecordProblemOperation({
  entityTypeId,
  operations,
  record,
}: {
  entityTypeId: string;
  operations: RecordsFailedOperationDiagnostics[];
  record: Pick<CachedEntityRecord, "localId">;
}) {
  return operations.find((operation) =>
    operation.entityTypeId === entityTypeId &&
    operation.localRecordId === record.localId
  ) ?? null;
}

export function getRecordProblemActionState({
  connectivityStatus,
  operation,
  record,
}: {
  connectivityStatus: ConnectivityStatus;
  operation: RecordsFailedOperationDiagnostics | null;
  record: Pick<CachedEntityRecord, "serverId" | "syncStatus">;
}) {
  if (record.syncStatus !== "failed") {
    return {
      canCloseOrphan: false,
      canDiscard: false,
      canResolve: false,
      reason: null,
    };
  }

  if (!operation) {
    if (record.serverId) {
      return {
        canCloseOrphan: true,
        canDiscard: false,
        canResolve: false,
        reason: "No encontramos una operacion local pendiente para este aviso.",
      };
    }

    return {
      canCloseOrphan: false,
      canDiscard: false,
      canResolve: false,
      reason: "No encontramos una operacion local pendiente. Este borrador no se cerrara automaticamente.",
    };
  }

  if (operation.operation === "UPDATE" && connectivityStatus === "offline") {
    return {
      canCloseOrphan: false,
      canDiscard: false,
      canResolve: true,
      reason: "Conectate para recuperar la version del servidor antes de descartar cambios locales.",
    };
  }

  return {
    canCloseOrphan: false,
    canDiscard: true,
    canResolve: true,
    reason: null,
  };
}
