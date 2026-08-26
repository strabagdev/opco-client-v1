import { describe, expect, it } from "vitest";

import { getStateUpdateDiagnosticsRouteState } from "./state-update-route-logic";

describe("state update diagnostics route readiness", () => {
  it("does not allow DB diagnostics while the owner is unavailable", () => {
    const state = getStateUpdateDiagnosticsRouteState({
      localDatabaseStorageState: readyStorage(),
      ownerKey: null,
      selectedContractId: "contract_1",
      status: "authenticated",
    });

    expect(state).toEqual({
      message: "Esperando contexto local...",
      ready: false,
      reason: "owner",
    });
  });

  it("waits for SQLite before reading persisted operations", () => {
    const state = getStateUpdateDiagnosticsRouteState({
      localDatabaseStorageState: {
        destructiveRecoveryAvailable: false,
        errorCode: null,
        retryable: false,
        status: "initializing",
      },
      ownerKey: "org_1:user_1",
      selectedContractId: "contract_1",
      status: "offline",
    });

    expect(state).toMatchObject({
      message: "Abriendo datos locales...",
      ready: false,
      reason: "sqlite",
    });
  });

  it("uses the active owner and contract only after authenticated bootstrap is ready", () => {
    const state = getStateUpdateDiagnosticsRouteState({
      localDatabaseStorageState: readyStorage(),
      ownerKey: "org_1:user_1",
      selectedContractId: "contract_1",
      status: "authenticated",
    });

    expect(state).toEqual({
      message: "Diagnostico listo",
      ownerKey: "org_1:user_1",
      ready: true,
      selectedContractId: "contract_1",
    });
  });

  it("keeps the dedicated route gated behind session readiness instead of relying on a query param", () => {
    const state = getStateUpdateDiagnosticsRouteState({
      localDatabaseStorageState: readyStorage(),
      ownerKey: "org_1:user_1",
      selectedContractId: "contract_1",
      status: "loading",
    });

    expect(state).toMatchObject({
      message: "Cargando sesion...",
      ready: false,
      reason: "session",
    });
  });
});

function readyStorage() {
  return {
    destructiveRecoveryAvailable: false,
    errorCode: null,
    retryable: false,
    status: "ready" as const,
  } as const;
}
