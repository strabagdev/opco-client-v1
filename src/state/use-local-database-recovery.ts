import { useCallback, useEffect, useState } from "react";

import {
  getLocalDatabaseRecoverySummary,
  getLocalDatabaseStorageState,
  resetLocalDatabaseAfterConfirmation,
  retryLocalDatabaseInitialization,
  subscribeLocalDatabaseStorageState,
} from "../lib/local-db";
import { LocalDatabaseStorageState } from "../lib/local-db-recovery";
import { RecordsSyncSummary } from "../lib/offline-records";
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

  useEffect(
    () =>
      subscribeLocalDatabaseStorageState(() => {
        setLocalDatabaseStorageState(getLocalDatabaseStorageState());
      }),
    [],
  );

  const retryLocalStorage = useCallback(async () => {
    await retryLocalDatabaseInitialization();
    setBootstrapAttempt((attempt) => attempt + 1);
    setStatus("loading");
  }, [setBootstrapAttempt, setStatus]);

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
    getRecoverySummary: getLocalDatabaseRecoverySummary,
    localDatabaseStorageState,
    localStorageRecoveryNotice,
    resetLocalStorage,
    retryLocalStorage,
  };
}
