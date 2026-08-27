import { describe, expect, it } from "vitest";

import {
  shouldEmitStateUpdateRefresh,
  shouldHandleStateUpdateRefresh,
} from "./state-update-refresh";

describe("state update refresh signal", () => {
  it("emits after a successful state update sync so open workflows can refresh", () => {
    expect(shouldEmitStateUpdateRefresh({
      result: { completed: 1, conflicts: 0, failed: 0, operationsAttempted: 1, operationsSelected: 1, reconciledAfterTimeout: false, retriable: 0 },
      selectedOperations: 1,
    })).toBe(true);
  });

  it("emits after partial failure so counts and latest state are re-read", () => {
    expect(shouldEmitStateUpdateRefresh({
      result: { completed: 2, conflicts: 0, failed: 1, operationsAttempted: 3, operationsSelected: 3, reconciledAfterTimeout: false, retriable: 0 },
      selectedOperations: 3,
    })).toBe(true);
  });

  it("does not emit when reconnect found no state update work", () => {
    expect(shouldEmitStateUpdateRefresh({
      result: { completed: 0, conflicts: 0, failed: 0, operationsAttempted: 0, operationsSelected: 0, reconciledAfterTimeout: false, retriable: 0 },
      selectedOperations: 0,
    })).toBe(false);
  });

  it("handles each emitted key once and skips initial mount", () => {
    expect(shouldHandleStateUpdateRefresh({ currentKey: 0, previousKey: 0 })).toBe(false);
    expect(shouldHandleStateUpdateRefresh({ currentKey: 1, previousKey: 0 })).toBe(true);
    expect(shouldHandleStateUpdateRefresh({ currentKey: 1, previousKey: 1 })).toBe(false);
  });
});
