import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyStateUpdateReconnectDiagnostics, useSessionDiagnostics } from "./use-session-diagnostics";

const hooks = vi.hoisted(() => {
  const callbacks: { deps: unknown[]; value: unknown }[] = [];
  const effects: { cleanup?: () => void; deps: unknown[] }[] = [];
  const refs: { current: unknown }[] = [];
  const states: unknown[] = [];
  let callbackIndex = 0;
  let effectIndex = 0;
  let refIndex = 0;
  let stateIndex = 0;
  let pendingEffects: (() => void | (() => void))[] = [];

  const sameDeps = (left: unknown[], right: unknown[]) =>
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

  return {
    beginRender() {
      callbackIndex = 0;
      effectIndex = 0;
      refIndex = 0;
      stateIndex = 0;
      pendingEffects = [];
    },
    flushEffects() {
      for (const run of pendingEffects) run();
      pendingEffects = [];
    },
    reset() {
      callbacks.splice(0);
      effects.splice(0);
      refs.splice(0);
      states.splice(0);
    },
    useCallback<T>(callback: T, deps: unknown[]) {
      const index = callbackIndex++;
      const previous = callbacks[index];
      if (!previous || !sameDeps(previous.deps, deps)) callbacks[index] = { deps, value: callback };
      return callbacks[index].value as T;
    },
    useEffect(effect: () => void | (() => void), deps: unknown[]) {
      const index = effectIndex++;
      const previous = effects[index];
      if (!previous || !sameDeps(previous.deps, deps)) {
        previous?.cleanup?.();
        pendingEffects.push(() => {
          const cleanup = effect();
          effects[index] = { cleanup: cleanup ?? undefined, deps };
        });
      }
    },
    useRef<T>(initial: T) {
      const index = refIndex++;
      refs[index] ??= { current: initial };
      return refs[index] as { current: T };
    },
    useState<T>(initial: T) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      const setState = (next: T | ((current: T) => T)) => {
        states[index] = typeof next === "function" ? (next as (current: T) => T)(states[index] as T) : next;
      };
      return [states[index] as T, setState] as const;
    },
  };
});

vi.mock("react", () => ({
  useCallback: hooks.useCallback,
  useEffect: hooks.useEffect,
  useRef: hooks.useRef,
  useState: hooks.useState,
}));

describe("session diagnostics connectivity persistence effect", () => {
  afterEach(() => {
    vi.useRealTimers();
    hooks.reset();
  });

  it("stabilizes after its own state update when connectivity did not change", async () => {
    vi.useFakeTimers();
    const getTelemetry = vi.fn(async () => emptyStateUpdateReconnectDiagnostics);
    const setTelemetry = vi.fn(async () => undefined);
    const store = {
      getStateUpdateSyncDiagnosticsTelemetry: getTelemetry,
      setStateUpdateSyncDiagnosticsTelemetry: setTelemetry,
    };
    const TestComponent = () => {
      hooks.beginRender();
      useSessionDiagnostics({
        api: {} as never,
        connectivityStatus: "online",
        definitionCache: store as never,
        ownerKey: "owner-safe",
        setStateUpdateReconnectRefreshKey: vi.fn(),
        showStateUpdateDiagnostics: false,
        token: "token-not-read",
      });
      hooks.flushEffects();
    };

    TestComponent();
    await vi.runAllTimersAsync();
    await Promise.resolve();
    TestComponent();
    await vi.runAllTimersAsync();
    TestComponent();
    await vi.runAllTimersAsync();

    expect(getTelemetry).toHaveBeenCalledTimes(2);
    expect(setTelemetry).toHaveBeenCalledTimes(1);
  });
});
