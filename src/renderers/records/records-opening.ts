import { useSyncExternalStore } from "react";

import type { CachedRecordsResult } from "@/lib/offline-records";
import {
  type RecordsOpeningHistoryStore,
  type RecordsOpeningMeasurement,
  upsertRecordsOpeningHistory,
} from "../../lib/records-opening-history";

export type RecordsOpeningHistorySnapshot = { history: RecordsOpeningMeasurement[]; scopeKey: string | null };

type OpeningResult<TLocal, TRemote> = {
  local: TLocal | null;
  localPresented: boolean;
  remote: TRemote;
};

type OpeningInput<TLocal, TRemote> = {
  canPresentLocal(local: TLocal): boolean;
  isActive?(): boolean;
  onPresentLocal(local: TLocal): void;
  readLocal(): Promise<TLocal>;
  refreshRemote(): Promise<TRemote>;
};

let historySnapshot: RecordsOpeningHistorySnapshot = { history: [], scopeKey: null };
const listeners = new Set<() => void>();
const clearedOwners = new Set<string>();
let historyGeneration = 0;

export async function loadRecordsCacheFirst<TLocal, TRemote>({
  canPresentLocal,
  isActive = () => true,
  onPresentLocal,
  readLocal,
  refreshRemote,
}: OpeningInput<TLocal, TRemote>): Promise<OpeningResult<TLocal, TRemote>> {
  const remoteOutcome = refreshRemote().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ error, ok: false as const }),
  );
  let local: TLocal | null = null;

  try {
    local = await readLocal();
  } catch {
    // Local cache availability must not block an otherwise valid remote opening.
  }

  const localPresented = local !== null && isActive() && canPresentLocal(local);

  if (localPresented && local !== null) {
    onPresentLocal(local);
  }

  const outcome = await remoteOutcome;

  if (!outcome.ok) {
    throw outcome.error;
  }

  return { local, localPresented, remote: outcome.value };
}

export async function hydrateRecordsOpeningHistory({
  contractId,
  ownerKey,
  store,
}: {
  contractId: string;
  ownerKey: string;
  store: RecordsOpeningHistoryStore;
}) {
  const scopeKey = openingScopeKey(ownerKey, contractId);
  const generation = historyGeneration;

  try {
    const persisted = await store.getRecordsOpeningHistory(ownerKey, contractId);
    if (generation !== historyGeneration || clearedOwners.has(ownerKey)) return;
    const current = historySnapshot.scopeKey === scopeKey ? historySnapshot.history : [];
    setHistorySnapshot({
      history: current.reduce(upsertRecordsOpeningHistory, persisted),
      scopeKey,
    });
  } catch {
    if (historySnapshot.scopeKey !== scopeKey) setHistorySnapshot({ history: [], scopeKey });
  }
}

export function activateRecordsOpeningHistoryOwner(ownerKey: string) {
  clearedOwners.delete(ownerKey);
}

export function recordRecordsOpeningMeasurement({
  contractId,
  measurement,
  ownerKey,
  store,
}: {
  contractId: string;
  measurement: RecordsOpeningMeasurement;
  ownerKey: string;
  store: RecordsOpeningHistoryStore;
}) {
  if (clearedOwners.has(ownerKey)) return;
  const scopeKey = openingScopeKey(ownerKey, contractId);
  const current = historySnapshot.scopeKey === scopeKey ? historySnapshot.history : [];
  setHistorySnapshot({ history: upsertRecordsOpeningHistory(current, measurement), scopeKey });
  void store.upsertRecordsOpeningMeasurement(ownerKey, contractId, measurement).catch(() => undefined);
}

export function clearRecordsOpeningHistorySnapshot(ownerKey?: string | null) {
  historyGeneration += 1;
  if (ownerKey) clearedOwners.add(ownerKey);
  setHistorySnapshot({ history: [], scopeKey: null });
}

export function getRecordsOpeningHistorySnapshot() {
  return historySnapshot;
}

export function selectPresentableLocalRecords(result: CachedRecordsResult, snapshotComplete: boolean) {
  if (snapshotComplete) return result;

  const records = result.records.filter((record) => record.syncStatus !== "synced");

  return {
    ...result,
    pagination: {
      ...result.pagination,
      page: 1,
      total: records.length,
      totalPages: 1,
    },
    records,
  };
}

export function shouldStartRecordsOpeningMeasurement(previousScope: string | null, nextScope: string) {
  return previousScope !== nextScope;
}

export function useRecordsOpeningHistory() {
  return useSyncExternalStore(subscribe, getRecordsOpeningHistorySnapshot, getRecordsOpeningHistorySnapshot);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setHistorySnapshot(snapshot: RecordsOpeningHistorySnapshot) {
  historySnapshot = snapshot;
  listeners.forEach((listener) => listener());
}

function openingScopeKey(ownerKey: string, contractId: string) {
  return `${ownerKey}\u0000${contractId}`;
}
