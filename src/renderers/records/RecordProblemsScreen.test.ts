import { describe, expect, it } from "vitest";

import { RecordsFailedOperationDiagnostics } from "@/lib/offline-records";

import {
  confirmWebRecordProblemAction,
  findRecordProblemOperation,
  getRecordProblemActionState,
} from "./record-problem-actions";

describe("record problem resolution actions", () => {
  it("enables legacy CREATE errors when the local operation exists", () => {
    const state = getRecordProblemActionState({
      connectivityStatus: "online",
      operation: operation("CREATE", "local_1"),
      record: { serverId: null, syncStatus: "failed" },
    });

    expect(state).toMatchObject({
      canDiscard: true,
      canResolve: true,
      reason: null,
    });
  });

  it("enables legacy UPDATE errors when the local operation exists", () => {
    const state = getRecordProblemActionState({
      connectivityStatus: "online",
      operation: operation("UPDATE", "record_1", "record_1"),
      record: { serverId: "record_1", syncStatus: "failed" },
    });

    expect(state).toMatchObject({
      canDiscard: true,
      canResolve: true,
      reason: null,
    });
  });

  it("does not block a legacy CREATE discard while offline", () => {
    const state = getRecordProblemActionState({
      connectivityStatus: "offline",
      operation: operation("CREATE", "local_1"),
      record: { serverId: null, syncStatus: "failed" },
    });

    expect(state.canDiscard).toBe(true);
  });

  it("explains why a legacy UPDATE discard is blocked while offline", () => {
    const state = getRecordProblemActionState({
      connectivityStatus: "offline",
      operation: operation("UPDATE", "record_1", "record_1"),
      record: { serverId: "record_1", syncStatus: "failed" },
    });

    expect(state.canResolve).toBe(true);
    expect(state.canDiscard).toBe(false);
    expect(state.reason).toContain("Conectate");
  });

  it("shows a close action only for orphaned remote-backed notices", () => {
    const state = getRecordProblemActionState({
      connectivityStatus: "online",
      operation: null,
      record: { serverId: "record_1", syncStatus: "failed" },
    });

    expect(state).toMatchObject({
      canCloseOrphan: true,
      canDiscard: false,
      canResolve: false,
    });
  });

  it("does not expose a fake action for orphaned local drafts", () => {
    const state = getRecordProblemActionState({
      connectivityStatus: "online",
      operation: null,
      record: { serverId: null, syncStatus: "failed" },
    });

    expect(state.canCloseOrphan).toBe(false);
    expect(state.canDiscard).toBe(false);
    expect(state.canResolve).toBe(false);
    expect(state.reason).toContain("operacion local pendiente");
  });

  it("does not run a web-confirmed action when confirm is cancelled", () => {
    let calls = 0;

    const accepted = confirmWebRecordProblemAction({
      getWindow: () => ({
        confirm: () => {
          calls += 1;
          return false;
        },
      }),
      message: "Mensaje",
      title: "Titulo",
    });

    expect(accepted).toBe(false);
    expect(calls).toBe(1);
  });

  it("runs a web-confirmed action only once when confirm is accepted", () => {
    let calls = 0;

    const accepted = confirmWebRecordProblemAction({
      getWindow: () => ({
        confirm: () => {
          calls += 1;
          return true;
        },
      }),
      message: "Mensaje",
      title: "Titulo",
    });

    expect(accepted).toBe(true);
    expect(calls).toBe(1);
  });

  it("does not access window when it is unavailable", () => {
    expect(confirmWebRecordProblemAction({
      getWindow: () => undefined,
      message: "Mensaje",
      title: "Titulo",
    })).toBe(false);
  });

  it("matches operations by entity and local record id", () => {
    const staleOperation = operation("UPDATE", "record_1", "record_1");
    const currentOperation = {
      ...operation("CREATE", "record_1"),
      entityTypeId: "entity_2",
    };

    expect(findRecordProblemOperation({
      entityTypeId: "entity_2",
      operations: [staleOperation, currentOperation],
      record: { localId: "record_1" },
    })).toBe(currentOperation);
  });
});

function operation(
  operationType: RecordsFailedOperationDiagnostics["operation"],
  localRecordId: string,
  serverRecordId: string | null = null,
): RecordsFailedOperationDiagnostics {
  return {
    entityTypeId: "entity_1",
    hasStructuredDetails: false,
    lastErrorCode: "INVALID_RELATION",
    lastErrorDetails: null,
    lastErrorMessage: "RUT debe ser unico dentro de este tipo de entidad.",
    lastHttpStatus: 400,
    localRecordId,
    manualRetryToken: `records:${localRecordId}`,
    manualRetryable: true,
    operation: operationType,
    retryCount: 1,
    serverRecordId,
    syncErrorCode: "INVALID_RELATION",
    syncErrorMessage: "RUT debe ser unico dentro de este tipo de entidad.",
    syncStatus: "failed",
    updatedAt: "2026-09-14T12:00:00.000Z",
  };
}
