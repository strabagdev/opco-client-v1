import { afterEach, describe, expect, it, vi } from "vitest";
import { useOfflinePreparationRecovery } from "./use-offline-preparation-recovery";

const harness = vi.hoisted(() => {
  const effects: { deps?: unknown[]; cleanup?: () => void }[] = [];
  const refs: { current: unknown }[] = [];
  let index = 0, refIndex = 0;
  let pending: (() => void)[] = [];
  const changes = new Set<(state: string) => void>();
  return {
    begin() { index = 0; refIndex = 0; pending = []; },
    flush() { pending.forEach(effect => effect()); },
    reset() { effects.forEach(e => e.cleanup?.()); effects.length = 0; refs.length = 0; changes.clear(); },
    useRef<T>(value: T) { const i = refIndex++; refs[i] ??= { current: value }; return refs[i] as { current: T }; },
    useEffect(effect: () => void | (() => void), deps?: unknown[]) {
      const i = index++, previous = effects[i];
      if (!deps || !previous?.deps || deps.length !== previous.deps.length || deps.some((d,n) => d !== previous.deps![n])) {
        pending.push(() => { previous?.cleanup?.(); effects[i] = { deps, cleanup: effect() ?? undefined }; });
      }
    },
    appState: { currentState: "active", addEventListener: vi.fn((_event: string, listener: (state: string) => void) => {
      changes.add(listener); return { remove: () => changes.delete(listener) };
    }) },
    change(state: string) { changes.forEach(listener => listener(state)); },
    reconcile: vi.fn(async (_input: unknown) => undefined),
    subscribe: vi.fn((_input: unknown) => vi.fn()),
  };
});
vi.mock("react", () => ({ useRef: harness.useRef, useEffect: harness.useEffect }));
vi.mock("react-native", () => ({ AppState: harness.appState }));
vi.mock("../lib/app-view-prewarm", () => ({ reconcileOfflinePreparation: harness.reconcile, subscribeOfflinePreparationExecution: harness.subscribe }));
type Input = Parameters<typeof useOfflinePreparationRecovery>[0];
const input = (): Input => ({ api: {} as never, store: {} as never, ownerKey: "owner", contractId: "contract", token: "session",
  connectivityStatus: "offline", canRecover: true, beforeRecovery: vi.fn(async () => true), onChange: vi.fn() });
function TestComponent(value: Input) { harness.begin(); useOfflinePreparationRecovery(value); harness.flush(); }
afterEach(() => { harness.reset(); vi.clearAllMocks(); });

describe("session preparation reconciliation events", () => {
  it("hydrates offline, resumes on connectivity/readiness and foreground, without reacting to ordinary renders", () => {
    const value = input(); TestComponent(value);
    expect(harness.reconcile).toHaveBeenCalledTimes(1);
    expect(harness.reconcile.mock.calls[0][0]).toMatchObject({ online: false });
    TestComponent({ ...value, onChange: vi.fn() }); expect(harness.reconcile).toHaveBeenCalledTimes(1);
    TestComponent({ ...value, connectivityStatus: "online" }); expect(harness.reconcile).toHaveBeenCalledTimes(2);
    harness.change("background"); harness.change("active"); expect(harness.reconcile).toHaveBeenCalledTimes(3);
    harness.change("active"); expect(harness.reconcile).toHaveBeenCalledTimes(3);
  });
  it("invalidates old scope/session callbacks before they can publish or pass preflight", async () => {
    const value = input(); TestComponent(value);
    const old = harness.reconcile.mock.calls[0][0] as { isCurrent(): boolean; beforeRecovery(): Promise<boolean> };
    const subscription = harness.subscribe.mock.calls[0][0] as { onChange(value: unknown): void };
    expect(old.isCurrent()).toBe(true);
    const next = { ...value, ownerKey: "other", token: "other-session", onChange: vi.fn() }; TestComponent(next);
    expect(old.isCurrent()).toBe(false); expect(await old.beforeRecovery()).toBe(false);
    const calls = next.onChange.mock.calls.length; subscription.onChange({ active: true });
    expect(next.onChange).toHaveBeenCalledTimes(calls); expect(value.beforeRecovery).not.toHaveBeenCalled();
  });
  it("defers recovery while writes/readiness are busy and resumes once eligible", () => {
    const value = { ...input(), connectivityStatus: "online" as const, canRecover: false }; TestComponent(value);
    expect(harness.reconcile.mock.calls[0][0]).toMatchObject({ online: false });
    TestComponent({ ...value, canRecover: true }); expect(harness.reconcile.mock.calls[1][0]).toMatchObject({ online: true });
    TestComponent({ ...value, canRecover: true }); expect(harness.reconcile).toHaveBeenCalledTimes(2);
  });
});
