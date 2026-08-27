import type { StateUpdateSyncResult } from "@/sync/state-update-sync";

export function shouldEmitStateUpdateRefresh(input: {
  result: StateUpdateSyncResult;
  selectedOperations: number;
}) {
  return input.selectedOperations > 0 || stateUpdateSyncResultTotal(input.result) > 0;
}

export function shouldHandleStateUpdateRefresh(input: {
  currentKey: number;
  previousKey: number;
}) {
  return input.currentKey > 0 && input.currentKey !== input.previousKey;
}

function stateUpdateSyncResultTotal(result: StateUpdateSyncResult) {
  return result.completed + result.conflicts + result.failed + result.retriable;
}
