import { useCallback, useEffect, useRef, useState } from "react";
import { prepareStateUpdateContextOnce, stateUpdateContextPreparationKey, type StateUpdateContextPreparationInput } from "@/lib/app-view-prewarm";
import type { StateUpdateCurrentCoverage } from "@/lib/state-update-offline";

type Phase = "idle" | "preparing" | "ready" | "partial" | "failed" | "offline";
type Preparation = { scopeKey: string | null; phase: Phase; coverage: StateUpdateCurrentCoverage | null; error: unknown; queued?: boolean };

/** Scheduling only: fetching, bounded concurrency and persistence stay in the shared preparer. */
export function useContextPreparation({ input, connectivityStatus, canPrepare, refreshKey }: {
  input: Omit<StateUpdateContextPreparationInput, "signal" | "force"> | null;
  connectivityStatus: string;
  canPrepare: boolean;
  refreshKey: number;
}) {
  const scopeKey = input ? stateUpdateContextPreparationKey(input.scope) : null;
  const online = connectivityStatus === "online";
  const [state, setState] = useState<Preparation>({ scopeKey: null, phase: "idle", coverage: null, error: null });
  const active = useRef<{ scopeKey: string | null; controller: AbortController; promise: Promise<void>; generation: number } | null>(null);
  const demand = useRef({ scopeKey: null as string | null, refreshKey, generation: 0, attempted: 0, sawOffline: false });

  useEffect(() => () => {
    const run = active.current;
    if (!run || run.scopeKey !== scopeKey) return;
    // A cancelled mount/connection may resume; a failed completed attempt does not retry itself.
    demand.current.attempted = Math.min(demand.current.attempted, run.generation - 1);
    run.controller.abort();
    active.current = null;
  }, [scopeKey, online]);

  const prepare = useCallback((generation?: number): Promise<void> => {
    if (!input || !online || !canPrepare) return Promise.resolve();
    if (active.current) return active.current.promise;
    const requested = generation ?? ++demand.current.generation;
    demand.current.attempted = requested;
    const controller = new AbortController();
    setState(current => ({ scopeKey, phase: "preparing", coverage: current.scopeKey === scopeKey ? current.coverage : null, error: null }));
    const promise = Promise.resolve().then(async () => {
      let coverage: StateUpdateCurrentCoverage | null = null;
      let coverageRead = false;
      let error: unknown = null;
      try {
        // Complete is persisted coverage, not proof that remote data is still fresh.
        await prepareStateUpdateContextOnce({ ...input, signal: controller.signal, force: true });
        if (controller.signal.aborted) return;
        coverage = await input.store.getStateUpdateCurrentCoverage(input.scope);
        coverageRead = true;
      } catch (failure) {
        error = failure;
        // Revalidate the surviving copy, including any ACK invalidation; never restore an old marker.
        if (!controller.signal.aborted) {
          try { coverage = await input.store.getStateUpdateCurrentCoverage(input.scope); coverageRead = true; } catch { /* Keep the refresh failure and the last known copy. */ }
        }
      } finally {
        if (active.current?.controller === controller) active.current = null;
        if (!controller.signal.aborted) {
          const pending = demand.current.scopeKey === scopeKey && demand.current.generation > requested;
          setState(current => ({ scopeKey,
            phase: pending ? "idle" : error ? "failed" : coverage?.status === "complete" ? "ready" : "partial",
            coverage: coverageRead ? coverage : current.scopeKey === scopeKey ? current.coverage : null,
            error,
            queued: pending,
          }));
        }
      }
    });
    active.current = { scopeKey, controller, promise, generation: requested };
    return promise;
  }, [input, scopeKey, online, canPrepare]);

  useEffect(() => {
    const wanted = demand.current;
    if (wanted.scopeKey !== scopeKey) { wanted.scopeKey = scopeKey; wanted.generation++; }
    if (connectivityStatus === "offline") wanted.sawOffline = true;
    if (online && wanted.sawOffline) { wanted.sawOffline = false; wanted.generation++; }
    if (wanted.refreshKey !== refreshKey) { wanted.refreshKey = refreshKey; wanted.generation++; }
    if (!input || !online || !canPrepare || active.current || wanted.attempted >= wanted.generation) return;
    // Multiple signals while blocked/running collapse into the newest demand. Completion rechecks it.
    void prepare(wanted.generation);
  }, [scopeKey, input, online, connectivityStatus, canPrepare, refreshKey, prepare, state.phase]);

  useEffect(() => {
    if (!input || (online && state.scopeKey === scopeKey)) return;
    let cancelled = false;
    void input.store.getStateUpdateCurrentCoverage(input.scope).then(coverage => {
      if (!cancelled && !active.current) setState({ scopeKey, phase: online ? "idle" : "offline", coverage, error: null });
    }).catch(error => {
      if (!cancelled && !active.current) setState({ scopeKey, phase: "failed", coverage: null, error });
    });
    return () => { cancelled = true; };
  }, [input, scopeKey, online, state.scopeKey]);

  const current = state.scopeKey === scopeKey ? state : { scopeKey, phase: "idle" as const, coverage: null, error: null };
  return { ...current, isPreparing: online && (current.phase === "preparing" || Boolean(current.queued && canPrepare)), prepare };
}
