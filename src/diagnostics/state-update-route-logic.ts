import { LocalDatabaseStorageState } from "@/lib/local-db-recovery";

type DiagnosticsSessionStatus = "loading" | "anonymous" | "authenticated" | "offline";

export type StateUpdateDiagnosticsRouteState =
  | {
      message: "Cargando sesion...";
      ready: false;
      reason: "session";
    }
  | {
      message: "Abriendo datos locales...";
      ready: false;
      reason: "sqlite";
    }
  | {
      message: "Esperando contexto local...";
      ready: false;
      reason: "owner";
    }
  | {
      message: "Esperando contrato seleccionado...";
      ready: false;
      reason: "contract";
    }
  | {
      message: "Diagnostico listo";
      ownerKey: string;
      ready: true;
      selectedContractId: string;
    };

export function getStateUpdateDiagnosticsRouteState({
  localDatabaseStorageState,
  ownerKey,
  selectedContractId,
  status,
}: {
  localDatabaseStorageState: LocalDatabaseStorageState;
  ownerKey: string | null;
  selectedContractId: string | null;
  status: DiagnosticsSessionStatus;
}): StateUpdateDiagnosticsRouteState {
  if (status === "loading" || status === "anonymous") {
    return {
      message: "Cargando sesion...",
      ready: false,
      reason: "session",
    };
  }

  if (localDatabaseStorageState.status !== "ready") {
    return {
      message: "Abriendo datos locales...",
      ready: false,
      reason: "sqlite",
    };
  }

  if (!ownerKey) {
    return {
      message: "Esperando contexto local...",
      ready: false,
      reason: "owner",
    };
  }

  if (!selectedContractId) {
    return {
      message: "Esperando contrato seleccionado...",
      ready: false,
      reason: "contract",
    };
  }

  return {
    message: "Diagnostico listo",
    ownerKey,
    ready: true,
    selectedContractId,
  };
}
