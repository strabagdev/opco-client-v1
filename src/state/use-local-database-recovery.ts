import { useCallback, useEffect, useRef, useState } from "react";

import {
  getLocalDatabaseRecoverySummary,
  getLocalDatabaseStorageState,
  resetLocalDatabaseAfterConfirmation,
  retryLocalDatabaseInitialization,
  subscribeLocalDatabaseStorageState,
} from "../lib/local-db";
import { LocalDatabaseStorageState } from "../lib/local-db-recovery";
import { RecordsSyncSummary } from "../lib/offline-records";
import { clearOpfsOpeningRecoveryBudget, startOpfsOpeningRecovery, type OpfsOpeningRecoveryStatus } from "../lib/opfs-opening-recovery";
import { getLocalDatabaseRecoveryGuidance } from "./local-database-recovery-logic";
export {
  getLocalDatabaseFailurePhase,
  getLocalDatabaseRecoveryGuidance,
} from "./local-database-recovery-logic";

type UseLocalDatabaseRecoveryInput = {
  connectivityStatus: string;
  emptyRecordsSyncSummary: RecordsSyncSummary;
  setBootstrapAttempt(updater: (attempt: number) => number): void;
  setContext(value: null): void;
  setMe(value: null): void;
  setPendingRecordsCount(value: number): void;
  setRecordsReconnectRefreshKey(updater: (key: number) => number): void;
  setRecordsSyncSummary(value: RecordsSyncSummary): void;
  setSelectedContractIdState(value: null): void;
  setStatus(value: "loading"): void;
};

export function useLocalDatabaseRecovery({
  connectivityStatus,
  emptyRecordsSyncSummary,
  setBootstrapAttempt,
  setContext,
  setMe,
  setPendingRecordsCount,
  setRecordsReconnectRefreshKey,
  setRecordsSyncSummary,
  setSelectedContractIdState,
  setStatus,
}: UseLocalDatabaseRecoveryInput) {
  const [localDatabaseStorageState, setLocalDatabaseStorageState] = useState<LocalDatabaseStorageState>(
    getLocalDatabaseStorageState,
  );
  const [localStorageRecoveryNotice, setLocalStorageRecoveryNotice] = useState<string | null>(null);
  const reloadRequested = useRef(false);
  const [automaticRecovery, setAutomaticRecovery] = useState<OpfsOpeningRecoveryStatus>("idle");

  useEffect(
    () =>
      subscribeLocalDatabaseStorageState(() => {
        setLocalDatabaseStorageState(getLocalDatabaseStorageState());
      }),
    [],
  );

  const canRecoverOpening = getLocalDatabaseRecoveryGuidance(localDatabaseStorageState).reloadOnRetry;
  useEffect(() => {
    if (localDatabaseStorageState.status === "ready") clearOpfsOpeningRecoveryBudget();
    if (!canRecoverOpening) return;
    return startOpfsOpeningRecovery({
      isEligible: () => getLocalDatabaseRecoveryGuidance(getLocalDatabaseStorageState()).reloadOnRetry && !reloadRequested.current,
      onStatus: setAutomaticRecovery,
      reload: () => {
        reloadRequested.current = true;
        try { window.location.reload(); }
        catch (error) { reloadRequested.current = false; throw error; }
      },
    });
  }, [canRecoverOpening, localDatabaseStorageState.status]);

  const retryLocalStorage = useCallback(async () => {
    const displayedReload = getLocalDatabaseRecoveryGuidance(localDatabaseStorageState).reloadOnRetry;
    const currentReload = getLocalDatabaseRecoveryGuidance(getLocalDatabaseStorageState()).reloadOnRetry;
    if (displayedReload || currentReload) {
      // Reload only the blocked initial document whose warning was actually presented.
      // A late click must not restart a runtime that has since become operational.
      if (!displayedReload || !currentReload || reloadRequested.current) return;
      reloadRequested.current = true;
      try {
        window.location.reload();
      } catch (error) {
        reloadRequested.current = false;
        throw error;
      }
      return;
    }
    await retryLocalDatabaseInitialization();
    setBootstrapAttempt((attempt) => attempt + 1);
    setStatus("loading");
  }, [localDatabaseStorageState, setBootstrapAttempt, setStatus]);

  const resetLocalStorage = useCallback(async () => {
    await resetLocalDatabaseAfterConfirmation({ confirmed: true });
    setMe(null);
    setContext(null);
    setSelectedContractIdState(null);
    setRecordsSyncSummary(emptyRecordsSyncSummary);
    setPendingRecordsCount(0);
    setRecordsReconnectRefreshKey((key) => key + 1);
    setLocalStorageRecoveryNotice(
      connectivityStatus === "offline" ? "Conectate para volver a descargar los datos." : null,
    );
    setBootstrapAttempt((attempt) => attempt + 1);
    setStatus("loading");
  }, [
    connectivityStatus,
    emptyRecordsSyncSummary,
    setBootstrapAttempt,
    setContext,
    setMe,
    setPendingRecordsCount,
    setRecordsReconnectRefreshKey,
    setRecordsSyncSummary,
    setSelectedContractIdState,
    setStatus,
  ]);

  return {
    automaticRecovery,
    getRecoverySummary: getLocalDatabaseRecoverySummary,
    localDatabaseStorageState,
    localStorageRecoveryNotice,
    resetLocalStorage,
    retryLocalStorage,
  };
}
