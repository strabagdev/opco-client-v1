import { useCallback, useEffect, useRef, useState } from "react";
import { prepareStateUpdateContextOnce, stateUpdateContextPreparationKey, type StateUpdateContextPreparationInput } from "@/lib/app-view-prewarm";
import type { StateUpdateCurrentCoverage } from "@/lib/state-update-offline";

type Phase = "idle" | "preparing" | "ready" | "partial" | "failed" | "offline";
type Preparation = { scopeKey: string | null; phase: Phase; coverage: StateUpdateCurrentCoverage | null; error: unknown };

/** Scheduling only: all fetching, persistence, verification and single-flight stay in the shared preparer. */
export function useContextPreparation({ input, connectivityStatus, canPrepare, refreshKey }: {
  input: Omit<StateUpdateContextPreparationInput, "signal" | "force"> | null;
  connectivityStatus: string;
  canPrepare: boolean;
  refreshKey: number;
}) {
  const scopeKey = input ? stateUpdateContextPreparationKey(input.scope) : null;
  const online = connectivityStatus === "online";
  const [state, setState] = useState<Preparation>({ scopeKey: null, phase: "idle", coverage: null, error: null });
  const active = useRef<{ controller: AbortController; promise: Promise<void>; attemptKey?: string } | null>(null);
  const attempted = useRef(new Set<string>());
  const reconnectEpoch = useRef(0);
  const sawOffline = useRef(false);

  useEffect(() => () => {
    if (active.current?.attemptKey) attempted.current.delete(active.current.attemptKey);
    active.current?.controller.abort();
    active.current = null;
  }, [scopeKey, online]);

  const prepare = useCallback((force = true, attemptKey?: string): Promise<void> => {
    if (!input || !online || !canPrepare) return Promise.resolve();
    if (active.current) return active.current.promise;
    const controller = new AbortController();
    setState(current => ({ scopeKey, phase: "preparing", coverage: current.scopeKey === scopeKey ? current.coverage : null, error: null }));
    const promise = Promise.resolve().then(async () => {
      try {
        await prepareStateUpdateContextOnce({ ...input, signal: controller.signal, force });
        if (controller.signal.aborted) return;
        const coverage = await input.store.getStateUpdateCurrentCoverage(input.scope);
        if (controller.signal.aborted) return;
        setState({ scopeKey, phase: coverage?.status === "complete" ? "ready" : "partial", coverage, error: null });
      } catch (error) {
        if (!controller.signal.aborted) setState(current => ({ ...current, scopeKey, phase: "failed", error }));
      } finally {
        if (active.current?.controller === controller) active.current = null;
      }
    });
    active.current = { controller, promise, attemptKey };
    return promise;
  }, [input, scopeKey, online, canPrepare]);

  useEffect(() => {
    if (connectivityStatus === "offline") sawOffline.current = true;
    if (online && sawOffline.current) {
      reconnectEpoch.current++;
      sawOffline.current = false;
    }
    if (!input || !online || !canPrepare || active.current) return;
    const key = JSON.stringify([scopeKey, reconnectEpoch.current, refreshKey]);
    if (attempted.current.has(key)) return;
    attempted.current.add(key);
    void prepare(false, key);
  }, [scopeKey, input, online, connectivityStatus, canPrepare, refreshKey, prepare, state.phase]);

  useEffect(() => {
    // Revisiting a completed/failed attempt still needs its persisted marker, without another download.
    if (!input || (online && state.scopeKey === scopeKey)) return;
    let cancelled = false;
    void input.store.getStateUpdateCurrentCoverage(input.scope).then(coverage => {
      if (!cancelled && !active.current) setState({ scopeKey,
        phase: online ? coverage?.status === "complete" ? "ready" : "partial" : "offline", coverage, error: null });
    }).catch(error => {
      if (!cancelled && !active.current) setState({ scopeKey, phase: "failed", coverage: null, error });
    });
    return () => { cancelled = true; };
  }, [input, scopeKey, online, state.scopeKey]);

  const current = state.scopeKey === scopeKey ? state : { scopeKey, phase: "idle" as const, coverage: null, error: null };
  return { ...current, isPreparing: online && current.phase === "preparing", prepare };
}
